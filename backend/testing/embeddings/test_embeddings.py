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
    def __init__(self):
        self.last_kwargs = None

    def create(self, **kwargs):
        self.last_kwargs = kwargs
        texts = kwargs["input"] if isinstance(kwargs["input"], list) else [kwargs["input"]]

        class FakeResponse:
            def model_dump(self_inner):
                return {
                    "object": "list",
                    "model": kwargs["model"],
                    "data": [
                        {"object": "embedding", "index": i, "embedding": [0.1, 0.2, 0.3]}
                        for i in range(len(texts))
                    ],
                    "usage": {"prompt_tokens": 3, "total_tokens": 3},
                }

        return FakeResponse()


class FakeClient:
    def __init__(self):
        self.embeddings = FakeEmbeddingsResource()


@pytest.fixture
def fake_client(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(embeddings_router, "get_client", lambda: fake)
    return fake


@pytest.fixture
def participant_token():
    """
    Function-scoped (not module-scoped): each test gets its own user, so the
    per-user rate limit on POST /embeddings can't make one test's call count
    against another's.
    """
    rand_id = random.randint(100000, 999999)
    email = f"23f{rand_id}@ds.study.iitm.ac.in"
    password = "secure_password"
    client.post("/auth/register", json={"email": email, "password": password})
    resp = client.post("/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


def test_create_embedding_single_string(fake_client, participant_token):
    resp = client.post(
        "/embeddings",
        json={"input": "hello world"},
        headers={"Authorization": f"Bearer {participant_token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["model"] == embeddings_router.EMBEDDINGS_DEFAULT_MODEL
    assert len(body["data"]) == 1
    assert fake_client.embeddings.last_kwargs["input"] == "hello world"
    # Optional fields left unset by the caller must not be forwarded at all.
    assert "encoding_format" not in fake_client.embeddings.last_kwargs
    assert "dimensions" not in fake_client.embeddings.last_kwargs


def test_create_embedding_list_and_model_override(fake_client, participant_token):
    resp = client.post(
        "/embeddings",
        json={"input": ["a", "b"], "model": "custom-model", "dimensions": 256},
        headers={"Authorization": f"Bearer {participant_token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["data"]) == 2
    assert fake_client.embeddings.last_kwargs["model"] == "custom-model"
    assert fake_client.embeddings.last_kwargs["dimensions"] == 256


def test_create_embedding_requires_auth(fake_client):
    resp = client.post("/embeddings", json={"input": "hello"})
    assert resp.status_code == 401
