"""
Tests for the unauthenticated festival brochure endpoint.

`GET /events/public` is the pre-login events catalogue: it must work with no
token at all, and it must not leak anything beyond the published fields.
"""
import os
import sys
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from database import event_collection

client = TestClient(app)


@pytest.fixture
def published_event():
    event_collection.delete_many({})
    event_collection.insert_one({
        "event_id": "122",
        "event_type": "technical",
        "name": "Hustlepreneurs By Escape Room",
        "description": "A startup pitch gauntlet.",
        "poster": "/images/events/posters/122.avif",
        "team": {"min": 2, "max": 4, "house": False, "allow_single_registration": False},
        "open": True,
        "prize_money": [{"position": "Top 5 Teams", "amount": 10000}],
        "registration": {
            "meta": '[{"label":"Team Size","value":"2 – 4"}]',
            "prize_amounts": '["₹10000 each"]',
        },
        "schedule": [{
            "round_id": "RND1",
            "name": "The Pitch",
            "description": "Final pitch to the panel.",
            "start_time": "",
            "end_time": "",
            "venue": "ICSR Hall III",
        }],
        # None of the following may reach an anonymous caller.
        "registration_fields": [{"field_id": "team_size", "label": "Team size", "type": "select", "required": True}],
        "event_team": [{"user_id": "SA123456", "role": "event_head"}],
        "created_by": "internal-object-id",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "logs": [{"action": "registration", "participant_id": "DS23F1000001"}],
    })
    yield
    event_collection.delete_many({})


def test_public_events_readable_without_a_token(published_event):
    response = client.get("/events/public")
    assert response.status_code == 200

    events = response.json()
    assert len(events) == 1

    event = events[0]
    assert event["event_id"] == "122"
    assert event["name"] == "Hustlepreneurs By Escape Room"
    assert event["poster"] == "/images/events/posters/122.avif"
    assert event["open"] is True
    assert event["team"]["max"] == 4
    assert event["prize_money"] == [{"position": "Top 5 Teams", "amount": 10000}]
    # The display overlay rides along in the registration map.
    assert event["registration"]["prize_amounts"] == '["₹10000 each"]'
    # The round's venue survives, since the brochure prints it.
    assert event["schedule"][0]["venue"] == "ICSR Hall III"


def test_public_events_withholds_private_fields(published_event):
    event = client.get("/events/public").json()[0]

    for field in ("event_team", "registration_fields", "created_by", "logs", "_id",
                  "created_at", "updated_at"):
        assert field not in event, f"{field} must not be public"


def test_private_event_list_still_requires_a_token(published_event):
    # The brochure being open must not have opened the staff listing.
    assert client.get("/events").status_code in (401, 403)


def test_public_path_is_not_mistaken_for_an_event_id(published_event):
    # A literal /events/public must not be captured by an /{event_id} route.
    body = client.get("/events/public").json()
    assert isinstance(body, list)
