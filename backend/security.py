import os
from pathlib import Path
from datetime import datetime, timedelta
from jose import jwt
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes
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
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 1 week token expiry

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
