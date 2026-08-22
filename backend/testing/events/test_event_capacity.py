"""
Story 3.2 / 3.3 — event fullness, and who is allowed to see what of it.

Four behaviours are pinned here, each of which was wrong before:

  * ``GET /events`` no longer hands the registration roster to every caller.
  * Deregistration removes the registration from the event's roster mirror.
  * Attendance counts distinct participants, not scan rows.
  * ``GET /events/{id}/capacity`` gives a participant the two numbers they need
    and nothing that identifies anybody.
"""
import base64
import json
import os
import random
import sys
from datetime import datetime, timedelta

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from database import (
    participants_collection,
    backend_teams_collection,
    event_collection,
    event_logs_collection,
)
import security

client = TestClient(app)


def _make_staff(role, department="technicals"):
    """A backend_teams account plus a live admin token for it."""
    rand = random.randint(100000, 999999)
    email = f"{role[:2]}{rand}@ds.study.iitm.ac.in"
    paradox_id = f"{role[:2].upper()}{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id,
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": department,
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"})
    return paradox_id, login.json()["access_token"]


def _make_participant():
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    return login.json()["id"], login.json()["access_token"]


def _qr_for(participant_id):
    """A QR payload the scan endpoint will accept for this participant."""
    doc = participants_collection.find_one({"participant_id": participant_id})
    public_key = serialization.load_pem_public_key(
        doc["qr_secrets"]["public_key"].encode("utf-8")
    )
    ciphertext = public_key.encrypt(
        json.dumps({"participant_id": participant_id}).encode("utf-8"),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                     algorithm=hashes.SHA256(), label=None)
    )
    return {
        "participant_id": participant_id,
        "data": base64.b64encode(ciphertext).decode("utf-8"),
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


@pytest.fixture(scope="module")
def ctx():
    event_collection.delete_many({})
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    event_logs_collection.delete_many({})

    sa_id, sa_token = _make_staff("super_admin")
    sa_headers = {"Authorization": f"Bearer {sa_token}"}

    now = datetime.utcnow()
    ev_id = client.post("/events", json={
        "event_type": "technical",
        "name": "Capacity Test",
        "description": "An event with a published limit",
        "team": {"min": 1, "max": 1, "house_vs_house_event": False, "allow_single_registration": True},
        # The registration window covers "now" so registration is open for
        # this fixture's whole lifetime, and `allowed` is the manual override.
        "registration": {
            "start_time": (now - timedelta(hours=1)).isoformat() + "Z",
            "end_time": (now + timedelta(days=30)).isoformat() + "Z",
            "allowed": True,
        },
    }, headers=sa_headers).json()["event_id"]

    # Two scanners on the same gate, which is the case that inflated attendance.
    client.post(f"/events/{ev_id}/team", json={"user_id": sa_id, "role": "event_head"},
                headers=sa_headers)
    vol_id, vol_token = _make_staff("volunteer")
    client.post(f"/events/{ev_id}/team", json={"user_id": vol_id, "role": "member"},
                headers=sa_headers)

    p_id, p_token = _make_participant()
    client.post(f"/events/{ev_id}/register", headers={"Authorization": f"Bearer {p_token}"},
                json={"registration_data": {"github": "octocat"}})

    return {
        "ev_id": ev_id,
        "sa_headers": sa_headers,
        "vol_headers": {"Authorization": f"Bearer {vol_token}"},
        "p_headers": {"Authorization": f"Bearer {p_token}"},
        "p_id": p_id,
    }


# ── GET /events no longer leaks the roster ──────────────────────────────────

def test_list_events_does_not_expose_the_registration_roster(ctx):
    """
    The old `logs` field held one entry per registration, each with a
    `participant_id`; it has been removed entirely (the roster mirror was
    dropped — `participants.events[]` is the sole source of truth). This
    endpoint is readable by any authenticated user, so a residual roster field
    would let any participant enumerate everybody registered for every event.
    """
    resp = client.get("/events", headers=ctx["p_headers"])
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) > 0
    for event in events:
        assert "logs" not in event


def test_list_events_still_carries_what_the_app_needs(ctx):
    """The fix is a projection, not a rewrite: everything else still arrives."""
    event = next(e for e in client.get("/events", headers=ctx["p_headers"]).json()
                 if e["event_id"] == ctx["ev_id"])
    # `registration.is_open` is computed from `allowed` + the time window.
    assert event["registration"]["is_open"] is True
    for field in ("event_id", "name", "description", "team", "schedule",
                  "registration_fields", "event_team"):
        assert field in event


def test_no_participant_id_reaches_a_participant_from_the_events_list(ctx):
    """A blunt sweep of the whole payload, not just the field we remembered."""
    body = client.get("/events", headers=ctx["p_headers"]).text
    assert ctx["p_id"] not in body


# ── deregistration stops being counted ──────────────────────────────────────

def test_deregistration_removes_the_registration_from_the_participant_record(ctx):
    """
    Registration lives only on `participants.events[]` now (the event-side
    `logs` roster mirror was removed entirely), so deregistering must pull it
    from there — checked directly against the participants collection.
    """
    ev_id = ctx["ev_id"]
    event_oid = event_collection.find_one({"event_id": ev_id})["_id"]
    p_id, p_token = _make_participant()
    headers = {"Authorization": f"Bearer {p_token}"}

    client.post(f"/events/{ev_id}/register", headers=headers, json={"registration_data": {}})
    participant = participants_collection.find_one({"participant_id": p_id})
    assert any(str(ev.get("event_id")) == str(event_oid) for ev in participant.get("events", []))

    resp = client.delete(f"/events/{ev_id}/register", headers=headers)
    assert resp.status_code == 200

    participant = participants_collection.find_one({"participant_id": p_id})
    assert not any(str(ev.get("event_id")) == str(event_oid) for ev in participant.get("events", []))


def test_cancelled_registrations_are_not_counted_as_registered(ctx):
    ev_id = ctx["ev_id"]
    before = client.get(f"/events/{ev_id}/capacity", headers=ctx["p_headers"]).json()["registered"]

    _, p_token = _make_participant()
    headers = {"Authorization": f"Bearer {p_token}"}
    client.post(f"/events/{ev_id}/register", headers=headers, json={"registration_data": {}})
    during = client.get(f"/events/{ev_id}/capacity", headers=ctx["p_headers"]).json()["registered"]
    assert during == before + 1

    client.delete(f"/events/{ev_id}/register", headers=headers)
    after = client.get(f"/events/{ev_id}/capacity", headers=ctx["p_headers"]).json()["registered"]
    assert after == before


def test_the_cancellation_is_still_recorded_in_the_audit_trail(ctx):
    """`logs` tracks current state; history moves to the audit trail, not away."""
    ev_id = ctx["ev_id"]
    p_id, p_token = _make_participant()
    headers = {"Authorization": f"Bearer {p_token}"}
    client.post(f"/events/{ev_id}/register", headers=headers, json={"registration_data": {}})
    client.delete(f"/events/{ev_id}/register", headers=headers)

    trail = client.get(f"/audit-logs?target_id={ev_id}", headers=ctx["sa_headers"]).json()
    assert any(row["action"] == "EVENT_DEREGISTER" and row["actor_id"] == p_id for row in trail)


# ── attendance counts heads, not scan rows ──────────────────────────────────

def test_two_volunteers_scanning_one_person_is_one_attendance(ctx):
    """
    The scan endpoint dedupes per scanner so each volunteer keeps an accurate
    tally of their own gate. Counting those rows reported one person twice.
    """
    ev_id = ctx["ev_id"]
    qr = _qr_for(ctx["p_id"])

    assert client.post(f"/events/{ev_id}/scan", json=qr,
                       headers=ctx["sa_headers"]).status_code == 200
    assert client.post(f"/events/{ev_id}/scan", json=_qr_for(ctx["p_id"]),
                       headers=ctx["vol_headers"]).status_code == 200

    # Two rows were written — the per-scanner trail is deliberately unchanged.
    day = datetime.utcnow().strftime("%Y-%m-%d")
    event_oid = str(event_collection.find_one({"event_id": ev_id})["_id"])
    assert event_logs_collection.count_documents({"event_id": event_oid, "day": day}) == 2

    # But one person walked in.
    part = client.get(f"/events/{ev_id}/participation", headers=ctx["sa_headers"]).json()
    assert part["total_daily_scans"] == 1
    cap = client.get(f"/events/{ev_id}/capacity", headers=ctx["p_headers"]).json()
    assert cap["attended_today"] == 1


def test_each_volunteer_still_sees_their_own_tally(ctx):
    """The per-scanner reading must survive the fix to the event-wide one."""
    ev_id = ctx["ev_id"]
    assert client.get(f"/events/{ev_id}/my_daily_scans",
                      headers=ctx["sa_headers"]).json()["daily_unique_scans"] == 1
    assert client.get(f"/events/{ev_id}/my_daily_scans",
                      headers=ctx["vol_headers"]).json()["daily_unique_scans"] == 1


def test_a_second_participant_raises_the_head_count(ctx):
    """Deduping must not collapse two different people into one."""
    ev_id = ctx["ev_id"]
    p_id, p_token = _make_participant()
    client.post(f"/events/{ev_id}/register", headers={"Authorization": f"Bearer {p_token}"},
                json={"registration_data": {}})
    client.post(f"/events/{ev_id}/scan", json=_qr_for(p_id), headers=ctx["sa_headers"])

    cap = client.get(f"/events/{ev_id}/capacity", headers=ctx["p_headers"]).json()
    assert cap["attended_today"] == 2


# ── the participant-safe endpoint itself ────────────────────────────────────

def test_a_participant_can_read_the_capacity_counts(ctx):
    resp = client.get(f"/events/{ctx['ev_id']}/capacity", headers=ctx["p_headers"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["event_id"] == ctx["ev_id"]
    assert isinstance(body["registered"], int)
    assert isinstance(body["attended_today"], int)


def test_the_capacity_response_carries_no_identities(ctx):
    """
    The whole reason this endpoint may be participant-readable: there is nothing
    in it to leak. Asserted as an exact key set so a later addition cannot
    quietly reintroduce one.
    """
    body = client.get(f"/events/{ctx['ev_id']}/capacity", headers=ctx["p_headers"]).json()
    assert set(body.keys()) == {"event_id", "registered", "attended_today"}
    raw = client.get(f"/events/{ctx['ev_id']}/capacity", headers=ctx["p_headers"]).text
    assert ctx["p_id"] not in raw


def test_staff_may_read_it_too(ctx):
    """It is gated on being signed in, not on being a participant."""
    assert client.get(f"/events/{ctx['ev_id']}/capacity",
                      headers=ctx["sa_headers"]).status_code == 200


def test_capacity_requires_authentication(ctx):
    assert client.get(f"/events/{ctx['ev_id']}/capacity").status_code == 401


def test_capacity_404s_for_an_unknown_event(ctx):
    resp = client.get("/events/NO_SUCH_EVENT/capacity", headers=ctx["p_headers"])
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Event not found"
