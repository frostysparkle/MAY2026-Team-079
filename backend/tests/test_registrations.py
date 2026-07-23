"""Unit tests for the event-registration service (Correctness Properties 4, 5).

Uses asyncio.run to avoid adding a pytest-async plugin (matches the repo's
existing sync-test setup)."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.events.service import EventNotFoundError
from app.registrations.service import (
    EventFullError,
    cancel,
    count_active,
    is_registered,
    register,
)


def _expression_value(doc: dict[str, Any], expression: Any) -> Any:
    if isinstance(expression, str) and expression.startswith("$"):
        return doc.get(expression[1:])
    if isinstance(expression, dict) and "$ifNull" in expression:
        value, fallback = expression["$ifNull"]
        resolved = _expression_value(doc, value)
        return fallback if resolved is None else resolved
    return expression


def _match(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, expected in query.items():
        if key == "$expr":
            left, right = expected["$lt"]
            if not (
                _expression_value(doc, left)
                < _expression_value(doc, right)
            ):
                return False
            continue

        actual = doc.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and (key in doc) is not expected["$exists"]:
                return False
            if "$gt" in expected and not (actual is not None and actual > expected["$gt"]):
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


def _apply_update(document: dict[str, Any], update: dict[str, Any]) -> None:
    document.update(update.get("$set", {}))
    for field, amount in update.get("$inc", {}).items():
        document[field] = document.get(field, 0) + amount


class FakeCollection:
    def __init__(self, docs: list[dict[str, Any]] | None = None) -> None:
        self.docs = [deepcopy(d) for d in docs or []]
        self.lock = asyncio.Lock()

    async def find_one(self, query):
        async with self.lock:
            for d in self.docs:
                if _match(d, query):
                    return deepcopy(d)
        return None

    async def count_documents(self, query):
        async with self.lock:
            return sum(1 for d in self.docs if _match(d, query))

    async def insert_one(self, doc):
        async with self.lock:
            if "user_id" in doc and "event_id" in doc:
                duplicate = any(
                    existing.get("user_id") == doc["user_id"]
                    and existing.get("event_id") == doc["event_id"]
                    for existing in self.docs
                )
                if duplicate:
                    raise DuplicateKeyError("duplicate registration")
            doc = deepcopy(doc)
            doc.setdefault("_id", ObjectId())
            self.docs.append(doc)
            return SimpleNamespace(inserted_id=doc["_id"])

    async def update_one(self, query, update):
        async with self.lock:
            for d in self.docs:
                if _match(d, query):
                    _apply_update(d, update)
                    return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def find_one_and_update(self, query, update, return_document=None):
        async with self.lock:
            for d in self.docs:
                if _match(d, query):
                    _apply_update(d, update)
                    return deepcopy(d)
        return None


def _events(capacity=100, status="published", *, include_counter=True):
    eid = ObjectId()
    event = {"_id": eid, "capacity": capacity, "status": status}
    if include_counter:
        event["registration_count"] = 0
    return str(eid), FakeCollection([event])


def test_register_then_idempotent():
    async def run():
        event_id, events = _events()
        regs = FakeCollection()
        uid = ObjectId()
        await register(regs, events, uid, event_id)
        assert await count_active(regs, event_id) == 1
        assert await is_registered(regs, uid, event_id) is True
        await register(regs, events, uid, event_id)  # Property 4: idempotent
        assert await count_active(regs, event_id) == 1
        assert events.docs[0]["registration_count"] == 1

    asyncio.run(run())


def test_capacity_enforced():
    async def run():
        event_id, events = _events(capacity=1)
        regs = FakeCollection()
        await register(regs, events, ObjectId(), event_id)
        with pytest.raises(EventFullError):  # Property 5
            await register(regs, events, ObjectId(), event_id)
        assert events.docs[0]["registration_count"] == 1

    asyncio.run(run())


def test_cancel_then_reactivate():
    async def run():
        event_id, events = _events()
        regs = FakeCollection()
        uid = ObjectId()
        await register(regs, events, uid, event_id)
        await cancel(regs, events, uid, event_id)
        await cancel(regs, events, uid, event_id)  # idempotent release
        assert await count_active(regs, event_id) == 0
        assert events.docs[0]["registration_count"] == 0
        await register(regs, events, uid, event_id)  # re-activate, not duplicate
        assert await count_active(regs, event_id) == 1
        assert events.docs[0]["registration_count"] == 1
        assert len([d for d in regs.docs if d["user_id"] == uid]) == 1

    asyncio.run(run())


def test_concurrent_registrations_do_not_oversubscribe():
    async def run():
        event_id, events = _events(capacity=1)
        regs = FakeCollection()
        results = await asyncio.gather(
            register(regs, events, ObjectId(), event_id),
            register(regs, events, ObjectId(), event_id),
            return_exceptions=True,
        )

        assert sum(isinstance(result, dict) for result in results) == 1
        assert sum(isinstance(result, EventFullError) for result in results) == 1
        assert await count_active(regs, event_id) == 1
        assert events.docs[0]["registration_count"] == 1

    asyncio.run(run())


def test_concurrent_retry_for_same_user_uses_one_reservation():
    async def run():
        event_id, events = _events(capacity=2)
        regs = FakeCollection()
        user_id = ObjectId()
        results = await asyncio.gather(
            register(regs, events, user_id, event_id),
            register(regs, events, user_id, event_id),
        )

        assert all(result["status"] == "registered" for result in results)
        assert await count_active(regs, event_id) == 1
        assert events.docs[0]["registration_count"] == 1

    asyncio.run(run())


def test_legacy_event_counter_is_backfilled_before_reservation():
    async def run():
        event_id, events = _events(capacity=1, include_counter=False)
        regs = FakeCollection(
            [
                {
                    "_id": ObjectId(),
                    "user_id": ObjectId(),
                    "event_id": event_id,
                    "status": "registered",
                }
            ]
        )

        with pytest.raises(EventFullError):
            await register(regs, events, ObjectId(), event_id)
        assert events.docs[0]["registration_count"] == 1

    asyncio.run(run())


def test_unpublished_event_not_found():
    async def run():
        event_id, events = _events(status="draft")
        regs = FakeCollection()
        with pytest.raises(EventNotFoundError):
            await register(regs, events, ObjectId(), event_id)

    asyncio.run(run())
