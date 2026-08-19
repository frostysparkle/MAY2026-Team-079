import os
import sys
import random

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from routers import embeddings as embeddings_router

client = TestClient(app)


class FakeEmbeddingsResource:
    def create(self, **kwargs):
        texts = kwargs["input"] if isinstance(kwargs["input"], list) else [kwargs["input"]]

        class FakeResponse:
            def model_dump(self_inner):
                return {
                    "object": "list",
                    "model": kwargs["model"],
                    "data": [{"object": "embedding", "index": i, "embedding": [0.1, 0.2, 0.3]} for i in range(len(texts))],
                    "usage": {"prompt_tokens": 3, "total_tokens": 3},
                }

        return FakeResponse()


class FakeClient:
    def __init__(self):
        self.embeddings = FakeEmbeddingsResource()


@pytest.fixture(autouse=True)
def fake_client_and_clean_state(monkeypatch):
    """
    Fakes the provider client (no real network) and gives every test a clean
    rate-limit bucket, so state left over from other test modules can't leak
    in and no test here leaks state into the next.
    """
    monkeypatch.setattr(embeddings_router, "get_client", lambda: FakeClient())
    monkeypatch.setattr(embeddings_router, "_last_request_at", {})
    yield


def _new_participant_token():
    rand_id = random.randint(100000, 999999)
    email = f"23f{rand_id}@ds.study.iitm.ac.in"
    password = "secure_password"
    client.post("/auth/register", json={"email": email, "password": password})
    resp = client.post("/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


def test_second_call_within_window_is_rate_limited():
    headers = {"Authorization": f"Bearer {_new_participant_token()}"}

    first = client.post("/embeddings", json={"input": "hello"}, headers=headers)
    assert first.status_code == 200

    second = client.post("/embeddings", json={"input": "hello again"}, headers=headers)
    assert second.status_code == 429
    assert "Retry-After" in second.headers
    assert int(second.headers["Retry-After"]) > 0


def test_rate_limit_is_per_user():
    headers_a = {"Authorization": f"Bearer {_new_participant_token()}"}
    headers_b = {"Authorization": f"Bearer {_new_participant_token()}"}

    resp_a = client.post("/embeddings", json={"input": "hello"}, headers=headers_a)
    assert resp_a.status_code == 200

    # A different user must not be blocked by user A's call.
    resp_b = client.post("/embeddings", json={"input": "hello"}, headers=headers_b)
    assert resp_b.status_code == 200


def test_call_allowed_again_after_window_elapses(monkeypatch):
    monkeypatch.setattr(embeddings_router, "RATE_LIMIT_SECONDS", 0)
    headers = {"Authorization": f"Bearer {_new_participant_token()}"}

    first = client.post("/embeddings", json={"input": "hello"}, headers=headers)
    assert first.status_code == 200

    second = client.post("/embeddings", json={"input": "hello again"}, headers=headers)
    assert second.status_code == 200
