from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection

from app.admin.schemas import UpsertStaffAssignmentRequest


class StaffAssignmentNotFoundError(RuntimeError):
    pass


class StaffAssignmentUserNotFoundError(RuntimeError):
    pass


class StaffAssignmentScopeNotFoundError(RuntimeError):
    pass


async def list_staff_assignments(
    assignments: AsyncCollection[dict[str, Any]],
) -> list[dict[str, Any]]:
    cursor = assignments.find(
        {},
        sort=[
            ("active", -1),
            ("scope_type", 1),
            ("scope_id", 1),
            ("role", 1),
        ],
    )
    return [doc async for doc in cursor]


async def upsert_staff_assignment(
    assignments: AsyncCollection[dict[str, Any]],
    users: AsyncCollection[dict[str, Any]],
    events: AsyncCollection[dict[str, Any]],
    payload: UpsertStaffAssignmentRequest,
    assigned_by: ObjectId,
) -> dict[str, Any]:
    if not ObjectId.is_valid(payload.user_id):
        raise StaffAssignmentUserNotFoundError("User not found.")
    user_id = ObjectId(payload.user_id)
    if await users.find_one({"_id": user_id}) is None:
        raise StaffAssignmentUserNotFoundError("User not found.")

    if payload.scope_type == "event" and payload.scope_id != "*":
        if not ObjectId.is_valid(payload.scope_id):
            raise StaffAssignmentScopeNotFoundError("Event not found.")
        if await events.find_one({"_id": ObjectId(payload.scope_id)}) is None:
            raise StaffAssignmentScopeNotFoundError("Event not found.")

    now = datetime.now(UTC)
    assignment = await assignments.find_one_and_update(
        {
            "user_id": user_id,
            "role": payload.role,
            "scope_type": payload.scope_type,
            "scope_id": payload.scope_id,
        },
        {
            "$set": {
                "active": True,
                "assigned_by": assigned_by,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    assert assignment is not None
    return assignment


async def set_staff_assignment_status(
    assignments: AsyncCollection[dict[str, Any]],
    assignment_id: str,
    active: bool,
    updated_by: ObjectId,
) -> dict[str, Any]:
    if not ObjectId.is_valid(assignment_id):
        raise StaffAssignmentNotFoundError("Staff assignment not found.")
    assignment = await assignments.find_one_and_update(
        {"_id": ObjectId(assignment_id)},
        {
            "$set": {
                "active": active,
                "assigned_by": updated_by,
                "updated_at": datetime.now(UTC),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if assignment is None:
        raise StaffAssignmentNotFoundError("Staff assignment not found.")
    return assignment
