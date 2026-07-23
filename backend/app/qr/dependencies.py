from typing import Annotated

from fastapi import Depends, Request, status

from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.qr.crypto import (
    SecretCipher,
    SecretEncryptionConfigurationError,
)
from app.qr.verification_state import RedisVerificationState


def get_secret_cipher(
    settings: Annotated[Settings, Depends(get_settings)],
) -> SecretCipher:
    try:
        return SecretCipher(settings.qr_secret_encryption_key)
    except SecretEncryptionConfigurationError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="qr_encryption_not_configured",
            message="QR secret encryption is not configured.",
        ) from exc


def get_verification_state(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> RedisVerificationState:
    try:
        redis = request.app.state.redis.client
    except (AttributeError, RuntimeError) as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="verification_state_unavailable",
            message="QR verification state is unavailable.",
        ) from exc
    return RedisVerificationState(
        redis,
        rate_limit=settings.qr_scan_rate_limit,
        rate_window_seconds=settings.qr_scan_rate_window_seconds,
    )
