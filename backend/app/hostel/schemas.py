from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class AllocationOut(BaseModel):
    id: str
    participant_id: str
    hostel_block: str
    room: str
    instructions: str
    coordinator: str | None
    checked_in: bool
    checked_in_at: str | None


class AllocationWithParticipantOut(AllocationOut):
    """Admin listing enriches allocations with the participant's name/email."""

    full_name: str | None
    email: str | None


class MyAllocationResponse(BaseModel):
    """FR-5.1 — null allocation renders the explicit 'no accommodation' state."""

    allocation: AllocationOut | None


class AllocationListResponse(BaseModel):
    allocations: list[AllocationWithParticipantOut]


class CreateAllocationRequest(BaseModel):
    participant_id: str = Field(min_length=1)
    hostel_block: str = Field(min_length=1, max_length=120)
    room: str = Field(min_length=1, max_length=40)
    instructions: str = ""
    coordinator: str | None = None

    @field_validator("hostel_block", "room", "instructions")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class UpdateAllocationRequest(BaseModel):
    hostel_block: str | None = Field(default=None, min_length=1, max_length=120)
    room: str | None = Field(default=None, min_length=1, max_length=40)
    instructions: str | None = None
    coordinator: str | None = None

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


def serialize_allocation(doc: dict[str, Any]) -> AllocationOut:
    return AllocationOut(
        id=str(doc["_id"]),
        participant_id=str(doc["user_id"]),
        hostel_block=doc.get("hostel_block", ""),
        room=doc.get("room", ""),
        instructions=doc.get("instructions", ""),
        coordinator=doc.get("coordinator"),
        checked_in=bool(doc.get("checked_in")),
        checked_in_at=_iso(doc.get("checked_in_at")),
    )
