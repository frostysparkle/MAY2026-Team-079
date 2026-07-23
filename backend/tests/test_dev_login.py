"""Dev-login gating tests (Correctness Property 8)."""

from copy import deepcopy
from typing import Any

from bson import ObjectId
from fastapi.testclient import TestClient

from app.auth.dependencies import get_photos_collection_optional, get_users_collection
from app.core.config import Settings, get_settings
from app.main import create_app


ALLOWED = (
    "ds.study.iitm.ac.in",
    "es.study.iitm.ac.in",
    "ee.study.iitm.ac.in",
    "mg.study.iitm.ac.in",
)


def _settings(enable_dev_login: bool) -> Settings:
    return Settings(
        mongodb_uri=None,
        mongodb_database="test",
        app_env="test",
        google_client_id="cid",
        allowed_google_domains=ALLOWED,
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
        enable_dev_login=enable_dev_login,
        redis_url=None,
        qr_secret_encryption_key=None,
        qr_scan_rate_limit=10,
        qr_scan_rate_window_seconds=60,
    )


class FakeUsers:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self.docs = [deepcopy(d) for d in docs]

    async def find_one(self, query):
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return deepcopy(d)
        return None


def _seed_user():
    return {
        "_id": ObjectId(),
        "email": "newbie@ds.study.iitm.ac.in",
        "roles": ["participant"],
        "status": "active",
        "profile": {"full_name": "Newbie"},
        "profile_complete": False,
        "is_test": True,
        "test_label": "New student",
    }


def _client(enable: bool):
    users = FakeUsers([_seed_user()])
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: _settings(enable)
    app.dependency_overrides[get_users_collection] = lambda: users
    app.dependency_overrides[get_photos_collection_optional] = lambda: None
    return TestClient(app)


def test_dev_login_404_when_disabled():
    with _client(enable=False) as c:
        assert c.post("/api/v1/auth/dev-login", json={"email": "newbie@ds.study.iitm.ac.in"}).status_code == 404
        assert c.get("/api/v1/auth/test-accounts").status_code == 404


def test_dev_login_issues_session_when_enabled():
    with _client(enable=True) as c:
        r = c.post("/api/v1/auth/dev-login", json={"email": "newbie@ds.study.iitm.ac.in"})
        assert r.status_code == 200
        body = r.json()
        assert body["access_token"]
        assert body["is_new_user"] is False
        assert body["user"]["email"] == "newbie@ds.study.iitm.ac.in"


def test_dev_login_unknown_account_404():
    with _client(enable=True) as c:
        assert c.post("/api/v1/auth/dev-login", json={"email": "ghost@ds.study.iitm.ac.in"}).status_code == 404
