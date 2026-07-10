from dataclasses import dataclass
from functools import lru_cache
from os import getenv


DEFAULT_DATABASE_NAME = "paradox_connect"
DEFAULT_GOOGLE_DOMAINS = (
    "ds.study.iitm.ac.in",
    "es.study.iitm.ac.in",
    "ee.study.iitm.ac.in",
    "mg.study.iitm.ac.in",
)
DEFAULT_CORS_ORIGINS = ("http://localhost:5173",)


def _csv_setting(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw_value = getenv(name)
    if raw_value is None:
        return default
    return tuple(value.strip().casefold() for value in raw_value.split(",") if value.strip())


def _positive_int_setting(name: str, default: int) -> int:
    raw_value = getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer.") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero.")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    mongodb_uri: str | None
    mongodb_database: str
    app_env: str
    google_client_id: str | None
    allowed_google_domains: tuple[str, ...]
    jwt_secret: str | None
    jwt_issuer: str
    jwt_access_token_minutes: int
    initial_super_admin_email: str | None
    cors_origins: tuple[str, ...]


@lru_cache
def get_settings() -> Settings:
    uri = getenv("MONGODB_URI", "").strip() or None
    database = getenv("MONGODB_DATABASE", DEFAULT_DATABASE_NAME).strip()
    environment = getenv("APP_ENV", "development").strip()
    google_client_id = getenv("GOOGLE_CLIENT_ID", "").strip() or None
    jwt_secret = getenv("JWT_SECRET", "").strip() or None
    initial_super_admin_email = (
        getenv("INITIAL_SUPER_ADMIN_EMAIL", "").strip().casefold() or None
    )

    return Settings(
        mongodb_uri=uri,
        mongodb_database=database or DEFAULT_DATABASE_NAME,
        app_env=environment or "development",
        google_client_id=google_client_id,
        allowed_google_domains=_csv_setting(
            "ALLOWED_GOOGLE_DOMAINS", DEFAULT_GOOGLE_DOMAINS
        ),
        jwt_secret=jwt_secret,
        jwt_issuer=getenv("JWT_ISSUER", "paradox-connect").strip()
        or "paradox-connect",
        jwt_access_token_minutes=_positive_int_setting(
            "JWT_ACCESS_TOKEN_MINUTES", 30
        ),
        initial_super_admin_email=initial_super_admin_email,
        cors_origins=_csv_setting("CORS_ORIGINS", DEFAULT_CORS_ORIGINS),
    )
