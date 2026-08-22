"""
Solo vs. team registration (`POST /events/{event_id}/register`).

A participant registers exactly one of three ways: solo, creating a new team
(`team_name`), or joining an existing one (`team_id`). The created team's
`team_id` is backend-assigned the same way `event_id` and `round_id` are —
never chosen by the client — via `id_generator.EventIDGenerator.next_team_id`.
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


def _make_participant():
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    body = login.json()
    return body["id"], {"Authorization": f"Bearer {body['access_token']}"}


def _window():
    now = datetime.utcnow()
    return {
        "start_time": (now - timedelta(hours=1)).isoformat() + "Z",
        "end_time": (now + timedelta(days=30)).isoformat() + "Z",
        "allowed": True,
    }


def _create_event(sa_headers, **team_overrides):
    team = {"min": 1, "max": 4, "house_vs_house_event": False, "allow_single_registration": True}
    team.update(team_overrides)
    payload = {
        "event_type": "technical",
        "name": f"Team Reg Event {random.randint(100000, 999999)}",
        "description": "A test event.",
        "team": team,
        "prize_money": [],
        "registration": _window(),
        "schedule": [],
        "registration_fields": [],
    }
    resp = client.post("/events", json=payload, headers=sa_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["event_id"]


@pytest.fixture(autouse=True)
def clean_slate():
    event_collection.delete_many({})
    yield
    event_collection.delete_many({})


# ── solo registration ────────────────────────────────────────────────────────

def test_solo_registration_gets_no_team_id():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    _, p_headers = _make_participant()

    resp = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p_headers)
    assert resp.status_code == 200
    assert "team_id" not in resp.json()

    my_reg = client.get("/events/my_registrations", headers=p_headers).json()
    assert my_reg[0]["team_id"] is None


def test_solo_registration_is_refused_when_the_event_forbids_it():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, allow_single_registration=False, max=4)
    _, p_headers = _make_participant()

    resp = client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p_headers)
    assert resp.status_code == 400
    assert "requires team registration" in resp.json()["detail"]


# ── creating a team ──────────────────────────────────────────────────────────

def test_creating_a_team_returns_a_backend_generated_team_id():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    _, p_headers = _make_participant()

    resp = client.post(f"/events/{ev}/register", json={"team_name": "Alpha Squad", "registration_data": {}}, headers=p_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["team_role"] == "leader"
    assert "team_id" in body
    # Same id-generation family as event_id / round_id: EventIDGenerator's
    # next_team_id prefixes with "TM" + the event type code.
    assert body["team_id"].startswith("TM")

    my_reg = client.get("/events/my_registrations", headers=p_headers).json()
    assert my_reg[0]["team_id"] == body["team_id"]
    assert my_reg[0]["team_role"] == "leader"


def test_two_different_teams_created_for_the_same_event_get_different_ids():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    _, p1_headers = _make_participant()
    _, p2_headers = _make_participant()

    t1 = client.post(f"/events/{ev}/register", json={"team_name": "Alpha", "registration_data": {}}, headers=p1_headers).json()["team_id"]
    t2 = client.post(f"/events/{ev}/register", json={"team_name": "Beta", "registration_data": {}}, headers=p2_headers).json()["team_id"]
    assert t1 != t2


def test_creating_a_team_is_refused_for_a_max_one_event():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, min=1, max=1)
    _, p_headers = _make_participant()

    resp = client.post(f"/events/{ev}/register", json={"team_name": "Solo Only Please", "registration_data": {}}, headers=p_headers)
    assert resp.status_code == 400
    assert "does not support team registration" in resp.json()["detail"]


# ── joining a team ───────────────────────────────────────────────────────────

def test_joining_an_existing_team_by_id_adds_a_member():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, min=1, max=3)
    _, leader_headers = _make_participant()
    _, member_headers = _make_participant()

    team_id = client.post(f"/events/{ev}/register", json={"team_name": "Gamma", "registration_data": {}}, headers=leader_headers).json()["team_id"]

    resp = client.post(f"/events/{ev}/register", json={"team_id": team_id, "registration_data": {}}, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["team_id"] == team_id
    assert body["team_role"] == "member"


def test_joining_an_unknown_team_id_is_404():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, min=1, max=3)
    _, p_headers = _make_participant()

    resp = client.post(f"/events/{ev}/register", json={"team_id": "TMTEC999999", "registration_data": {}}, headers=p_headers)
    assert resp.status_code == 404


def test_joining_a_full_team_is_refused():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, min=1, max=2)
    _, leader_headers = _make_participant()
    _, second_headers = _make_participant()
    _, third_headers = _make_participant()

    team_id = client.post(f"/events/{ev}/register", json={"team_name": "Full House", "registration_data": {}}, headers=leader_headers).json()["team_id"]
    joined = client.post(f"/events/{ev}/register", json={"team_id": team_id, "registration_data": {}}, headers=second_headers)
    assert joined.status_code == 200

    overflow = client.post(f"/events/{ev}/register", json={"team_id": team_id, "registration_data": {}}, headers=third_headers)
    assert overflow.status_code == 400
    assert "full" in overflow.json()["detail"].lower()


def test_a_team_id_from_a_different_event_cannot_be_joined():
    """team_id lookups are scoped to *this* event — a team formed for one
    event must not be joinable from another event's registration."""
    _, sa_headers = _make_super_admin()
    ev_a = _create_event(sa_headers, min=1, max=3)
    ev_b = _create_event(sa_headers, min=1, max=3)
    _, leader_headers = _make_participant()
    _, other_headers = _make_participant()

    team_id = client.post(f"/events/{ev_a}/register", json={"team_name": "Cross Event", "registration_data": {}}, headers=leader_headers).json()["team_id"]

    resp = client.post(f"/events/{ev_b}/register", json={"team_id": team_id, "registration_data": {}}, headers=other_headers)
    assert resp.status_code == 404


# ── mutual exclusivity ───────────────────────────────────────────────────────

def test_sending_both_team_name_and_team_id_is_rejected_at_the_schema_layer():
    _, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers)
    _, p_headers = _make_participant()

    resp = client.post(
        f"/events/{ev}/register",
        json={"team_name": "Alpha", "team_id": "TMTEC111111", "registration_data": {}},
        headers=p_headers,
    )
    assert resp.status_code == 422


# ── allocate_teams uses the same id scheme ──────────────────────────────────

def test_allocate_teams_assigns_ids_from_the_same_generator_family():
    sa_id, sa_headers = _make_super_admin()
    ev = _create_event(sa_headers, min=1, max=2, house_vs_house_event=False)

    # Make the super admin the event head so allocate_teams is authorized.
    client.post(f"/events/{ev}/team", json={"user_id": sa_id, "role": "event_head"}, headers=sa_headers)

    for _ in range(4):
        _, p_headers = _make_participant()
        client.post(f"/events/{ev}/register", json={"registration_data": {}}, headers=p_headers)

    resp = client.post(f"/events/{ev}/allocate_teams", headers=sa_headers)
    assert resp.status_code == 200
    assert "Allocated" in resp.json()["message"]

    docs = list(participants_collection.find({"events": {"$elemMatch": {"team_id": {"$ne": None}}}}))
    team_ids = {ev_entry["team_id"] for doc in docs for ev_entry in doc.get("events", []) if ev_entry.get("team_id")}
    assert len(team_ids) > 0
    assert all(tid.startswith("TM") for tid in team_ids)
