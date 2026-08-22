"""
Verifies seed_events.py's mechanics — create / skip / update / drop-demo —
against the real FastAPI app.

Uses a small dataset built here, in the restructured events schema, rather
than `frontend/src/data/paradoxEvents.json`. That file is frontend content and
still holds the *previous* events shape (`team.house`, a top-level `open`
flag, a client-chosen `event_id`, ...); it has not been migrated as part of
this backend change (see the note in `seed_events.py`), so depending on it
here would make this test fail for a reason that has nothing to do with
`publish_events` itself. This fixture is what `publish_events` is asked to
publish instead — proof the script's mechanics work stands on its own,
independent of when that frontend file gets updated.
"""
import os
import sys
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from main import app
from database import event_collection, backend_teams_collection
from seed_events import login, publish_events

ADMIN_EMAIL = "seed_super_admin@ds.study.iitm.ac.in"
ADMIN_PASSWORD = "seed_password_123"


def _dataset():
    """Two events in the current schema — one solo, one team-based with a
    published window covering "now", so registration-window validation on
    create is satisfied without any test having to mock the clock."""
    now = datetime.utcnow()
    window = {
        "start_time": (now - timedelta(days=1)).isoformat() + "Z",
        "end_time": (now + timedelta(days=30)).isoformat() + "Z",
        "allowed": True,
    }
    return [
        {
            "event_type": "technical",
            "name": "Hustlepreneurs By Escape Room",
            "description": "A startup pitch gauntlet.",
            "poster": "/images/events/posters/122.avif",
            "team": {"min": 2, "max": 4, "house_vs_house_event": False, "allow_single_registration": False},
            "prize_money": [{"position": "Top 5 Teams", "amount": 10000}],
            "registration": window,
            "schedule": [{
                "name": "The Pitch",
                "start_time": (now + timedelta(days=2)).isoformat() + "Z",
                "end_time": (now + timedelta(days=2, hours=2)).isoformat() + "Z",
                "venue": "ICSR Hall III",
            }],
            "registration_fields": [],
        },
        {
            "event_type": "sports",
            "name": "Last1Standing",
            "description": "Last1Standing is a competitive elimination sport.",
            "poster": "/images/events/posters/22.avif",
            "team": {"min": 1, "max": 1, "house_vs_house_event": False, "allow_single_registration": True},
            "prize_money": [],
            "registration": window,
            "schedule": [],
            "registration_fields": [],
        },
    ]


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


@pytest.fixture
def dataset():
    return _dataset()


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

    events = {e["name"]: e for e in response.json()}
    assert len(events) == len(dataset)

    # Content survives the round trip through the API verbatim, and
    # `registration.is_open` is computed from the published window.
    hustle = events["Hustlepreneurs By Escape Room"]
    assert hustle["poster"] == "/images/events/posters/122.avif"
    assert hustle["schedule"][-1]["venue"] == "ICSR Hall III"
    assert hustle["registration"]["is_open"] is True
    assert hustle["team"]["max"] == 4

    last_standing = events["Last1Standing"]
    assert last_standing["event_type"] == "sports"
    assert "competitive elimination" in last_standing["description"]


def test_drops_the_retired_demo_events(admin_client, dataset):
    now = datetime.utcnow()
    event_collection.insert_one({
        "event_id": "EVT_SOLO",
        "event_type": "technical",
        "name": "Code Sprint",
        "description": "A solo competitive programming contest.",
        "team": {"min": 1, "max": 1, "house_vs_house_event": False, "allow_single_registration": True},
        "prize_money": [],
        "registration": {
            "start_time": (now - timedelta(days=1)).isoformat() + "Z",
            "end_time": (now + timedelta(days=1)).isoformat() + "Z",
            "allowed": True,
        },
        "schedule": [],
        "registration_fields": [],
        "event_team": [],
        "announcements": [],
    })

    tally = publish_events(admin_client, dataset, drop_demo=True, log=lambda *_: None)

    assert tally["demo_deleted"] == 1
    assert tally["failed"] == 0
    assert event_collection.find_one({"event_id": "EVT_SOLO"}) is None
    assert event_collection.count_documents({}) == len(dataset)


def test_update_rewrites_existing_events(admin_client, dataset):
    publish_events(admin_client, dataset, log=lambda *_: None)

    event_collection.update_one({"name": "Last1Standing"}, {"$set": {"description": "Renamed by hand"}})

    tally = publish_events(admin_client, dataset, update=True, log=lambda *_: None)

    assert tally["updated"] == len(dataset)
    assert tally["failed"] == 0
    assert event_collection.find_one({"name": "Last1Standing"})["description"] == (
        "Last1Standing is a competitive elimination sport."
    )
