from hashlib import sha256
from typing import Protocol

from redis.asyncio import Redis


_RATE_LIMIT_SCRIPT = """
local count = redis.call("INCR", KEYS[1])
if count == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
"""


class VerificationState(Protocol):
    async def allow_attempt(
        self,
        participant_id: str,
        scanner_device_id: str,
        scanner_ip: str,
    ) -> bool: ...

    async def mark_code_used(
        self,
        participant_id: str,
        checkpoint_context: str,
        scope_id: str,
        step: int,
        ttl_seconds: int,
    ) -> bool: ...


def _key_digest(*parts: str) -> str:
    material = "\x1f".join(parts).encode("utf-8")
    return sha256(material).hexdigest()


class RedisVerificationState:
    def __init__(
        self,
        redis: Redis,
        *,
        rate_limit: int,
        rate_window_seconds: int,
    ) -> None:
        self._redis = redis
        self._rate_limit = rate_limit
        self._rate_window_seconds = rate_window_seconds

    async def allow_attempt(
        self,
        participant_id: str,
        scanner_device_id: str,
        scanner_ip: str,
    ) -> bool:
        digest = _key_digest(participant_id, scanner_device_id, scanner_ip)
        count = await self._redis.eval(
            _RATE_LIMIT_SCRIPT,
            1,
            f"paradox:qr:rate:{digest}",
            self._rate_window_seconds,
        )
        return int(count) <= self._rate_limit

    async def mark_code_used(
        self,
        participant_id: str,
        checkpoint_context: str,
        scope_id: str,
        step: int,
        ttl_seconds: int,
    ) -> bool:
        digest = _key_digest(
            participant_id,
            checkpoint_context,
            scope_id,
            str(step),
        )
        created = await self._redis.set(
            f"paradox:qr:used:{digest}",
            "1",
            ex=ttl_seconds,
            nx=True,
        )
        return bool(created)
