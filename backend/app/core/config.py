from dataclasses import dataclass
from functools import lru_cache
from os import getenv


DEFAULT_DATABASE_NAME = "paradox_connect"
DEFAULT_EMAIL_DOMAINS = (
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
    allowed_email_domains: tuple[str, ...]
    jwt_secret: str | None
    jwt_issuer: str
    jwt_access_token_minutes: int
    initial_super_admin_email: str | None
    initial_super_admin_password: str | None
    cors_origins: tuple[str, ...]
    payment_gateway: str
    payment_webhook_secret: str
    payment_currency: str
    hostel_fee_amount: int
    frontend_base_url: str
    enable_dev_login: bool
    redis_url: str | None
    qr_secret_encryption_key: str | None
    qr_scan_rate_limit: int
    qr_scan_rate_window_seconds: int


@lru_cache
def get_settings() -> Settings:
    uri = getenv("MONGODB_URI", "").strip() or None
    database = getenv("MONGODB_DATABASE", DEFAULT_DATABASE_NAME).strip()
    environment = getenv("APP_ENV", "development").strip() or "development"
    jwt_secret = getenv("JWT_SECRET", "").strip() or None
    initial_super_admin_email = (
        getenv("INITIAL_SUPER_ADMIN_EMAIL", "").strip().casefold() or None
    )
    initial_super_admin_password = (
        getenv("INITIAL_SUPER_ADMIN_PASSWORD", "").strip() or None
    )

    return Settings(
        mongodb_uri=uri,
        mongodb_database=database or DEFAULT_DATABASE_NAME,
        app_env=environment or "development",
        allowed_email_domains=_csv_setting(
            "ALLOWED_EMAIL_DOMAINS", DEFAULT_EMAIL_DOMAINS
        ),
        jwt_secret=jwt_secret,
        jwt_issuer=getenv("JWT_ISSUER", "paradox-connect").strip()
        or "paradox-connect",
        jwt_access_token_minutes=_positive_int_setting(
            "JWT_ACCESS_TOKEN_MINUTES", 30
        ),
        initial_super_admin_email=initial_super_admin_email,
        initial_super_admin_password=initial_super_admin_password,
        cors_origins=_csv_setting("CORS_ORIGINS", DEFAULT_CORS_ORIGINS),
        payment_gateway=getenv("PAYMENT_GATEWAY", "mock").strip().lower() or "mock",
        # A real provider must set PAYMENT_WEBHOOK_SECRET; the mock gateway falls
        # back to a dev secret so local end-to-end works without extra config.
        payment_webhook_secret=(
            getenv("PAYMENT_WEBHOOK_SECRET", "").strip() or "mock-dev-webhook-secret"
        ),
        payment_currency=getenv("PAYMENT_CURRENCY", "INR").strip() or "INR",
        hostel_fee_amount=_positive_int_setting("HOSTEL_FEE_AMOUNT", 2000),
        frontend_base_url=(
            getenv("FRONTEND_BASE_URL", "").strip() or DEFAULT_CORS_ORIGINS[0]
        ),
        # Dev-only account switching: never available in production, and off
        # unless explicitly enabled.
        enable_dev_login=(
            environment != "production"
            and getenv("ENABLE_DEV_LOGIN", "").strip().lower() == "true"
        ),
        redis_url=getenv("REDIS_URL", "").strip() or None,
        qr_secret_encryption_key=(
            getenv("QR_SECRET_ENCRYPTION_KEY", "").strip() or None
        ),
        qr_scan_rate_limit=_positive_int_setting("QR_SCAN_RATE_LIMIT", 10),
        qr_scan_rate_window_seconds=_positive_int_setting(
            "QR_SCAN_RATE_WINDOW_SECONDS", 60
        ),
    )
