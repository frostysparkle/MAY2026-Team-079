from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import get_current_user, get_events_collection
from app.auth.roles import effective_rank, require_role, role_rank
from app.core.errors import ApiError
from app.events.schemas import (
    EventCreate,
    EventListResponse,
    EventOut,
    EventUpdate,
    serialize_event,
)
from app.events.service import (
    EventNotFoundError,
    create_event,
    get_event,
    list_events,
    update_event,
)


router = APIRouter(prefix="/events", tags=["events"])

_ORGANIZER_RANK = role_rank("organizer")


def _can_manage(user: dict[str, Any]) -> bool:
    return effective_rank(user) >= _ORGANIZER_RANK


def _db_error(exc: PyMongoError) -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


@router.get("", response_model=EventListResponse, summary="List events")
async def list_events_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
) -> EventListResponse:
    try:
        docs = await list_events(events, include_unpublished=_can_manage(current_user))
    except PyMongoError as exc:
        raise _db_error(exc) from exc
    return EventListResponse(events=[serialize_event(d) for d in docs])


@router.get("/{event_id}", response_model=EventOut, summary="Get one event")
async def get_event_route(
    event_id: str,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
) -> EventOut:
    try:
        doc = await get_event(
            events, event_id, include_unpublished=_can_manage(current_user)
        )
    except EventNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error(exc) from exc
    return serialize_event(doc)


@router.post(
    "",
    response_model=EventOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an event (organizer+)",
)
async def create_event_route(
    body: EventCreate,
    actor: Annotated[dict[str, Any], Depends(require_role("organizer"))],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
) -> EventOut:
    try:
        doc = await create_event(events, body, actor["_id"])
    except PyMongoError as exc:
        raise _db_error(exc) from exc
    return serialize_event(doc)


@router.patch(
    "/{event_id}",
    response_model=EventOut,
    summary="Update an event (organizer+)",
)
async def update_event_route(
    event_id: str,
    body: EventUpdate,
    _actor: Annotated[dict[str, Any], Depends(require_role("organizer"))],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
) -> EventOut:
    changes = body.changes()
    if not changes:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_changes",
            message="No fields to update.",
        )
    try:
        doc = await update_event(events, event_id, changes)
    except EventNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error(exc) from exc
    return serialize_event(doc)
