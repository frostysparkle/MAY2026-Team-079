from pydantic import BaseModel

from app.auth.schemas import Role


class AdminUserItem(BaseModel):
    id: str
    full_name: str | None
    email: str
    roles: list[Role]
    created_at: str | None


class ListUsersResponse(BaseModel):
    users: list[AdminUserItem]


class AssignRoleRequest(BaseModel):
    role: Role


class AssignRoleResponse(BaseModel):
    participant_id: str
    role: Role
