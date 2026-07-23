from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection

from app.events.schemas import EventCreate


class EventNotFoundError(RuntimeError):
    pass


async def list_events(
    events: AsyncCollection[dict[str, Any]],
    include_unpublished: bool,
    accessible_event_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    query: dict[str, Any]
    if include_unpublished:
        query = {}
    elif accessible_event_ids:
        object_ids = [
            ObjectId(event_id)
            for event_id in accessible_event_ids
            if ObjectId.is_valid(event_id)
        ]
        query = {
            "$or": [
                {"status": "published"},
                {"_id": {"$in": object_ids}},
            ]
        }
    else:
        query = {"status": "published"}
    cursor = events.find(query, sort=[("event_date", 1), ("start_time", 1)])
    return [doc async for doc in cursor]


async def get_event(
    events: AsyncCollection[dict[str, Any]],
    event_id: str,
    include_unpublished: bool,
) -> dict[str, Any]:
    if not ObjectId.is_valid(event_id):
        raise EventNotFoundError("Event not found.")
    query: dict[str, Any] = {"_id": ObjectId(event_id)}
    if not include_unpublished:
        query["status"] = "published"
    doc = await events.find_one(query)
    if doc is None:
        raise EventNotFoundError("Event not found.")
    return doc


async def create_event(
    events: AsyncCollection[dict[str, Any]],
    payload: EventCreate,
    created_by: ObjectId,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    doc = {
        "title": payload.title,
        "venue": payload.venue,
        "event_date": payload.event_date,
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "capacity": payload.capacity,
        "instructions": payload.instructions,
        "status": payload.status,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    result = await events.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def update_event(
    events: AsyncCollection[dict[str, Any]],
    event_id: str,
    changes: dict[str, Any],
) -> dict[str, Any]:
    if not ObjectId.is_valid(event_id):
        raise EventNotFoundError("Event not found.")
    changes = {**changes, "updated_at": datetime.now(UTC)}
    result = await events.find_one_and_update(
        {"_id": ObjectId(event_id)},
        {"$set": changes},
        return_document=ReturnDocument.AFTER,
    )
    if result is None:
        raise EventNotFoundError("Event not found.")
    return result
