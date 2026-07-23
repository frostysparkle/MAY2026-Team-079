from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings


class RedisService:
    """Application-scoped Redis client for short-lived verification state."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Redis | None = None

    @property
    def client(self) -> Redis:
        if self._client is None:
            raise RuntimeError("Redis is not configured. Set REDIS_URL first.")
        return self._client

    def connect(self) -> None:
        if self._settings.redis_url:
            self._client = Redis.from_url(
                self._settings.redis_url,
                decode_responses=True,
                health_check_interval=30,
            )

    async def ping(self) -> bool:
        if self._client is None:
            return False
        try:
            return bool(await self._client.ping())
        except RedisError:
            return False

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
