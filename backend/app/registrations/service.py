"""Participant-side event registration.

Activates the `event_registrations` collection (unique index on
(user_id, event_id) already exists). Registrations are soft-cancellable so a
cancelled row is re-activated rather than duplicated (Correctness Property 4),
and an atomic counter on the event document reserves capacity before a
registration is activated (Property 5).
"""

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.events.service import EventNotFoundError, get_event


class EventFullError(RuntimeError):
    pass


async def _ensure_registration_counter(
    registrations: AsyncCollection[dict[str, Any]],
    events: AsyncCollection[dict[str, Any]],
    event: dict[str, Any],
) -> None:
    """Backfill one legacy event's counter once before it is used for admission."""
    if "registration_count" in event:
        return

    active_count = await count_active(registrations, str(event["_id"]))
    await events.update_one(
        {
            "_id": event["_id"],
            "registration_count": {"$exists": False},
        },
        {"$set": {"registration_count": active_count}},
    )


async def _reserve_capacity(
    events: AsyncCollection[dict[str, Any]],
    event: dict[str, Any],
) -> None:
    reserved = await events.find_one_and_update(
        {
            "_id": event["_id"],
            "status": "published",
            "$expr": {
                "$lt": [
                    {"$ifNull": ["$registration_count", 0]},
                    "$capacity",
                ]
            },
        },
        {
            "$inc": {"registration_count": 1},
            "$set": {"updated_at": datetime.now(UTC)},
        },
        return_document=ReturnDocument.AFTER,
    )
    if reserved is None:
        still_published = await events.find_one(
            {"_id": event["_id"], "status": "published"}
        )
        if still_published is None:
            raise EventNotFoundError("Event not found.")
        raise EventFullError("This event is at capacity.")


async def _release_capacity(
    events: AsyncCollection[dict[str, Any]], event_id: ObjectId
) -> None:
    await events.update_one(
        {"_id": event_id, "registration_count": {"$gt": 0}},
        {
            "$inc": {"registration_count": -1},
            "$set": {"updated_at": datetime.now(UTC)},
        },
    )


async def count_active(
    registrations: AsyncCollection[dict[str, Any]], event_id: str
) -> int:
    return await registrations.count_documents(
        {"event_id": event_id, "status": "registered"}
    )


async def is_registered(
    registrations: AsyncCollection[dict[str, Any]], user_id: ObjectId, event_id: str
) -> bool:
    doc = await registrations.find_one(
        {"user_id": user_id, "event_id": event_id, "status": "registered"}
    )
    return doc is not None


async def registration_info(
    registrations: AsyncCollection[dict[str, Any]],
    event: dict[str, Any],
    user_id: ObjectId,
) -> tuple[int, int, bool]:
    """Return (count, spots_left, registered) for an event, for a given user."""
    event_id = str(event["_id"])
    count = await count_active(registrations, event_id)
    capacity = int(event.get("capacity", 0))
    spots_left = max(capacity - count, 0)
    registered = await is_registered(registrations, user_id, event_id)
    return count, spots_left, registered


async def register(
    registrations: AsyncCollection[dict[str, Any]],
    events: AsyncCollection[dict[str, Any]],
    user_id: ObjectId,
    event_id: str,
) -> dict[str, Any]:
    """Register the user for a published event. Idempotent; raises
    EventNotFoundError (unknown/unpublished) or EventFullError (at capacity)."""
    event = await get_event(events, event_id, include_unpublished=False)

    existing = await registrations.find_one({"user_id": user_id, "event_id": event_id})
    if existing is not None and existing.get("status") == "registered":
        await _ensure_registration_counter(registrations, events, event)
        return existing  # idempotent — already registered

    await _ensure_registration_counter(registrations, events, event)
    await _reserve_capacity(events, event)

    now = datetime.now(UTC)
    try:
        if existing is not None:
            result = await registrations.update_one(
                {"_id": existing["_id"], "status": {"$ne": "registered"}},
                {"$set": {"status": "registered", "updated_at": now}},
            )
            if result.modified_count:
                return {**existing, "status": "registered", "updated_at": now}

            # A concurrent request activated the same row after our initial read.
            await _release_capacity(events, event["_id"])
            current = await registrations.find_one(
                {
                    "user_id": user_id,
                    "event_id": event_id,
                    "status": "registered",
                }
            )
            if current is not None:
                return current
            raise RuntimeError("Registration changed during activation.")

        doc = {
            "user_id": user_id,
            "event_id": event_id,
            "status": "registered",
            "created_at": now,
            "updated_at": now,
        }
        result = await registrations.insert_one(doc)
        doc["_id"] = result.inserted_id
        return doc
    except DuplicateKeyError:
        # The unique (user_id, event_id) index makes concurrent retries
        # idempotent. Return the winner and give our extra reservation back.
        await _release_capacity(events, event["_id"])
        current = await registrations.find_one(
            {
                "user_id": user_id,
                "event_id": event_id,
                "status": "registered",
            }
        )
        if current is not None:
            return current
        raise
    except PyMongoError:
        await _release_capacity(events, event["_id"])
        raise


async def cancel(
    registrations: AsyncCollection[dict[str, Any]],
    events: AsyncCollection[dict[str, Any]],
    user_id: ObjectId,
    event_id: str,
) -> None:
    """Soft-cancel an active registration. Idempotent (no-op if not registered)."""
    cancelled = await registrations.find_one_and_update(
        {"user_id": user_id, "event_id": event_id, "status": "registered"},
        {"$set": {"status": "cancelled", "updated_at": datetime.now(UTC)}},
        return_document=ReturnDocument.AFTER,
    )
    if cancelled is not None and ObjectId.is_valid(event_id):
        await _release_capacity(events, ObjectId(event_id))


async def list_my_registrations(
    registrations: AsyncCollection[dict[str, Any]],
    events: AsyncCollection[dict[str, Any]],
    user_id: ObjectId,
) -> list[dict[str, Any]]:
    """Active registrations joined with their event details (skips events that
    no longer exist)."""
    cursor = registrations.find(
        {"user_id": user_id, "status": "registered"}, sort=[("created_at", -1)]
    )
    out: list[dict[str, Any]] = []
    async for reg in cursor:
        event_id = reg["event_id"]
        if not ObjectId.is_valid(event_id):
            continue
        event = await events.find_one({"_id": ObjectId(event_id)})
        if event is not None:
            out.append({"registration": reg, "event": event})
    return out
