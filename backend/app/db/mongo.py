"""Application-scoped MongoDB client management."""

from typing import Any

from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError

from app.core.config import Settings


class MongoService:

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: AsyncMongoClient[dict[str, Any]] | None = None

    @property
    def database(self):
        if self._client is None:
            raise RuntimeError("MongoDB is not configured. Set MONGODB_URI first.")
        return self._client[self._settings.mongodb_database]

    def connect(self) -> None:
        if self._settings.mongodb_uri:
            self._client = AsyncMongoClient(self._settings.mongodb_uri)

    async def ping(self) -> bool:
        if self._client is None:
            return False

        try:
            await self._client.admin.command("ping")
        except PyMongoError:
            return False
        return True

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
