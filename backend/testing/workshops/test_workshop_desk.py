"""
The workshop desk: `GET /workshops/{id}/participation`,
`PATCH /workshops/{id}/participants/{pid}`, and
`DELETE /workshops/{id}/volunteers/{uid}`.

These three routes exist so the people who actually staff a workshop can read and
correct their own room, so the authorisation matrix *is* the feature and is what
most of this file asserts: an assigned volunteer is in, a staff account assigned
somewhere else is out, and writing attendance needs the same permission as
scanning it.

Unlike the neighbouring suites this fixture does not wipe the collections. It
creates uniquely-named records and cleans up after itself, so it cannot pull the
ground out from under another module that shares this mongomock process.
"""
import base64
import json
import os
import random
import sys
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from database import (
    participants_collection,
    backend_teams_collection,
    workshops_collection,
    workshop_logs_collection,
    system_logs_collection,
)
import security

client = TestClient(app)

PASSWORD = "secure_password"


def _staff(paradox_id: str, email: str, role: str) -> str:
    """Insert a staff account and return its bearer token."""
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id,
        "email": email,
        "password_hash": security.get_password_hash(PASSWORD),
        "role": role,
        "department": "workshops",
        "designation": "Desk Test",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def desk():
    tag = random.randint(100000, 999999)

    # --- a participant with a real academic record -------------------------
    # `PATCH /profile/complete` writes `course_stage`; `academic_level` and
    # `academic_level_number` are what the student dataset adds beside it, so they
    # are written the same way the seed writes them.
    p_email = f"23f{tag}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": p_email, "password": PASSWORD})
    p_login = client.post("/auth/login", json={"email": p_email, "password": PASSWORD})
    assert p_login.status_code == 200, p_login.text
    p_token = p_login.json()["access_token"]
    p_id = p_login.json()["id"]
    p_pubkey = p_login.json()["public_key"]

    client.patch(
        "/profile/complete",
        json={
            "full_name": "Ananya Iyer",
            "dob": "2004-03-11",
            "house": "wayanad",
            "gender": "female",
            "phone": "+91 90000 00001",
            "country": "India",
            "state": "Kerala",
            "city": "Kochi",
            "address": "12, Marine Drive",
            "program": "DS",
            "course_stage": "diploma",
        },
        headers=_bearer(p_token),
    )
    participants_collection.update_one(
        {"participant_id": p_id},
        {"$set": {"profile.academic_level": "Diploma", "profile.academic_level_number": 2,
                  "profile.degree": "BS in Data Science and Applications", "profile.entry_year": 2023}},
    )

    # A second participant who books and never turns up, so "absent" is a real
    # row rather than the absence of one.
    q_email = f"22f{tag}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": q_email, "password": PASSWORD})
    q_login = client.post("/auth/login", json={"email": q_email, "password": PASSWORD})
    q_token = q_login.json()["access_token"]
    q_id = q_login.json()["id"]

    # --- the staff cast ----------------------------------------------------
    sa_id = f"SA{tag}"
    sa_token = _staff(sa_id, f"sa{tag}@ds.study.iitm.ac.in", "super_admin")
    vol_id = f"BTV{tag}"
    vol_token = _staff(vol_id, f"vol{tag}@ds.study.iitm.ac.in", "volunteer")
    muted_id = f"BTM{tag}"
    muted_token = _staff(muted_id, f"muted{tag}@ds.study.iitm.ac.in", "volunteer")
    outsider_id = f"BTO{tag}"
    outsider_token = _staff(outsider_id, f"out{tag}@ds.study.iitm.ac.in", "volunteer")

    # --- the workshop, its team, and two bookings --------------------------
    ws_id = f"WKS_DESK_{tag}"
    slot_id = f"SLOT_DESK_{tag}"
    created = client.post(
        "/workshops",
        json={
            "workshop_id": ws_id,
            "slot_id": slot_id,
            "name": "Ethics of AI",
            "description": "A test workshop for the desk routes.",
            "venue": "CRC 101",
            "capacity": 50,
            "instructions": "Bring a laptop",
        },
        headers=_bearer(sa_token),
    )
    assert created.status_code == 200, created.text

    for user_id, role, attendance in (
        (vol_id, "workshop_manager", True),
        (muted_id, "workshop_volunteer", False),
    ):
        assigned = client.post(
            f"/workshops/{ws_id}/volunteers",
            json={"user_id": user_id, "role": role, "attendance": attendance},
            headers=_bearer(sa_token),
        )
        assert assigned.status_code == 200, assigned.text

    for token in (p_token, q_token):
        booked = client.post(f"/workshops/{ws_id}/register", headers=_bearer(token))
        assert booked.status_code == 200, booked.text

    ws_doc = workshops_collection.find_one({"workshop_id": ws_id})

    yield {
        "ws_id": ws_id,
        "ws_doc_id": str(ws_doc["_id"]),
        "p_id": p_id,
        "p_token": p_token,
        "p_pubkey": p_pubkey,
        "q_id": q_id,
        "sa_id": sa_id,
        "sa_token": sa_token,
        "vol_id": vol_id,
        "vol_token": vol_token,
        "muted_id": muted_id,
        "muted_token": muted_token,
        "outsider_id": outsider_id,
        "outsider_token": outsider_token,
    }

    # Leave the shared collections as they were found.
    workshops_collection.delete_one({"workshop_id": ws_id})
    workshop_logs_collection.delete_many({"workshop_id": str(ws_doc["_id"])})
    participants_collection.delete_many({"participant_id": {"$in": [p_id, q_id]}})
    backend_teams_collection.delete_many(
        {"paradox_id": {"$in": [sa_id, vol_id, muted_id, outsider_id]}}
    )


def _qr_for(participant_id: str, public_key_pem: str) -> dict:
    """A live QR payload, encrypted to that participant's own public key."""
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    ciphertext = public_key.encrypt(
        json.dumps({"participant_id": participant_id}).encode("utf-8"),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    return {
        "participant_id": participant_id,
        "data": base64.b64encode(ciphertext).decode("utf-8"),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


# ---------------------------------------------------------------- participation


def test_assigned_volunteer_reads_the_roster(desk):
    """The whole point: a volunteer who is *not* a Super Admin gets the roster."""
    resp = client.get(f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["vol_token"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["workshop_id"] == desk["ws_id"]
    assert body["count"] == 2
    assert body["capacity"] == 50
    assert {row["participant_id"] for row in body["participants"]} == {desk["p_id"], desk["q_id"]}

    # Sorted by participant id, so a door list is stable between calls.
    ids = [row["participant_id"] for row in body["participants"]]
    assert ids == sorted(ids)


def test_roster_carries_the_academic_level(desk):
    """Requirement 2: the real level, not an inference from the roll number."""
    resp = client.get(f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["vol_token"]))
    row = next(r for r in resp.json()["participants"] if r["participant_id"] == desk["p_id"])

    assert row["course_stage"] == "diploma"
    assert row["academic_level"] == "Diploma"
    assert row["academic_level_number"] == 2
    assert row["program"] == "DS"
    assert row["name"] == "Ananya Iyer"
    assert row["house"] == "wayanad"
    assert row["booking_type"] == "pre-registered"

    # A profile that was never completed reports nulls rather than being dropped.
    other = next(r for r in resp.json()["participants"] if r["participant_id"] == desk["q_id"])
    assert other["course_stage"] is None
    assert other["academic_level"] is None


def test_roster_never_leaks_credentials(desk):
    resp = client.get(f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["sa_token"]))
    raw = resp.text
    assert "password_hash" not in raw
    assert "private_key" not in raw
    assert "qr_secrets" not in raw
    assert "embedding" not in raw


def test_roster_reports_the_team_with_scanning_state(desk):
    resp = client.get(f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["vol_token"]))
    team = {member["user_id"]: member for member in resp.json()["workshop_team"]}

    assert team[desk["vol_id"]]["role"] == "workshop_manager"
    assert team[desk["vol_id"]]["attendance"] is True
    assert team[desk["muted_id"]]["attendance"] is False


def test_volunteer_with_scanning_off_still_reads_the_roster(desk):
    """`attendance` gates scanning, not reading — a stood-down volunteer can look."""
    resp = client.get(f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["muted_token"]))
    assert resp.status_code == 200


def test_unassigned_staff_is_refused(desk):
    resp = client.get(f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["outsider_token"]))
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Not authorized to view this workshop's participation"


def test_participant_token_is_refused(desk):
    resp = client.get(f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["p_token"]))
    assert resp.status_code == 403


def test_participation_requires_a_token(desk):
    # 401 from `HTTPBearer` itself, before the route's own 403 can be reached.
    assert client.get(f"/workshops/{desk['ws_id']}/participation").status_code == 401


def test_unknown_workshop_is_404(desk):
    resp = client.get("/workshops/NO_SUCH_WORKSHOP/participation", headers=_bearer(desk["sa_token"]))
    assert resp.status_code == 404


def test_attendance_counts_follow_a_real_scan(desk):
    """A scan and the roster must agree, since the desk shows both."""
    scan = client.post(
        f"/workshops/{desk['ws_id']}/attendance?scan_type=pre-registered",
        json=_qr_for(desk["p_id"], desk["p_pubkey"]),
        headers=_bearer(desk["vol_token"]),
    )
    assert scan.status_code == 200, scan.text

    body = client.get(
        f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["vol_token"])
    ).json()

    assert body["attended_count"] == 1
    assert body["absent_count"] == 1
    assert body["participant_count"] == 1
    assert next(r for r in body["participants"] if r["participant_id"] == desk["p_id"])["attended"] is True
    assert next(r for r in body["participants"] if r["participant_id"] == desk["q_id"])["attended"] is False


# ------------------------------------------------------------------ correction


def test_volunteer_marks_a_missing_attendee_present(desk):
    """Requirement 3: the authorised override for a QR that cannot be scanned."""
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"attended": True},
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["changes"] == {"attended": True}

    body = client.get(
        f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["vol_token"])
    ).json()
    assert body["attended_count"] == 2
    assert body["participant_count"] == 2


def test_override_is_logged_as_an_override(desk):
    """A hand-set attendance must be distinguishable from a scan, for ever."""
    rows = list(workshop_logs_collection.find({
        "workshop_id": desk["ws_doc_id"],
        "action": "attendance_override",
        "participant_id": desk["q_id"],
    }))
    assert len(rows) == 1
    assert rows[0]["scanned_by"] == desk["vol_id"]
    assert rows[0]["changes"] == {"attended": True}

    audit = list(system_logs_collection.find({
        "action": "UPDATE_WORKSHOP_PARTICIPANT",
        "target_id": desk["ws_id"],
    }))
    assert audit and audit[-1]["actor_id"] == desk["vol_id"]


def test_repeating_the_same_correction_changes_nothing(desk):
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"attended": True},
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "No change"

    # The count did not drift, and no second log row was invented.
    body = client.get(
        f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["vol_token"])
    ).json()
    assert body["participant_count"] == 2
    assert workshop_logs_collection.count_documents({
        "workshop_id": desk["ws_doc_id"],
        "action": "attendance_override",
        "participant_id": desk["q_id"],
    }) == 1


def test_marking_somebody_absent_again_decrements_the_count(desk):
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"attended": False},
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["changes"] == {"attended": False}

    body = client.get(
        f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["vol_token"])
    ).json()
    assert body["attended_count"] == 1
    assert body["participant_count"] == 1


def test_booking_type_can_be_relabelled_without_taking_another_seat(desk):
    before = workshops_collection.find_one({"workshop_id": desk["ws_id"]})["registration_count"]

    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"booking_type": "on-spot"},
        headers=_bearer(desk["sa_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["changes"] == {"booking_type": "on-spot"}

    after = workshops_collection.find_one({"workshop_id": desk["ws_id"]})
    assert after["registration_count"] == before

    body = client.get(
        f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["sa_token"])
    ).json()
    assert body["on_spot_count"] == 1

    # Put it back, so the ordering of later tests cannot depend on this one.
    client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"booking_type": "pre-registered"},
        headers=_bearer(desk["sa_token"]),
    )


def test_correction_rejects_a_nonsense_booking_type(desk):
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"booking_type": "walk-in"},
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "booking_type must be 'pre-registered' or 'on-spot'"


def test_correction_rejects_an_empty_body(desk):
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={},
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Nothing to update"


def test_correction_refuses_a_volunteer_whose_scanning_is_off(desk):
    """Writing attendance is the same privilege as scanning it."""
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"attended": True},
        headers=_bearer(desk["muted_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Scanning disabled for this volunteer"


def test_correction_refuses_unassigned_staff(desk):
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{desk['q_id']}",
        json={"attended": True},
        headers=_bearer(desk["outsider_token"]),
    )
    assert resp.status_code == 403


def test_correction_404s_for_somebody_who_never_booked(desk):
    outsider_email = f"21f{random.randint(100000, 999999)}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": outsider_email, "password": PASSWORD})
    stranger = client.post("/auth/login", json={"email": outsider_email, "password": PASSWORD}).json()["id"]

    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/{stranger}",
        json={"attended": True},
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Participant is not registered for this workshop"

    participants_collection.delete_one({"participant_id": stranger})


def test_correction_404s_for_an_unknown_participant(desk):
    resp = client.patch(
        f"/workshops/{desk['ws_id']}/participants/NOBODY",
        json={"attended": True},
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Participant not found"


# --------------------------------------------------------------- team removal


def test_volunteer_cannot_remove_a_colleague(desk):
    resp = client.delete(
        f"/workshops/{desk['ws_id']}/volunteers/{desk['muted_id']}",
        headers=_bearer(desk["vol_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only Super Admins can remove volunteers"


def test_removing_somebody_not_on_the_team_is_404(desk):
    resp = client.delete(
        f"/workshops/{desk['ws_id']}/volunteers/{desk['outsider_id']}",
        headers=_bearer(desk["sa_token"]),
    )
    assert resp.status_code == 404


def test_super_admin_removes_a_volunteer_and_their_access_goes_with_them(desk):
    resp = client.delete(
        f"/workshops/{desk['ws_id']}/volunteers/{desk['muted_id']}",
        headers=_bearer(desk["sa_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "Volunteer removed"

    team = workshops_collection.find_one({"workshop_id": desk["ws_id"]})["workshop_team"]
    assert [member["user_id"] for member in team] == [desk["vol_id"]]

    # The roster closes behind them immediately.
    after = client.get(
        f"/workshops/{desk['ws_id']}/participation", headers=_bearer(desk["muted_token"])
    )
    assert after.status_code == 403

    # Scans they already made are untouched — attendance history is not a shift.
    assert workshop_logs_collection.count_documents({"workshop_id": desk["ws_doc_id"]}) > 0

    audit = list(system_logs_collection.find({
        "action": "REMOVE_WORKSHOP_VOLUNTEER",
        "target_id": desk["ws_id"],
    }))
    assert audit and audit[-1]["details"]["user_id"] == desk["muted_id"]
