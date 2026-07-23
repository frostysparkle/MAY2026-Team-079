"""Canonical participant serialization shared by every endpoint.

The frontend adapter (`frontend/src/api/realApi.ts`) maps this snake_case shape
into its camelCase `Participant` type. Keep the field set aligned with
`docs/api-contract.md`.
"""

from datetime import datetime
from typing import Any

from bson import ObjectId
from pydantic import BaseModel
from pymongo.asynchronous.collection import AsyncCollection

from app.auth.schemas import Role


class ParticipantProfileOut(BaseModel):
    full_name: str | None = None
    age: int | None = None
    gender: str | None = None
    phone: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    program: str | None = None
    course_stage: str | None = None
    course_stage_other: str | None = None


class ParticipantOut(BaseModel):
    id: str
    email: str
    roles: list[Role]
    status: str
    profile_complete: bool
    created_at: str | None
    photo_url: str | None
    profile: ParticipantProfileOut


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return None


def serialize_participant(
    user: dict[str, Any], photo_url: str | None = None
) -> ParticipantOut:
    profile = user.get("profile") or {}
    return ParticipantOut(
        id=str(user["_id"]),
        email=user["email"],
        roles=user.get("roles", []),
        status=user.get("status", "active"),
        profile_complete=bool(user.get("profile_complete")),
        created_at=_iso(user.get("created_at")),
        photo_url=photo_url,
        profile=ParticipantProfileOut(
            full_name=profile.get("full_name"),
            age=profile.get("age"),
            gender=profile.get("gender"),
            phone=profile.get("phone"),
            country=profile.get("country"),
            state=profile.get("state"),
            city=profile.get("city"),
            program=profile.get("program"),
            course_stage=profile.get("course_stage"),
            course_stage_other=profile.get("course_stage_other"),
        ),
    )


async def resolve_photo_url(
    photos: AsyncCollection[dict[str, Any]] | None, user_id: ObjectId
) -> str | None:
    """Return the stored photo data URL for a user, or None if unavailable."""
    if photos is None:
        return None
    doc = await photos.find_one({"user_id": user_id})
    if doc is None:
        return None
    return doc.get("data_url")
