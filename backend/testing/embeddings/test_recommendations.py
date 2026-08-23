"""
POST /events/recommendations and POST /workshops/recommendations — similarity
re-ranking of the full catalogue against a participant's query or saved
preference embedding. No relevance threshold: every event/workshop is always
returned, only reordered.
"""
import os
import sys
import random

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from database import workshops_collection, event_collection, participants_collection, backend_teams_collection
import security
from routers import workshops as workshops_router
from routers import events as events_router
from similarity import cosine_similarity

client = TestClient(app)


def unit(i: int, n: int = 768) -> list[float]:
    """A one-hot-ish vector so two different indices are guaranteed dissimilar."""
    v = [0.0] * n
    v[i % n] = 1.0
    return v


@pytest.fixture
def sa_token():
    rand = random.randint(100000, 999999)
    email = f"sa_rec{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.delete_one({"email": email})
    backend_teams_collection.insert_one({
        "paradox_id": f"SAREC{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "technicals",
        "designation": "Head",
    })
    resp = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"})
    return resp.json()["access_token"]


@pytest.fixture
def participant(monkeypatch):
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    token = login.json()["access_token"]
    return {"email": email, "token": token, "headers": {"Authorization": f"Bearer {token}"}}


def test_events_are_all_returned_sorted_most_similar_first(monkeypatch, sa_token, participant):
    # Two events with orthogonal embeddings.
    monkeypatch.setattr(events_router, "generate_embedding", lambda text: unit(0))
    headers = {"Authorization": f"Bearer {sa_token}"}
    resp_a = client.post("/events", json={
        "event_type": "technical", "name": "Close Event", "description": "close",
        "team": {"min": 1, "max": 1},
        "registration": {"start_time": "2026-01-01T00:00:00Z", "end_time": "2026-12-31T00:00:00Z"},
    }, headers=headers)
    ev_close = resp_a.json()["event_id"]

    monkeypatch.setattr(events_router, "generate_embedding", lambda text: unit(1))
    resp_b = client.post("/events", json={
        "event_type": "technical", "name": "Far Event", "description": "far",
        "team": {"min": 1, "max": 1},
        "registration": {"start_time": "2026-01-01T00:00:00Z", "end_time": "2026-12-31T00:00:00Z"},
    }, headers=headers)
    ev_far = resp_b.json()["event_id"]

    # Query embeds to the same direction as the "close" event.
    monkeypatch.setattr(events_router, "generate_embedding", lambda text: unit(0))
    resp = client.post("/events/recommendations", json={"query": "close topic"}, headers=participant["headers"])
    assert resp.status_code == 200
    body = resp.json()

    ids = [e["event_id"] for e in body]
    # Both events present — nothing is filtered out.
    assert ev_close in ids
    assert ev_far in ids

    close_entry = next(e for e in body if e["event_id"] == ev_close)
    far_entry = next(e for e in body if e["event_id"] == ev_far)
    assert close_entry["similarity"] > far_entry["similarity"]
    # Sorted descending by similarity.
    sims = [e["similarity"] for e in body]
    assert sims == sorted(sims, reverse=True)


def test_events_query_persists_to_profile_and_is_reused_when_absent(monkeypatch, sa_token, participant):
    vector = unit(5)
    monkeypatch.setattr(events_router, "generate_embedding", lambda text: vector)

    resp = client.post("/events/recommendations", json={"query": "something"}, headers=participant["headers"])
    assert resp.status_code == 200

    doc = participants_collection.find_one({"email": participant["email"]})
    assert doc["embedding"]["event"] == vector

    # No query this time — must reuse the persisted vector rather than erroring
    # or embedding an empty string.
    calls = []
    monkeypatch.setattr(events_router, "generate_embedding", lambda text: calls.append(text) or unit(9))
    resp2 = client.post("/events/recommendations", json={"query": None}, headers=participant["headers"])
    assert resp2.status_code == 200
    assert calls == []  # generate_embedding must not be called when query is absent

    doc2 = participants_collection.find_one({"email": participant["email"]})
    assert doc2["embedding"]["event"] == vector  # unchanged


def test_workshops_are_all_returned_sorted_and_use_separate_embedding_slot(monkeypatch, sa_token, participant):
    # The backend's SequentialIDGenerator assigns the real workshop_id and
    # ignores whatever the client sent, so the slot_id (unique per test run) is
    # what identifies this workshop afterwards.
    slot_id = f"SLOT_REC_{random.randint(1000, 9999)}"
    monkeypatch.setattr(workshops_router, "generate_embedding", lambda text: unit(2))
    headers = {"Authorization": f"Bearer {sa_token}"}
    client.post("/workshops", json={
        "workshop_id": "ignored", "slot_id": slot_id, "name": "Rec Workshop",
        "description": "topic", "venue": "Hall", "capacity": 10, "instructions": "none",
    }, headers=headers)
    ws_id = workshops_collection.find_one({"slot_id": slot_id})["workshop_id"]

    monkeypatch.setattr(workshops_router, "generate_embedding", lambda text: unit(2))
    resp = client.post("/workshops/recommendations", json={"query": "topic"}, headers=participant["headers"])
    assert resp.status_code == 200
    body = resp.json()
    ids = [w["workshop_id"] for w in body]
    assert ws_id in ids
    match = next(w for w in body if w["workshop_id"] == ws_id)
    assert match["similarity"] == pytest.approx(1.0)

    # The workshop-side search must not touch the event-side embedding slot.
    doc = participants_collection.find_one({"email": participant["email"]})
    assert doc["embedding"]["workshop"] == unit(2)
    assert doc["embedding"]["event"] == [0.0] * 768


def test_no_query_and_no_saved_preference_still_returns_everything(sa_token, participant):
    headers = {"Authorization": f"Bearer {sa_token}"}
    slot_id = f"SLOT_REC2_{random.randint(1000, 9999)}"
    client.post("/workshops", json={
        "workshop_id": "ignored", "slot_id": slot_id, "name": "Rec Workshop 2",
        "description": "topic", "venue": "Hall", "capacity": 10, "instructions": "none",
    }, headers=headers)
    ws_id = workshops_collection.find_one({"slot_id": slot_id})["workshop_id"]

    resp = client.post("/workshops/recommendations", json={}, headers=participant["headers"])
    assert resp.status_code == 200
    body = resp.json()
    ids = [w["workshop_id"] for w in body]
    assert ws_id in ids  # zero-vector similarity still returns everything


def test_cosine_similarity_basics():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0
    assert cosine_similarity([], []) == 0.0
