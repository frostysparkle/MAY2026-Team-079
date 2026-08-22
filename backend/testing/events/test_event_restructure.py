"""
New route-level coverage for the restructured events domain.

Deliberately a fresh file rather than edits to the pre-existing event test
files: every test here targets a behaviour that is new or changed by the
restructure (backend-generated `event_id`, one-person-one-event team
enforcement, the three-role team literal, required `registration_fields`
validation, the `allowed` override combined with the time window, the removal
of the `logs` roster mirror, and announcement create/read authorization).

The SSE endpoint (`GET /events/{id}/announcements/stream`) is exercised only
for its *rejection* paths (401/403), which return before a stream is ever
opened and so complete immediately under `TestClient`. A successful stream
never closes on its own, and `TestClient`'s synchronous wrapper around a
long-lived ASGI stream blocks until the body finishes — reading a live
announcement frame back is covered separately against a real running server,
not here, to keep this suite fast and non-hanging.
"""
import os
import random
import sys
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from database import backend_teams_collection, participants_collection, event_collection
import security

client = TestClient(app)


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_super_admin():
    rand = random.randint(100000, 999999)
    email = f"sa{rand}@ds.study.iitm.ac.in"
    paradox_id = f"SA{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id, "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin", "department": "technicals", "designation": "Head",
        "created_at": datetime.utcnow(), "updated_at": datetime.utcnow(),
    })
    token = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"}).json()["access_token"]
    return paradox_id, {"Authorization": f"Bearer {token}"}


def _make_staff(role="volunteer"):
    """A plain backend_teams member with no linked participant account."""
    rand = random.randint(100000, 999999)
    email = f"bt{rand}@ds.study.iitm.ac.in"
    paradox_id = f"BT{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id, "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role, "department": "technicals", "designation": "Staff",
        "created_at": datetime.utcnow(), "updated_at": datetime.utcnow(),
    })
    token = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"}).json()["access_token"]
    return paradox_id, {"Authorization": f"Bearer {token}"}


def _make_participant():
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    body = login.json()
    return body["id"], {"Authorization": f"Bearer {body['access_token']}"}


def _make_staff_linked_to_participant(role="event_head"):
    """
    A backend_teams member whose `admin_id` points at a real participant
    document — the same link `POST /events/{id}/register` checks to decide
    whether the caller is that event's own team member registering for
    themselves.
    """
    p_id, p_headers = _make_participant()
    participant_oid = participants_collection.find_one({"participant_id": p_id})["_id"]

    rand = random.randint(100000, 999999)
    email = f"bt{rand}@ds.study.iitm.ac.in"
    paradox_id = f"BT{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id, "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role, "department": "technicals", "designation": "Staff",
        "admin_id": participant_oid,
        "created_at": datetime.utcnow(), "updated_at": datetime.utcnow(),
    })
    staff_token = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"}).json()["access_token"]
    return paradox_id, {"Authorization": f"Bearer {staff_token}"}, p_headers


def _window(start_offset=timedelta(hours=-1), end_offset=timedelta(days=30), allowed=True):
    now = datetime.utcnow()
    return {
        "start_time": (now + start_offset).isoformat() + "Z",
        "end_time": (now + end_offset).isoformat() + "Z",
        "allowed": allowed,
    }


def _create_event(sa_headers, **overrides):
    payload = {
        "event_type": "technical",
        "name": f"Test Event {random.randint(100000, 999999)}",
        "description": "A test event.",
        "team": {"min": 1, "max": 4, "house_vs_house_event": False, "allow_single_registration": True},
        "prize_money": [],
        "registration": _window(),
        "schedule": [],
        "registration_fields": [],
    }
    payload.update(overrides)
    resp = client.post("/events", json=payload, headers=sa_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["event_id"]


@pytest.fixture(autouse=True)
def clean_slate():
    event_collection.delete_many({})
    yield
    event_collection.delete_many({})


# ── event_id is backend-generated ───────────────────────────────────────────

def test_create_event_ignores_a_client_supplied_event_id():
    """`EventCreateRequest` has no `event_id` field, so a client that sends one
    anyway (e.g. an old caller that has not been updated) gets a backend
    generated id instead of the one it tried to force."""
    _, sa_headers = _make_super_admin()
    payload = {
        "event_id": "HACKED_ID",
        "event_type": "technical",
        "name": "Should Not Keep This Id",
        "description": "d",
        "team": {"min": 1, "max": 1},
        "prize_money": [],
        "registration": _window(),
        "schedule": [],
        "registration_fields": [],
    }
    resp = client.post("/events", json=payload, headers=sa_headers)
    assert resp.status_code == 200
    assert resp.json()["event_id"] != "HACKED_ID"
    assert resp.json()["event_id"].startswith("EVTEC")


# ── one person, one event ───────────────────────────────────────────────────

def test_one_person_one_event_is_enforced_across_events():
    _, sa_headers = _make_super_admin()
    staff_id, _ = _make_staff()
    ev_a = _create_event(sa_headers)
    ev_b = _create_event(sa_headers)

    ok = client.post(f"/events/{ev_a}/team", json={"user_id": staff_id, "role": "event_head"}, headers=sa_headers)
    assert ok.status_code == 200

    blocked = client.post(f"/events/{ev_b}/team", json={"user_id": staff_id, "role": "member"}, headers=sa_headers)
    assert blocked.status_code == 409
    assert ev_a in blocked.json()["detail"]


def test_removing_a_team_member_frees_them_for_a_different_event():
    _, sa_headers = _make_super_admin()
    staff_id, _ = _make_staff()
    ev_a = _create_event(sa_headers)
    ev_b = _create_event(sa_headers)

    client.post(f"/events/{ev_a}/team", json={"user_id": staff_id, "role": "event_head"}, headers=sa_headers)
    removed = client.delete(f"/events/{ev_a}/team/{staff_id}", headers=sa_headers)
    assert removed.status_code == 200

    reassigned = client.post(f"/events/{ev_b}/team", json={"user_id": staff_id, "role": "volunteer"}, headers=sa_headers)
    assert reassigned.status_code == 200


def test_assigning_an_unknown_user_id_to_a_team_is_rejected():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    resp = client.post(f"/events/{ev}/team", json={"user_id": "NOBODY_HOME", "role": "member"}, headers=sa_headers)
    assert resp.status_code == 404


def test_an_event_team_role_outside_the_three_is_rejected_by_validation():
    """`EventTeamAssignRequest.role` is a `Literal`, so an old-style role name
    (`event_member`) is a 422 at the schema layer, before any route logic runs."""
    _, sa_headers = _make_super_admin()
    staff_id, _ = _make_staff()
    ev = _create_event(sa_headers)
    resp = client.post(f"/events/{ev}/team", json={"user_id": staff_id, "role": "event_member"}, headers=sa_headers)
    assert resp.status_code == 422


# ── required registration_fields ────────────────────────────────────────────

def test_registration_missing_a_required_field_is_rejected():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, registration_fields=[
        {"field_id": "team_name", "label": "Team name", "type": "text", "required": True}
    ])
    _, p_headers = _make_participant()

    missing = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p_headers)
    assert missing.status_code == 422
    assert "Team name" in missing.json()["detail"]

    ok = client.post(f"/events/{ev}/register", json={"registration_data": {"team_name": "Alpha"}}, headers=p_headers)
    assert ok.status_code == 200


# ── registration window + manual override ──────────────────────────────────

def test_registration_before_the_window_start_is_closed():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, registration=_window(start_offset=timedelta(days=1), end_offset=timedelta(days=2)))
    _, p_headers = _make_participant()
    resp = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p_headers)
    assert resp.status_code == 400
    assert "closed" in resp.json()["detail"].lower()


def test_registration_after_the_window_end_is_closed():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, registration=_window(start_offset=timedelta(days=-2), end_offset=timedelta(days=-1)))
    _, p_headers = _make_participant()
    resp = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p_headers)
    assert resp.status_code == 400


def test_manual_allowed_override_closes_registration_inside_an_open_window():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)

    _, p1_headers = _make_participant()
    opened = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p1_headers)
    assert opened.status_code == 200

    flipped = client.put(f"/events/{ev}", json={"registration": {"allowed": False}}, headers=sa_headers)
    assert flipped.status_code == 200

    listing = next(e for e in client.get("/events", headers=sa_headers).json() if e["event_id"] == ev)
    assert listing["registration"]["is_open"] is False
    # The window itself must survive a partial update that only names `allowed`.
    assert listing["registration"]["start_time"]
    assert listing["registration"]["end_time"]

    _, p2_headers = _make_participant()
    blocked = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p2_headers)
    assert blocked.status_code == 400


# ── team member cannot register for their own event ────────────────────────

def test_event_head_cannot_register_as_a_participant_for_their_own_event():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    head_id, _, head_participant_headers = _make_staff_linked_to_participant(role="event_head")
    client.post(f"/events/{ev}/team", json={"user_id": head_id, "role": "event_head"}, headers=sa_headers)

    resp = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=head_participant_headers)
    assert resp.status_code == 403


# ── announcements: who may publish ──────────────────────────────────────────

def test_only_the_event_head_or_super_admin_may_publish_an_announcement():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    head_id, head_headers = _make_staff()
    member_id, member_headers = _make_staff()
    client.post(f"/events/{ev}/team", json={"user_id": head_id, "role": "event_head"}, headers=sa_headers)
    client.post(f"/events/{ev}/team", json={"user_id": member_id, "role": "member"}, headers=sa_headers)

    from_member = client.post(f"/events/{ev}/announcements", json={"message": "hi", "priority": "low"}, headers=member_headers)
    assert from_member.status_code == 403

    from_head = client.post(f"/events/{ev}/announcements", json={"message": "hi", "priority": "low"}, headers=head_headers)
    assert from_head.status_code == 200

    from_sa = client.post(f"/events/{ev}/announcements", json={"message": "also hi", "priority": "high"}, headers=sa_headers)
    assert from_sa.status_code == 200


def test_announcement_priority_outside_the_three_values_is_rejected():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    resp = client.post(f"/events/{ev}/announcements", json={"message": "hi", "priority": "urgent"}, headers=sa_headers)
    assert resp.status_code == 422


# ── announcements: who may read ─────────────────────────────────────────────

def test_announcements_are_readable_by_a_registrant_but_not_a_stranger():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    client.post(f"/events/{ev}/announcements", json={"message": "Venue changed", "priority": "high"}, headers=sa_headers)

    _, registrant_headers = _make_participant()
    client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=registrant_headers)

    _, stranger_headers = _make_participant()

    seen = client.get(f"/events/{ev}/announcements", headers=registrant_headers)
    assert seen.status_code == 200
    assert seen.json()[0]["message"] == "Venue changed"

    denied = client.get(f"/events/{ev}/announcements", headers=stranger_headers)
    assert denied.status_code == 403


def test_announcements_are_readable_by_the_events_own_team():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    volunteer_id, volunteer_headers = _make_staff()
    client.post(f"/events/{ev}/team", json={"user_id": volunteer_id, "role": "volunteer"}, headers=sa_headers)
    client.post(f"/events/{ev}/announcements", json={"message": "Gate opens at 9", "priority": "mid"}, headers=sa_headers)

    resp = client.get(f"/events/{ev}/announcements", headers=volunteer_headers)
    assert resp.status_code == 200
    assert resp.json()[0]["message"] == "Gate opens at 9"


# ── SSE stream: rejection paths only (see module docstring) ────────────────

def test_announcement_stream_requires_authentication():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    resp = client.get(f"/events/{ev}/announcements/stream")
    assert resp.status_code == 401


def test_announcement_stream_rejects_an_unregistered_participant():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    _, stranger_headers = _make_participant()
    resp = client.get(f"/events/{ev}/announcements/stream", headers=stranger_headers)
    assert resp.status_code == 403


def test_announcement_stream_404s_for_an_unknown_event():
    _, sa_headers = _make_super_admin()
    resp = client.get("/events/NOPE/announcements/stream", headers=sa_headers)
    assert resp.status_code == 404


# ── the roster mirror is gone ────────────────────────────────────────────────

def test_the_event_document_carries_no_logs_field_after_register_and_deregister():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    _, p_headers = _make_participant()

    client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p_headers)
    client.delete(f"/events/{ev}/register", headers=p_headers)

    raw = event_collection.find_one({"event_id": ev})
    assert "logs" not in raw
    assert "announcements" in raw
    assert raw["announcements"] == []
