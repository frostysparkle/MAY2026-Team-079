from dataclasses import dataclass
from functools import lru_cache
from os import getenv


DEFAULT_DATABASE_NAME = "paradox_connect"


@dataclass(frozen=True, slots=True)
class Settings:
    mongodb_uri: str | None
    mongodb_database: str
    app_env: str


@lru_cache
def get_settings() -> Settings:
    uri = getenv("MONGODB_URI", "").strip() or None
    database = getenv("MONGODB_DATABASE", DEFAULT_DATABASE_NAME).strip()
    environment = getenv("APP_ENV", "development").strip()

    return Settings(
        mongodb_uri=uri,
        mongodb_database=database or DEFAULT_DATABASE_NAME,
        app_env=environment or "development",
    )
