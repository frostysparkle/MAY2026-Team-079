from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError

from app.hostel.schemas import CreateAllocationRequest


class AllocationNotFoundError(RuntimeError):
    pass


class AllocationConflictError(RuntimeError):
    pass


class ParticipantNotFoundError(RuntimeError):
    pass


async def get_allocation_for_user(
    allocations: AsyncCollection[dict[str, Any]], user_id: ObjectId
) -> dict[str, Any] | None:
    return await allocations.find_one({"user_id": user_id})


async def list_allocations(
    allocations: AsyncCollection[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [doc async for doc in allocations.find({}, sort=[("hostel_block", 1), ("room", 1)])]


async def create_allocation(
    allocations: AsyncCollection[dict[str, Any]],
    users: AsyncCollection[dict[str, Any]],
    payload: CreateAllocationRequest,
) -> dict[str, Any]:
    if not ObjectId.is_valid(payload.participant_id):
        raise ParticipantNotFoundError("Participant not found.")
    user_id = ObjectId(payload.participant_id)
    if await users.find_one({"_id": user_id}) is None:
        raise ParticipantNotFoundError("Participant not found.")

    now = datetime.now(UTC)
    doc = {
        "user_id": user_id,
        "hostel_block": payload.hostel_block,
        "room": payload.room,
        "instructions": payload.instructions,
        "coordinator": payload.coordinator,
        "checked_in": False,
        "checked_in_at": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await allocations.insert_one(doc)
    except DuplicateKeyError as exc:
        raise AllocationConflictError(
            "This participant already has a hostel allocation."
        ) from exc
    doc["_id"] = result.inserted_id
    return doc


async def update_allocation(
    allocations: AsyncCollection[dict[str, Any]],
    allocation_id: str,
    changes: dict[str, Any],
) -> dict[str, Any]:
    if not ObjectId.is_valid(allocation_id):
        raise AllocationNotFoundError("Allocation not found.")
    changes = {**changes, "updated_at": datetime.now(UTC)}
    result = await allocations.find_one_and_update(
        {"_id": ObjectId(allocation_id)},
        {"$set": changes},
        return_document=ReturnDocument.AFTER,
    )
    if result is None:
        raise AllocationNotFoundError("Allocation not found.")
    return result


async def delete_allocation(
    allocations: AsyncCollection[dict[str, Any]], allocation_id: str
) -> None:
    if not ObjectId.is_valid(allocation_id):
        raise AllocationNotFoundError("Allocation not found.")
    result = await allocations.delete_one({"_id": ObjectId(allocation_id)})
    if result.deleted_count == 0:
        raise AllocationNotFoundError("Allocation not found.")


async def mark_checked_in(
    allocations: AsyncCollection[dict[str, Any]], user_id: ObjectId
) -> None:
    """Record a successful hostel check-in (FR-5.2)."""
    await allocations.update_one(
        {"user_id": user_id},
        {"$set": {"checked_in": True, "checked_in_at": datetime.now(UTC)}},
    )
