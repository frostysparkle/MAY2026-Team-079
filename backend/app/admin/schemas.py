from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

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


StaffAssignmentRole = Literal["organizer", "staff"]
StaffScopeType = Literal["event", "checkpoint"]
CheckpointScope = Literal["mess", "hostel", "workshop"]


class UpsertStaffAssignmentRequest(BaseModel):
    user_id: str = Field(min_length=1)
    role: StaffAssignmentRole
    scope_type: StaffScopeType
    scope_id: str = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_scope(self) -> "UpsertStaffAssignmentRequest":
        if (
            self.scope_type == "checkpoint"
            and self.scope_id != "*"
            and self.scope_id not in {"mess", "hostel", "workshop"}
        ):
            raise ValueError(
                "checkpoint scope_id must be mess, hostel, workshop, or *."
            )
        return self


class SetStaffAssignmentStatusRequest(BaseModel):
    active: bool


class StaffAssignmentOut(BaseModel):
    id: str
    user_id: str
    role: StaffAssignmentRole
    scope_type: StaffScopeType
    scope_id: str
    active: bool
    created_at: datetime
    updated_at: datetime


class StaffAssignmentListResponse(BaseModel):
    assignments: list[StaffAssignmentOut]


def serialize_staff_assignment(doc: dict[str, Any]) -> StaffAssignmentOut:
    return StaffAssignmentOut(
        id=str(doc["_id"]),
        user_id=str(doc["user_id"]),
        role=doc["role"],
        scope_type=doc["scope_type"],
        scope_id=doc["scope_id"],
        active=doc["active"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )
