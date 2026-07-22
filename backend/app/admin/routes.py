from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.admin.schemas import (
    AdminUserItem,
    AssignRoleRequest,
    AssignRoleResponse,
    ListUsersResponse,
)
from app.admin.service import ParticipantNotFoundError, assign_role, list_users
from app.auth.dependencies import get_users_collection
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
