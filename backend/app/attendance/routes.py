from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.attendance.schemas import (
    AttendanceDashboardResponse,
    DashboardEventOut,
    EventAttendanceOut,
    EventCrowdOut,
    crowd_status,
)
from app.attendance.service import event_attendance, remaining_capacity
from app.auth.dependencies import (
    get_current_user,
    get_events_collection,
    get_scan_logs_collection,
)
from app.auth.roles import require_role
from app.auth.scopes import require_event_scope
from app.core.errors import ApiError
from app.events.service import EventNotFoundError, get_event, list_events


router = APIRouter(prefix="/attendance", tags=["attendance"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


def _event_not_found() -> ApiError:
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code="event_not_found",
        message="Event not found.",
    )


@router.get(
    "/events/{event_id}",
    response_model=EventAttendanceOut,
    summary="Live attendance & remaining capacity (organizer+, FR-3.1/3.2)",
)
async def event_attendance_route(
    event_id: str,
    _actor: Annotated[
        dict[str, Any], Depends(require_event_scope("organizer"))
    ],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    scan_logs: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_scan_logs_collection)
    ],
) -> EventAttendanceOut:
    try:
        event = await get_event(events, event_id, include_unpublished=True)
        attendance = await event_attendance(scan_logs, event_id)
    except EventNotFoundError as exc:
        raise _event_not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc

    capacity = int(event.get("capacity", 0))
    remaining = remaining_capacity(capacity, attendance)
    return EventAttendanceOut(
        event_id=event_id,
        capacity=capacity,
        attendance=attendance,
        remaining=remaining,
        at_capacity=remaining == 0,
    )


@router.get(
    "/events/{event_id}/crowd",
    response_model=EventCrowdOut,
    summary="Crowd status for a participant before visiting (FR-3.3)",
)
async def event_crowd_route(
    event_id: str,
    _user: Annotated[dict[str, Any], Depends(get_current_user)],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    scan_logs: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_scan_logs_collection)
    ],
) -> EventCrowdOut:
    try:
        event = await get_event(events, event_id, include_unpublished=False)
        attendance = await event_attendance(scan_logs, event_id)
    except EventNotFoundError as exc:
        raise _event_not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return EventCrowdOut(
        event_id=event_id, status=crowd_status(attendance, int(event.get("capacity", 0)))
    )


@router.get(
    "/dashboard",
    response_model=AttendanceDashboardResponse,
    summary="Live crowd across all active events (admin+, FR-3.4)",
)
async def dashboard_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    scan_logs: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_scan_logs_collection)
    ],
) -> AttendanceDashboardResponse:
    try:
        published = await list_events(events, include_unpublished=False)
        items: list[DashboardEventOut] = []
        for event in published:
            event_id = str(event["_id"])
            attendance = await event_attendance(scan_logs, event_id)
            capacity = int(event.get("capacity", 0))
            remaining = remaining_capacity(capacity, attendance)
            items.append(
                DashboardEventOut(
                    event_id=event_id,
                    title=event.get("title", ""),
                    venue=event.get("venue", ""),
                    capacity=capacity,
                    attendance=attendance,
                    remaining=remaining,
                    at_capacity=remaining == 0,
                    status=crowd_status(attendance, capacity),
                )
            )
    except PyMongoError as exc:
        raise _db_error() from exc
    return AttendanceDashboardResponse(events=items)
