"""Unit tests for the event-registration service (Correctness Properties 4, 5).

Uses asyncio.run to avoid adding a pytest-async plugin (matches the repo's
existing sync-test setup)."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from bson import ObjectId

from app.events.service import EventNotFoundError
from app.registrations.service import (
    EventFullError,
    cancel,
    count_active,
    is_registered,
    register,
)


def _match(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(doc.get(k) == v for k, v in query.items())


class FakeCollection:
    def __init__(self, docs: list[dict[str, Any]] | None = None) -> None:
        self.docs = [deepcopy(d) for d in docs or []]

    async def find_one(self, query):
        for d in self.docs:
            if _match(d, query):
                return deepcopy(d)
        return None

    async def count_documents(self, query):
        return sum(1 for d in self.docs if _match(d, query))

    async def insert_one(self, doc):
        doc = deepcopy(doc)
        doc.setdefault("_id", ObjectId())
        self.docs.append(doc)
        return SimpleNamespace(inserted_id=doc["_id"])

    async def update_one(self, query, update):
        for d in self.docs:
            if _match(d, query):
                d.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def _events(capacity=100, status="published"):
    eid = ObjectId()
    return str(eid), FakeCollection([{"_id": eid, "capacity": capacity, "status": status}])


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

    asyncio.run(run())


def test_capacity_enforced():
    async def run():
        event_id, events = _events(capacity=1)
        regs = FakeCollection()
        await register(regs, events, ObjectId(), event_id)
        with pytest.raises(EventFullError):  # Property 5
            await register(regs, events, ObjectId(), event_id)

    asyncio.run(run())


def test_cancel_then_reactivate():
    async def run():
        event_id, events = _events()
        regs = FakeCollection()
        uid = ObjectId()
        await register(regs, events, uid, event_id)
        await cancel(regs, uid, event_id)
        assert await count_active(regs, event_id) == 0
        await register(regs, events, uid, event_id)  # re-activate, not duplicate
        assert await count_active(regs, event_id) == 1
        assert len([d for d in regs.docs if d["user_id"] == uid]) == 1

    asyncio.run(run())


def test_unpublished_event_not_found():
    async def run():
        event_id, events = _events(status="draft")
        regs = FakeCollection()
        with pytest.raises(EventNotFoundError):
            await register(regs, events, ObjectId(), event_id)

    asyncio.run(run())
