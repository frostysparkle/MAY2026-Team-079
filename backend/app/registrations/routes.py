from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_events_collection,
    get_registrations_collection,
)
from app.core.errors import ApiError
from app.events.service import EventNotFoundError, get_event
from app.registrations.schemas import (
    MyRegistrationsResponse,
    RegistrationResult,
    serialize_my_registration,
)
from app.registrations.service import (
    EventFullError,
    cancel,
    list_my_registrations,
    register,
    registration_info,
)


router = APIRouter(tags=["registrations"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


@router.post(
    "/events/{event_id}/register",
    response_model=RegistrationResult,
    summary="Register for an event (participant)",
)
async def register_route(
    event_id: str,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    events: Annotated[AsyncCollection[dict[str, Any]], Depends(get_events_collection)],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
) -> RegistrationResult:
    try:
        await register(registrations, events, current_user["_id"], event_id)
        event = await get_event(events, event_id, include_unpublished=True)
        count, spots_left, registered = await registration_info(
            registrations, event, current_user["_id"]
        )
    except EventNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found.",
        ) from exc
    except EventFullError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="event_full",
            message="This event is at capacity.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return RegistrationResult(
        event_id=event_id,
        registered=registered,
        registration_count=count,
        spots_left=spots_left,
    )


@router.delete(
    "/events/{event_id}/register",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cancel an event registration (participant)",
)
async def cancel_route(
    event_id: str,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
) -> None:
    try:
        await cancel(registrations, current_user["_id"], event_id)
    except PyMongoError as exc:
        raise _db_error() from exc


@router.get(
    "/me/registrations",
    response_model=MyRegistrationsResponse,
    summary="My registered events",
)
async def my_registrations_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    events: Annotated[AsyncCollection[dict[str, Any]], Depends(get_events_collection)],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
) -> MyRegistrationsResponse:
    try:
        joined = await list_my_registrations(registrations, events, current_user["_id"])
    except PyMongoError as exc:
        raise _db_error() from exc
    return MyRegistrationsResponse(
        registrations=[serialize_my_registration(j["registration"], j["event"]) for j in joined]
    )
