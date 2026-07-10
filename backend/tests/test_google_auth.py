from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from app.auth.dependencies import get_google_verifier, get_users_collection
from app.auth.google import (
    GoogleAccountNotAllowedError,
    GoogleIdentity,
    validate_google_claims,
)
from app.core.config import Settings, get_settings
from app.main import create_app


ALLOWED_DOMAINS = (
    "ds.study.iitm.ac.in",
    "es.study.iitm.ac.in",
    "ee.study.iitm.ac.in",
    "mg.study.iitm.ac.in",
)


def make_settings() -> Settings:
    return Settings(
        mongodb_uri=None,
        mongodb_database="test_paradox_connect",
        app_env="test",
        google_client_id="test-client.apps.googleusercontent.com",
        allowed_google_domains=ALLOWED_DOMAINS,
        jwt_secret="test-jwt-secret-that-is-longer-than-32-characters",
        jwt_issuer="paradox-connect-test",
        jwt_access_token_minutes=30,
        initial_super_admin_email=None,
        cors_origins=("http://localhost:5173",),
    )


class FakeGoogleVerifier:
    def __init__(self, identity: GoogleIdentity) -> None:
        self.identity = identity

    async def verify(self, _credential: str) -> GoogleIdentity:
        return self.identity


class FakeUsersCollection:
    def __init__(self, documents: list[dict[str, Any]] | None = None) -> None:
        self.documents = [deepcopy(document) for document in documents or []]

    async def find_one(self, query: dict[str, Any]) -> dict[str, Any] | None:
        for document in self.documents:
            if all(document.get(field) == value for field, value in query.items()):
                return deepcopy(document)
        return None

    async def insert_one(self, document: dict[str, Any]) -> SimpleNamespace:
        inserted = deepcopy(document)
        inserted["_id"] = ObjectId()
        self.documents.append(inserted)
        return SimpleNamespace(inserted_id=inserted["_id"])

    async def update_one(
        self, query: dict[str, Any], update: dict[str, dict[str, Any]]
    ) -> SimpleNamespace:
        for document in self.documents:
            if not all(document.get(field) == value for field, value in query.items()):
                continue
            for field, value in update.get("$set", {}).items():
                if "." in field:
                    parent, child = field.split(".", 1)
                    document.setdefault(parent, {})[child] = value
                else:
                    document[field] = value
            for field in update.get("$unset", {}):
                document.pop(field, None)
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def google_identity(email: str = "student@ds.study.iitm.ac.in") -> GoogleIdentity:
    return GoogleIdentity(
        subject="google-account-123",
        email=email,
        hosted_domain=email.rsplit("@", 1)[1],
        name="Example Student",
    )


def test_claim_validation_requires_verified_allowed_workspace_account() -> None:
    identity = validate_google_claims(
        {
            "sub": "google-account-123",
            "email": "Student@DS.STUDY.IITM.AC.IN",
            "email_verified": True,
            "hd": "ds.study.iitm.ac.in",
            "name": " Example Student ",
        },
        ALLOWED_DOMAINS,
    )

    assert identity.email == "student@ds.study.iitm.ac.in"
    assert identity.name == "Example Student"

    with pytest.raises(GoogleAccountNotAllowedError):
        validate_google_claims(
            {
                "sub": "google-account-123",
                "email": "student@gmail.com",
                "email_verified": True,
                "hd": "gmail.com",
            },
            ALLOWED_DOMAINS,
        )


def test_google_login_creates_participant_and_issued_token_authenticates_me() -> None:
    users = FakeUsersCollection()
    settings = make_settings()
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_users_collection] = lambda: users
    app.dependency_overrides[get_google_verifier] = lambda: FakeGoogleVerifier(
        google_identity()
    )

    with TestClient(app) as client:
        login_response = client.post(
            "/api/v1/auth/google", json={"credential": "valid-google-token"}
        )

        assert login_response.status_code == 200
        login_body = login_response.json()
        assert login_body["is_new_user"] is True
        assert login_body["user"]["roles"] == ["participant"]
        assert login_body["user"]["profile_complete"] is False

        me_response = client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {login_body['access_token']}"},
        )

    assert me_response.status_code == 200
    assert me_response.json()["email"] == "student@ds.study.iitm.ac.in"
    assert "password_hash" not in users.documents[0]


def test_invited_super_admin_is_linked_without_losing_role() -> None:
    invited_email = "admin@es.study.iitm.ac.in"
    users = FakeUsersCollection(
        [
            {
                "_id": ObjectId(),
                "email": invited_email,
                "email_verified": False,
                "roles": ["super_admin"],
                "status": "invited",
                "profile": {},
                "profile_complete": False,
            }
        ]
    )
    settings = make_settings()
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_users_collection] = lambda: users
    app.dependency_overrides[get_google_verifier] = lambda: FakeGoogleVerifier(
        google_identity(invited_email)
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/google", json={"credential": "valid-google-token"}
        )

    assert response.status_code == 200
    assert response.json()["is_new_user"] is False
    assert response.json()["user"]["roles"] == ["super_admin"]
    assert users.documents[0]["google_subject"] == "google-account-123"
    assert users.documents[0]["status"] == "active"


def test_validation_errors_use_the_api_error_shape_without_echoing_credential() -> None:
    users = FakeUsersCollection()
    app = create_app()
    app.dependency_overrides[get_users_collection] = lambda: users
    with TestClient(app) as client:
        response = client.post("/api/v1/auth/google", json={"credential": ""})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert "input" not in response.text
