"""
Who an audit entry says did the thing.

The trail used to record an actor as a bare id — a staff `paradox_id` or a
participant `participant_id`, with nothing on the record to say which namespace it
belonged to — so a reader got `BT1755…` where a name belonged. These tests pin
down the two halves of the fix and the boundary between them:

1. A name is captured *with* the entry, at the moment of the action. That is what
   makes the trail an audit trail rather than a live join: renaming or deleting
   someone afterwards must not rewrite what their history says.

2. Entries written before names were recorded are resolved when the trail is
   read, from `backend_teams` and `participants`, in one batched pass. This is a
   fallback for old rows, not the main path, and the tests below assert that the
   recorded name wins whenever there is one.

`actor_id` and `details` are deliberately left exactly as they were. The CSV
export and the per-entity views key on ids, so a test here guards that too.
"""
import os
import random
import sys
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import database
import security
from database import (
    backend_teams_collection,
    mess_collection,
    participants_collection,
    system_logs_collection,
)
from main import app

client = TestClient(app)

MESS_ID = "MS_ACTOR_1"


def staff(role: str = "super_admin", **fields) -> tuple[str, dict]:
    """
    A staff account, signed in. Returns (paradox_id, auth headers).

    `fields` overrides what lands on the document, so a test can build the account
    that has a name, the one that has only a designation, and the one that has
    neither — the three rungs of the fallback.
    """
    rand = random.randint(100000, 999999)
    email = fields.pop("email", f"bt{rand}@ds.study.iitm.ac.in")
    paradox_id = f"BT{rand}"
    doc = {
        "paradox_id": paradox_id,
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": "technicals",
        "designation": "Fest Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    doc.update(fields)
    backend_teams_collection.insert_one(doc)

    login = client.post(
        "/auth/admin/login", json={"email": email, "password": "secure_password"}
    )
    assert login.status_code == 200, login.text
    return paradox_id, {"Authorization": f"Bearer {login.json()['access_token']}"}


def participant(full_name: str) -> tuple[str, dict]:
    """A registered participant with a completed profile. Returns (id, headers)."""
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post(
        "/auth/login", json={"email": email, "password": "secure_password"}
    ).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    client.patch("/profile/complete", json={
        "full_name": full_name, "dob": "2003-05-01", "house": "Ganga",
        "gender": "female", "phone": "9876500011", "mess_preference": "veg",
        "country": "India", "state": "TN", "city": "Chennai", "address": "IITM",
        "program": "DS", "course_stage": "degree",
    }, headers=headers)
    return login["id"], headers


@pytest.fixture(autouse=True)
def clean():
    for collection in (
        system_logs_collection,
        backend_teams_collection,
        participants_collection,
        mess_collection,
    ):
        collection.delete_many({})
    yield
    for collection in (
        system_logs_collection,
        backend_teams_collection,
        participants_collection,
        mess_collection,
    ):
        collection.delete_many({})


def entry(headers: dict, action: str) -> dict:
    """The one entry for `action`, read back through the endpoint."""
    resp = client.get("/audit-logs", params={"action": action}, headers=headers)
    assert resp.status_code == 200, resp.text
    logs = resp.json()
    assert len(logs) == 1, logs
    return logs[0]


def create_mess(headers: dict, mess_id: str = MESS_ID):
    resp = client.post("/mess", json={
        "mess_id": mess_id, "name": "Mess hall 2", "capacity": 300,
        "preference": "veg", "cuisines": ["north"],
    }, headers=headers)
    assert resp.status_code == 200, resp.text


# --------------------------------------------------------------- write time ---

def test_a_staff_action_records_the_actors_name(clean):
    _, headers = staff(name="Priya Raman")
    create_mess(headers)

    log = entry(headers, "CREATE_MESS")
    assert log["actor_name"] == "Priya Raman"
    # The type is recorded because the id alone does not say which collection it
    # belongs to, and the two namespaces are indistinguishable by shape.
    assert log["actor_type"] == "staff"
    assert log["actor_role"] == "super_admin"


def test_a_participant_action_records_their_profile_name(clean):
    _, sa_headers = staff(name="Priya Raman")
    participant_id, p_headers = participant("Arjun Kumar")

    resp = client.post("/hostels/register", headers=p_headers)
    assert resp.status_code == 200, resp.text

    log = entry(sa_headers, "ACCOMMODATION_REGISTER")
    assert log["actor_id"] == participant_id
    assert log["actor_name"] == "Arjun Kumar"
    assert log["actor_type"] == "participant"


def test_the_name_recorded_is_the_name_at_the_time_of_the_action(clean):
    """
    The reason names are denormalised onto the entry rather than joined on read.

    A staff member who is renamed — or who leaves and has their account removed —
    would otherwise take the readability of their own history with them.
    """
    paradox_id, headers = staff(name="Priya Raman")
    create_mess(headers)

    backend_teams_collection.update_one(
        {"paradox_id": paradox_id}, {"$set": {"name": "Priya R. Iyer"}}
    )

    assert entry(headers, "CREATE_MESS")["actor_name"] == "Priya Raman"


def test_a_deleted_actor_keeps_their_name_on_the_record(clean):
    paradox_id, headers = staff(name="Priya Raman")
    create_mess(headers)

    reader_id, reader_headers = staff(name="Second Admin")
    backend_teams_collection.delete_one({"paradox_id": paradox_id})

    log = entry(reader_headers, "CREATE_MESS")
    assert log["actor_id"] == paradox_id
    assert log["actor_name"] == "Priya Raman"


# ---------------------------------------------------------------- read time ---

def test_an_entry_written_before_names_is_resolved_on_read(clean):
    paradox_id, headers = staff(name="Priya Raman")
    # Exactly the shape the writer used to produce: an id and nothing else.
    system_logs_collection.insert_one({
        "timestamp": datetime(2026, 8, 20, 18, 50, 48),
        "actor_id": paradox_id,
        "action": "LEGACY_ACTION",
        "target_id": MESS_ID,
        "details": {},
    })

    assert entry(headers, "LEGACY_ACTION")["actor_name"] == "Priya Raman"


def test_a_staff_account_without_a_name_falls_back_to_its_designation(clean):
    _, reader = staff(name="Reader")
    # `name` absent entirely, as every account created before the field existed is.
    legacy_id = f"BT{random.randint(100000, 999999)}"
    backend_teams_collection.insert_one({
        "paradox_id": legacy_id, "email": "mess.head@ds.study.iitm.ac.in",
        "role": "admin", "department": "mess", "designation": "Mess Head",
    })
    system_logs_collection.insert_one({
        "timestamp": datetime(2026, 8, 20, 18, 0, 0), "actor_id": legacy_id,
        "action": "LEGACY_ACTION", "target_id": MESS_ID, "details": {},
    })

    assert entry(reader, "LEGACY_ACTION")["actor_name"] == "Mess Head"


def test_a_staff_account_with_neither_falls_back_to_the_email(clean):
    """The last rung. A row shows something a human can act on, never a blank."""
    _, reader = staff(name="Reader")
    legacy_id = f"BT{random.randint(100000, 999999)}"
    backend_teams_collection.insert_one({
        "paradox_id": legacy_id, "email": "bt413179@ds.study.iitm.ac.in", "role": "admin",
    })
    system_logs_collection.insert_one({
        "timestamp": datetime(2026, 8, 20, 18, 0, 0), "actor_id": legacy_id,
        "action": "LEGACY_ACTION", "target_id": MESS_ID, "details": {},
    })

    assert entry(reader, "LEGACY_ACTION")["actor_name"] == "bt413179"


def test_an_actor_who_no_longer_exists_anywhere_resolves_to_no_name(clean):
    """
    Null rather than a guess. The client shows the id in that case, so the row is
    never less informative than it was before names existed.
    """
    _, reader = staff(name="Reader")
    system_logs_collection.insert_one({
        "timestamp": datetime(2026, 8, 20, 18, 0, 0), "actor_id": "BT_GONE",
        "action": "LEGACY_ACTION", "target_id": MESS_ID, "details": {},
    })

    log = entry(reader, "LEGACY_ACTION")
    assert log["actor_name"] is None
    assert log["actor_id"] == "BT_GONE"
    assert "BT_GONE" not in log["names"]


def test_a_recorded_name_is_not_overwritten_by_the_current_one(clean):
    """Read-time resolution is a fallback for old rows, not a second source."""
    paradox_id, headers = staff(name="Priya Raman")
    create_mess(headers)
    backend_teams_collection.update_one(
        {"paradox_id": paradox_id}, {"$set": {"name": "Someone Else"}}
    )

    assert entry(headers, "CREATE_MESS")["actor_name"] == "Priya Raman"


# -------------------------------------------------------------- names map ---

def test_the_names_map_covers_the_person_named_inside_details(clean):
    """
    The specific row that prompted this: a team assignment names two people, the
    admin doing it and the member being added, as two similar-looking ids.
    """
    admin_id, headers = staff(name="Priya Raman")
    member_id, _ = participant("Arjun Kumar")
    create_mess(headers)

    resp = client.post(f"/mess/{MESS_ID}/team",
                       json={"user_id": member_id, "role": "volunteer"}, headers=headers)
    assert resp.status_code == 200, resp.text

    log = entry(headers, "ASSIGN_MESS_TEAM")
    assert log["names"][admin_id] == "Priya Raman"
    assert log["names"][member_id] == "Arjun Kumar"
    # And the ids themselves are untouched, because the export and the filters
    # still key on them.
    assert log["actor_id"] == admin_id
    assert log["details"] == {"team_user_id": member_id, "role": "volunteer"}


def test_the_names_map_covers_a_target_that_is_a_person(clean):
    """`UPDATE_PARTICIPANT`'s target_id is a participant, not a venue."""
    _, headers = staff(name="Priya Raman")
    subject_id, _ = participant("Arjun Kumar")

    resp = client.patch(f"/participants/{subject_id}",
                        json={"house": "Yamuna"}, headers=headers)
    assert resp.status_code == 200, resp.text

    log = entry(headers, "UPDATE_PARTICIPANT")
    assert log["target_id"] == subject_id
    assert log["names"][subject_id] == "Arjun Kumar"


def test_a_scanned_participant_is_named(clean):
    _, headers = staff(name="Priya Raman")
    subject_id, _ = participant("Arjun Kumar")
    system_logs_collection.insert_one({
        "timestamp": datetime(2026, 8, 20, 18, 0, 0), "actor_id": "BT_GONE",
        "action": "MESS_SCAN", "target_id": MESS_ID,
        "details": {"participant_id": subject_id, "slot": "lunch", "day": 2},
    })

    log = entry(headers, "MESS_SCAN")
    assert log["names"][subject_id] == "Arjun Kumar"
    # The recorded detail is unchanged; the map sits beside it.
    assert log["details"]["participant_id"] == subject_id
    assert log["details"]["slot"] == "lunch"


def test_resolving_names_does_not_cost_a_query_per_row(clean, monkeypatch):
    """
    The guard against the obvious wrong implementation.

    The trail is read a hundred to a thousand rows at a time. Resolving a name per
    row would turn one request into hundreds of round trips, so the endpoint
    collects every id on the page first and looks them up in one pass per
    collection.
    """
    _, headers = staff(name="Priya Raman")

    def reads_for(distinct_actors: int) -> int:
        """Collection reads during one `GET /audit-logs` over that many actors."""
        system_logs_collection.delete_many({"action": "LEGACY_ACTION"})
        for i in range(distinct_actors):
            actor = f"BT_BULK_{i}"
            backend_teams_collection.insert_one({
                "paradox_id": actor, "email": f"bulk{i}@ds.study.iitm.ac.in",
                "name": f"Volunteer {i}", "role": "volunteer",
            })
            system_logs_collection.insert_one({
                "timestamp": datetime(2026, 8, 20, 18, 0, i), "actor_id": actor,
                "action": "LEGACY_ACTION", "target_id": MESS_ID, "details": {},
            })

        reads = {"n": 0}
        for collection in (backend_teams_collection, participants_collection):
            real_find = collection.find

            def counted(*args, _real=real_find, **kwargs):
                reads["n"] += 1
                return _real(*args, **kwargs)

            monkeypatch.setattr(collection, "find", counted)

        resp = client.get("/audit-logs", params={"action": "LEGACY_ACTION"}, headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()) == distinct_actors

        monkeypatch.undo()
        return reads["n"]

    # Asserted as "does not grow with the row count" rather than as an exact
    # number, so the test states the property it cares about and is not coupled to
    # how many reads the auth and permission checks happen to make.
    assert reads_for(5) == reads_for(40)


# ------------------------------------------------------------- timestamps ---

def test_a_timestamp_says_which_zone_it_is_in(clean):
    """
    Entries are stored naive UTC, so the response used to carry
    `2026-08-20T18:50:48` with no offset — which a browser reads as *local* time,
    shifting every displayed time by the reader's own UTC offset.
    """
    _, headers = staff(name="Priya Raman")
    system_logs_collection.insert_one({
        "timestamp": datetime(2026, 8, 20, 18, 50, 48),
        "actor_id": "BT_GONE", "action": "LEGACY_ACTION",
        "target_id": MESS_ID, "details": {},
    })

    assert entry(headers, "LEGACY_ACTION")["timestamp"] == "2026-08-20T18:50:48Z"


def test_every_timestamp_in_the_trail_is_marked(clean):
    _, headers = staff(name="Priya Raman")
    create_mess(headers)
    create_mess(headers, mess_id=f"{MESS_ID}_2")

    logs = client.get("/audit-logs", headers=headers).json()
    assert len(logs) == 2
    assert all(log["timestamp"].endswith("Z") for log in logs)


# ------------------------------------------------------------ regressions ---

def test_the_existing_filters_still_work_alongside_the_names(clean):
    _, headers = staff(name="Priya Raman")
    create_mess(headers)
    create_mess(headers, mess_id=f"{MESS_ID}_2")

    scoped = client.get(
        "/audit-logs", params={"target_id": MESS_ID, "action": "CREATE_MESS"}, headers=headers
    ).json()
    assert len(scoped) == 1
    assert scoped[0]["target_id"] == MESS_ID
    assert scoped[0]["actor_name"] == "Priya Raman"


def test_an_unknown_target_still_returns_an_empty_list(clean):
    """The enrichment loop must not turn "nothing matched" into an error."""
    _, headers = staff(name="Priya Raman")

    resp = client.get("/audit-logs", params={"target_id": "NOPE"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_names_are_still_super_admin_only(clean):
    _, headers = staff(role="staff", name="Not An Admin")

    resp = client.get("/audit-logs", headers=headers)
    assert resp.status_code == 403
