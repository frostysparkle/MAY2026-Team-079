import asyncio
from copy import deepcopy
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.admin.schemas import UpsertStaffAssignmentRequest
from app.admin.staff_assignments import (
    StaffAssignmentNotFoundError,
    StaffAssignmentScopeNotFoundError,
    StaffAssignmentUserNotFoundError,
    set_staff_assignment_status,
    upsert_staff_assignment,
)


def _matches(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(doc.get(key) == value for key, value in query.items())


class FakeCollection:
    def __init__(self, docs: list[dict[str, Any]] | None = None) -> None:
        self.docs = [deepcopy(doc) for doc in docs or []]

    async def find_one(self, query):
        for doc in self.docs:
            if _matches(doc, query):
                return deepcopy(doc)
        return None

    async def find_one_and_update(
        self, query, update, *, upsert=False, return_document=None
    ):
        del return_document
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(deepcopy(update.get("$set", {})))
                return deepcopy(doc)
        if not upsert:
            return None
        doc = {
            "_id": ObjectId(),
            **deepcopy(query),
            **deepcopy(update.get("$setOnInsert", {})),
            **deepcopy(update.get("$set", {})),
        }
        self.docs.append(doc)
        return deepcopy(doc)


def test_assignment_scope_schema_rejects_unknown_checkpoints():
    with pytest.raises(ValidationError):
        UpsertStaffAssignmentRequest(
            user_id=str(ObjectId()),
            role="staff",
            scope_type="checkpoint",
            scope_id="unknown",
        )


def test_assignment_upsert_validates_targets_and_reactivates():
    async def run():
        user_id = ObjectId()
        event_id = ObjectId()
        actor_id = ObjectId()
        users = FakeCollection([{"_id": user_id}])
        events = FakeCollection([{"_id": event_id}])
        assignments = FakeCollection()
        payload = UpsertStaffAssignmentRequest(
            user_id=str(user_id),
            role="organizer",
            scope_type="event",
            scope_id=str(event_id),
        )

        created = await upsert_staff_assignment(
            assignments, users, events, payload, actor_id
        )
        assert created["active"] is True
        assert created["assigned_by"] == actor_id

        assignments.docs[0]["active"] = False
        reactivated = await upsert_staff_assignment(
            assignments, users, events, payload, actor_id
        )
        assert reactivated["active"] is True
        assert len(assignments.docs) == 1

        missing_user = payload.model_copy(update={"user_id": str(ObjectId())})
        with pytest.raises(StaffAssignmentUserNotFoundError):
            await upsert_staff_assignment(
                assignments, users, events, missing_user, actor_id
            )

        missing_event = payload.model_copy(update={"scope_id": str(ObjectId())})
        with pytest.raises(StaffAssignmentScopeNotFoundError):
            await upsert_staff_assignment(
                assignments, users, events, missing_event, actor_id
            )

    asyncio.run(run())


def test_assignment_can_be_deactivated_and_missing_ids_are_rejected():
    async def run():
        assignment_id = ObjectId()
        actor_id = ObjectId()
        assignments = FakeCollection(
            [
                {
                    "_id": assignment_id,
                    "active": True,
                }
            ]
        )

        updated = await set_staff_assignment_status(
            assignments, str(assignment_id), False, actor_id
        )
        assert updated["active"] is False
        assert updated["assigned_by"] == actor_id

        with pytest.raises(StaffAssignmentNotFoundError):
            await set_staff_assignment_status(
                assignments, str(ObjectId()), False, actor_id
            )

    asyncio.run(run())
