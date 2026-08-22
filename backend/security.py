import os
from pathlib import Path
from datetime import datetime, timedelta
from jose import jwt
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
import base64
import json
import bcrypt
from dotenv import load_dotenv

# security.py can be imported before database.py (or without it at all), so it
# loads the env file itself instead of assuming someone else already did.
# load_dotenv never overrides variables already set in the environment, so this
# is safe no matter the import order.
load_dotenv(Path(__file__).resolve().parent / "atlas-credentials.env")

# The JWT signing key must come from the environment. The previous committed
# fallback ("paradox-super-secret-jwt-key") meant any deployment that had not set
# SECRET_KEY signed tokens with a public string, so anyone could forge them.
# Missing it now refuses to boot rather than silently degrading to that key.
if not os.getenv("SECRET_KEY"):
    raise RuntimeError(
        "SECRET_KEY is not set. Add SECRET_KEY=<64 hex chars> to "
        "backend/atlas-credentials.env. Generate one with: "
        'python -c "import secrets; print(secrets.token_hex(32))"'
    )
SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = "HS256"
# Overridable per deployment; 1 week remains the effective default when unset.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Whether this password matches this stored hash.

    Returns False rather than raising when the stored hash is missing or not a
    bcrypt hash at all. It used to raise: `None.encode()` gave `AttributeError` and a
    malformed string gave `ValueError`, both of which reached the client as a 500
    from `POST /auth/login` — an account whose document was created by anything
    other than `POST /auth/register` could not fail to log in, it could only crash.

    False is the truthful answer in every case. A document with no usable hash has no
    password that can match, so the callers' own "Invalid credentials" 401 and
    "Incorrect current password" 400 are exactly right. Refusing to authenticate is
    also the safe direction to fail: there is no input for which this now returns True
    where it previously raised.
    """
    if not plain_password or not hashed_password:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        # Not a bcrypt hash — truncated, double-encoded, or written by hand.
        return False

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def generate_rsa_key_pair():
    """Generates a 2048-bit RSA key pair and returns PEM encoded strings."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()
    
    pem_private = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    
    pem_public = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    
    return pem_private.decode('utf-8'), pem_public.decode('utf-8')


# ---------------------------------------------------------------------------
# Envelope encryption for RSA private keys at rest.
#
# `qr_secrets.private_key` used to be stored as plaintext PEM inside MongoDB,
# so a single DB dump (or backup) was every attendee's digital identity: the
# private key is what scanner endpoints use to decrypt QR payloads, i.e. it
# *is* the participant's identity. Values written from here on are AES-256-GCM
# envelopes under a master key that lives only in the environment, never in
# the database. Legacy plaintext rows keep working — see decrypt_private_key.
# ---------------------------------------------------------------------------

# Every encrypted value carries this prefix. It is what lets the read path
# tell ciphertext from legacy plaintext and makes plaintext/ciphertext rows
# coexist harmlessly during the deploy -> migrate rollout window. Also how
# migrate_qr_keys.py finds the rows it still has to convert.
ENVELOPE_PREFIX = "enc:v1:"
# 96-bit nonce: standard for AES-GCM (and what AESGCM.generate_nonce produces).
_NONCE_BYTES = 12
_MASTER_KEY_BYTES = 32

_QR_KEY_GEN_HINT = (
    'python -c "import os,base64; '
    "print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
    '"'
)


def _load_qr_master_key() -> bytes:
    """Decodes QR_MASTER_KEY into raw AES key bytes.

    Mirrors the JWT-secret fail-fast policy: a missing or malformed master key
    is a startup-grade misconfiguration, not something to paper over with a
    default — silently encrypting under a known key would be worse than not
    starting at all.
    """
    value = os.getenv("QR_MASTER_KEY", "").strip()
    if not value:
        raise RuntimeError(
            "QR_MASTER_KEY is not set. It must be a urlsafe-base64 encoding of "
            f"32 random bytes. Generate one with:\n  {_QR_KEY_GEN_HINT}\n"
            "then add it to backend/atlas-credentials.env (or export it in the "
            "process environment)."
        )
    try:
        key = base64.urlsafe_b64decode(value.encode("ascii"))
    except Exception:
        raise RuntimeError(
            "QR_MASTER_KEY is not valid urlsafe-base64. Regenerate it with:\n"
            f"  {_QR_KEY_GEN_HINT}"
        )
    if len(key) != _MASTER_KEY_BYTES:
        raise RuntimeError(
            f"QR_MASTER_KEY must decode to exactly {_MASTER_KEY_BYTES} bytes, "
            f"got {len(key)}. Regenerate it with:\n  {_QR_KEY_GEN_HINT}"
        )
    return key


def encrypt_private_key(pem: str) -> str:
    """AES-GCM-seals a PEM-encoded RSA private key for storage.

    Returns ``enc:v1:<urlsafe-base64(nonce || ciphertext || tag)>``. A fresh
    12-byte nonce is drawn per call, so encrypting the same key twice yields
    different strings.
    """
    key = _load_qr_master_key()
    nonce = os.urandom(_NONCE_BYTES)
    sealed = AESGCM(key).encrypt(nonce, pem.encode("utf-8"), None)
    return ENVELOPE_PREFIX + base64.urlsafe_b64encode(nonce + sealed).decode("ascii")


def decrypt_private_key(stored: str) -> str:
    """Returns the plaintext PEM for a stored ``qr_secrets.private_key``.

    Rows without the ``enc:v1:`` prefix are legacy plaintext and pass through
    untouched, which keeps pre-migration data readable while the fleet rolls
    out. An *encrypted* row without a usable master key raises rather than
    handing back garbage the RSA layer would choke on anyway.
    """
    if not stored.startswith(ENVELOPE_PREFIX):
        return stored

    encoded = stored[len(ENVELOPE_PREFIX):]
    try:
        blob = base64.urlsafe_b64decode(encoded.encode("ascii"))
    except Exception:
        raise RuntimeError(
            "qr_secrets.private_key has an enc:v1: prefix but its payload is "
            "not valid urlsafe-base64; the row is corrupted."
        )
    if len(blob) <= _NONCE_BYTES:
        raise RuntimeError(
            "qr_secrets.private_key carries an enc:v1: envelope shorter than "
            "its 12-byte nonce; the row is corrupted."
        )

    key = _load_qr_master_key()
    nonce, sealed = blob[:_NONCE_BYTES], blob[_NONCE_BYTES:]
    try:
        return AESGCM(key).decrypt(nonce, sealed, None).decode("utf-8")
    except InvalidTag:
        raise RuntimeError(
            "Failed to decrypt qr_secrets.private_key: AES-GCM authentication "
            "failed. Either this row was encrypted under a different "
            "QR_MASTER_KEY than the one configured now (rotated? wrong "
            "environment?), or the stored value was tampered with / truncated."
        )
    except UnicodeDecodeError:
        raise RuntimeError(
            "Decrypted qr_secrets.private_key is not valid UTF-8; the row is "
            "corrupted or was encrypted under a different master key."
        )


def decrypt_qr_data(private_key_pem: str, encrypted_data_b64: str) -> dict:
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode('utf-8'),
        password=None
    )
    encrypted_data = base64.b64decode(encrypted_data_b64)
    decrypted_data = private_key.decrypt(
        encrypted_data,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    )
    return json.loads(decrypted_data.decode('utf-8'))
