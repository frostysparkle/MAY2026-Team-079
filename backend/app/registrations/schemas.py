from datetime import datetime
from typing import Any

from pydantic import BaseModel


class RegistrationResult(BaseModel):
    event_id: str
    registered: bool
    registration_count: int
    spots_left: int


class MyRegistrationItem(BaseModel):
    event_id: str
    title: str
    venue: str
    event_date: str
    start_time: str
    end_time: str
    status: str
    registered_at: str | None


class MyRegistrationsResponse(BaseModel):
    registrations: list[MyRegistrationItem]


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


def serialize_my_registration(reg: dict[str, Any], event: dict[str, Any]) -> MyRegistrationItem:
    return MyRegistrationItem(
        event_id=str(event["_id"]),
        title=event.get("title", ""),
        venue=event.get("venue", ""),
        event_date=event.get("event_date", ""),
        start_time=event.get("start_time", ""),
        end_time=event.get("end_time", ""),
        status=event.get("status", "draft"),
        registered_at=_iso(reg.get("created_at")),
    )
