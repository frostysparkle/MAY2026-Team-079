from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_events_collection,
    get_registrations_collection,
    get_staff_assignments_collection,
)
from app.auth.scopes import (
    assigned_scope_ids,
    require_event_scope,
    require_fixed_scope,
)
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
from app.registrations.service import registration_info


router = APIRouter(prefix="/events", tags=["events"])


def _db_error(exc: PyMongoError) -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


async def _annotate(
    doc: dict[str, Any],
    registrations: AsyncCollection[dict[str, Any]],
    user: dict[str, Any],
) -> EventOut:
    count, spots_left, registered = await registration_info(registrations, doc, user["_id"])
    return serialize_event(doc).model_copy(
        update={
            "registered": registered,
            "registration_count": count,
            "spots_left": spots_left,
        }
    )


@router.get("", response_model=EventListResponse, summary="List events")
async def list_events_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
    assignments: Annotated[
        AsyncCollection[dict[str, Any]],
        Depends(get_staff_assignments_collection),
    ],
) -> EventListResponse:
    try:
        event_ids = await assigned_scope_ids(
            current_user,
            assignments,
            roles=("organizer",),
            scope_type="event",
        )
        docs = await list_events(
            events,
            include_unpublished=event_ids is None,
            accessible_event_ids=event_ids,
        )
        items = [await _annotate(d, registrations, current_user) for d in docs]
    except PyMongoError as exc:
        raise _db_error(exc) from exc
    return EventListResponse(events=items)


@router.get("/{event_id}", response_model=EventOut, summary="Get one event")
async def get_event_route(
    event_id: str,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
    assignments: Annotated[
        AsyncCollection[dict[str, Any]],
        Depends(get_staff_assignments_collection),
    ],
) -> EventOut:
    try:
        event_ids = await assigned_scope_ids(
            current_user,
            assignments,
            roles=("organizer",),
            scope_type="event",
        )
        doc = await get_event(
            events,
            event_id,
            include_unpublished=event_ids is None or event_id in event_ids,
        )
        annotated = await _annotate(doc, registrations, current_user)
    except EventNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error(exc) from exc
    return annotated


@router.post(
    "",
    response_model=EventOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an event (organizer+)",
)
async def create_event_route(
    body: EventCreate,
    actor: Annotated[
        dict[str, Any],
        Depends(require_fixed_scope("event", "*", "organizer")),
    ],
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
    _actor: Annotated[
        dict[str, Any], Depends(require_event_scope("organizer"))
    ],
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
