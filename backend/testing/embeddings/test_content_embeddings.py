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
import main as main_module

client = TestClient(app)

FAKE_VECTOR_A = [0.1] * 768
FAKE_VECTOR_B = [0.2] * 768


class CountingEmbedder:
    """Records every text it was called with and returns queued vectors in order."""

    def __init__(self, vectors):
        self.vectors = list(vectors)
        self.calls = []

    def __call__(self, text):
        self.calls.append(text)
        return self.vectors.pop(0) if self.vectors else FAKE_VECTOR_B


@pytest.fixture
def sa_token():
    rand = random.randint(100000, 999999)
    email = f"sa_emb{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.delete_one({"email": email})
    backend_teams_collection.insert_one({
        "paradox_id": f"SAEMB{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "technicals",
        "designation": "Head",
    })
    resp = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"})
    return resp.json()["access_token"]


def test_workshop_embedding_generated_on_create_and_regenerated_on_description_change(monkeypatch, sa_token):
    embedder = CountingEmbedder([FAKE_VECTOR_A, FAKE_VECTOR_B])
    monkeypatch.setattr(workshops_router, "generate_embedding", embedder)

    ws_id = f"WKS_EMB_{random.randint(1000, 9999)}"
    headers = {"Authorization": f"Bearer {sa_token}"}
    resp = client.post("/workshops", json={
        "workshop_id": ws_id,
        "slot_id": "SLOT_EMB",
        "name": "Embedding Test",
        "description": "original description",
        "venue": "Hall",
        "capacity": 10,
        "instructions": "none",
    }, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["original description"]

    doc = workshops_collection.find_one({"workshop_id": ws_id})
    assert doc["embedding"] == FAKE_VECTOR_A

    # Re-sending the same description alongside an unrelated field change must
    # not burn another embeddings call.
    resp = client.put(f"/workshops/{ws_id}", json={"description": "original description", "capacity": 20}, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["original description"]
    doc = workshops_collection.find_one({"workshop_id": ws_id})
    assert doc["embedding"] == FAKE_VECTOR_A
    assert doc["capacity"] == 20

    # Changing the description regenerates.
    resp = client.put(f"/workshops/{ws_id}", json={"description": "new description"}, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["original description", "new description"]
    doc = workshops_collection.find_one({"workshop_id": ws_id})
    assert doc["embedding"] == FAKE_VECTOR_B


def test_workshop_public_and_registration_responses_include_embedding(monkeypatch, sa_token):
    monkeypatch.setattr(workshops_router, "generate_embedding", lambda text: FAKE_VECTOR_A)
    ws_id = f"WKS_EMB2_{random.randint(1000, 9999)}"
    headers = {"Authorization": f"Bearer {sa_token}"}
    client.post("/workshops", json={
        "workshop_id": ws_id, "slot_id": "SLOT_EMB2", "name": "Embedding Test 2",
        "description": "desc", "venue": "Hall", "capacity": 10, "instructions": "none",
    }, headers=headers)

    resp = client.get("/workshops/public")
    assert resp.status_code == 200
    match = next(w for w in resp.json() if w["workshop_id"] == ws_id)
    assert match["embedding"] == FAKE_VECTOR_A


def test_event_embedding_generated_on_create_and_regenerated_on_description_change(monkeypatch, sa_token):
    embedder = CountingEmbedder([FAKE_VECTOR_A, FAKE_VECTOR_B])
    monkeypatch.setattr(events_router, "generate_embedding", embedder)

    ev_id = f"EV_EMB_{random.randint(1000, 9999)}"
    headers = {"Authorization": f"Bearer {sa_token}"}
    resp = client.post("/events", json={
        "event_id": ev_id,
        "event_type": "technical",
        "name": "Embedding Event",
        "description": "original description",
        "team": {"min": 1, "max": 1},
        "registration": {"start_time": "2026-01-01T00:00:00", "end_time": "2026-01-02T00:00:00"},
    }, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["original description"]

    doc = event_collection.find_one({"event_id": ev_id})
    assert doc["embedding"] == FAKE_VECTOR_A

    resp = client.put(f"/events/{ev_id}", json={"description": "original description"}, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["original description"]

    resp = client.put(f"/events/{ev_id}", json={"description": "changed"}, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["original description", "changed"]
    doc = event_collection.find_one({"event_id": ev_id})
    assert doc["embedding"] == FAKE_VECTOR_B


def test_event_public_response_includes_embedding(monkeypatch, sa_token):
    monkeypatch.setattr(events_router, "generate_embedding", lambda text: FAKE_VECTOR_A)
    ev_id = f"EV_EMB2_{random.randint(1000, 9999)}"
    headers = {"Authorization": f"Bearer {sa_token}"}
    client.post("/events", json={
        "event_id": ev_id, "event_type": "technical", "name": "Embedding Event 2",
        "description": "desc", "team": {"min": 1, "max": 1},
        "registration": {"start_time": "2026-01-01T00:00:00", "end_time": "2026-01-02T00:00:00"},
    }, headers=headers)

    resp = client.get("/events/public")
    assert resp.status_code == 200
    match = next(e for e in resp.json() if e["event_id"] == ev_id)
    assert match["embedding"] == FAKE_VECTOR_A


def test_participant_registration_gets_zero_embedding():
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    doc = participants_collection.find_one({"email": email})
    assert doc["embedding"] == {"workshop": [0.0] * 768, "event": [0.0] * 768}


def test_profile_completion_generates_shared_preference_embedding(monkeypatch):
    embedder = CountingEmbedder([FAKE_VECTOR_A, FAKE_VECTOR_B])
    monkeypatch.setattr(main_module, "generate_embedding", embedder)

    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    base_payload = {
        "full_name": "Test Participant",
        "dob": "2000-01-01",
        "house": "House1",
        "gender": "other",
        "phone": "9999999999",
        "country": "India",
        "state": "TN",
        "city": "Chennai",
        "address": "Addr",
        "program": "DS",
        "course_stage": "diploma",
        "event_preferences": "I like AI and dance",
    }

    resp = client.patch("/profile/complete", json=base_payload, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["I like AI and dance"]

    doc = participants_collection.find_one({"email": email})
    assert doc["embedding"] == {"workshop": FAKE_VECTOR_A, "event": FAKE_VECTOR_A}

    # Resubmitting the same preference text must not regenerate.
    resp = client.patch("/profile/complete", json=base_payload, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["I like AI and dance"]

    # Changing the preference text regenerates, and the new vector lands in
    # both slots since there is still only one shared preference input.
    changed_payload = dict(base_payload, event_preferences="Now I like sports")
    resp = client.patch("/profile/complete", json=changed_payload, headers=headers)
    assert resp.status_code == 200
    assert embedder.calls == ["I like AI and dance", "Now I like sports"]
    doc = participants_collection.find_one({"email": email})
    assert doc["embedding"] == {"workshop": FAKE_VECTOR_B, "event": FAKE_VECTOR_B}
