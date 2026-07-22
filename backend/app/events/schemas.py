from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


EventStatus = Literal["draft", "published", "cancelled"]

_DATE_RE = r"^\d{4}-\d{2}-\d{2}$"
_TIME_RE = r"^([01]\d|2[0-3]):[0-5]\d$"


class EventOut(BaseModel):
    id: str
    title: str
    venue: str
    event_date: str
    start_time: str
    end_time: str
    capacity: int
    instructions: str
    status: EventStatus
    created_at: str | None


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    venue: str = Field(min_length=1, max_length=160)
    event_date: str = Field(pattern=_DATE_RE)
    start_time: str = Field(pattern=_TIME_RE)
    end_time: str = Field(pattern=_TIME_RE)
    capacity: int = Field(ge=1)
    instructions: str = Field(min_length=1)
    status: EventStatus = "draft"

    @field_validator("title", "venue", "instructions")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    venue: str | None = Field(default=None, min_length=1, max_length=160)
    event_date: str | None = Field(default=None, pattern=_DATE_RE)
    start_time: str | None = Field(default=None, pattern=_TIME_RE)
    end_time: str | None = Field(default=None, pattern=_TIME_RE)
    capacity: int | None = Field(default=None, ge=1)
    instructions: str | None = Field(default=None, min_length=1)
    status: EventStatus | None = None

    def changes(self) -> dict[str, Any]:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class EventListResponse(BaseModel):
    events: list[EventOut]


def serialize_event(doc: dict[str, Any]) -> EventOut:
    created = doc.get("created_at")
    return EventOut(
        id=str(doc["_id"]),
        title=doc.get("title", ""),
        venue=doc.get("venue", ""),
        event_date=doc.get("event_date", ""),
        start_time=doc.get("start_time", ""),
        end_time=doc.get("end_time", ""),
        capacity=doc.get("capacity", 0),
        instructions=doc.get("instructions", ""),
        status=doc.get("status", "draft"),
        created_at=created.isoformat() if isinstance(created, datetime) else created,
    )
