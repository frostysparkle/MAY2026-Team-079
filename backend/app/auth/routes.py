from typing import Any, Annotated

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_google_verifier,
    get_users_collection,
)
from app.auth.google import (
    GoogleAccountNotAllowedError,
    GoogleIdentityConfigurationError,
    GoogleIdentityError,
    GoogleIdentityUnavailableError,
    GoogleTokenVerifier,
)
from app.auth.schemas import (
    AuthenticatedUser,
    GoogleLoginRequest,
    GoogleLoginResponse,
)
from app.auth.service import (
    AccountUnavailableError,
    IdentityConflictError,
    login_google_user,
)
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.security import SecurityConfigurationError, create_access_token


router = APIRouter(prefix="/auth", tags=["authentication"])
users_router = APIRouter(prefix="/users", tags=["users"])


def _user_response(user: dict[str, Any]) -> AuthenticatedUser:
    profile = user.get("profile", {})
    return AuthenticatedUser(
        id=str(user["_id"]),
        email=user["email"],
        email_verified=bool(user.get("email_verified")),
        roles=user.get("roles", []),
        status=user["status"],
        full_name=profile.get("full_name"),
        profile_complete=bool(user.get("profile_complete")),
    )


@router.post(
    "/google",
    response_model=GoogleLoginResponse,
    summary="Sign in with a Google Identity Services credential",
)
async def login_with_google(
    body: GoogleLoginRequest,
    verifier: Annotated[GoogleTokenVerifier, Depends(get_google_verifier)],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleLoginResponse:
    try:
        identity = await verifier.verify(body.credential)
        result = await login_google_user(users, identity)
        access_token = create_access_token(str(result.user["_id"]), settings)
    except GoogleIdentityConfigurationError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="google_auth_not_configured",
            message="Google authentication is not configured.",
        ) from exc
    except GoogleIdentityUnavailableError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="google_auth_unavailable",
            message="Google identity verification is temporarily unavailable.",
        ) from exc
    except GoogleAccountNotAllowedError as exc:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="google_account_not_allowed",
            message=str(exc),
        ) from exc
    except GoogleIdentityError as exc:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="invalid_google_credential",
            message=str(exc),
        ) from exc
    except IdentityConflictError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="identity_conflict",
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

    return GoogleLoginResponse(
        access_token=access_token,
        expires_in=settings.jwt_access_token_minutes * 60,
        is_new_user=result.is_new_user,
        user=_user_response(result.user),
    )


@users_router.get(
    "/me",
    response_model=AuthenticatedUser,
    summary="Return the authenticated user",
)
async def get_me(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
) -> AuthenticatedUser:
    return _user_response(current_user)
