from typing import Any, Annotated

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_photos_collection_optional,
    get_users_collection,
)
from app.auth.schemas import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
)
from app.auth.service import (
    AccountUnavailableError,
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    LoginResult,
    authenticate_user,
    register_user,
)
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.security import SecurityConfigurationError, create_access_token
from app.participants.serialization import (
    ParticipantOut,
    resolve_photo_url,
    serialize_participant,
)


router = APIRouter(prefix="/auth", tags=["authentication"])
users_router = APIRouter(prefix="/users", tags=["users"])

# Resolve the forward reference to ParticipantOut declared in schemas.py
# (kept there to avoid a circular import at module load).
AuthResponse.model_rebuild()


async def _participant_response(
    user: dict[str, Any],
    photos: AsyncCollection[dict[str, Any]] | None,
) -> ParticipantOut:
    photo_url = await resolve_photo_url(photos, user["_id"])
    return serialize_participant(user, photo_url)


async def _auth_response(
    result: LoginResult,
    settings: Settings,
    photos: AsyncCollection[dict[str, Any]] | None,
) -> AuthResponse:
    access_token = create_access_token(str(result.user["_id"]), settings)
    return AuthResponse(
        access_token=access_token,
        expires_in=settings.jwt_access_token_minutes * 60,
        is_new_user=result.is_new_user,
        user=await _participant_response(result.user, photos),
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new account with an email and password",
)
async def register(
    body: RegisterRequest,
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
    photos: Annotated[
        AsyncCollection[dict[str, Any]] | None,
        Depends(get_photos_collection_optional),
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthResponse:
    try:
        result = await register_user(
            users, body.email, body.password, body.full_name
        )
        return await _auth_response(result, settings, photos)
    except EmailAlreadyRegisteredError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="email_already_registered",
            message=str(exc),
        ) from exc
    except SecurityConfigurationError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="authentication_not_configured",
            message="Application authentication is not configured.",
        ) from exc
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Sign in with an email and password",
)
async def login(
    body: LoginRequest,
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
    photos: Annotated[
        AsyncCollection[dict[str, Any]] | None,
        Depends(get_photos_collection_optional),
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthResponse:
    try:
        result = await authenticate_user(users, body.email, body.password)
        return await _auth_response(result, settings, photos)
    except InvalidCredentialsError as exc:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="invalid_credentials",
            message=str(exc),
        ) from exc
    except AccountUnavailableError as exc:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="account_unavailable",
            message=str(exc),
        ) from exc
    except SecurityConfigurationError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="authentication_not_configured",
            message="Application authentication is not configured.",
        ) from exc
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc


@users_router.get(
    "/me",
    response_model=ParticipantOut,
    summary="Return the authenticated user",
)
async def get_me(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    photos: Annotated[
        AsyncCollection[dict[str, Any]] | None,
        Depends(get_photos_collection_optional),
    ],
) -> ParticipantOut:
    return await _participant_response(current_user, photos)
