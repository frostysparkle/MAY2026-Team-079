from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from jwt.exceptions import InvalidTokenError

from app.core.config import Settings


class SecurityConfigurationError(RuntimeError):
    pass


class InvalidAccessTokenError(ValueError):
    pass


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
