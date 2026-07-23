"""TOTP helpers for the digital ID.

Parameters MUST match the frontend (`otpauth`) and `docs/api-contract.md`:
SHA1, 6 digits, 30s period, ±1 step window, Base32 160-bit secret.
"""

import hashlib
import hmac
import time

import pyotp


PERIOD_SECONDS = 30
DIGITS = 6
WINDOW = 1
REPLAY_TTL_SECONDS = PERIOD_SECONDS * (2 * WINDOW + 1)


def generate_secret() -> str:
    """A fresh Base32-encoded 160-bit secret."""
    return pyotp.random_base32()


def _totp(secret_base32: str) -> pyotp.TOTP:
    return pyotp.TOTP(
        secret_base32, digits=DIGITS, digest=hashlib.sha1, interval=PERIOD_SECONDS
    )


def verify_and_step(
    secret_base32: str, code: str, at: float | None = None
) -> int | None:
    """Verify a code within ±WINDOW steps.

    Returns the matched time-step (for replay protection) or None if invalid.
    """
    now = time.time() if at is None else at
    totp = _totp(secret_base32)
    for offset in (0, -1, 1):
        moment = now + offset * PERIOD_SECONDS
        if hmac.compare_digest(totp.at(moment), code):
            return int(moment // PERIOD_SECONDS)
    return None
