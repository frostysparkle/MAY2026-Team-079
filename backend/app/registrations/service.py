"""Participant-side event registration.

Activates the `event_registrations` collection (unique index on
(user_id, event_id) already exists). Registrations are soft-cancellable so a
cancelled row is re-activated rather than duplicated (Correctness Property 4),
and capacity is checked against the count of active registrations (Property 5).
"""

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection

from app.events.service import EventNotFoundError, get_event


class EventFullError(RuntimeError):
    pass


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
        return existing  # idempotent — already registered

    capacity = int(event.get("capacity", 0))
    if capacity > 0 and await count_active(registrations, event_id) >= capacity:
        raise EventFullError("This event is at capacity.")

    now = datetime.now(UTC)
    if existing is not None:
        await registrations.update_one(
            {"_id": existing["_id"]},
            {"$set": {"status": "registered", "updated_at": now}},
        )
        return {**existing, "status": "registered", "updated_at": now}

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


async def cancel(
    registrations: AsyncCollection[dict[str, Any]],
    user_id: ObjectId,
    event_id: str,
) -> None:
    """Soft-cancel an active registration. Idempotent (no-op if not registered)."""
    await registrations.update_one(
        {"user_id": user_id, "event_id": event_id, "status": "registered"},
        {"$set": {"status": "cancelled", "updated_at": datetime.now(UTC)}},
    )


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
