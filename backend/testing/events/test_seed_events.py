"""
Verifies the event migration end to end.

Runs `seed_events.publish_events` against the real FastAPI app with the real
dataset, then reads the result back through the public brochure endpoint — the
same path the landing page uses. This is the proof that the whole catalogue can
be created through the Super Admin events API and comes back out intact.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from main import app
from database import event_collection, backend_teams_collection
from seed_events import DEFAULT_DATASET, login, publish_events

ADMIN_EMAIL = "seed_super_admin@ds.study.iitm.ac.in"
ADMIN_PASSWORD = "seed_password_123"


@pytest.fixture
def admin_client():
    """A TestClient authenticated as a Super Admin. TestClient is an httpx.Client,
    so `publish_events` runs against it unchanged."""
    event_collection.delete_many({})
    backend_teams_collection.delete_many({"email": ADMIN_EMAIL})
    backend_teams_collection.insert_one({
        "paradox_id": "SA_SEED_TEST",
        "email": ADMIN_EMAIL,
        "password_hash": security.get_password_hash(ADMIN_PASSWORD),
        "role": "super_admin",
        "department": "technicals",
        "designation": "Head",
        "admin_id": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })

    client = TestClient(app)
    token = login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
    client.headers["Authorization"] = f"Bearer {token}"
    yield client

    event_collection.delete_many({})
    backend_teams_collection.delete_many({"email": ADMIN_EMAIL})


@pytest.fixture(scope="module")
def dataset():
    assert DEFAULT_DATASET.is_file(), f"dataset missing at {DEFAULT_DATASET}"
    return json.loads(Path(DEFAULT_DATASET).read_text(encoding="utf-8"))


def test_publishes_the_whole_catalogue(admin_client, dataset):
    tally = publish_events(admin_client, dataset, log=lambda *_: None)

    assert tally["failed"] == 0
    assert tally["created"] == len(dataset)
    assert event_collection.count_documents({}) == len(dataset)


def test_rerunning_changes_nothing(admin_client, dataset):
    publish_events(admin_client, dataset, log=lambda *_: None)
    again = publish_events(admin_client, dataset, log=lambda *_: None)

    assert again["created"] == 0
    assert again["failed"] == 0
    assert again["skipped"] == len(dataset)
    assert event_collection.count_documents({}) == len(dataset)


def test_published_events_are_readable_without_a_token(admin_client, dataset):
    publish_events(admin_client, dataset, log=lambda *_: None)

    # A fresh client with no Authorization header, like a signed-out visitor.
    anonymous = TestClient(app)
    response = anonymous.get("/events/public")
    assert response.status_code == 200

    events = {e["event_id"]: e for e in response.json()}
    assert len(events) == len(dataset)

    # Content survives the round trip through the API verbatim.
    hustle = events["122"]
    assert hustle["name"] == "Hustlepreneurs By Escape Room"
    assert hustle["poster"] == "/images/events/posters/122.avif"
    assert hustle["registration"]["prize_amounts"] == '["₹10000 each"]'
    assert hustle["schedule"][-1]["venue"] == "ICSR Hall III"
    assert hustle["open"] is True

    last_standing = events["22"]
    assert last_standing["event_type"] == "sports"
    assert "Last1Standing is a competitive" in last_standing["description"]
    assert '"label":"Rounds","value":"5"' in last_standing["registration"]["meta"]


def test_drops_the_retired_demo_events(admin_client, dataset):
    event_collection.insert_one({
        "event_id": "EVT_SOLO",
        "event_type": "technical",
        "name": "Code Sprint",
        "description": "A solo competitive programming contest.",
        "team": {"min": 1, "max": 1, "house": False, "allow_single_registration": True},
        "open": True,
        "prize_money": [],
        "registration": {},
        "schedule": [],
        "registration_fields": [],
        "event_team": [],
    })

    tally = publish_events(admin_client, dataset, drop_demo=True, log=lambda *_: None)

    assert tally["demo_deleted"] == 1
    assert tally["failed"] == 0
    assert event_collection.find_one({"event_id": "EVT_SOLO"}) is None
    assert event_collection.count_documents({}) == len(dataset)


def test_update_rewrites_existing_events(admin_client, dataset):
    publish_events(admin_client, dataset, log=lambda *_: None)

    event_collection.update_one({"event_id": "22"}, {"$set": {"name": "Renamed by hand"}})

    tally = publish_events(admin_client, dataset, update=True, log=lambda *_: None)

    assert tally["updated"] == len(dataset)
    assert tally["failed"] == 0
    assert event_collection.find_one({"event_id": "22"})["name"] == "Last1Standing"
