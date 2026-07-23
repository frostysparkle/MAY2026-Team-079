"""Dev-only account switching (Task 3, Correctness Property 8).

`POST /auth/dev-login` issues a normal session for a **seeded test account**
without Google, and `GET /auth/test-accounts` lists those accounts for the
switcher. Both are hard-gated: they return 404 unless `settings.enable_dev_login`
is true (which is forced false when `APP_ENV=production`). Only users flagged
`is_test` can be assumed, so real accounts are never reachable this way.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_photos_collection_optional,
    get_users_collection,
)
from app.auth.roles import ROLE_ORDER
from app.auth.schemas import AuthResponse
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.security import create_access_token
from app.participants.serialization import (
    ParticipantOut,
    resolve_photo_url,
    serialize_participant,
)


router = APIRouter(prefix="/auth", tags=["dev"])

# Ensure the forward-referenced ParticipantOut is resolvable for response_model,
# regardless of import order.
AuthResponse.model_rebuild(_types_namespace={"ParticipantOut": ParticipantOut})


class DevLoginRequest(BaseModel):
    email: str = Field(min_length=3)


class TestAccountOut(BaseModel):
    email: str
    full_name: str | None
    role: str
    label: str | None


class TestAccountsResponse(BaseModel):
    accounts: list[TestAccountOut]


def require_dev_login(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Settings:
    if not settings.enable_dev_login:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="Not available.",
        )
    return settings


def _highest_role(roles: list[str] | None) -> str:
    known = [r for r in (roles or []) if r in ROLE_ORDER]
    if not known:
        return "participant"
    return max(known, key=ROLE_ORDER.index)


@router.post(
    "/dev-login",
    response_model=AuthResponse,
    summary="DEV ONLY: assume a seeded test account (no password)",
)
async def dev_login_route(
    body: DevLoginRequest,
    settings: Annotated[Settings, Depends(require_dev_login)],
    users: Annotated[AsyncCollection[dict[str, Any]], Depends(get_users_collection)],
    photos: Annotated[
        AsyncCollection[dict[str, Any]] | None,
        Depends(get_photos_collection_optional),
    ],
) -> AuthResponse:
    try:
        user = await users.find_one(
            {"email": body.email.strip().casefold(), "is_test": True}
        )
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc
    if user is None or user.get("status") != "active":
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="test_account_not_found",
            message="No seeded test account for that email.",
        )

    token = create_access_token(str(user["_id"]), settings)
    photo_url = await resolve_photo_url(photos, user["_id"])
    return AuthResponse(
        access_token=token,
        expires_in=settings.jwt_access_token_minutes * 60,
        is_new_user=False,
        user=serialize_participant(user, photo_url),
    )


@router.get(
    "/test-accounts",
    response_model=TestAccountsResponse,
    summary="DEV ONLY: list seeded test accounts for the switcher",
)
async def test_accounts_route(
    _settings: Annotated[Settings, Depends(require_dev_login)],
    users: Annotated[AsyncCollection[dict[str, Any]], Depends(get_users_collection)],
) -> TestAccountsResponse:
    try:
        cursor = users.find({"is_test": True}, sort=[("test_order", 1), ("email", 1)])
        docs = [doc async for doc in cursor]
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc
    return TestAccountsResponse(
        accounts=[
            TestAccountOut(
                email=d["email"],
                full_name=(d.get("profile") or {}).get("full_name"),
                role=_highest_role(d.get("roles")),
                label=d.get("test_label"),
            )
            for d in docs
        ]
    )
