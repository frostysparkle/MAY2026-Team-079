from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.announcements.schemas import (
    AnnouncementListResponse,
    AnnouncementOut,
    CreateAnnouncementRequest,
    serialize_announcement,
)
from app.announcements.service import (
    AnnouncementNotFoundError,
    create_announcement,
    delete_announcement,
    list_all,
    list_for_user,
)
from app.auth.dependencies import (
    get_announcements_collection,
    get_current_user,
    get_hostel_allocations_collection,
)
from app.auth.roles import require_role
from app.core.errors import ApiError


router = APIRouter(prefix="/announcements", tags=["announcements"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


@router.post(
    "",
    response_model=AnnouncementOut,
    status_code=status.HTTP_201_CREATED,
    summary="Send an official announcement (admin+, FR-8.1)",
)
async def create_announcement_route(
    body: CreateAnnouncementRequest,
    actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    announcements: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_announcements_collection)
    ],
) -> AnnouncementOut:
    sender_name = (actor.get("profile") or {}).get("full_name") or actor.get("email")
    try:
        doc = await create_announcement(announcements, body, actor["_id"], sender_name)
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_announcement(doc)


@router.get(
    "",
    response_model=AnnouncementListResponse,
    summary="My announcements feed (audience-filtered)",
)
async def my_feed_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    announcements: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_announcements_collection)
    ],
    hostel_allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
) -> AnnouncementListResponse:
    try:
        docs = await list_for_user(announcements, hostel_allocations, current_user)
    except PyMongoError as exc:
        raise _db_error() from exc
    return AnnouncementListResponse(announcements=[serialize_announcement(d) for d in docs])


@router.get(
    "/manage",
    response_model=AnnouncementListResponse,
    summary="All announcements log (admin+, accountability)",
)
async def manage_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    announcements: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_announcements_collection)
    ],
) -> AnnouncementListResponse:
    try:
        docs = await list_all(announcements)
    except PyMongoError as exc:
        raise _db_error() from exc
    return AnnouncementListResponse(announcements=[serialize_announcement(d) for d in docs])


@router.delete(
    "/{announcement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an announcement (admin+)",
)
async def delete_route(
    announcement_id: str,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    announcements: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_announcements_collection)
    ],
) -> None:
    try:
        await delete_announcement(announcements, announcement_id)
    except AnnouncementNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="announcement_not_found",
            message="Announcement not found.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
