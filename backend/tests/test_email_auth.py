"""Unit tests for the email/password auth service and endpoints."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from app.auth.dependencies import (
    get_photos_collection_optional,
    get_users_collection,
)
from app.auth.service import (
    AccountUnavailableError,
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    authenticate_user,
    register_user,
)
from app.core.config import Settings, get_settings
from app.core.security import hash_password, verify_password
from app.main import create_app


def _match(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(doc.get(k) == v for k, v in query.items())


class FakeUsers:
    def __init__(self, docs: list[dict[str, Any]] | None = None) -> None:
        self.docs = [deepcopy(d) for d in docs or []]

    async def find_one(self, query):
        for d in self.docs:
            if _match(d, query):
                return deepcopy(d)
        return None

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


def _settings() -> Settings:
    return Settings(
        mongodb_uri=None,
        mongodb_database="test",
        app_env="test",
        google_client_id=None,
        allowed_google_domains=(),
        jwt_secret="x" * 40,
        jwt_issuer="paradox-connect-test",
        jwt_access_token_minutes=30,
        initial_super_admin_email=None,
        cors_origins=("http://localhost:5173",),
        payment_gateway="mock",
        payment_webhook_secret="s",
        payment_currency="INR",
        hostel_fee_amount=2000,
        frontend_base_url="http://localhost:5173",
        enable_dev_login=False,
        redis_url=None,
        qr_secret_encryption_key=None,
        qr_scan_rate_limit=10,
        qr_scan_rate_window_seconds=60,
    )


def test_password_hash_roundtrip():
    stored = hash_password("s3cret-password")
    assert stored != "s3cret-password"
    assert verify_password("s3cret-password", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("s3cret-password", None)


def test_register_then_authenticate():
    async def run():
        users = FakeUsers()
        created = await register_user(users, "a@b.com", "password123", "Alice")
        assert created.is_new_user
        assert created.user["email"] == "a@b.com"
        assert "password_hash" in created.user

        signed_in = await authenticate_user(users, "a@b.com", "password123")
        assert not signed_in.is_new_user
        assert signed_in.user["_id"] == created.user["_id"]

    asyncio.run(run())


def test_duplicate_email_rejected():
    async def run():
        users = FakeUsers()
        await register_user(users, "dup@b.com", "password123", None)
        with pytest.raises(EmailAlreadyRegisteredError):
            await register_user(users, "dup@b.com", "password123", None)

    asyncio.run(run())


def test_wrong_password_rejected():
    async def run():
        users = FakeUsers()
        await register_user(users, "a@b.com", "password123", None)
        with pytest.raises(InvalidCredentialsError):
            await authenticate_user(users, "a@b.com", "nope")
        with pytest.raises(InvalidCredentialsError):
            await authenticate_user(users, "missing@b.com", "password123")

    asyncio.run(run())


def test_inactive_account_cannot_login():
    async def run():
        users = FakeUsers(
            [
                {
                    "_id": ObjectId(),
                    "email": "banned@b.com",
                    "password_hash": hash_password("password123"),
                    "status": "disabled",
                }
            ]
        )
        with pytest.raises(AccountUnavailableError):
            await authenticate_user(users, "banned@b.com", "password123")

    asyncio.run(run())


def _client(users: FakeUsers) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = _settings
    app.dependency_overrides[get_users_collection] = lambda: users
    app.dependency_overrides[get_photos_collection_optional] = lambda: None
    return TestClient(app)


def test_register_and_login_endpoints_issue_working_tokens():
    users = FakeUsers()
    with _client(users) as c:
        reg = c.post(
            "/api/v1/auth/register",
            json={"email": "New@B.com", "password": "password123", "full_name": "New"},
        )
        assert reg.status_code == 201, reg.text
        body = reg.json()
        assert body["is_new_user"] is True
        assert body["user"]["email"] == "new@b.com"
        token = body["access_token"]

        me = c.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == "new@b.com"

        dup = c.post(
            "/api/v1/auth/register",
            json={"email": "new@b.com", "password": "password123"},
        )
        assert dup.status_code == 409
        assert dup.json()["code"] == "email_already_registered"

        login = c.post(
            "/api/v1/auth/login",
            json={"email": "new@b.com", "password": "password123"},
        )
        assert login.status_code == 200
        assert login.json()["is_new_user"] is False

        bad = c.post(
            "/api/v1/auth/login",
            json={"email": "new@b.com", "password": "wrongpass"},
        )
        assert bad.status_code == 401
        assert bad.json()["code"] == "invalid_credentials"
