from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_photos_collection,
    get_users_collection,
)
from app.core.errors import ApiError
from app.participants.serialization import resolve_photo_url, serialize_participant
from app.profile.schemas import CompleteProfileRequest, CompleteProfileResponse
from app.profile.service import complete_profile


router = APIRouter(prefix="/profile", tags=["profile"])


@router.post(
    "/complete",
    response_model=CompleteProfileResponse,
    summary="Save the one-time participant profile and photo",
)
async def complete_profile_route(
    body: CompleteProfileRequest,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
    photos: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_photos_collection)
    ],
) -> CompleteProfileResponse:
    try:
        updated = await complete_profile(users, photos, current_user, body)
        photo_url = await resolve_photo_url(photos, updated["_id"])
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc

    return CompleteProfileResponse(
        participant=serialize_participant(updated, photo_url)
    )
