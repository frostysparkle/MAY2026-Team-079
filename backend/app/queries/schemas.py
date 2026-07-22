from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


QueryCategory = Literal["event", "hostel", "mess", "workshop", "lost_item", "other"]
QueryStatus = Literal["open", "assigned", "in_progress", "resolved"]
QueryTeam = Literal["event", "hostel", "mess", "workshop", "general"]


class QueryOut(BaseModel):
    id: str
    participant_id: str
    category: QueryCategory
    description: str
    status: QueryStatus
    assigned_team: QueryTeam | None
    created_at: str | None
    updated_at: str | None


class RaiseQueryRequest(BaseModel):
    category: QueryCategory
    description: str = Field(min_length=1, max_length=2000)

    @field_validator("description")
    @classmethod
    def _strip(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Description cannot be empty.")
        return cleaned


class UpdateQueryRequest(BaseModel):
    status: QueryStatus | None = None
    assigned_team: QueryTeam | None = None

    def has_changes(self) -> bool:
        return self.status is not None or self.assigned_team is not None


class QueryListResponse(BaseModel):
    queries: list[QueryOut]


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


def serialize_query(doc: dict[str, Any]) -> QueryOut:
    return QueryOut(
        id=str(doc["_id"]),
        participant_id=str(doc["participant_id"]),
        category=doc.get("category", "other"),
        description=doc.get("description", ""),
        status=doc.get("status", "open"),
        assigned_team=doc.get("assigned_team"),
        created_at=_iso(doc.get("created_at")),
        updated_at=_iso(doc.get("updated_at")),
    )
