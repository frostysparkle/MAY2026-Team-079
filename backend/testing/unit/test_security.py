"""
Unit tests for backend/security.py — real bcrypt, real JWTs, real RSA.

Marked slow where full-cost cryptography is the subject: these are the tests
that justify not stubbing it anywhere else.
"""
import base64
import json
from datetime import timedelta

import pytest
from jose import jwt

import security


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_hash_then_verify_round_trip():
    hashed = security.get_password_hash("s3cret-password")
    assert hashed != "s3cret-password"
    assert security.verify_password("s3cret-password", hashed)


@pytest.mark.slow
def test_verify_rejects_the_wrong_password():
    hashed = security.get_password_hash("s3cret-password")
    assert not security.verify_password("s3cret-passwort", hashed)


@pytest.mark.slow
def test_two_hashes_of_the_same_password_differ():
    """Distinct salts, so a leaked table cannot be grouped by identical hashes."""
    first = security.get_password_hash("same-password")
    second = security.get_password_hash("same-password")
    assert first != second
    assert security.verify_password("same-password", first)
    assert security.verify_password("same-password", second)


@pytest.mark.slow
def test_hash_is_a_bcrypt_2b_string():
    assert security.get_password_hash("x" * 12).startswith("$2b$")


def test_verify_raises_on_a_missing_hash():
    """
    `verify_password(plain, None)` raises rather than returning False, because
    it calls `.encode()` on the hash. This is what makes `POST /auth/login`
    return 500 instead of 401 for a participant document with no
    `password_hash` — see test_auth.py for the endpoint-level xfail.
    """
    with pytest.raises(AttributeError):
        security.verify_password("anything", None)


@pytest.mark.slow
def test_verify_raises_on_a_malformed_hash():
    with pytest.raises(ValueError):
        security.verify_password("anything", "not-a-bcrypt-hash")


# ---------------------------------------------------------------------------
# Access tokens
# ---------------------------------------------------------------------------

def test_token_carries_its_claims_and_an_expiry():
    token = security.create_access_token({"sub": "DS23F000001", "type": "participant"})
    claims = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
    assert claims["sub"] == "DS23F000001"
    assert claims["type"] == "participant"
    assert "exp" in claims


def _expiry_delta(token: str, reference):
    """How far past ``reference`` this token's ``exp`` sits.

    ``create_access_token`` builds ``exp`` from ``datetime.utcnow()``, so the
    claim is seconds-since-epoch interpreted as UTC; it is read back as an aware
    UTC instant and stripped, which is the only comparison that does not shift by
    the runner's local offset.
    """
    from datetime import datetime, timezone

    claims = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
    expires_at = datetime.fromtimestamp(claims["exp"], tz=timezone.utc).replace(tzinfo=None)
    return expires_at - reference


def test_token_default_expiry_is_fifteen_minutes():
    from datetime import datetime

    before = datetime.utcnow()
    delta = _expiry_delta(security.create_access_token({"sub": "X"}), before)
    assert timedelta(minutes=14) <= delta <= timedelta(minutes=16)


def test_explicit_expiry_overrides_the_default():
    from datetime import datetime

    before = datetime.utcnow()
    token = security.create_access_token({"sub": "X"}, expires_delta=timedelta(hours=3))
    assert timedelta(minutes=175) <= _expiry_delta(token, before) <= timedelta(minutes=185)


def test_create_access_token_does_not_mutate_its_input():
    payload = {"sub": "X"}
    security.create_access_token(payload)
    assert payload == {"sub": "X"}, "`exp` leaked back into the caller's dict"


def test_an_expired_token_fails_to_decode():
    token = security.create_access_token({"sub": "X"}, expires_delta=timedelta(seconds=-10))
    with pytest.raises(jwt.JWTError):
        jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])


def test_a_token_signed_with_another_key_fails_to_decode():
    foreign = jwt.encode({"sub": "X"}, "a-different-secret", algorithm="HS256")
    with pytest.raises(jwt.JWTError):
        jwt.decode(foreign, security.SECRET_KEY, algorithms=[security.ALGORITHM])


def test_a_tampered_token_fails_to_decode():
    token = security.create_access_token({"sub": "X", "type": "participant"})
    head, payload, signature = token.split(".")
    forged = json.dumps({"sub": "X", "type": "staff"}).encode()
    tampered = ".".join([
        head,
        base64.urlsafe_b64encode(forged).decode().rstrip("="),
        signature,
    ])
    with pytest.raises(jwt.JWTError):
        jwt.decode(tampered, security.SECRET_KEY, algorithms=[security.ALGORITHM])


def test_algorithm_and_expiry_constants():
    assert security.ALGORITHM == "HS256"
    assert security.ACCESS_TOKEN_EXPIRE_MINUTES == 60 * 24 * 7


# ---------------------------------------------------------------------------
# RSA keypairs and QR decryption
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_generated_keypair_is_pem_encoded(keypair):
    private_pem, public_pem = keypair
    assert private_pem.startswith("-----BEGIN PRIVATE KEY-----")
    assert public_pem.startswith("-----BEGIN PUBLIC KEY-----")


@pytest.mark.slow
def test_each_call_produces_a_different_keypair():
    first, _ = security.generate_rsa_key_pair()
    second, _ = security.generate_rsa_key_pair()
    assert first != second


@pytest.mark.slow
def test_decrypt_qr_data_round_trip(keypair):
    from testing.helpers import encrypt_for

    payload = {"participant_id": "DS23F000001", "nonce": 42}
    assert security.decrypt_qr_data(keypair[0], encrypt_for(keypair[1], payload)) == payload


@pytest.mark.slow
def test_decrypt_qr_data_rejects_a_foreign_ciphertext(keypair, alt_keypair):
    from testing.helpers import encrypt_for

    with pytest.raises(Exception):
        security.decrypt_qr_data(keypair[0], encrypt_for(alt_keypair[1], {"a": 1}))


@pytest.mark.slow
def test_decrypt_qr_data_rejects_garbage_ciphertext(keypair):
    with pytest.raises(Exception):
        security.decrypt_qr_data(keypair[0], base64.b64encode(b"junk").decode())


def test_decrypt_qr_data_rejects_an_unusable_private_key():
    with pytest.raises(Exception):
        security.decrypt_qr_data("-----BEGIN PRIVATE KEY-----\nnope\n", "AAAA")


@pytest.mark.slow
def test_decrypt_qr_data_rejects_non_json_plaintext(keypair):
    """
    The payload must be JSON: `decrypt_qr_data` ends in `json.loads`, so
    successfully decrypted non-JSON still fails. `verify_qr` maps that to
    400 "Invalid or corrupted QR code" like any other failure.
    """
    from testing.helpers import encrypt_for
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    public_key = serialization.load_pem_public_key(keypair[1].encode())
    ciphertext = public_key.encrypt(
        b"plain text, not json",
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                     algorithm=hashes.SHA256(), label=None),
    )
    with pytest.raises(json.JSONDecodeError):
        security.decrypt_qr_data(keypair[0], base64.b64encode(ciphertext).decode())
    # `encrypt_for` is imported to keep the helper's contract visible next to the
    # hand-rolled encryption above.
    assert callable(encrypt_for)
