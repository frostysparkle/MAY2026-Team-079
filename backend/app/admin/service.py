from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection


class ParticipantNotFoundError(RuntimeError):
    pass


async def list_users(
    users: AsyncCollection[dict[str, Any]],
) -> list[dict[str, Any]]:
    cursor = users.find({}, sort=[("created_at", 1)])
    return [doc async for doc in cursor]


async def assign_role(
    users: AsyncCollection[dict[str, Any]],
    participant_id: str,
    role: str,
) -> None:
    """Set a participant's roles to exactly [role] (Super-Admin action)."""
    if not ObjectId.is_valid(participant_id):
        raise ParticipantNotFoundError("Participant not found.")

    result = await users.update_one(
        {"_id": ObjectId(participant_id)},
        {"$set": {"roles": [role], "updated_at": datetime.now(UTC)}},
    )
    if result.matched_count == 0:
        raise ParticipantNotFoundError("Participant not found.")
