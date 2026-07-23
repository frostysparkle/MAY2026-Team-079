import asyncio

import pytest
from cryptography.fernet import Fernet

from app.qr.crypto import (
    SecretCipher,
    SecretDecryptionError,
    SecretEncryptionConfigurationError,
)
from app.qr.verification_state import RedisVerificationState


class FakeRedis:
    def __init__(self) -> None:
        self.counters: dict[str, int] = {}
        self.expiries: dict[str, int] = {}
        self.values: dict[str, str] = {}

    async def eval(self, script, number_of_keys, key, window):
        del script
        assert number_of_keys == 1
        self.counters[key] = self.counters.get(key, 0) + 1
        if self.counters[key] == 1:
            self.expiries[key] = int(window)
        return self.counters[key]

    async def set(self, key, value, *, ex, nx):
        assert nx is True
        if key in self.values:
            return None
        self.values[key] = value
        self.expiries[key] = ex
        return True


def test_secret_cipher_round_trips_and_rejects_bad_configuration_or_tokens():
    key = Fernet.generate_key().decode("ascii")
    cipher = SecretCipher(key)
    ciphertext = cipher.encrypt("JBSWY3DPEHPK3PXP")

    assert ciphertext != "JBSWY3DPEHPK3PXP"
    assert cipher.decrypt(ciphertext) == "JBSWY3DPEHPK3PXP"

    with pytest.raises(SecretEncryptionConfigurationError):
        SecretCipher(None)
    with pytest.raises(SecretEncryptionConfigurationError):
        SecretCipher("not-a-fernet-key")
    with pytest.raises(SecretDecryptionError):
        cipher.decrypt(ciphertext[:-2] + "xx")


def test_redis_rate_limit_uses_expiring_hashed_composite_keys():
    async def run():
        redis = FakeRedis()
        state = RedisVerificationState(
            redis,  # type: ignore[arg-type]
            rate_limit=2,
            rate_window_seconds=60,
        )

        assert await state.allow_attempt("participant-1", "device-1", "127.0.0.1")
        assert await state.allow_attempt("participant-1", "device-1", "127.0.0.1")
        assert not await state.allow_attempt(
            "participant-1", "device-1", "127.0.0.1"
        )
        assert await state.allow_attempt("participant-1", "device-2", "127.0.0.1")

        keys = list(redis.counters)
        assert len(keys) == 2
        assert all("participant-1" not in key for key in keys)
        assert all(redis.expiries[key] == 60 for key in keys)

    asyncio.run(run())


def test_redis_replay_markers_are_atomic_expiring_and_scope_specific():
    async def run():
        redis = FakeRedis()
        state = RedisVerificationState(
            redis,  # type: ignore[arg-type]
            rate_limit=10,
            rate_window_seconds=60,
        )

        assert await state.mark_code_used(
            "participant-1", "event", "event-1", 123, 90
        )
        assert not await state.mark_code_used(
            "participant-1", "event", "event-1", 123, 90
        )
        assert await state.mark_code_used(
            "participant-1", "event", "event-2", 123, 90
        )
        assert len(redis.values) == 2
        assert all(redis.expiries[key] == 90 for key in redis.values)

    asyncio.run(run())
