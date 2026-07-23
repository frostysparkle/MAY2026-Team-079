import asyncio
from copy import deepcopy
from typing import Any

import pytest
from bson import ObjectId

from app.auth.scopes import assigned_scope_ids, ensure_scope_access
from app.core.errors import ApiError


def _matches_value(value: Any, expected: Any) -> bool:
    if isinstance(expected, dict) and "$in" in expected:
        return value in expected["$in"]
    return value == expected


def _matches(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(_matches_value(doc.get(key), value) for key, value in query.items())


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self._docs = iter(deepcopy(docs))

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._docs)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class FakeAssignments:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self.docs = deepcopy(docs)

    async def find_one(self, query):
        for doc in self.docs:
            if _matches(doc, query):
                return deepcopy(doc)
        return None

    def find(self, query):
        return FakeCursor([doc for doc in self.docs if _matches(doc, query)])


def _assignment(
    user_id: ObjectId,
    *,
    role: str = "organizer",
    scope_id: str,
    active: bool = True,
) -> dict[str, Any]:
    return {
        "_id": ObjectId(),
        "user_id": user_id,
        "role": role,
        "scope_type": "event",
        "scope_id": scope_id,
        "active": active,
    }


def test_exact_and_wildcard_assignments_grant_only_the_requested_scope():
    async def run():
        user_id = ObjectId()
        event_id = str(ObjectId())
        other_event_id = str(ObjectId())
        user = {"_id": user_id, "roles": ["organizer"]}
        assignments = FakeAssignments(
            [_assignment(user_id, scope_id=event_id)]
        )

        assert (
            await ensure_scope_access(
                user,
                assignments,
                roles=("organizer",),
                scope_type="event",
                scope_id=event_id,
            )
            is user
        )
        with pytest.raises(ApiError) as denied:
            await ensure_scope_access(
                user,
                assignments,
                roles=("organizer",),
                scope_type="event",
                scope_id=other_event_id,
            )
        assert denied.value.code == "scope_access_denied"

        assignments.docs.append(_assignment(user_id, scope_id="*"))
        assert (
            await ensure_scope_access(
                user,
                assignments,
                roles=("organizer",),
                scope_type="event",
                scope_id=other_event_id,
            )
            is user
        )

    asyncio.run(run())


def test_inactive_or_wrong_role_assignments_do_not_grant_access():
    async def run():
        user_id = ObjectId()
        event_id = str(ObjectId())
        user = {"_id": user_id, "roles": ["staff"]}
        assignments = FakeAssignments(
            [
                _assignment(user_id, scope_id=event_id, active=False),
                _assignment(user_id, role="staff", scope_id=event_id),
            ]
        )

        with pytest.raises(ApiError):
            await ensure_scope_access(
                user,
                assignments,
                roles=("organizer",),
                scope_type="event",
                scope_id=event_id,
            )
        await ensure_scope_access(
            user,
            assignments,
            roles=("organizer", "staff"),
            scope_type="event",
            scope_id=event_id,
        )

    asyncio.run(run())


def test_admins_bypass_assignments_and_exact_scopes_filter_drafts():
    async def run():
        user_id = ObjectId()
        first_event = str(ObjectId())
        second_event = str(ObjectId())
        assignments = FakeAssignments(
            [
                _assignment(user_id, scope_id=first_event),
                _assignment(user_id, scope_id=second_event, active=False),
            ]
        )
        organizer = {"_id": user_id, "roles": ["organizer"]}
        assert await assigned_scope_ids(
            organizer,
            assignments,
            roles=("organizer",),
            scope_type="event",
        ) == {first_event}

        admin = {"_id": ObjectId(), "roles": ["admin"]}
        assert (
            await assigned_scope_ids(
                admin,
                FakeAssignments([]),
                roles=("organizer",),
                scope_type="event",
            )
            is None
        )
        await ensure_scope_access(
            admin,
            FakeAssignments([]),
            roles=("organizer",),
            scope_type="event",
            scope_id=first_event,
        )

    asyncio.run(run())
