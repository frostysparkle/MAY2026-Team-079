"""
test_domain.py — Comprehensive test suite covering all Milestone 4 TC IDs
(TC101–TC110, TC-FIX-01) plus additional gap coverage identified during review.

Run with:
    cd backend && TESTING=1 python3 -m pytest test_domain.py -v --tb=short
"""

import pytest
import base64
import json
import random
import os
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

# Ensure mongomock is used
os.environ.setdefault("TESTING", "1")

from main import app
from database import (
    participants_collection,
    backend_teams_collection,
    event_collection,
    mess_collection,
    hostel_collection,
    workshops_collection,
    workshop_logs_collection,
    event_logs_collection,
    system_logs_collection,
)
import security

client = TestClient(app)


# ──────────────────────────────────────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────────────────────────────────────

def encrypt_qr(public_key_pem: str, participant_id: str) -> str:
    """Encrypt a participant_id payload with RSA-OAEP for QR simulation."""
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    payload_bytes = json.dumps({"participant_id": participant_id}).encode("utf-8")
    ciphertext = public_key.encrypt(
        payload_bytes,
        asym_padding.OAEP(
            mgf=asym_padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ciphertext).decode("utf-8")


def fresh_qr_payload(public_key_pem: str, participant_id: str) -> dict:
    return {
        "participant_id": participant_id,
        "data": encrypt_qr(public_key_pem, participant_id),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


def expired_qr_payload(public_key_pem: str, participant_id: str) -> dict:
    """Returns a QR payload with a timestamp 2 minutes in the past (expired)."""
    return {
        "participant_id": participant_id,
        "data": encrypt_qr(public_key_pem, participant_id),
        "timestamp": (datetime.utcnow() - timedelta(minutes=2)).isoformat() + "Z",
    }


# ──────────────────────────────────────────────────────────────────────────────
# MODULE-SCOPED FIXTURE — shared state for all tests in this file
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def ctx():
    """
    Bootstraps a clean in-memory database with:
      - 1 participant (p)
      - 1 super_admin backend team member (sa)
      - 1 hostel (H_TD01, gender=male, capacity=10)
      - 1 mess (M_TD01, preference=veg, capacity=10)
      - 1 workshop (WKS_TD01, capacity=50)
      - 1 event (EVT_TD01)
    """
    # ── Clean slate ──────────────────────────────────────────────────────────
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    event_collection.delete_many({})
    mess_collection.delete_many({})
    hostel_collection.delete_many({})
    workshops_collection.delete_many({})
    workshop_logs_collection.delete_many({})
    event_logs_collection.delete_many({})
    system_logs_collection.delete_many({})

    rand = random.randint(100000, 999999)
    p_email = f"23f{rand}@ds.study.iitm.ac.in"
    password = "Secure@1234"

    # ── Register & login participant ─────────────────────────────────────────
    r = client.post("/auth/register", json={"email": p_email, "password": password})
    assert r.status_code == 200, f"Registration failed: {r.text}"
    login = client.post("/auth/login", json={"email": p_email, "password": password})
    p_token = login.json()["access_token"]
    p_id = login.json()["id"]
    p_pubkey = login.json()["public_key"]

    # Complete profile (gender=male so hostel allocation works)
    client.patch(
        "/profile/complete",
        json={
            "full_name": "Domain Test User",
            "dob": "2001-05-10",
            "house": "Ganga House",
            "gender": "male",
            "phone": "+919876543210",
            "mess_preference": "veg",
            "country": "India",
            "state": "Tamil Nadu",
            "city": "Chennai",
            "address": "IITM Campus",
            "program": "DS",
            "course_stage": "diploma",
        },
        headers={"Authorization": f"Bearer {p_token}"},
    )
    # Mark participant as requiring accommodation & mess
    participants_collection.update_one(
        {"participant_id": p_id},
        {"$set": {"accommodation.registered": True, "mess.registered": True}},
    )

    # ── Super admin ──────────────────────────────────────────────────────────
    sa_rand = random.randint(100000, 999999)
    sa_email = f"sa{sa_rand}@ds.study.iitm.ac.in"
    sa_id = f"SA{sa_rand}"
    backend_teams_collection.insert_one(
        {
            "paradox_id": sa_id,
            "email": sa_email,
            "password_hash": security.get_password_hash(password),
            "role": "super_admin",
            "department": "technicals",
            "designation": "Fest Coordinator",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
    )
    sa_login = client.post("/auth/admin/login", json={"email": sa_email, "password": password})
    sa_token = sa_login.json()["access_token"]

    # ── Hostel ───────────────────────────────────────────────────────────────
    hostel_id = f"H_TD{random.randint(1000,9999)}"
    hostel_collection.insert_one(
        {
            "hostel_id": hostel_id,
            "name": "Brahmaputra",
            "capacity": 10,
            "gender": "male",
            "coordinator": {"user_id": sa_id, "name": "SA Coord"},
            "hostel_team": [{"user_id": sa_id, "role": "other", "logging": True}],
            "created_at": datetime.utcnow(),
        }
    )

    # ── Mess ─────────────────────────────────────────────────────────────────
    mess_id = f"M_TD{random.randint(1000,9999)}"
    mess_collection.insert_one(
        {
            "mess_id": mess_id,
            "name": "Himalaya Veg",
            "capacity": 10,
            "preference": "veg",
            "mess_team": [{"user_id": sa_id, "role": "other", "logging": True}],
            "created_at": datetime.utcnow(),
        }
    )

    # ── Workshop ─────────────────────────────────────────────────────────────
    sa_hdr = {"Authorization": f"Bearer {sa_token}"}
    ws_id = f"WKS_TD{random.randint(1000,9999)}"
    slot_id = f"SLOT_TD{random.randint(1000,9999)}"
    client.post(
        "/workshops",
        json={
            "workshop_id": ws_id,
            "slot_id": slot_id,
            "name": "Domain Test Workshop",
            "venue": "CRC 101",
            "capacity": 50,
            "instructions": "Bring laptop",
        },
        headers=sa_hdr,
    )
    ws_doc = workshops_collection.find_one({"workshop_id": ws_id})
    ws_doc_id = str(ws_doc["_id"])
    # Assign SA as volunteer with scan enabled
    client.post(
        f"/workshops/{ws_id}/volunteers",
        json={"user_id": sa_id, "role": "workshop_volunteer", "attendance": True},
        headers=sa_hdr,
    )

    # ── Event ────────────────────────────────────────────────────────────────
    ev_id = f"EVT_TD{random.randint(1000,9999)}"
    client.post(
        "/events",
        json={
            "event_id": ev_id,
            "event_type": "technical",
            "name": "Domain Hackathon",
            "description": "24hr Hackathon",
            "team": {"min": 1, "max": 4, "house": False, "allow_single_registration": True},
            "prize_money": [{"position": "1st", "amount": 10000}],
            "registration": {
                "start_time": "2026-08-01T00:00:00Z",
                "end_time": "2026-08-31T00:00:00Z",
            },
            "schedule": [
                {
                    "name": "Round 1",
                    "start_time": "2026-08-12T09:00:00Z",
                    "end_time": "2026-08-12T12:00:00Z",
                }
            ],
            "registration_fields": [
                {"field_id": "github", "label": "GitHub URL", "type": "url", "required": True}
            ],
        },
        headers=sa_hdr,
    )
    # Assign SA to event team so they can scan
    client.post(
        f"/events/{ev_id}/team",
        json={"user_id": sa_id, "role": "event_head"},
        headers=sa_hdr,
    )

    return {
        "p_token": p_token,
        "p_id": p_id,
        "p_pubkey": p_pubkey,
        "p_email": p_email,
        "password": password,
        "sa_token": sa_token,
        "sa_id": sa_id,
        "sa_email": sa_email,
        "hostel_id": hostel_id,
        "mess_id": mess_id,
        "ws_id": ws_id,
        "ws_doc_id": ws_doc_id,
        "slot_id": slot_id,
        "ev_id": ev_id,
    }


# ──────────────────────────────────────────────────────────────────────────────
# TC104 — Invalid email registration returns 400
# ──────────────────────────────────────────────────────────────────────────────

def test_TC104_auth_register_invalid_email(ctx):
    """TC104: Registration with non-IITM email must return 400."""
    resp = client.post(
        "/auth/register",
        json={"email": "bad_email@gmail.com", "password": "Secure@1234"},
    )
    assert resp.status_code == 400
    assert "Must be an @*.study.iitm.ac.in email" in resp.json()["detail"]


# ──────────────────────────────────────────────────────────────────────────────
# TC105 — Participant cannot create an event (403)
# ──────────────────────────────────────────────────────────────────────────────

def test_TC105_event_create_forbidden_for_participant(ctx):
    """TC105: Only Super Admins can create events; participant must get 403."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    resp = client.post(
        "/events",
        json={
            "event_id": "EVT_FORBIDDEN",
            "event_type": "technical",
            "name": "Forbidden Event",
            "description": "Should fail",
            "team": {"min": 1, "max": 1, "house": False, "allow_single_registration": True},
            "registration": {
                "start_time": "2026-08-01T00:00:00Z",
                "end_time": "2026-08-31T00:00:00Z",
            },
        },
        headers=p_hdr,
    )
    assert resp.status_code == 403
    # A participant token never reaches the "Only Super Admins" check: under the
    # dual-login model get_current_staff rejects it at the auth layer first.
    # Still 403, and still the thing this case is about — a participant cannot
    # create an event.
    assert "Staff credentials required" in resp.json()["detail"]


# ──────────────────────────────────────────────────────────────────────────────
# TC106 — Workshop pre-registration (200 + DB log created)
# ──────────────────────────────────────────────────────────────────────────────

def test_TC106_workshop_pre_registration(ctx):
    """TC106: Participant pre-registers for workshop; log entry created in DB."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    resp = client.post(f"/workshops/{ctx['ws_id']}/register", headers=p_hdr)
    assert resp.status_code == 200
    assert resp.json()["message"] == "Successfully registered for workshop"

    logs = list(
        workshop_logs_collection.find(
            {"workshop_id": ctx["ws_doc_id"], "action": "registration"}
        )
    )
    assert len(logs) > 0, "Expected a registration log entry in workshop_logs"


# ──────────────────────────────────────────────────────────────────────────────
# TC107 — Workshop pre-registered attendance scan (200 + attendance log)
# ──────────────────────────────────────────────────────────────────────────────

def test_TC107_workshop_attendance_pre_registered(ctx):
    """TC107: Scanning a pre-registered attendee marks them present; log written."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    qr = fresh_qr_payload(ctx["p_pubkey"], ctx["p_id"])

    resp = client.post(
        f"/workshops/{ctx['ws_id']}/attendance?scan_type=pre-registered",
        json=qr,
        headers=sa_hdr,
    )
    assert resp.status_code == 200
    assert "Pre-registered attendee marked present" in resp.json()["message"]

    logs = list(
        workshop_logs_collection.find(
            {"workshop_id": ctx["ws_doc_id"], "action": "attendance", "scan_type": "pre-registered"}
        )
    )
    assert len(logs) > 0, "Expected an attendance log entry in workshop_logs"


# ──────────────────────────────────────────────────────────────────────────────
# Event registration — prerequisite for TC108, TC103, scan tests
# ──────────────────────────────────────────────────────────────────────────────

def test_event_register_participant(ctx):
    """Participant registers for the event (prerequisite for scan tests)."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    resp = client.post(
        f"/events/{ctx['ev_id']}/register",
        json={"registration_data": {"github": "https://github.com/test"}},
        headers=p_hdr,
    )
    assert resp.status_code == 200

    # Verify it shows up in my_registrations
    get_resp = client.get("/events/my_registrations", headers=p_hdr)
    assert get_resp.status_code == 200
    assert len(get_resp.json()) > 0


# ──────────────────────────────────────────────────────────────────────────────
# TC108 — Daily unique scan deduplication
# ──────────────────────────────────────────────────────────────────────────────

def test_TC108_daily_unique_scans_dedup(ctx):
    """TC108: Two scans of the same QR by the same scanner only count as 1."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    qr = fresh_qr_payload(ctx["p_pubkey"], ctx["p_id"])

    resp1 = client.post(f"/events/{ctx['ev_id']}/scan", json=qr, headers=sa_hdr)
    assert resp1.status_code == 200
    assert resp1.json()["is_participating"] is True

    # Re-scan — should still return 200 (not an error), just not double-log
    resp2 = client.post(f"/events/{ctx['ev_id']}/scan", json=qr, headers=sa_hdr)
    assert resp2.status_code == 200

    # daily_unique_scans should be 1, not 2
    scans_resp = client.get(f"/events/{ctx['ev_id']}/my_daily_scans", headers=sa_hdr)
    assert scans_resp.status_code == 200
    assert scans_resp.json()["daily_unique_scans"] == 1

    # Participation stats for SA should include total_daily_scans
    part_resp = client.get(f"/events/{ctx['ev_id']}/participation", headers=sa_hdr)
    assert part_resp.status_code == 200
    assert "total_daily_scans" in part_resp.json()
    assert part_resp.json()["total_daily_scans"] == 1


# ──────────────────────────────────────────────────────────────────────────────
# TC103 — UHC member does NOT see total_daily_scans
# ──────────────────────────────────────────────────────────────────────────────

def test_TC103_uhc_stats_exclusion(ctx):
    """TC103: UHC members see participation data but not total_daily_scans."""
    uhc_rand = random.randint(10000, 99999)
    uhc_email = f"uhc{uhc_rand}@ds.study.iitm.ac.in"
    uhc_id = f"UHC{uhc_rand}"
    backend_teams_collection.insert_one(
        {
            "paradox_id": uhc_id,
            "email": uhc_email,
            "password_hash": security.get_password_hash("Secure@1234"),
            "role": "admin",
            "department": "uhc",
            "designation": "UHC Member",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
    )
    uhc_login = client.post(
        "/auth/admin/login", json={"email": uhc_email, "password": "Secure@1234"}
    )
    uhc_token = uhc_login.json()["access_token"]

    resp = client.get(
        f"/events/{ctx['ev_id']}/participation",
        headers={"Authorization": f"Bearer {uhc_token}"},
    )
    assert resp.status_code == 200
    assert "total_daily_scans" not in resp.json(), (
        "UHC members must NOT see total_daily_scans"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Hostel allocation (prerequisite for TC109, TC102, TC110)
# ──────────────────────────────────────────────────────────────────────────────

def test_hostel_allocation_prerequisite(ctx):
    """Allocate participant to hostel before hostel scanning tests."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    resp = client.post("/hostels/allocate", headers=sa_hdr)
    assert resp.status_code == 200
    assert "Allocated" in resp.json()["message"]


# ──────────────────────────────────────────────────────────────────────────────
# TC109 — Hostel CRUD + allocation (room number >= 100)
# ──────────────────────────────────────────────────────────────────────────────

def test_TC109_hostel_crud_and_allocation(ctx):
    """TC109: Participant allocated hostel; room number must be >= 100."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    resp = client.get("/hostels/my_hostel", headers=p_hdr)
    assert resp.status_code == 200
    data = resp.json()
    assert data["assigned_hostel"] == ctx["hostel_id"]
    assert int(data["room"]) >= 100, f"Expected room >= 100, got {data['room']}"


# ──────────────────────────────────────────────────────────────────────────────
# TC102 — Hostel duplicate entry scan returns 400
# ──────────────────────────────────────────────────────────────────────────────

def test_TC102_hostel_duplicate_entry_scan(ctx):
    """TC102: A second 'entry' scan after already being inside returns 400."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    qr = fresh_qr_payload(ctx["p_pubkey"], ctx["p_id"])

    # First entry — should succeed
    resp1 = client.post(
        f"/hostels/{ctx['hostel_id']}/scan?action=entry", json=qr, headers=sa_hdr
    )
    assert resp1.status_code == 200

    # Second entry — must fail with 400 "already inside"
    resp2 = client.post(
        f"/hostels/{ctx['hostel_id']}/scan?action=entry", json=qr, headers=sa_hdr
    )
    assert resp2.status_code == 400
    assert "already inside" in resp2.json()["detail"]


# ──────────────────────────────────────────────────────────────────────────────
# TC110 — Hostel exit scan (200, statistics shows currently_inside == 0)
# ──────────────────────────────────────────────────────────────────────────────

def test_TC110_hostel_exit_scan(ctx):
    """TC110: Exit scan succeeds; statistics shows currently_inside == 0."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    qr = fresh_qr_payload(ctx["p_pubkey"], ctx["p_id"])

    resp = client.post(
        f"/hostels/{ctx['hostel_id']}/scan?action=exit", json=qr, headers=sa_hdr
    )
    assert resp.status_code == 200

    stats_resp = client.get(f"/hostels/{ctx['hostel_id']}/statistics", headers=sa_hdr)
    assert stats_resp.status_code == 200
    assert stats_resp.json()["currently_inside"] == 0


# ──────────────────────────────────────────────────────────────────────────────
# Mess allocation (prerequisite for TC101)
# ──────────────────────────────────────────────────────────────────────────────

def test_mess_allocation_prerequisite(ctx):
    """Allocate participant to mess before mess scanning tests."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    resp = client.post("/mess/allocate", headers=sa_hdr)
    assert resp.status_code == 200
    assert "Allocated" in resp.json()["message"]

    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    my_mess = client.get("/mess/my_mess", headers=p_hdr)
    assert my_mess.status_code == 200
    assert my_mess.json()["allotted_mess"] == ctx["mess_id"]


# ──────────────────────────────────────────────────────────────────────────────
# TC101 — Mess duplicate scan returns 400
# ──────────────────────────────────────────────────────────────────────────────

def test_TC101_mess_duplicate_scan(ctx):
    """TC101: Second scan for same slot/day returns 400 'Already logged in'."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    qr = fresh_qr_payload(ctx["p_pubkey"], ctx["p_id"])

    # First scan — valid
    resp1 = client.post(
        f"/mess/{ctx['mess_id']}/scan?slot=breakfast&day=1", json=qr, headers=sa_hdr
    )
    assert resp1.status_code == 200, f"First scan failed: {resp1.text}"

    # Second scan — must fail
    resp2 = client.post(
        f"/mess/{ctx['mess_id']}/scan?slot=breakfast&day=1", json=qr, headers=sa_hdr
    )
    assert resp2.status_code == 400
    assert "Already logged in" in resp2.json()["detail"]
    assert "breakfast" in resp2.json()["detail"]
    assert "day 1" in resp2.json()["detail"]


# ──────────────────────────────────────────────────────────────────────────────
# TC-FIX-01 — Expired QR returns 400 "QR Code expired"
# ──────────────────────────────────────────────────────────────────────────────

def test_TCFIX01_expired_qr_rejected(ctx):
    """TC-FIX-01: QR with timestamp > 60s in the past must return 400 'QR Code expired'."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    expired_qr = expired_qr_payload(ctx["p_pubkey"], ctx["p_id"])

    # Test against workshop attendance endpoint
    resp = client.post(
        f"/workshops/{ctx['ws_id']}/attendance?scan_type=pre-registered",
        json=expired_qr,
        headers=sa_hdr,
    )
    assert resp.status_code == 400
    assert "QR Code expired" in resp.json()["detail"]

    # Also verify against hostel scan endpoint
    resp2 = client.post(
        f"/hostels/{ctx['hostel_id']}/scan?action=entry",
        json=expired_qr,
        headers=sa_hdr,
    )
    assert resp2.status_code == 400
    assert "QR Code expired" in resp2.json()["detail"]

    # And mess scan endpoint
    resp3 = client.post(
        f"/mess/{ctx['mess_id']}/scan?slot=lunch&day=1",
        json=expired_qr,
        headers=sa_hdr,
    )
    assert resp3.status_code == 400
    assert "QR Code expired" in resp3.json()["detail"]


# ──────────────────────────────────────────────────────────────────────────────
# Auth — password change flow
# ──────────────────────────────────────────────────────────────────────────────

def test_auth_change_password(ctx):
    """Changed password returns new token; old flow stays accessible."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    new_pw = "NewSecure@5678"
    resp = client.post(
        "/auth/password/change",
        json={"current_password": ctx["password"], "new_password": new_pw},
        headers=p_hdr,
    )
    assert resp.status_code == 200
    new_token = resp.json()["access_token"]
    assert new_token is not None

    # New token should be usable
    verify_resp = client.get(
        "/events/my_registrations",
        headers={"Authorization": f"Bearer {new_token}"},
    )
    assert verify_resp.status_code == 200

    # Revert so other tests aren't broken
    client.post(
        "/auth/password/change",
        json={"current_password": new_pw, "new_password": ctx["password"]},
        headers={"Authorization": f"Bearer {new_token}"},
    )


# ──────────────────────────────────────────────────────────────────────────────
# Backend team CRUD (Super Admin)
# ──────────────────────────────────────────────────────────────────────────────

def test_backend_team_crud(ctx):
    """Super Admin can create, list, update, and delete backend team members."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    bt_rand = random.randint(10000, 99999)
    bt_email = f"bt{bt_rand}@ds.study.iitm.ac.in"

    # CREATE
    create_resp = client.post(
        "/backend_teams",
        json={
            "email": bt_email,
            "password": "Secure@1234",
            "role": "admin",
            "department": "technicals",
            "designation": "Tech Lead",
        },
        headers=sa_hdr,
    )
    assert create_resp.status_code == 200
    new_paradox_id = create_resp.json()["paradox_id"]

    # LIST
    list_resp = client.get("/backend_teams", headers=sa_hdr)
    assert list_resp.status_code == 200
    ids = [m["paradox_id"] for m in list_resp.json()]
    assert new_paradox_id in ids

    # UPDATE
    upd_resp = client.put(
        f"/backend_teams/{new_paradox_id}",
        json={"designation": "Senior Tech Lead"},
        headers=sa_hdr,
    )
    assert upd_resp.status_code == 200

    # DELETE
    del_resp = client.delete(f"/backend_teams/{new_paradox_id}", headers=sa_hdr)
    assert del_resp.status_code == 200

    # Verify deleted
    list_resp2 = client.get("/backend_teams", headers=sa_hdr)
    ids2 = [m["paradox_id"] for m in list_resp2.json()]
    assert new_paradox_id not in ids2


def test_backend_team_create_forbidden_for_participant(ctx):
    """Participant cannot create backend team members."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    resp = client.post(
        "/backend_teams",
        json={
            "email": f"hacker{random.randint(1000,9999)}@ds.study.iitm.ac.in",
            "password": "Secure@1234",
            "role": "admin",
            "department": "technicals",
            "designation": "Hacker",
        },
        headers=p_hdr,
    )
    assert resp.status_code == 403


# ──────────────────────────────────────────────────────────────────────────────
# Audit log retrieval
# ──────────────────────────────────────────────────────────────────────────────

def test_audit_log_accessible_to_super_admin(ctx):
    """Super Admin can fetch audit logs and they contain at least one entry."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    resp = client.get("/audit-logs", headers=sa_hdr)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) > 0, "Expected at least one audit log entry"


def test_audit_log_forbidden_for_participant(ctx):
    """Participants cannot view audit logs."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    resp = client.get("/audit-logs", headers=p_hdr)
    assert resp.status_code == 403


# ──────────────────────────────────────────────────────────────────────────────
# Event deregister flow
# ──────────────────────────────────────────────────────────────────────────────

def test_event_deregister(ctx):
    """Participant can deregister from an event; it no longer appears in their list."""
    # Register a second participant to deregister without breaking scan tests
    rand2 = random.randint(200000, 299999)
    p2_email = f"23f{rand2}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": p2_email, "password": "Secure@1234"})
    login2 = client.post("/auth/login", json={"email": p2_email, "password": "Secure@1234"})
    p2_token = login2.json()["access_token"]
    p2_hdr = {"Authorization": f"Bearer {p2_token}"}

    # Register for event
    reg = client.post(
        f"/events/{ctx['ev_id']}/register",
        json={"registration_data": {}},
        headers=p2_hdr,
    )
    assert reg.status_code == 200

    # Deregister
    dereg = client.delete(f"/events/{ctx['ev_id']}/register", headers=p2_hdr)
    assert dereg.status_code == 200

    # Verify removed
    my_reg = client.get("/events/my_registrations", headers=p2_hdr)
    ev_ids = [str(e.get("event_id")) for e in my_reg.json()]
    # Should be empty for this user
    assert len(my_reg.json()) == 0


# ──────────────────────────────────────────────────────────────────────────────
# Workshop on-spot attendance flow
# ──────────────────────────────────────────────────────────────────────────────

def test_workshop_on_spot_attendance(ctx):
    """An unregistered participant can be admitted as on-spot (within 10% capacity)."""
    # Register a fresh participant who has NOT pre-registered for the workshop
    rand3 = random.randint(300000, 399999)
    p3_email = f"23f{rand3}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": p3_email, "password": "Secure@1234"})
    login3 = client.post("/auth/login", json={"email": p3_email, "password": "Secure@1234"})
    p3_pubkey = login3.json()["public_key"]
    p3_id = login3.json()["id"]

    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    qr3 = fresh_qr_payload(p3_pubkey, p3_id)

    resp = client.post(
        f"/workshops/{ctx['ws_id']}/attendance?scan_type=on-spot",
        json=qr3,
        headers=sa_hdr,
    )
    assert resp.status_code == 200
    assert "On-spot registration successful" in resp.json()["message"]


# ──────────────────────────────────────────────────────────────────────────────
# Additional: Unauthenticated access is rejected
# ──────────────────────────────────────────────────────────────────────────────

def test_unauthenticated_request_rejected():
    """All protected endpoints must return 401 without a Bearer token."""
    resp = client.get("/events")
    # FastAPI HTTPBearer returns 401 when no Authorization header is provided
    assert resp.status_code == 401


# ──────────────────────────────────────────────────────────────────────────────
# Additional: Duplicate event registration is rejected (409)
# ──────────────────────────────────────────────────────────────────────────────

def test_duplicate_event_registration(ctx):
    """A participant cannot register for the same event twice."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    # First registration was done in test_event_register_participant
    resp = client.post(
        f"/events/{ctx['ev_id']}/register",
        json={"registration_data": {}},
        headers=p_hdr,
    )
    assert resp.status_code == 409


# ──────────────────────────────────────────────────────────────────────────────
# Additional: Workshop duplicate registration is rejected (400)
# ──────────────────────────────────────────────────────────────────────────────

def test_duplicate_workshop_registration(ctx):
    """A participant cannot register for the same workshop twice."""
    p_hdr = {"Authorization": f"Bearer {ctx['p_token']}"}
    # Already registered in test_TC106_workshop_pre_registration
    resp = client.post(f"/workshops/{ctx['ws_id']}/register", headers=p_hdr)
    assert resp.status_code == 400
    assert "Already registered" in resp.json()["detail"]


# ──────────────────────────────────────────────────────────────────────────────
# Additional: Mess statistics endpoint
# ──────────────────────────────────────────────────────────────────────────────

def test_mess_statistics(ctx):
    """Super Admin can retrieve mess statistics."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    resp = client.get(f"/mess/{ctx['mess_id']}/statistics", headers=sa_hdr)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_allocated"] > 0
    assert data["capacity"] == 10


# ──────────────────────────────────────────────────────────────────────────────
# Additional: Forgot password & reset password stub endpoints
# ──────────────────────────────────────────────────────────────────────────────

def test_forgot_password_stub(ctx):
    """Forgot password always returns 200 (no user disclosure)."""
    resp = client.post(
        "/auth/password/forgot", json={"email": "anyone@ds.study.iitm.ac.in"}
    )
    assert resp.status_code == 200
    assert "reset link" in resp.json()["message"].lower()


def test_reset_password_stub():
    """Reset password stub returns 200."""
    resp = client.post(
        "/auth/password/reset",
        json={"token": "mock_token_123", "new_password": "NewSecure@5678"},
    )
    assert resp.status_code == 200


# ──────────────────────────────────────────────────────────────────────────────
# Additional: Workshop logs accessible to Super Admin
# ──────────────────────────────────────────────────────────────────────────────

def test_workshop_logs_retrieval(ctx):
    """Super Admin can retrieve workshop logs."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    resp = client.get(f"/workshops/{ctx['ws_id']}/logs", headers=sa_hdr)
    assert resp.status_code == 200
    assert "logs" in resp.json()
    assert len(resp.json()["logs"]) > 0


# ──────────────────────────────────────────────────────────────────────────────
# Additional: Event team allocation
# ──────────────────────────────────────────────────────────────────────────────

def test_event_allocate_teams(ctx):
    """Super Admin can trigger team allocation for an event."""
    sa_hdr = {"Authorization": f"Bearer {ctx['sa_token']}"}
    resp = client.post(f"/events/{ctx['ev_id']}/allocate_teams", headers=sa_hdr)
    assert resp.status_code == 200
    assert "Allocated" in resp.json()["message"] or "Not a team event" in resp.json()["message"]
