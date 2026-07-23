from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.admin.schemas import (
    AdminUserItem,
    AssignRoleRequest,
    AssignRoleResponse,
    ListUsersResponse,
    SetStaffAssignmentStatusRequest,
    StaffAssignmentListResponse,
    StaffAssignmentOut,
    UpsertStaffAssignmentRequest,
    serialize_staff_assignment,
)
from app.admin.service import ParticipantNotFoundError, assign_role, list_users
from app.admin.staff_assignments import (
    StaffAssignmentNotFoundError,
    StaffAssignmentScopeNotFoundError,
    StaffAssignmentUserNotFoundError,
    list_staff_assignments,
    set_staff_assignment_status,
    upsert_staff_assignment,
)
from app.auth.dependencies import (
    get_events_collection,
    get_staff_assignments_collection,
    get_users_collection,
)
from app.auth.roles import require_role
from app.core.errors import ApiError
from app.participants.serialization import serialize_participant


router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/users",
    response_model=ListUsersResponse,
    summary="List all users (admin and above)",
)
async def list_users_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> ListUsersResponse:
    try:
        docs = await list_users(users)
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc

    items = [
        AdminUserItem(
            id=str(doc["_id"]),
            full_name=(doc.get("profile") or {}).get("full_name"),
            email=doc["email"],
            roles=doc.get("roles", []),
            created_at=serialize_participant(doc).created_at,
        )
        for doc in docs
    ]
    return ListUsersResponse(users=items)


@router.patch(
    "/participants/{participant_id}/role",
    response_model=AssignRoleResponse,
    summary="Assign a participant's role (Super Admin only)",
)
async def assign_role_route(
    participant_id: str,
    body: AssignRoleRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("super_admin"))],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> AssignRoleResponse:
    try:
        await assign_role(users, participant_id, body.role)
    except ParticipantNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="participant_not_found",
            message="Participant not found.",
        ) from exc
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc

    return AssignRoleResponse(participant_id=participant_id, role=body.role)


@router.get(
    "/staff-assignments",
    response_model=StaffAssignmentListResponse,
    summary="List scoped staff assignments (admin and above)",
)
async def list_staff_assignments_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    assignments: Annotated[
        AsyncCollection[dict[str, Any]],
        Depends(get_staff_assignments_collection),
    ],
) -> StaffAssignmentListResponse:
    try:
        docs = await list_staff_assignments(assignments)
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc
    return StaffAssignmentListResponse(
        assignments=[serialize_staff_assignment(doc) for doc in docs]
    )


@router.post(
    "/staff-assignments",
    response_model=StaffAssignmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Grant or reactivate a scoped organizer/staff assignment",
)
async def upsert_staff_assignment_route(
    body: UpsertStaffAssignmentRequest,
    actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    assignments: Annotated[
        AsyncCollection[dict[str, Any]],
        Depends(get_staff_assignments_collection),
    ],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
) -> StaffAssignmentOut:
    try:
        doc = await upsert_staff_assignment(
            assignments, users, events, body, actor["_id"]
        )
    except StaffAssignmentUserNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message=str(exc),
        ) from exc
    except StaffAssignmentScopeNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="scope_not_found",
            message=str(exc),
        ) from exc
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc
    return serialize_staff_assignment(doc)


@router.patch(
    "/staff-assignments/{assignment_id}",
    response_model=StaffAssignmentOut,
    summary="Activate or deactivate a scoped staff assignment",
)
async def set_staff_assignment_status_route(
    assignment_id: str,
    body: SetStaffAssignmentStatusRequest,
    actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    assignments: Annotated[
        AsyncCollection[dict[str, Any]],
        Depends(get_staff_assignments_collection),
    ],
) -> StaffAssignmentOut:
    try:
        doc = await set_staff_assignment_status(
            assignments, assignment_id, body.active, actor["_id"]
        )
    except StaffAssignmentNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="staff_assignment_not_found",
            message=str(exc),
        ) from exc
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc
    return serialize_staff_assignment(doc)
