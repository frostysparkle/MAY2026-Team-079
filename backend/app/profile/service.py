import base64
import re
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection

from app.profile.schemas import CompleteProfileRequest


_DATA_URL_RE = re.compile(r"^data:(?P<mime>image/(?:jpeg|png));base64,(?P<data>.+)$")


def _photo_meta(data_url: str) -> tuple[str, int]:
    """Return (mime, byte_size) for an already-validated photo data URL."""
    match = _DATA_URL_RE.match(data_url.strip())
    assert match is not None  # guaranteed by schema validation
    raw = base64.b64decode(match.group("data"), validate=True)
    return match.group("mime"), len(raw)


async def complete_profile(
    users: AsyncCollection[dict[str, Any]],
    photos: AsyncCollection[dict[str, Any]],
    user: dict[str, Any],
    req: CompleteProfileRequest,
) -> dict[str, Any]:
    """Persist the one-time profile and store the photo in the `photos`
    collection (separate from the participant document)."""
    now = datetime.now(UTC)
    user_id: ObjectId = user["_id"]

    profile = {
        "full_name": req.full_name,
        "age": req.age,
        "gender": req.gender,
        "phone": req.phone,
        "country": req.country,
        "state": req.state,
        "city": req.city,
        "program": req.program,
        "course_stage": req.course_stage,
        "course_stage_other": (
            req.course_stage_other if req.course_stage == "other" else None
        ),
    }

    mime, size = _photo_meta(req.photo_data_url)
    await photos.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "data_url": req.photo_data_url,
                "content_type": mime,
                "size_bytes": size,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    await users.update_one(
        {"_id": user_id},
        {"$set": {"profile": profile, "profile_complete": True, "updated_at": now}},
    )

    updated = dict(user)
    updated["profile"] = profile
    updated["profile_complete"] = True
    return updated
