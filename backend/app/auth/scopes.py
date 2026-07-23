from collections.abc import Iterable
from typing import Annotated, Any, Callable, Coroutine

from fastapi import Depends, status
from pymongo.asynchronous.collection import AsyncCollection

from app.auth.dependencies import (
    get_current_user,
    get_staff_assignments_collection,
)
from app.auth.roles import effective_rank, role_rank
from app.core.errors import ApiError


def has_global_scope_access(user: dict[str, Any]) -> bool:
    """Admins and Super Admins retain application-wide operational access."""
    return effective_rank(user) >= role_rank("admin")


def _denied() -> ApiError:
    return ApiError(
        status_code=status.HTTP_403_FORBIDDEN,
        code="scope_access_denied",
        message="You are not assigned to this operational scope.",
    )


async def ensure_scope_access(
    user: dict[str, Any],
    assignments: AsyncCollection[dict[str, Any]],
    *,
    roles: Iterable[str],
    scope_type: str,
    scope_id: str,
) -> dict[str, Any]:
    if has_global_scope_access(user):
        return user

    assignment = await assignments.find_one(
        {
            "user_id": user["_id"],
            "role": {"$in": tuple(roles)},
            "scope_type": scope_type,
            "scope_id": {"$in": (scope_id, "*")},
            "active": True,
        }
    )
    if assignment is None:
        raise _denied()
    return user


async def assigned_scope_ids(
    user: dict[str, Any],
    assignments: AsyncCollection[dict[str, Any]],
    *,
    roles: Iterable[str],
    scope_type: str,
) -> set[str] | None:
    """Return exact active scopes, or None when the caller has global/wildcard access."""
    if has_global_scope_access(user):
        return None

    cursor = assignments.find(
        {
            "user_id": user["_id"],
            "role": {"$in": tuple(roles)},
            "scope_type": scope_type,
            "active": True,
        }
    )
    scope_ids = {doc["scope_id"] async for doc in cursor}
    if "*" in scope_ids:
        return None
    return scope_ids


def require_event_scope(
    *roles: str,
) -> Callable[..., Coroutine[Any, Any, dict[str, Any]]]:
    async def _dependency(
        event_id: str,
        current_user: Annotated[dict[str, Any], Depends(get_current_user)],
        assignments: Annotated[
            AsyncCollection[dict[str, Any]],
            Depends(get_staff_assignments_collection),
        ],
    ) -> dict[str, Any]:
        return await ensure_scope_access(
            current_user,
            assignments,
            roles=roles,
            scope_type="event",
            scope_id=event_id,
        )

    return _dependency


def require_fixed_scope(
    scope_type: str,
    scope_id: str,
    *roles: str,
) -> Callable[..., Coroutine[Any, Any, dict[str, Any]]]:
    async def _dependency(
        current_user: Annotated[dict[str, Any], Depends(get_current_user)],
        assignments: Annotated[
            AsyncCollection[dict[str, Any]],
            Depends(get_staff_assignments_collection),
        ],
    ) -> dict[str, Any]:
        return await ensure_scope_access(
            current_user,
            assignments,
            roles=roles,
            scope_type=scope_type,
            scope_id=scope_id,
        )

    return _dependency
