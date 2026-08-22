"""
Standalone verification script for the backend_teams schema hardening
(role/department enums, prefixed paradox_id, admin_id validation,
role/department immutability, and the hostels.py "other"-role casing fix).

Not part of the pytest suite (backend/testing/**, backend/test_*.py are
protected and are not modified by this change) — run directly instead:

    python verify_backend_teams.py

Uses TestClient against mongomock (TESTING=1), the same mechanism the real
test suite uses, so nothing here touches a live database. Exits with a
non-zero status if any check fails, and prints a PASS/FAIL line per check.
"""
import os
os.environ.setdefault("TESTING", "1")

import random
import sys
from datetime import datetime

from fastapi.testclient import TestClient

from main import app
from database import participants_collection, backend_teams_collection, hostel_collection
import security

client = TestClient(app)

failures = []


def check(label, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(label)


def rand_email(prefix="u"):
    return f"{prefix}{random.randint(100000, 999999)}@ds.study.iitm.ac.in"


def register_participant(email, password="secure_password"):
    resp = client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["participant_id"]


def bootstrap_super_admin():
    """
    Insert one super_admin directly, bypassing POST /backend_teams (which
    itself requires an existing super_admin caller) purely to get a first
    admin token to drive every other check through the real API.
    """
    email = rand_email("boot_sa")
    paradox_id = "SATE0001"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id,
        "email": email,
        "name": "Bootstrap Admin",
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "technical",
        "designation": "Head",
        "admin_id": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"})
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def main():
    # Clean slate — this is mongomock, in-memory, and dropped when the process
    # exits, but clearing explicitly keeps this script idempotent if re-run
    # within the same process (it isn't, but costs nothing to be safe).
    backend_teams_collection.delete_many({})
    participants_collection.delete_many({})
    hostel_collection.delete_many({})

    sa_token = bootstrap_super_admin()
    sa_headers = {"Authorization": f"Bearer {sa_token}"}

    # --- 1. Valid create, each role, correct paradox_id prefix -------------
    vol_email = rand_email("vol")
    register_participant(vol_email)
    resp = client.post("/backend_teams", json={
        "email": vol_email, "password": "secure_password",
        "role": "volunteer", "department": "mess", "designation": "Desk Volunteer",
    }, headers=sa_headers)
    check("create volunteer/mess -> 200", resp.status_code == 200, resp.text)
    vol_paradox_id = resp.json().get("paradox_id", "")
    check("volunteer/mess paradox_id has VLME prefix", vol_paradox_id.startswith("VLME"), vol_paradox_id)

    other_email = rand_email("oth")
    resp = client.post("/backend_teams", json={
        "email": other_email, "password": "secure_password",
        "role": "other", "department": "hostels", "designation": "Block Desk",
    }, headers=sa_headers)
    check("create other/hostels (no participant needed) -> 200", resp.status_code == 200, resp.text)
    other_paradox_id = resp.json().get("paradox_id", "")
    check("other/hostels paradox_id has OTHO prefix", other_paradox_id.startswith("OTHO"), other_paradox_id)
    other_doc = backend_teams_collection.find_one({"paradox_id": other_paradox_id})
    check("other-role admin_id is None with no participant match", other_doc.get("admin_id") is None)

    admin_email = rand_email("adm")
    register_participant(admin_email)
    resp = client.post("/backend_teams", json={
        "email": admin_email, "password": "secure_password",
        "role": "admin", "department": "uhc", "designation": "UHC Member",
    }, headers=sa_headers)
    check("create admin/uhc -> 200", resp.status_code == 200, resp.text)
    admin_paradox_id = resp.json().get("paradox_id", "")
    check("admin/uhc paradox_id has ADUH prefix", admin_paradox_id.startswith("ADUH"), admin_paradox_id)

    # --- 2. Invalid role / department rejected (422) -----------------------
    resp = client.post("/backend_teams", json={
        "email": rand_email("bad"), "password": "secure_password",
        "role": "superuser", "department": "mess", "designation": "X",
    }, headers=sa_headers)
    check("invalid role -> 422", resp.status_code == 422, resp.text)

    resp = client.post("/backend_teams", json={
        "email": rand_email("bad"), "password": "secure_password",
        "role": "volunteer", "department": "technicals", "designation": "X",
    }, headers=sa_headers)
    check("invalid (old-style plural) department -> 422", resp.status_code == 422, resp.text)

    resp = client.post("/backend_teams", json={
        "email": rand_email("bad"), "password": "secure_password",
        "role": "volunteer", "department": "UpperHouseCouncil", "designation": "X",
    }, headers=sa_headers)
    check("invalid (old-style) department UpperHouseCouncil -> 422", resp.status_code == 422, resp.text)

    # --- 3. admin_id required for super_admin/admin/volunteer, missing -> 400
    no_participant_email = rand_email("noPart")  # never registered as a participant
    resp = client.post("/backend_teams", json={
        "email": no_participant_email, "password": "secure_password",
        "role": "admin", "department": "sports", "designation": "Sports Admin",
    }, headers=sa_headers)
    check("admin with no matching participant -> 400", resp.status_code == 400, resp.text)

    resp = client.post("/backend_teams", json={
        "email": rand_email("noPart2"), "password": "secure_password",
        "role": "volunteer", "department": "workshops", "designation": "Workshop Vol",
    }, headers=sa_headers)
    check("volunteer with no matching participant -> 400", resp.status_code == 400, resp.text)

    # --- 4. Duplicate participant link -> 409 -------------------------------
    # Simulates a legacy/imported backend_teams doc whose admin_id already
    # points at a participant, then a fresh POST /backend_teams resolving to
    # that same participant via their real email.
    dup_participant_email = rand_email("dup")
    dup_participant_id = register_participant(dup_participant_email)
    participant_oid = participants_collection.find_one({"participant_id": dup_participant_id})["_id"]
    backend_teams_collection.insert_one({
        "paradox_id": "ADSP9999",
        "email": rand_email("legacy"),
        "name": "Legacy Import",
        "password_hash": security.get_password_hash("secure_password"),
        "role": "admin",
        "department": "sports",
        "designation": "Legacy",
        "admin_id": participant_oid,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    resp = client.post("/backend_teams", json={
        "email": dup_participant_email, "password": "secure_password",
        "role": "volunteer", "department": "sports", "designation": "Second Link",
    }, headers=sa_headers)
    check("second account linking an already-linked participant -> 409", resp.status_code == 409, resp.text)

    # --- 5. Role/department immutable on update -----------------------------
    resp = client.put(f"/backend_teams/{vol_paradox_id}", json={
        "role": "super_admin", "department": "uhc", "designation": "Promoted",
    }, headers=sa_headers)
    check("update accepted (designation only field honoured) -> 200", resp.status_code == 200, resp.text)
    reloaded = backend_teams_collection.find_one({"paradox_id": vol_paradox_id})
    check("role unchanged by update attempt", reloaded.get("role") == "volunteer", reloaded.get("role"))
    check("department unchanged by update attempt", reloaded.get("department") == "mess", reloaded.get("department"))
    check("designation was updated", reloaded.get("designation") == "Promoted", reloaded.get("designation"))

    # --- 6. 404 on update/delete of nonexistent paradox_id ------------------
    resp = client.put("/backend_teams/DOES_NOT_EXIST", json={"designation": "X"}, headers=sa_headers)
    check("update nonexistent paradox_id -> 404", resp.status_code == 404, resp.text)

    resp = client.delete("/backend_teams/DOES_NOT_EXIST", headers=sa_headers)
    check("delete nonexistent paradox_id -> 404", resp.status_code == 404, resp.text)

    resp = client.delete(f"/backend_teams/{admin_paradox_id}", headers=sa_headers)
    check("delete existing paradox_id -> 200", resp.status_code == 200, resp.text)

    # --- 7. hostels.py "other"-role gating (lowercase fix) ------------------
    hostel_id = f"HSTL_VERIFY_{random.randint(1000, 9999)}"
    resp = client.post("/hostels", json={
        "name": "Verify Block", "capacity": 10, "gender": "male",
        "sharing": 2, "num_rooms": 5,
    }, headers=sa_headers)
    check("create hostel -> 200", resp.status_code == 200, resp.text)
    hostel_id = resp.json().get("hostel_id", hostel_id)

    resp = client.post(f"/hostels/{hostel_id}/team", json={
        "user_id": other_paradox_id, "role": "hostel_volunteer", "attendance": True,
    }, headers=sa_headers)
    check("assign 'other'-role backend_teams member to hostel team -> 200", resp.status_code == 200, resp.text)

    resp = client.post(f"/hostels/{hostel_id}/team", json={
        "user_id": vol_paradox_id, "role": "hostel_volunteer", "attendance": True,
    }, headers=sa_headers)
    check(
        "assigning a non-'other'-role backend_teams member to hostel team -> 404",
        resp.status_code == 404, resp.text,
    )

    # --- Summary -------------------------------------------------------------
    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("All checks passed.")


if __name__ == "__main__":
    main()
