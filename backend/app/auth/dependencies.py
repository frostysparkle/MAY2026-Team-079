from typing import Any, Annotated

from bson import ObjectId
from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.google import GoogleTokenVerifier
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.security import (
    InvalidAccessTokenError,
    SecurityConfigurationError,
    decode_access_token,
)
from app.db.collections import (
    CONTACTS,
    EVENTS,
    MESS_MENU,
    PHOTOS,
    QR_SECRETS,
    QUERIES,
    SCAN_LOGS,
    USERS,
)


bearer_scheme = HTTPBearer(auto_error=False)


def _collection(
    request: Request, name: str
) -> AsyncCollection[dict[str, Any]]:
    try:
        return request.app.state.mongo.database[name]
    except RuntimeError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is not configured or available.",
        ) from exc


def get_users_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, USERS)


def get_events_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, EVENTS)


def get_queries_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, QUERIES)


def get_contacts_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, CONTACTS)


def get_mess_menu_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, MESS_MENU)


def get_qr_secrets_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, QR_SECRETS)


def get_scan_logs_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, SCAN_LOGS)


def get_photos_collection(
    request: Request,
) -> AsyncCollection[dict[str, Any]]:
    return _collection(request, PHOTOS)


def get_photos_collection_optional(
    request: Request,
) -> AsyncCollection[dict[str, Any]] | None:
    """Photos collection, or None when the database is unavailable.

    Used on read paths (login, /me) where a missing photo must not fail the
    request.
    """
    try:
        return request.app.state.mongo.database[PHOTOS]
    except RuntimeError:
        return None


def get_google_verifier(
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleTokenVerifier:
    return GoogleTokenVerifier(
        client_id=settings.google_client_id,
        allowed_domains=settings.allowed_google_domains,
    )


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
    settings: Annotated[Settings, Depends(get_settings)],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="authentication_required",
            message="A valid bearer token is required.",
        )

    try:
        claims = decode_access_token(credentials.credentials, settings)
    except SecurityConfigurationError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="authentication_not_configured",
            message="Application authentication is not configured.",
        ) from exc
    except InvalidAccessTokenError as exc:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="invalid_access_token",
            message="The access token is invalid or expired.",
        ) from exc

    user_id = claims["sub"]
    if not ObjectId.is_valid(user_id):
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="invalid_access_token",
            message="The access token is invalid or expired.",
        )

    try:
        user = await users.find_one({"_id": ObjectId(user_id)})
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc
    if user is None or user.get("status") != "active":
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="account_unavailable",
            message="The account is unavailable.",
        )
    return user
