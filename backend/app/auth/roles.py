"""Role hierarchy and role-based authorization dependencies.

Five tiers, low -> high (must match the frontend `ROLES` in
`frontend/src/config/constants.ts`).
"""

from typing import Annotated, Any, Callable, Coroutine

from fastapi import Depends, status

from app.auth.dependencies import get_current_user
from app.core.errors import ApiError


ROLE_ORDER: tuple[str, ...] = (
    "participant",
    "organizer",
    "staff",
    "admin",
    "super_admin",
)


def role_rank(role: str) -> int:
    try:
        return ROLE_ORDER.index(role)
    except ValueError:
        return -1


def effective_rank(user: dict[str, Any]) -> int:
    roles = user.get("roles") or []
    ranks = [role_rank(role) for role in roles]
    return max(ranks) if ranks else -1


def require_role(
    min_role: str,
) -> Callable[..., Coroutine[Any, Any, dict[str, Any]]]:
    """Dependency factory: require the user's highest role to be >= min_role."""
    minimum = role_rank(min_role)

    async def _dependency(
        current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    ) -> dict[str, Any]:
        if effective_rank(current_user) < minimum:
            raise ApiError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="insufficient_role",
                message="You do not have permission to perform this action.",
            )
        return current_user

    return _dependency
