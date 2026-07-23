import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from jwt.exceptions import InvalidTokenError

from app.core.config import Settings


class SecurityConfigurationError(RuntimeError):
    pass


class InvalidAccessTokenError(ValueError):
    pass


# --- Password hashing (PBKDF2-HMAC-SHA256, stdlib only) ---------------------

_PBKDF2_ALGORITHM = "pbkdf2_sha256"
_PBKDF2_ITERATIONS = 240_000
_PBKDF2_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """Return a self-describing PBKDF2 hash: ``algo$iterations$salt$hash``."""
    salt = secrets.token_bytes(_PBKDF2_SALT_BYTES)
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return "$".join(
        [
            _PBKDF2_ALGORITHM,
            str(_PBKDF2_ITERATIONS),
            salt.hex(),
            derived.hex(),
        ]
    )


def verify_password(password: str, stored_hash: str | None) -> bool:
    """Constant-time verification of a password against a stored PBKDF2 hash."""
    if not stored_hash:
        return False
    try:
        algorithm, iterations_raw, salt_hex, expected_hex = stored_hash.split("$")
        if algorithm != _PBKDF2_ALGORITHM:
            return False
        iterations = int(iterations_raw)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(expected_hex)
    except (ValueError, AttributeError):
        return False

    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations
    )
    return hmac.compare_digest(derived, expected)


def _jwt_secret(settings: Settings) -> str:
    secret = settings.jwt_secret
    if secret is None or len(secret) < 32:
        raise SecurityConfigurationError(
            "JWT_SECRET must contain at least 32 characters."
        )
    return secret


def create_access_token(user_id: str, settings: Settings) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iss": settings.jwt_issuer,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_token_minutes),
    }
    return jwt.encode(payload, _jwt_secret(settings), algorithm="HS256")


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            _jwt_secret(settings),
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "iss", "type", "iat", "exp"]},
        )
    except InvalidTokenError as exc:
        raise InvalidAccessTokenError("The access token is invalid or expired.") from exc

    if payload.get("type") != "access" or not isinstance(payload.get("sub"), str):
        raise InvalidAccessTokenError("The access token is invalid or expired.")
    return payload
