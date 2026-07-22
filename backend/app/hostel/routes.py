from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_hostel_allocations_collection,
    get_users_collection,
)
from app.auth.roles import require_role
from app.core.errors import ApiError
from app.hostel.schemas import (
    AllocationListResponse,
    AllocationOut,
    AllocationWithParticipantOut,
    CreateAllocationRequest,
    MyAllocationResponse,
    UpdateAllocationRequest,
    serialize_allocation,
)
from app.hostel.service import (
    AllocationConflictError,
    AllocationNotFoundError,
    ParticipantNotFoundError,
    create_allocation,
    delete_allocation,
    get_allocation_for_user,
    list_allocations,
    update_allocation,
)


router = APIRouter(prefix="/hostel", tags=["hostel"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


def _not_found() -> ApiError:
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code="allocation_not_found",
        message="Allocation not found.",
    )


@router.get(
    "/allocation",
    response_model=MyAllocationResponse,
    summary="My hostel allocation (FR-5.1)",
)
async def my_allocation_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
) -> MyAllocationResponse:
    try:
        doc = await get_allocation_for_user(allocations, current_user["_id"])
    except PyMongoError as exc:
        raise _db_error() from exc
    return MyAllocationResponse(allocation=serialize_allocation(doc) if doc else None)


@router.get(
    "/allocations",
    response_model=AllocationListResponse,
    summary="List all hostel allocations (admin+)",
)
async def list_allocations_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> AllocationListResponse:
    try:
        docs = await list_allocations(allocations)
        items: list[AllocationWithParticipantOut] = []
        for doc in docs:
            user = await users.find_one({"_id": doc["user_id"]})
            base = serialize_allocation(doc)
            items.append(
                AllocationWithParticipantOut(
                    **base.model_dump(),
                    full_name=(user.get("profile") or {}).get("full_name") if user else None,
                    email=user["email"] if user else None,
                )
            )
    except PyMongoError as exc:
        raise _db_error() from exc
    return AllocationListResponse(allocations=items)


@router.post(
    "/allocations",
    response_model=AllocationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Assign a hostel allocation (admin+)",
)
async def create_allocation_route(
    body: CreateAllocationRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> AllocationOut:
    try:
        doc = await create_allocation(allocations, users, body)
    except ParticipantNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="participant_not_found",
            message="Participant not found.",
        ) from exc
    except AllocationConflictError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="allocation_conflict",
            message=str(exc),
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_allocation(doc)


@router.patch(
    "/allocations/{allocation_id}",
    response_model=AllocationOut,
    summary="Update a hostel allocation (admin+)",
)
async def update_allocation_route(
    allocation_id: str,
    body: UpdateAllocationRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
) -> AllocationOut:
    changes = body.changes()
    if not changes:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_changes",
            message="No fields to update.",
        )
    try:
        doc = await update_allocation(allocations, allocation_id, changes)
    except AllocationNotFoundError as exc:
        raise _not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_allocation(doc)


@router.delete(
    "/allocations/{allocation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a hostel allocation (admin+)",
)
async def delete_allocation_route(
    allocation_id: str,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
) -> None:
    try:
        await delete_allocation(allocations, allocation_id)
    except AllocationNotFoundError as exc:
        raise _not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc
