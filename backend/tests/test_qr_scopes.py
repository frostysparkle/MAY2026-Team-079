import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pyotp
import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

from app.qr.schemas import ProvisionSecretRequest, VerifyScanRequest
from app.qr.service import (
    EventRegistrationRequiredError,
    provision_secret,
    verify_scan,
)


def _matches(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(doc.get(key) == value for key, value in query.items())


class FakeCollection:
    def __init__(
        self,
        docs: list[dict[str, Any]] | None = None,
        *,
        replay_unique: bool = False,
    ) -> None:
        self.docs = [deepcopy(doc) for doc in docs or []]
        self.replay_unique = replay_unique

    async def find_one(self, query):
        for doc in self.docs:
            if _matches(doc, query):
                return deepcopy(doc)
        return None

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(deepcopy(update.get("$set", {})))
                for key, value in update.get("$setOnInsert", {}).items():
                    doc.setdefault(key, deepcopy(value))
                return SimpleNamespace(matched_count=1, modified_count=1)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0)
        doc = {**deepcopy(query), **deepcopy(update.get("$set", {}))}
        for key, value in update.get("$setOnInsert", {}).items():
            doc.setdefault(key, deepcopy(value))
        doc["_id"] = ObjectId()
        self.docs.append(doc)
        return SimpleNamespace(
            matched_count=0, modified_count=0, upserted_id=doc["_id"]
        )

    async def insert_one(self, doc):
        saved = deepcopy(doc)
        if self.replay_unique and "step" in saved:
            replay_fields = (
                "participant_id",
                "checkpoint_context",
                "scope_id",
                "step",
            )
            if any(
                all(existing.get(key) == saved.get(key) for key in replay_fields)
                for existing in self.docs
            ):
                raise DuplicateKeyError("duplicate replay")
        saved.setdefault("_id", ObjectId())
        self.docs.append(saved)
        return SimpleNamespace(inserted_id=saved["_id"])


def test_event_scope_is_required_by_the_api_models():
    with pytest.raises(ValidationError):
        ProvisionSecretRequest(checkpoint_context="event")
    with pytest.raises(ValidationError):
        VerifyScanRequest(
            participant_id=str(ObjectId()),
            current_code="123456",
            checkpoint_context="event",
        )
    with pytest.raises(ValidationError):
        ProvisionSecretRequest(
            checkpoint_context="hostel",
            event_id=str(ObjectId()),
        )


def test_event_secret_requires_registration_and_is_stored_per_event():
    async def run():
        user_id = ObjectId()
        event_id = ObjectId()
        events = FakeCollection(
            [{"_id": event_id, "status": "published"}]
        )
        registrations = FakeCollection()
        secrets = FakeCollection()

        with pytest.raises(EventRegistrationRequiredError):
            await provision_secret(
                secrets,
                events,
                registrations,
                user_id,
                "event",
                str(event_id),
            )

        registrations.docs.append(
            {
                "_id": ObjectId(),
                "user_id": user_id,
                "event_id": str(event_id),
                "status": "registered",
            }
        )
        secret = await provision_secret(
            secrets,
            events,
            registrations,
            user_id,
            "event",
            str(event_id),
        )

        assert secret
        assert secrets.docs[0]["scope_id"] == str(event_id)

    asyncio.run(run())


def test_event_scan_rejects_unregistered_and_inactive_participants():
    async def run():
        user_id = ObjectId()
        scanner_id = ObjectId()
        event_id = ObjectId()
        secret = pyotp.random_base32()
        events = FakeCollection(
            [{"_id": event_id, "status": "published"}]
        )
        registrations = FakeCollection()
        secrets = FakeCollection(
            [
                {
                    "user_id": user_id,
                    "checkpoint_context": "event",
                    "scope_id": str(event_id),
                    "secret_base32": secret,
                }
            ]
        )
        logs = FakeCollection(replay_unique=True)
        users = FakeCollection(
            [{"_id": user_id, "status": "active", "profile": {}}]
        )

        outcome = await verify_scan(
            users,
            events,
            registrations,
            secrets,
            logs,
            str(user_id),
            pyotp.TOTP(secret).now(),
            "event",
            scanner_id,
            event_id=str(event_id),
        )
        assert outcome.result == "not_eligible"
        assert outcome.detail == "Participant is not registered for this event."

        users.docs[0]["status"] = "disabled"
        outcome = await verify_scan(
            users,
            events,
            registrations,
            secrets,
            logs,
            str(user_id),
            pyotp.TOTP(secret).now(),
            "event",
            scanner_id,
            event_id=str(event_id),
        )
        assert outcome.result == "not_eligible"
        assert outcome.detail == "Participant account is inactive."

    asyncio.run(run())


def test_registered_event_scan_uses_the_exact_event_scope():
    async def run():
        user_id = ObjectId()
        scanner_id = ObjectId()
        first_event = ObjectId()
        second_event = ObjectId()
        secret = pyotp.random_base32()
        events = FakeCollection(
            [
                {"_id": first_event, "status": "published"},
                {"_id": second_event, "status": "published"},
            ]
        )
        registrations = FakeCollection(
            [
                {
                    "user_id": user_id,
                    "event_id": str(first_event),
                    "status": "registered",
                },
                {
                    "user_id": user_id,
                    "event_id": str(second_event),
                    "status": "registered",
                },
            ]
        )
        secrets = FakeCollection(
            [
                {
                    "user_id": user_id,
                    "checkpoint_context": "event",
                    "scope_id": str(first_event),
                    "secret_base32": secret,
                }
            ]
        )
        logs = FakeCollection(replay_unique=True)
        users = FakeCollection(
            [{"_id": user_id, "status": "active", "profile": {}}]
        )
        code = pyotp.TOTP(secret).now()

        wrong_scope = await verify_scan(
            users,
            events,
            registrations,
            secrets,
            logs,
            str(user_id),
            code,
            "event",
            scanner_id,
            event_id=str(second_event),
        )
        assert wrong_scope.result == "wrong_checkpoint"

        valid = await verify_scan(
            users,
            events,
            registrations,
            secrets,
            logs,
            str(user_id),
            code,
            "event",
            scanner_id,
            event_id=str(first_event),
        )
        assert valid.result == "valid"
        assert logs.docs[-1]["event_id"] == str(first_event)

    asyncio.run(run())
