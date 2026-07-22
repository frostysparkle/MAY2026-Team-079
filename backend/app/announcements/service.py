from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection

from app.announcements.schemas import CreateAnnouncementRequest
from app.auth.roles import effective_rank, role_rank


class AnnouncementNotFoundError(RuntimeError):
    pass


async def create_announcement(
    announcements: AsyncCollection[dict[str, Any]],
    payload: CreateAnnouncementRequest,
    sender_id: ObjectId,
    sender_name: str | None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    doc = {
        "title": payload.title,
        "body": payload.body,
        "audience": payload.audience,
        "event_id": payload.event_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "created_at": now,
    }
    result = await announcements.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def list_all(
    announcements: AsyncCollection[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [doc async for doc in announcements.find({}, sort=[("created_at", -1)])]


def _can_see(doc: dict[str, Any], user: dict[str, Any], has_hostel: bool) -> bool:
    audience = doc.get("audience")
    if audience == "all_participants":
        return True
    if audience == "hostel_residents":
        return has_hostel
    if audience == "pors":
        return effective_rank(user) >= role_rank("organizer")
    # event_registrants: no registration model in the MVP, so these are shown to
    # everyone with the event referenced for context (documented simplification).
    if audience == "event_registrants":
        return True
    return False


async def list_for_user(
    announcements: AsyncCollection[dict[str, Any]],
    hostel_allocations: AsyncCollection[dict[str, Any]],
    user: dict[str, Any],
) -> list[dict[str, Any]]:
    has_hostel = (
        await hostel_allocations.find_one({"user_id": user["_id"]}) is not None
    )
    docs = [doc async for doc in announcements.find({}, sort=[("created_at", -1)])]
    return [doc for doc in docs if _can_see(doc, user, has_hostel)]


async def delete_announcement(
    announcements: AsyncCollection[dict[str, Any]], announcement_id: str
) -> None:
    if not ObjectId.is_valid(announcement_id):
        raise AnnouncementNotFoundError("Announcement not found.")
    result = await announcements.delete_one({"_id": ObjectId(announcement_id)})
    if result.deleted_count == 0:
        raise AnnouncementNotFoundError("Announcement not found.")
