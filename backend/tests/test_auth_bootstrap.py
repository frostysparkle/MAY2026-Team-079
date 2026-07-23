"""Tests for password-based initial Super Admin bootstrap."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from bson import ObjectId

from app.core.security import verify_password
from app.db.bootstrap import _seed_initial_super_admin
from app.db.collections import USERS


def _matches(document: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, expected in query.items():
        actual = document.get(key)
        if isinstance(actual, list):
            if expected not in actual:
                return False
        elif actual != expected:
            return False
    return True


class FakeUsers:
    def __init__(self, documents: list[dict[str, Any]] | None = None) -> None:
        self.documents = [deepcopy(document) for document in documents or []]

    async def count_documents(self, query):
        return sum(_matches(document, query) for document in self.documents)

    async def find_one(self, query):
        for document in self.documents:
            if _matches(document, query):
                return deepcopy(document)
        return None

    async def insert_one(self, document):
        stored = deepcopy(document)
        stored["_id"] = ObjectId()
        self.documents.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    async def update_one(self, query, update):
        for document in self.documents:
            if _matches(document, query):
                document.update(update["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class FakeDatabase:
    def __init__(self, users: FakeUsers) -> None:
        self.users = users

    def __getitem__(self, collection_name: str):
        assert collection_name == USERS
        return self.users


def _settings(email: str | None, password: str | None):
    return SimpleNamespace(
        initial_super_admin_email=email,
        initial_super_admin_password=password,
    )


def test_super_admin_requires_both_bootstrap_credentials():
    async def run():
        database = FakeDatabase(FakeUsers())
        with pytest.raises(RuntimeError, match="configured together"):
            await _seed_initial_super_admin(
                database,
                _settings("root@example.com", None),
            )

    asyncio.run(run())


def test_super_admin_is_created_with_a_hash_and_participant_access():
    async def run():
        users = FakeUsers()
        created = await _seed_initial_super_admin(
            FakeDatabase(users),
            _settings("root@example.com", "initial-password"),
        )

        assert created is True
        stored = users.documents[0]
        assert stored["status"] == "active"
        assert stored["roles"] == ["participant", "super_admin"]
        assert stored["password_hash"] != "initial-password"
        assert verify_password("initial-password", stored["password_hash"])
        assert "email_verified" not in stored

    asyncio.run(run())


def test_legacy_invitation_is_activated_with_a_password():
    async def run():
        user_id = ObjectId()
        users = FakeUsers(
            [
                {
                    "_id": user_id,
                    "email": "root@example.com",
                    "roles": ["super_admin"],
                    "status": "invited",
                }
            ]
        )
        created = await _seed_initial_super_admin(
            FakeDatabase(users),
            _settings("root@example.com", "initial-password"),
        )

        assert created is False
        stored = users.documents[0]
        assert stored["status"] == "active"
        assert verify_password("initial-password", stored["password_hash"])

    asyncio.run(run())


def test_bootstrap_does_not_replace_a_different_super_admin():
    async def run():
        users = FakeUsers(
            [
                {
                    "_id": ObjectId(),
                    "email": "existing@example.com",
                    "roles": ["participant", "super_admin"],
                    "status": "active",
                    "password_hash": "already-set",
                }
            ]
        )
        with pytest.raises(RuntimeError, match="different Super Admin"):
            await _seed_initial_super_admin(
                FakeDatabase(users),
                _settings("replacement@example.com", "initial-password"),
            )

    asyncio.run(run())
