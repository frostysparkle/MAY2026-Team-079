"""
`GET /participants` and `PATCH /participants/{participant_id}` — Story 7.3.

Admins could already *view* every roster and could not *update* anybody: no
endpoint anywhere wrote to a participant document except that participant's own
`PATCH /profile/complete`. These two close that, and most of what follows asserts
how narrow the write is — identity, credentials, and allocation state are all
deliberately out of reach, because the routes that own them enforce rules a
direct write would skip.
"""
import pytest
from fastapi.testclient import TestClient
from datetime import datetime
import random
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from main import app
from database import participants_collection, backend_teams_collection, system_logs_collection
import security

client = TestClient(app)


def _participant(name, house="Ganga"):
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    client.patch("/profile/complete", json={
        "full_name": name, "dob": "2000-01-01", "house": house, "gender": "male",
        "phone": "9999999999", "mess_preference": "veg", "country": "India",
        "state": "TN", "city": "Chennai", "address": "IITM", "program": "DS",
        "course_stage": "diploma",
    }, headers=headers)
    return login.json()["id"], email, headers


def _staff(role):
    rand = random.randint(100000, 999999)
    email = f"bt{rand}@ds.study.iitm.ac.in"
    paradox_id = f"BT{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id,
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": "technicals",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"})
    return paradox_id, {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture(scope="module")
def world():
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})

    admin_id, admin_headers = _staff("super_admin")
    _, volunteer_headers = _staff("volunteer")
    meera_id, meera_email, meera_headers = _participant("Meera Raghunathan", house="Ganga")
    arjun_id, arjun_email, _ = _participant("Arjun Prasad", house="Kaveri")

    return {
        "admin_id": admin_id, "admin_headers": admin_headers,
        "volunteer_headers": volunteer_headers,
        "meera_id": meera_id, "meera_email": meera_email, "meera_headers": meera_headers,
        "arjun_id": arjun_id, "arjun_email": arjun_email,
    }


@pytest.fixture(autouse=True)
def clean_logs():
    system_logs_collection.delete_many({})
    yield
    system_logs_collection.delete_many({})


# ------------------------------------------------------------------ the read ----

def test_a_super_admin_reads_the_fest_wide_roster(world):
    resp = client.get("/participants", headers=world["admin_headers"])
    assert resp.status_code == 200

    body = resp.json()
    assert body["count"] == 2
    assert {p["participant_id"] for p in body["participants"]} == {world["meera_id"], world["arjun_id"]}


def test_the_roster_never_carries_a_password_hash_or_a_qr_keypair(world):
    """The two fields that must never leave the participants collection."""
    for row in client.get("/participants", headers=world["admin_headers"]).json()["participants"]:
        assert "password_hash" not in row
        assert "qr_secrets" not in row
        # Excluded for size rather than secrecy, but a roster of base64 photos is
        # a response nobody wants.
        assert "photo" not in row
        assert "embedding" not in row


def test_registrations_come_back_as_counts_not_arrays(world):
    row = next(p for p in client.get("/participants", headers=world["admin_headers"]).json()["participants"]
               if p["participant_id"] == world["meera_id"])
    assert row["event_count"] == 0
    assert row["workshop_count"] == 0
    assert "events" not in row
    assert "workshops" not in row


def test_search_matches_a_name_an_email_or_an_id(world):
    def ids(query):
        resp = client.get(f"/participants?q={query}", headers=world["admin_headers"])
        return {p["participant_id"] for p in resp.json()["participants"]}

    assert ids("meera") == {world["meera_id"]}          # name, case-insensitively
    assert ids("Raghunathan") == {world["meera_id"]}    # surname alone
    assert ids(world["arjun_email"]) == {world["arjun_id"]}
    assert ids(world["meera_id"]) == {world["meera_id"]}
    assert ids("nobody-by-that-name") == set()


def test_the_roster_filters_by_house(world):
    resp = client.get("/participants?house=Kaveri", headers=world["admin_headers"])
    assert [p["participant_id"] for p in resp.json()["participants"]] == [world["arjun_id"]]


def test_limit_caps_the_roster(world):
    assert client.get("/participants?limit=1", headers=world["admin_headers"]).json()["count"] == 1


def test_a_non_super_admin_staffer_is_refused_the_roster(world):
    resp = client.get("/participants", headers=world["volunteer_headers"])
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Not authorized"


def test_a_participant_cannot_read_the_roster(world):
    assert client.get("/participants", headers=world["meera_headers"]).status_code == 403


def test_the_roster_requires_a_token(world):
    assert client.get("/participants").status_code in (401, 403)


def test_statistics_is_still_roster_free(world):
    """
    The read half of 7.3 is a separate endpoint on purpose: a dashboard showing
    fest-wide totals must not be the thing that leaks a list of names.
    """
    body = client.get("/participants/statistics", headers=world["admin_headers"]).json()
    assert body["total_registered"] == 2
    assert "participants" not in body
    assert not any("participant_id" in str(key) for key in body)


def test_statistics_is_not_captured_as_a_participant_id(world):
    """It is declared before `/{participant_id}`, so the literal path stays literal."""
    assert client.get("/participants/statistics", headers=world["admin_headers"]).status_code == 200


# ----------------------------------------------------------------- the write ----

def test_a_super_admin_corrects_a_misspelled_name(world):
    resp = client.patch(f"/participants/{world['arjun_id']}",
                        json={"full_name": "Arjun Prasath"}, headers=world["admin_headers"])
    assert resp.status_code == 200
    assert resp.json()["profile"]["full_name"] == "Arjun Prasath"

    stored = participants_collection.find_one({"participant_id": world["arjun_id"]})
    assert stored["profile"]["full_name"] == "Arjun Prasath"

    # Restore, so the module-scoped fixture stays truthful for later tests.
    client.patch(f"/participants/{world['arjun_id']}",
                 json={"full_name": "Arjun Prasad"}, headers=world["admin_headers"])


def test_a_partial_edit_leaves_every_other_profile_field_alone(world):
    before = participants_collection.find_one({"participant_id": world["meera_id"]})["profile"]

    client.patch(f"/participants/{world['meera_id']}", json={"phone": "8888888888"},
                 headers=world["admin_headers"])

    after = participants_collection.find_one({"participant_id": world["meera_id"]})["profile"]
    assert after["phone"] == "8888888888"
    assert after["full_name"] == before["full_name"]
    assert after["address"] == before["address"]
    assert after["house"] == before["house"]
    assert after["program"] == before["program"]

    client.patch(f"/participants/{world['meera_id']}", json={"phone": before["phone"]},
                 headers=world["admin_headers"])


def test_identity_credentials_and_allocation_are_not_writable(world):
    """
    `email` and `participant_id` are what every roster, log row, and QR payload
    joins on; `password_hash` and `qr_secrets` are credentials; mess and
    accommodation state belongs to the allocation routes, which enforce capacity.
    Pydantic ignores unknown keys, so the request succeeds and writes none of them.
    """
    before = participants_collection.find_one({"participant_id": world["meera_id"]})

    resp = client.patch(f"/participants/{world['meera_id']}", json={
        "full_name": "Meera Raghunathan",
        "email": "hijack@ds.study.iitm.ac.in",
        "participant_id": "DS00000000",
        "password_hash": "not-a-hash",
        "qr_secrets": {"private_key": "stolen"},
        "accommodation": {"hostel_id": "GANGA", "room": "999", "logged_in": True},
        "mess": {"mess_id": "NILGIRI"},
        "events": [{"event_id": "anything"}],
    }, headers=world["admin_headers"])
    assert resp.status_code == 200

    after = participants_collection.find_one({"participant_id": world["meera_id"]})
    assert after["email"] == before["email"]
    assert after["participant_id"] == before["participant_id"]
    assert after["password_hash"] == before["password_hash"]
    assert after["qr_secrets"] == before["qr_secrets"]
    assert after["accommodation"] == before["accommodation"]
    assert after["mess"]["mess_id"] == before["mess"]["mess_id"]
    assert after["events"] == before["events"]


def test_an_emergency_contact_can_be_replaced(world):
    resp = client.patch(f"/participants/{world['meera_id']}", json={
        "emergency_contact": {"name": "R Raghunathan", "relation": "father", "phone": "7777777777"},
    }, headers=world["admin_headers"])
    assert resp.status_code == 200
    assert resp.json()["profile"]["emergency_contact"]["relation"] == "father"


def test_an_empty_body_is_refused(world):
    resp = client.patch(f"/participants/{world['meera_id']}", json={}, headers=world["admin_headers"])
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Nothing to update"


def test_an_unknown_participant_is_a_404(world):
    resp = client.patch("/participants/DS99999999", json={"full_name": "Nobody"},
                        headers=world["admin_headers"])
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Participant not found"


def test_a_non_super_admin_staffer_cannot_edit_anybody(world):
    resp = client.patch(f"/participants/{world['meera_id']}", json={"full_name": "Hacked"},
                        headers=world["volunteer_headers"])
    assert resp.status_code == 403
    assert participants_collection.find_one(
        {"participant_id": world["meera_id"]})["profile"]["full_name"] == "Meera Raghunathan"


def test_a_participant_cannot_edit_another_participant(world):
    resp = client.patch(f"/participants/{world['arjun_id']}", json={"full_name": "Hacked"},
                        headers=world["meera_headers"])
    assert resp.status_code == 403


def test_the_edit_requires_a_token(world):
    assert client.patch(f"/participants/{world['meera_id']}",
                        json={"full_name": "Hacked"}).status_code in (401, 403)


def test_an_edit_reaches_the_audit_trail_naming_the_fields(world):
    client.patch(f"/participants/{world['meera_id']}",
                 json={"phone": "9999999999", "city": "Chennai"},
                 headers=world["admin_headers"])

    entry = system_logs_collection.find_one({"action": "UPDATE_PARTICIPANT"})
    assert entry is not None
    assert entry["actor_id"] == world["admin_id"]
    assert entry["target_id"] == world["meera_id"]
    assert entry["details"]["fields_updated"] == ["city", "phone"]
