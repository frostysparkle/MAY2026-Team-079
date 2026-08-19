"""
The audit trail endpoint and the per-entity log views built on it.

Two things are being proved:

1. ``GET /audit-logs`` can be narrowed to one entity or one action. The dashboard's
   per-entity log view depends on this happening server-side — ``limit`` is applied
   by Mongo before any client could filter, so an entity's older entries would be
   silently cut off otherwise.

2. ``GET /events/{event_id}/logs`` returns the attendance scans that
   ``POST /events/{event_id}/scan`` has always written but nothing ever read back.
   The rows key on the event's ObjectId rather than its readable ``event_id``, so
   the translation is the part worth pinning down.

Log rows are inserted directly here rather than driven through a QR scan: the scan
paths are already covered by ``test_mess.py`` and ``test_events.py``, and what is
under test is the read contract.
"""
import os
import random
import sys
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from database import (
    backend_teams_collection,
    event_collection,
    event_logs_collection,
    system_logs_collection,
)
from main import app

client = TestClient(app)

EVENT_ID = "EVT_AUDIT_1"
MESS_ID = "MS_AUDIT_1"
HOSTEL_ID = "HS_AUDIT_1"


def make_staff(role: str) -> str:
    """Insert a staff member and return their bearer token."""
    rand = random.randint(100000, 999999)
    email = f"audit{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"BT{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": "technicals",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    # Staff sign in through /auth/admin/login; /auth/login is participant-only.
    resp = client.post(
        "/auth/admin/login", json={"email": email, "password": "secure_password"}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def trail():
    """A trail spanning all four domains, plus one event with attendance scans."""
    system_logs_collection.delete_many({})
    event_collection.delete_many({})
    event_logs_collection.delete_many({})
    backend_teams_collection.delete_many({})

    sa_token = make_staff("super_admin")
    staff_token = make_staff("staff")

    base = datetime(2026, 8, 1, 9, 0, 0)
    system_logs_collection.insert_many([
        {"timestamp": base, "actor_id": "BT1", "action": "CREATE_EVENT",
         "target_id": EVENT_ID, "details": {}},
        {"timestamp": base + timedelta(minutes=1), "actor_id": "P1",
         "action": "EVENT_REGISTER", "target_id": EVENT_ID, "details": {}},
        {"timestamp": base + timedelta(minutes=2), "actor_id": "BT1",
         "action": "CREATE_MESS", "target_id": MESS_ID, "details": {"capacity": 300}},
        # The richest scan record in the system: who ate, which meal, which day.
        {"timestamp": base + timedelta(minutes=3), "actor_id": "BT3", "action": "MESS_SCAN",
         "target_id": MESS_ID, "details": {"participant_id": "P1", "slot": "lunch", "day": 2}},
        # Entry and exit are only distinguishable by the action name.
        {"timestamp": base + timedelta(minutes=4), "actor_id": "BT4", "action": "HOSTEL_ENTRY",
         "target_id": HOSTEL_ID, "details": {"participant_id": "P1"}},
        {"timestamp": base + timedelta(minutes=5), "actor_id": "BT4", "action": "HOSTEL_EXIT",
         "target_id": HOSTEL_ID, "details": {"participant_id": "P1"}},
    ])

    event_collection.insert_one({
        "event_id": EVENT_ID,
        "event_type": "technical",
        "name": "Hackathon",
        "event_team": [],
    })
    event_oid = event_collection.find_one({"event_id": EVENT_ID})["_id"]
    event_logs_collection.insert_many([
        {"event_id": str(event_oid), "participant_id": "P1", "scanned_by": "BT2",
         "day": "2026-08-01", "timestamp": base},
        {"event_id": str(event_oid), "participant_id": "P2", "scanned_by": "BT2",
         "day": "2026-08-02", "timestamp": base + timedelta(days=1)},
        # A different event's scan, which must not leak into this event's logs.
        {"event_id": "some-other-objectid", "participant_id": "P3", "scanned_by": "BT2",
         "day": "2026-08-02", "timestamp": base},
    ])

    yield {"sa": {"Authorization": f"Bearer {sa_token}"},
           "staff": {"Authorization": f"Bearer {staff_token}"}}

    system_logs_collection.delete_many({})
    event_collection.delete_many({})
    event_logs_collection.delete_many({})
    backend_teams_collection.delete_many({})


def test_returns_the_whole_trail_newest_first(trail):
    resp = client.get("/audit-logs", headers=trail["sa"])
    assert resp.status_code == 200

    logs = resp.json()
    assert len(logs) == 6
    assert logs[0]["action"] == "HOSTEL_EXIT"
    assert logs[-1]["action"] == "CREATE_EVENT"


def test_narrows_the_trail_to_one_entity(trail):
    resp = client.get("/audit-logs", params={"target_id": MESS_ID}, headers=trail["sa"])
    assert resp.status_code == 200

    logs = resp.json()
    assert {log["action"] for log in logs} == {"CREATE_MESS", "MESS_SCAN"}
    # Nothing from another hall, block, or event.
    assert all(log["target_id"] == MESS_ID for log in logs)


def test_a_mess_scan_keeps_its_meal_and_day(trail):
    resp = client.get(
        "/audit-logs", params={"target_id": MESS_ID, "action": "MESS_SCAN"}, headers=trail["sa"]
    )
    assert resp.status_code == 200

    logs = resp.json()
    assert len(logs) == 1
    assert logs[0]["details"] == {"participant_id": "P1", "slot": "lunch", "day": 2}


def test_entry_and_exit_are_separately_addressable(trail):
    entries = client.get(
        "/audit-logs", params={"target_id": HOSTEL_ID, "action": "HOSTEL_ENTRY"},
        headers=trail["sa"],
    ).json()
    exits = client.get(
        "/audit-logs", params={"target_id": HOSTEL_ID, "action": "HOSTEL_EXIT"},
        headers=trail["sa"],
    ).json()

    assert len(entries) == 1
    assert len(exits) == 1
    assert entries[0]["details"]["participant_id"] == "P1"

    # And both are present when only the block is named.
    both = client.get("/audit-logs", params={"target_id": HOSTEL_ID}, headers=trail["sa"]).json()
    assert {log["action"] for log in both} == {"HOSTEL_ENTRY", "HOSTEL_EXIT"}


def test_an_unknown_target_returns_an_empty_trail_not_everything(trail):
    resp = client.get("/audit-logs", params={"target_id": "NOPE"}, headers=trail["sa"])
    assert resp.status_code == 200
    assert resp.json() == []


def test_the_unfiltered_call_is_unchanged_for_non_super_admins(trail):
    resp = client.get("/audit-logs", headers=trail["staff"])
    assert resp.status_code == 403
    assert "Only Super Admins" in resp.json()["detail"]


def test_filtering_does_not_bypass_the_super_admin_gate(trail):
    resp = client.get("/audit-logs", params={"target_id": MESS_ID}, headers=trail["staff"])
    assert resp.status_code == 403


def test_event_logs_returns_only_that_events_scans(trail):
    resp = client.get(f"/events/{EVENT_ID}/logs", headers=trail["sa"])
    assert resp.status_code == 200

    logs = resp.json()["logs"]
    # Two rows for this event, keyed on its ObjectId; the third row belongs to
    # another event and must not appear.
    assert len(logs) == 2
    assert {log["participant_id"] for log in logs} == {"P1", "P2"}
    assert all(log["scanned_by"] == "BT2" for log in logs)


def test_event_logs_are_newest_first(trail):
    logs = client.get(f"/events/{EVENT_ID}/logs", headers=trail["sa"]).json()["logs"]
    assert [log["day"] for log in logs] == ["2026-08-02", "2026-08-01"]


def test_event_logs_are_super_admin_only(trail):
    resp = client.get(f"/events/{EVENT_ID}/logs", headers=trail["staff"])
    assert resp.status_code == 403
    assert "Only Super Admins" in resp.json()["detail"]


def test_event_logs_404_for_an_unknown_event(trail):
    resp = client.get("/events/NOPE/logs", headers=trail["sa"])
    assert resp.status_code == 404


def test_event_logs_are_empty_before_anyone_is_scanned(trail):
    event_collection.insert_one({
        "event_id": "EVT_AUDIT_2", "event_type": "sports", "name": "Relay", "event_team": [],
    })

    resp = client.get("/events/EVT_AUDIT_2/logs", headers=trail["sa"])
    assert resp.status_code == 200
    # An envelope with an empty list, never a 404 — the event exists, it just has
    # no attendance yet.
    assert resp.json() == {"logs": []}
