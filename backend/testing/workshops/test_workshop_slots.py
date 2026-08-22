"""
Workshop slots (`workshop_slots` collection + `/workshop-slots` router) and the
restructured workshop schema that now depends on them: `registration_start`,
`registration_end`, `registration_open`, and the one-shot
auto-close/admin-override mechanism that backs `registration_open`.

No backward compatibility with the old free-form `slot_id` / direct
`start_time` shape: every workshop created here goes through the new
`WorkshopCreateRequest` (slot_id + registration_start/end/open), and every
slot goes through the new `workshop-slots` router.

This is a *new* file, not an edit to any existing test file — per project
guardrails, existing seed/test files are left untouched even though the
schema they exercise has changed.
"""
import os
import random
import sys
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
os.environ.setdefault("TESTING", "1")

from main import app
from database import (
    participants_collection,
    backend_teams_collection,
    workshops_collection,
    workshop_slots_collection,
)
import security

client = TestClient(app)

PASSWORD = "secure_password"


def _iso(dt: datetime) -> str:
    return dt.isoformat() + "Z"


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _super_admin(tag: int) -> tuple[str, str]:
    """Insert a fresh Super Admin and return (paradox_id, bearer_token)."""
    sa_id = f"SA{tag}"
    email = f"sa{tag}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": sa_id,
        "email": email,
        "password_hash": security.get_password_hash(PASSWORD),
        "role": "super_admin",
        "department": "workshops",
        "designation": "Slots Test SA",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return sa_id, login.json()["access_token"]


def _volunteer(tag: int) -> tuple[str, str]:
    vol_id = f"BTV{tag}"
    email = f"vol{tag}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": vol_id,
        "email": email,
        "password_hash": security.get_password_hash(PASSWORD),
        "role": "volunteer",
        "department": "workshops",
        "designation": "Slots Test Volunteer",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return vol_id, login.json()["access_token"]


def _participant(tag: int) -> tuple[str, str]:
    email = f"23f{tag}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": PASSWORD})
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return login.json()["id"], login.json()["access_token"]


def _create_slot(token: str, slot_id: str, start: datetime, end: datetime):
    return client.post(
        "/workshop-slots",
        json={"slot_id": slot_id, "start_time": _iso(start), "end_time": _iso(end)},
        headers=_bearer(token),
    )


def _create_workshop(token: str, slot_id: str, *, reg_start: datetime, reg_end: datetime,
                      registration_open: bool = True, capacity: int = 2, name: str = "Test Workshop"):
    return client.post(
        "/workshops",
        json={
            "slot_id": slot_id,
            "name": name,
            "description": "A workshop for slot/registration-window tests.",
            "venue": "Hall Z",
            "capacity": capacity,
            "instructions": "Bring a laptop",
            "registration_start": _iso(reg_start),
            "registration_end": _iso(reg_end),
            "registration_open": registration_open,
        },
        headers=_bearer(token),
    )


# ──────────────────────────────────────────────────────────────────────────
# Task 1 — slot CRUD basics
# ──────────────────────────────────────────────────────────────────────────

def test_create_slot_and_list_publicly():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    now = datetime.utcnow()

    resp = _create_slot(sa_token, slot_id, now + timedelta(hours=1), now + timedelta(hours=3))
    assert resp.status_code == 200, resp.text

    listing = client.get("/workshop-slots")
    assert listing.status_code == 200
    ids = {s["slot_id"] for s in listing.json()}
    assert slot_id in ids


def test_slot_id_must_match_day_shift_pattern():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    now = datetime.utcnow()

    resp = _create_slot(sa_token, "not-a-valid-slot", now + timedelta(hours=1), now + timedelta(hours=2))
    assert resp.status_code == 422


def test_slot_rejects_end_before_start():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    now = datetime.utcnow()

    resp = _create_slot(sa_token, f"D2S{tag}", now + timedelta(hours=3), now + timedelta(hours=1))
    assert resp.status_code == 422


def test_slot_rejects_duplicate_slot_id():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D3S{tag}"
    now = datetime.utcnow()

    first = _create_slot(sa_token, slot_id, now + timedelta(hours=1), now + timedelta(hours=2))
    assert first.status_code == 200
    second = _create_slot(sa_token, slot_id, now + timedelta(hours=5), now + timedelta(hours=6))
    assert second.status_code == 400


def test_non_super_admin_cannot_create_slot():
    tag = random.randint(100000, 999999)
    _, vol_token = _volunteer(tag)
    now = datetime.utcnow()

    resp = _create_slot(vol_token, f"D4S{tag}", now + timedelta(hours=1), now + timedelta(hours=2))
    assert resp.status_code == 403


# ──────────────────────────────────────────────────────────────────────────
# Task 2 — workshop creation wired to slots
# ──────────────────────────────────────────────────────────────────────────

def test_create_workshop_denormalizes_slot_start_time():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    slot_start = datetime.utcnow() + timedelta(days=1)
    slot_end = slot_start + timedelta(hours=2)
    _create_slot(sa_token, slot_id, slot_start, slot_end)

    now = datetime.utcnow()
    created = _create_workshop(sa_token, slot_id, reg_start=now, reg_end=now + timedelta(days=1))
    assert created.status_code == 200, created.text
    ws_id = created.json()["workshop_id"]

    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored is not None
    assert stored["start_time"] == slot_start.isoformat() + "Z"


def test_create_workshop_rejects_unknown_slot():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    now = datetime.utcnow()

    resp = _create_workshop(sa_token, f"D9S{tag}", reg_start=now, reg_end=now + timedelta(days=1))
    assert resp.status_code == 404


def test_create_workshop_rejects_registration_end_before_start():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    now = datetime.utcnow()
    _create_slot(sa_token, slot_id, now + timedelta(hours=1), now + timedelta(hours=2))

    resp = _create_workshop(sa_token, slot_id, reg_start=now + timedelta(days=2), reg_end=now)
    assert resp.status_code == 422


def test_create_workshop_ignores_client_supplied_workshop_id():
    """workshop_id is never accepted from a client — WorkshopCreateRequest has no
    such field, so a client-supplied value is silently dropped by pydantic
    (extra fields are ignored, not rejected) and the backend generator's id is
    used instead, never the client's."""
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    now = datetime.utcnow()
    _create_slot(sa_token, slot_id, now + timedelta(hours=1), now + timedelta(hours=2))

    resp = client.post(
        "/workshops",
        json={
            "workshop_id": "CLIENT_CHOSEN_ID",
            "slot_id": slot_id,
            "name": "Test",
            "description": "desc",
            "venue": "Hall",
            "capacity": 10,
            "instructions": "none",
            "registration_start": _iso(now),
            "registration_end": _iso(now + timedelta(days=1)),
        },
        headers=_bearer(sa_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["workshop_id"] != "CLIENT_CHOSEN_ID"
    assert workshops_collection.find_one({"workshop_id": "CLIENT_CHOSEN_ID"}) is None


# ──────────────────────────────────────────────────────────────────────────
# Task 3 — registration window + capacity gate
# ──────────────────────────────────────────────────────────────────────────

def test_registration_closes_automatically_once_window_lapses():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    p_id, p_token = _participant(tag)
    slot_id = f"D1S{tag}"
    slot_start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, slot_start, slot_start + timedelta(hours=2))

    now = datetime.utcnow()
    created = _create_workshop(
        sa_token, slot_id,
        reg_start=now - timedelta(hours=2), reg_end=now - timedelta(minutes=1),
    )
    assert created.status_code == 200, created.text
    ws_id = created.json()["workshop_id"]

    # Not yet read since creation — persisted registration_open is still True,
    # closed_by_system still False, until something resolves it.
    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored["registration_open"] is True
    assert stored["registration_closed_by_system"] is False

    resp = client.post(f"/workshops/{ws_id}/register", headers=_bearer(p_token))
    assert resp.status_code == 400
    assert "closed" in resp.json()["detail"].lower()

    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored["registration_open"] is False
    assert stored["registration_closed_by_system"] is True


def test_registration_succeeds_within_window_and_under_capacity():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    p_id, p_token = _participant(tag)
    slot_id = f"D1S{tag}"
    slot_start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, slot_start, slot_start + timedelta(hours=2))

    now = datetime.utcnow()
    created = _create_workshop(sa_token, slot_id, reg_start=now - timedelta(hours=1), reg_end=now + timedelta(days=1))
    ws_id = created.json()["workshop_id"]

    resp = client.post(f"/workshops/{ws_id}/register", headers=_bearer(p_token))
    assert resp.status_code == 200, resp.text


def test_registration_blocked_at_capacity_even_when_open():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    slot_start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, slot_start, slot_start + timedelta(hours=2))

    now = datetime.utcnow()
    created = _create_workshop(
        sa_token, slot_id,
        reg_start=now - timedelta(hours=1), reg_end=now + timedelta(days=1), capacity=1,
    )
    ws_id = created.json()["workshop_id"]

    p1_id, p1_token = _participant(tag)
    p2_id, p2_token = _participant(tag + 1)

    first = client.post(f"/workshops/{ws_id}/register", headers=_bearer(p1_token))
    assert first.status_code == 200, first.text

    second = client.post(f"/workshops/{ws_id}/register", headers=_bearer(p2_token))
    assert second.status_code == 400
    assert "full" in second.json()["detail"].lower()


# ──────────────────────────────────────────────────────────────────────────
# Task 4 — admin override sticks; extending the deadline re-arms auto-close
# ──────────────────────────────────────────────────────────────────────────

def test_admin_override_reopens_registration_past_deadline_and_sticks():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    p_id, p_token = _participant(tag)
    slot_id = f"D1S{tag}"
    slot_start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, slot_start, slot_start + timedelta(hours=2))

    now = datetime.utcnow()
    created = _create_workshop(
        sa_token, slot_id,
        reg_start=now - timedelta(hours=2), reg_end=now - timedelta(minutes=1), capacity=5,
    )
    ws_id = created.json()["workshop_id"]

    # Auto-close fires on first read.
    closed = client.get("/workshops/public")
    assert closed.status_code == 200
    row = next(w for w in closed.json() if w["workshop_id"] == ws_id)
    assert row["registration_open"] is False

    # Admin explicitly reopens it, past the deadline.
    override = client.put(f"/workshops/{ws_id}", json={"registration_open": True}, headers=_bearer(sa_token))
    assert override.status_code == 200, override.text

    # A read immediately after must NOT silently re-close it.
    after = client.get("/workshops/public")
    row = next(w for w in after.json() if w["workshop_id"] == ws_id)
    assert row["registration_open"] is True

    # And registration actually works again — capacity still enforced, but
    # this workshop has room.
    resp = client.post(f"/workshops/{ws_id}/register", headers=_bearer(p_token))
    assert resp.status_code == 200, resp.text

    # One more read, to make sure the override doesn't erode over time/reads.
    again = client.get("/workshops/public")
    row = next(w for w in again.json() if w["workshop_id"] == ws_id)
    assert row["registration_open"] is True


def test_extending_registration_end_rearms_auto_close():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    slot_start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, slot_start, slot_start + timedelta(hours=2))

    now = datetime.utcnow()
    created = _create_workshop(
        sa_token, slot_id,
        reg_start=now - timedelta(hours=2), reg_end=now - timedelta(minutes=1),
    )
    ws_id = created.json()["workshop_id"]

    # Auto-close fires once.
    client.get("/workshops/public")
    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored["registration_open"] is False
    assert stored["registration_closed_by_system"] is True

    # Admin pushes a brand-new future deadline and reopens it explicitly.
    new_end = now + timedelta(days=2)
    resp = client.put(
        f"/workshops/{ws_id}",
        json={"registration_end": _iso(new_end), "registration_open": True},
        headers=_bearer(sa_token),
    )
    assert resp.status_code == 200, resp.text

    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored["registration_open"] is True
    # Pushing a new registration_end re-arms the one-shot flag.
    assert stored["registration_closed_by_system"] is False

    # Reading it now (still within the new window) must not auto-close it.
    listed = client.get("/workshops/public")
    row = next(w for w in listed.json() if w["workshop_id"] == ws_id)
    assert row["registration_open"] is True


# ──────────────────────────────────────────────────────────────────────────
# Task 5 — projections: new fields visible, internal field never leaks
# ──────────────────────────────────────────────────────────────────────────

def test_public_and_authenticated_listings_expose_new_fields_hide_internal():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    now = datetime.utcnow()
    _create_slot(sa_token, slot_id, now + timedelta(hours=1), now + timedelta(hours=3))
    created = _create_workshop(sa_token, slot_id, reg_start=now, reg_end=now + timedelta(days=1))
    ws_id = created.json()["workshop_id"]

    public_listing = client.get("/workshops/public")
    public_row = next(w for w in public_listing.json() if w["workshop_id"] == ws_id)
    assert "registration_start" in public_row
    assert "registration_end" in public_row
    assert "registration_open" in public_row
    assert "registration_closed_by_system" not in public_row

    admin_listing = client.get("/workshops", headers=_bearer(sa_token))
    admin_row = next(w for w in admin_listing.json() if w["workshop_id"] == ws_id)
    assert "registration_closed_by_system" not in admin_row


# ──────────────────────────────────────────────────────────────────────────
# Task 6 — slot edit cascade
# ──────────────────────────────────────────────────────────────────────────

def test_editing_slot_start_time_cascades_to_its_workshops():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    old_start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, old_start, old_start + timedelta(hours=2))

    now = datetime.utcnow()
    ws1 = _create_workshop(sa_token, slot_id, reg_start=now, reg_end=now + timedelta(days=1), name="A").json()["workshop_id"]
    ws2 = _create_workshop(sa_token, slot_id, reg_start=now, reg_end=now + timedelta(days=1), name="B").json()["workshop_id"]

    new_start = old_start + timedelta(hours=5)
    new_end = new_start + timedelta(hours=2)
    resp = client.put(
        f"/workshop-slots/{slot_id}",
        json={"start_time": _iso(new_start), "end_time": _iso(new_end)},
        headers=_bearer(sa_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["workshops_updated"] == 2

    for ws_id in (ws1, ws2):
        stored = workshops_collection.find_one({"workshop_id": ws_id})
        assert stored["start_time"] == _iso(new_start)


def test_slot_edit_rejects_end_before_start():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    slot_id = f"D1S{tag}"
    start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, start, start + timedelta(hours=2))

    resp = client.put(
        f"/workshop-slots/{slot_id}",
        json={"end_time": _iso(start - timedelta(hours=1))},
        headers=_bearer(sa_token),
    )
    assert resp.status_code == 400


# ──────────────────────────────────────────────────────────────────────────
# Task 7 — slot delete cascade
# ──────────────────────────────────────────────────────────────────────────

def test_deleting_slot_removes_workshops_and_participant_bookings():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    p_id, p_token = _participant(tag)
    slot_id = f"D1S{tag}"
    start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, start, start + timedelta(hours=2))

    now = datetime.utcnow()
    ws1 = _create_workshop(sa_token, slot_id, reg_start=now, reg_end=now + timedelta(days=1), name="A").json()["workshop_id"]
    ws2 = _create_workshop(sa_token, slot_id, reg_start=now, reg_end=now + timedelta(days=1), name="B").json()["workshop_id"]

    reg = client.post(f"/workshops/{ws1}/register", headers=_bearer(p_token))
    assert reg.status_code == 200, reg.text

    resp = client.delete(f"/workshop-slots/{slot_id}", headers=_bearer(sa_token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["workshops_deleted"] == 2

    assert workshops_collection.find_one({"workshop_id": ws1}) is None
    assert workshops_collection.find_one({"workshop_id": ws2}) is None

    participant = participants_collection.find_one({"participant_id": p_id})
    assert all(w.get("slot_id") != slot_id for w in participant.get("workshops", []))

    slot_gone = workshop_slots_collection.find_one({"slot_id": slot_id})
    assert slot_gone is None


def test_non_super_admin_cannot_delete_slot():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    _, vol_token = _volunteer(tag)
    slot_id = f"D1S{tag}"
    start = datetime.utcnow() + timedelta(days=1)
    _create_slot(sa_token, slot_id, start, start + timedelta(hours=2))

    resp = client.delete(f"/workshop-slots/{slot_id}", headers=_bearer(vol_token))
    assert resp.status_code == 403


# ──────────────────────────────────────────────────────────────────────────
# Task 8 — end-to-end lifecycle
# ──────────────────────────────────────────────────────────────────────────

def test_full_lifecycle_slot_to_deletion():
    tag = random.randint(100000, 999999)
    _, sa_token = _super_admin(tag)
    p1_id, p1_token = _participant(tag)
    p2_id, p2_token = _participant(tag + 1)

    # 1. Create a slot.
    slot_id = f"D1S{tag}"
    slot_start = datetime.utcnow() + timedelta(days=1)
    slot_created = _create_slot(sa_token, slot_id, slot_start, slot_start + timedelta(hours=2))
    assert slot_created.status_code == 200

    # 2. Create a workshop against it, capacity 1, window already open.
    now = datetime.utcnow()
    created = _create_workshop(
        sa_token, slot_id,
        reg_start=now - timedelta(hours=1), reg_end=now + timedelta(minutes=1), capacity=1,
    )
    assert created.status_code == 200, created.text
    ws_id = created.json()["workshop_id"]
    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored["start_time"] == slot_start.isoformat() + "Z"

    # 3. Register — succeeds (open, under capacity).
    reg1 = client.post(f"/workshops/{ws_id}/register", headers=_bearer(p1_token))
    assert reg1.status_code == 200, reg1.text

    # 4. Force the window shut via update (simulating time passing without
    #    waiting a real minute) and confirm the auto-close mechanism engages
    #    on the very next read.
    force_shut = client.put(
        f"/workshops/{ws_id}",
        json={"registration_end": _iso(now - timedelta(minutes=1))},
        headers=_bearer(sa_token),
    )
    assert force_shut.status_code == 200, force_shut.text
    client.get("/workshops/public")  # triggers sync
    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored["registration_open"] is False
    assert stored["registration_closed_by_system"] is True

    # 5. Admin override reopens it.
    reopened = client.put(f"/workshops/{ws_id}", json={"registration_open": True}, headers=_bearer(sa_token))
    assert reopened.status_code == 200

    # 6. Capacity is still enforced despite the override — workshop is full
    #    (capacity=1, already holds p1's booking).
    reg2 = client.post(f"/workshops/{ws_id}/register", headers=_bearer(p2_token))
    assert reg2.status_code == 400
    assert "full" in reg2.json()["detail"].lower()

    # 7. Edit the slot's start_time — cascades onto the workshop.
    new_start = slot_start + timedelta(hours=4)
    edited = client.put(
        f"/workshop-slots/{slot_id}",
        json={"start_time": _iso(new_start), "end_time": _iso(new_start + timedelta(hours=2))},
        headers=_bearer(sa_token),
    )
    assert edited.status_code == 200
    stored = workshops_collection.find_one({"workshop_id": ws_id})
    assert stored["start_time"] == _iso(new_start)

    # 8. Delete the slot — cascades: workshop and p1's booking disappear.
    deleted = client.delete(f"/workshop-slots/{slot_id}", headers=_bearer(sa_token))
    assert deleted.status_code == 200
    assert deleted.json()["workshops_deleted"] == 1
    assert workshops_collection.find_one({"workshop_id": ws_id}) is None
    p1 = participants_collection.find_one({"participant_id": p1_id})
    assert all(w.get("workshop_id") != stored["_id"] for w in p1.get("workshops", []))
