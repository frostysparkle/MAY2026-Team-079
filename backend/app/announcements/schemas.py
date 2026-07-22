from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# The four named audience groups (PRD FR-8.1).
Audience = Literal[
    "all_participants", "event_registrants", "hostel_residents", "pors"
]


class AnnouncementOut(BaseModel):
    id: str
    title: str
    body: str
    audience: Audience
    event_id: str | None
    sender_name: str | None
    created_at: str | None


class AnnouncementListResponse(BaseModel):
    announcements: list[AnnouncementOut]


class CreateAnnouncementRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=4000)
    audience: Audience
    event_id: str | None = None

    @field_validator("title", "body")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def _event_required_for_registrants(self) -> "CreateAnnouncementRequest":
        if self.audience == "event_registrants" and not self.event_id:
            raise ValueError("event_id is required when the audience is event registrants.")
        return self


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


def serialize_announcement(doc: dict[str, Any]) -> AnnouncementOut:
    return AnnouncementOut(
        id=str(doc["_id"]),
        title=doc.get("title", ""),
        body=doc.get("body", ""),
        audience=doc.get("audience", "all_participants"),
        event_id=doc.get("event_id"),
        sender_name=doc.get("sender_name"),
        created_at=_iso(doc.get("created_at")),
    )
