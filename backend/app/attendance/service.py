from typing import Any

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection


async def event_attendance(
    scan_logs: AsyncCollection[dict[str, Any]], event_id: str
) -> int:
    """Distinct participants with a valid scan for this event (FR-3.1).

    Counting distinct participants makes re-entry within the window idempotent —
    a repeat scan of the same person does not inflate the count.
    """
    participants = await scan_logs.distinct(
        "participant_id",
        {"checkpoint_context": "event", "event_id": event_id, "result": "valid"},
    )
    return len(participants)


def remaining_capacity(capacity: int, attendance: int) -> int:
    return max(capacity - attendance, 0)
