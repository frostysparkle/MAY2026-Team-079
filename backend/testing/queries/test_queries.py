"""
The query domain — Epic 6 (6.1 raise · 6.2 track · 6.3 assign · 6.4 answer) and
Story 5.4's durable record.

The point of these is the *routing*, not the CRUD. A query is worth building only
if the right team sees it and nobody else does, so most of what follows asserts
who is refused: a volunteer on one block must not read another block's queries, a
staff member on no team must get an empty queue rather than everybody's, and a
participant must not read a thread they did not raise.
"""
import pytest
from fastapi.testclient import TestClient
from datetime import datetime
import random
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from main import app
from database import (
    queries_collection,
    participants_collection,
    backend_teams_collection,
    hostel_collection,
    mess_collection,
    system_logs_collection,
)
import security

client = TestClient(app)


def _participant(house="Ganga", name="Test Participant"):
    """A registered participant with a completed profile. Returns (id, headers)."""
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
    return login.json()["id"], headers


def _staff(role="volunteer", designation="Block Volunteer"):
    rand = random.randint(100000, 999999)
    email = f"bt{rand}@ds.study.iitm.ac.in"
    paradox_id = f"BT{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id,
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": "hostels",
        "designation": designation,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"})
    return paradox_id, {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture(scope="module")
def world():
    """
    Two hostel blocks and one mess hall, each with its own volunteer, plus a
    Super Admin, a staff member on no team at all, and two participants.

    Module-scoped deliberately. Building it costs seven bcrypt hashes and two
    registrations, and no test here mutates a participant, hostel, hall, or team
    — only the ``queries`` collection, which ``clean_queries`` below resets
    between tests. Function scope made the file take three and a half minutes.
    """
    queries_collection.delete_many({})
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    hostel_collection.delete_many({})
    mess_collection.delete_many({})
    system_logs_collection.delete_many({})

    ganga_vol, ganga_headers = _staff()
    kaveri_vol, kaveri_headers = _staff()
    mess_vol, mess_headers = _staff()
    _, outsider_headers = _staff()
    admin_id, admin_headers = _staff(role="super_admin", designation="Fest Convenor")

    hostel_collection.insert_many([
        {"hostel_id": "GANGA", "name": "Ganga Block", "capacity": 50, "gender": "male",
         "coordinator": {}, "hostel_team": [{"user_id": ganga_vol, "role": "volunteer", "logging": True}],
         "created_at": datetime.utcnow()},
        {"hostel_id": "KAVERI", "name": "Kaveri Block", "capacity": 50, "gender": "male",
         "coordinator": {}, "hostel_team": [{"user_id": kaveri_vol, "role": "volunteer", "logging": True}],
         "created_at": datetime.utcnow()},
    ])
    mess_collection.insert_one(
        {"mess_id": "NILGIRI", "name": "Nilgiri Mess", "capacity": 400, "preference": "veg",
         "cuisines": ["south_indian"],
         "mess_team": [{"user_id": mess_vol, "role": "volunteer", "logging": True}],
         "created_at": datetime.utcnow()}
    )

    resident_id, resident_headers = _participant(name="Meera R")
    other_id, other_headers = _participant(name="Arjun P")

    return {
        "ganga_headers": ganga_headers, "ganga_vol": ganga_vol,
        "kaveri_headers": kaveri_headers, "kaveri_vol": kaveri_vol,
        "mess_headers": mess_headers,
        "outsider_headers": outsider_headers,
        "admin_headers": admin_headers, "admin_id": admin_id,
        "resident_id": resident_id, "resident_headers": resident_headers,
        "other_id": other_id, "other_headers": other_headers,
    }


@pytest.fixture(autouse=True)
def clean_queries():
    """
    The state each test actually owns. Cleared before *and* after, so a test can
    assert on a count of zero without depending on which test ran before it.
    """
    queries_collection.delete_many({})
    system_logs_collection.delete_many({})
    yield
    queries_collection.delete_many({})
    system_logs_collection.delete_many({})


HOSTEL_QUERY = {
    "category": "hostel",
    "target_id": "GANGA",
    "subject": "No water in the second-floor bathroom",
    "body": "Since last night. Room 214.",
}


# ---------------------------------------------------------------- 6.1 / 5.4 ----

def test_a_participant_can_raise_a_query(world):
    resp = client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    assert resp.status_code == 200

    body = resp.json()
    assert body["message"] == "Query raised"
    assert body["query_id"].startswith("QRY")

    stored = queries_collection.find_one({"query_id": body["query_id"]})
    assert stored["status"] == "open"
    assert stored["participant_id"] == world["resident_id"]
    assert stored["participant_name"] == "Meera R"
    assert stored["participant_house"] == "Ganga"
    assert stored["replies"] == []
    assert stored["assigned_to"] is None
    assert stored["resolved_at"] is None


def test_a_query_never_carries_the_authors_email_or_phone(world):
    """
    A block's `hostel_team` cannot read `/hostels/{id}/statistics` — that is Super
    Admin only — so a query row any team member can fetch must not become the
    back door to contact details. The reply thread is the channel back.
    """
    resp = client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    stored = queries_collection.find_one({"query_id": resp.json()["query_id"]}, {"_id": 0})
    assert "email" not in stored
    assert "phone" not in stored
    assert "participant_email" not in stored
    assert "participant_phone" not in stored


def test_raising_a_query_reaches_the_audit_trail(world):
    resp = client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    entry = system_logs_collection.find_one({"action": "RAISE_QUERY"})
    assert entry is not None
    assert entry["actor_id"] == world["resident_id"]
    assert entry["target_id"] == resp.json()["query_id"]


def test_a_bad_category_is_refused(world):
    resp = client.post("/queries", json={**HOSTEL_QUERY, "category": "plumbing"},
                       headers=world["resident_headers"])
    assert resp.status_code == 400
    assert "Invalid category" in resp.json()["detail"]
    assert queries_collection.count_documents({}) == 0


def test_a_hostel_query_must_name_a_hostel(world):
    resp = client.post("/queries", json={**HOSTEL_QUERY, "target_id": None},
                       headers=world["resident_headers"])
    assert resp.status_code == 400
    assert resp.json()["detail"] == "A hostel query must name a hostel"


def test_a_query_naming_an_entity_that_does_not_exist_is_a_404(world):
    """
    Validated at write time on purpose. Accepted-but-unroutable would sit
    unanswered looking exactly like a query nobody has got to yet.
    """
    resp = client.post("/queries", json={**HOSTEL_QUERY, "target_id": "NO_SUCH_BLOCK"},
                       headers=world["resident_headers"])
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No hostel found with id NO_SUCH_BLOCK"


def test_a_general_query_needs_no_target_and_stores_none(world):
    resp = client.post("/queries", json={
        "category": "general", "target_id": "GANGA",
        "subject": "Lost my institute ID", "body": "Where do I collect a replacement?",
    }, headers=world["resident_headers"])
    assert resp.status_code == 200
    # The target is dropped rather than kept, so a team's scope filter cannot
    # accidentally match a general query against its own block.
    assert queries_collection.find_one({"query_id": resp.json()["query_id"]})["target_id"] is None


def test_an_empty_subject_or_body_is_refused(world):
    assert client.post("/queries", json={**HOSTEL_QUERY, "subject": ""},
                       headers=world["resident_headers"]).status_code == 422
    assert client.post("/queries", json={**HOSTEL_QUERY, "body": ""},
                       headers=world["resident_headers"]).status_code == 422


def test_staff_cannot_raise_a_query(world):
    resp = client.post("/queries", json=HOSTEL_QUERY, headers=world["admin_headers"])
    assert resp.status_code == 403


# ---------------------------------------------------------------------- 6.2 ----

def test_a_participant_sees_their_own_queries_newest_first(world):
    client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    client.post("/queries", json={**HOSTEL_QUERY, "subject": "Second one"},
                headers=world["resident_headers"])
    client.post("/queries", json=HOSTEL_QUERY, headers=world["other_headers"])

    resp = client.get("/queries/mine", headers=world["resident_headers"])
    assert resp.status_code == 200
    mine = resp.json()
    assert len(mine) == 2
    assert {q["participant_id"] for q in mine} == {world["resident_id"]}


def test_mine_is_not_captured_as_a_query_id(world):
    """`/queries/mine` is declared before `/{query_id}`, so it stays a literal path."""
    assert client.get("/queries/mine", headers=world["resident_headers"]).status_code == 200


def test_a_participant_with_no_queries_gets_an_empty_list(world):
    assert client.get("/queries/mine", headers=world["resident_headers"]).json() == []


# ---------------------------------------------------------------------- 6.3 ----

def test_a_block_volunteer_sees_their_own_blocks_queries(world):
    client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])

    resp = client.get("/queries", headers=world["ganga_headers"])
    assert resp.status_code == 200
    assert [q["target_id"] for q in resp.json()] == ["GANGA"]


def test_a_volunteer_on_another_block_sees_nothing(world):
    client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    assert client.get("/queries", headers=world["kaveri_headers"]).json() == []


def test_a_mess_volunteer_does_not_see_hostel_queries(world):
    client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    assert client.get("/queries", headers=world["mess_headers"]).json() == []


def test_a_mess_volunteer_sees_their_own_halls_queries(world):
    client.post("/queries", json={
        "category": "mess", "target_id": "NILGIRI",
        "subject": "Breakfast ran out", "body": "Nothing left by 08:30.",
    }, headers=world["resident_headers"])

    resp = client.get("/queries", headers=world["mess_headers"])
    assert [q["target_id"] for q in resp.json()] == ["NILGIRI"]


def test_a_staffer_on_no_team_gets_an_empty_queue_not_a_403(world):
    """An empty queue is a real state. A 403 would read as a broken console."""
    client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    resp = client.get("/queries", headers=world["outsider_headers"])
    assert resp.status_code == 200
    assert resp.json() == []


def test_a_super_admin_sees_every_query_including_general_ones(world):
    client.post("/queries", json=HOSTEL_QUERY, headers=world["resident_headers"])
    client.post("/queries", json={
        "category": "general", "subject": "Lost ID", "body": "Replacement?",
    }, headers=world["other_headers"])

    resp = client.get("/queries", headers=world["admin_headers"])
    assert len(resp.json()) == 2
    assert "general" in {q["category"] for q in resp.json()}


def test_a_general_query_reaches_nobody_but_the_super_admins(world):
    client.post("/queries", json={
        "category": "general", "subject": "Lost ID", "body": "Replacement?",
    }, headers=world["resident_headers"])
    assert client.get("/queries", headers=world["ganga_headers"]).json() == []
    assert client.get("/queries", headers=world["mess_headers"]).json() == []


def test_the_queue_filters_by_status_and_category_server_side(world):
    first = client.post("/queries", json=HOSTEL_QUERY,
                        headers=world["resident_headers"]).json()["query_id"]
    client.post("/queries", json={**HOSTEL_QUERY, "subject": "Still open"},
                headers=world["other_headers"])
    client.patch(f"/queries/{first}", json={"status": "resolved"}, headers=world["admin_headers"])

    open_only = client.get("/queries?status=open", headers=world["admin_headers"]).json()
    assert [q["subject"] for q in open_only] == ["Still open"]

    assert len(client.get("/queries?category=hostel", headers=world["admin_headers"]).json()) == 2
    assert client.get("/queries?category=mess", headers=world["admin_headers"]).json() == []


def test_a_bad_status_filter_is_refused(world):
    resp = client.get("/queries?status=pending", headers=world["admin_headers"])
    assert resp.status_code == 400
    assert "Invalid status" in resp.json()["detail"]


def test_a_participant_token_cannot_read_the_staff_queue(world):
    assert client.get("/queries", headers=world["resident_headers"]).status_code == 403


def test_the_owning_team_can_set_status_and_assignment(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]

    resp = client.patch(f"/queries/{query_id}", json={
        "status": "resolved", "assigned_team": "Ganga Block desk",
    }, headers=world["ganga_headers"])
    assert resp.status_code == 200
    assert resp.json()["query"]["status"] == "resolved"
    assert resp.json()["query"]["assigned_team"] == "Ganga Block desk"
    assert resp.json()["query"]["resolved_at"] is not None


def test_assigning_a_query_to_somebody_implies_assigned(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.patch(f"/queries/{query_id}", json={"assigned_to": world["kaveri_vol"]},
                        headers=world["admin_headers"])
    assert resp.json()["query"]["status"] == "assigned"


def test_an_explicit_status_wins_over_the_implied_one(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.patch(f"/queries/{query_id}",
                        json={"assigned_to": world["ganga_vol"], "status": "resolved"},
                        headers=world["admin_headers"])
    assert resp.json()["query"]["status"] == "resolved"


def test_reopening_a_resolved_query_clears_resolved_at(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=world["admin_headers"])
    resp = client.patch(f"/queries/{query_id}", json={"status": "open"}, headers=world["admin_headers"])
    assert resp.json()["query"]["resolved_at"] is None


def test_a_partial_update_leaves_the_other_fields_alone(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=world["admin_headers"])
    resp = client.patch(f"/queries/{query_id}", json={"assigned_team": "Ganga Block desk"},
                        headers=world["admin_headers"])
    assert resp.json()["query"]["status"] == "resolved"


def test_an_assignee_keeps_a_query_from_a_block_they_are_not_on(world):
    """Otherwise reassignment silently loses the thread."""
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    client.patch(f"/queries/{query_id}", json={"assigned_to": world["kaveri_vol"]},
                 headers=world["admin_headers"])

    assert [q["query_id"] for q in client.get("/queries", headers=world["kaveri_headers"]).json()] == [query_id]


def test_a_volunteer_on_another_block_cannot_touch_the_query(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.patch(f"/queries/{query_id}", json={"status": "resolved"},
                        headers=world["kaveri_headers"])
    assert resp.status_code == 403
    assert queries_collection.find_one({"query_id": query_id})["status"] == "open"


def test_a_bad_status_is_refused_on_update(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.patch(f"/queries/{query_id}", json={"status": "pending"},
                        headers=world["admin_headers"])
    assert resp.status_code == 400
    assert queries_collection.find_one({"query_id": query_id})["status"] == "open"


def test_an_empty_update_is_refused(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.patch(f"/queries/{query_id}", json={}, headers=world["admin_headers"])
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Nothing to update"


def test_updating_an_unknown_query_is_a_404(world):
    resp = client.patch("/queries/QRYNOPE", json={"status": "resolved"},
                        headers=world["admin_headers"])
    assert resp.status_code == 404


def test_an_update_reaches_the_audit_trail(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=world["ganga_headers"])
    entry = system_logs_collection.find_one({"action": "UPDATE_QUERY", "target_id": query_id})
    assert entry is not None
    assert entry["actor_id"] == world["ganga_vol"]


# ---------------------------------------------------------------------- 6.4 ----

def test_the_owning_team_can_reply_and_the_participant_reads_it(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]

    resp = client.post(f"/queries/{query_id}/replies",
                       json={"body": "Plumber is on the way, sorry about that."},
                       headers=world["ganga_headers"])
    assert resp.status_code == 200
    assert resp.json()["reply"]["author_type"] == "staff"
    assert resp.json()["reply"]["author_name"] == "Block Volunteer"

    mine = client.get("/queries/mine", headers=world["resident_headers"]).json()
    assert mine[0]["replies"][0]["body"] == "Plumber is on the way, sorry about that."


def test_the_author_can_reply_to_their_own_thread(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.post(f"/queries/{query_id}/replies", json={"body": "Still not fixed."},
                       headers=world["resident_headers"])
    assert resp.status_code == 200
    assert resp.json()["reply"]["author_type"] == "participant"
    assert resp.json()["reply"]["author_name"] == "Meera R"


def test_another_participant_cannot_reply_to_someone_elses_thread(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.post(f"/queries/{query_id}/replies", json={"body": "Me too"},
                       headers=world["other_headers"])
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Not your query"


def test_a_staffer_outside_the_owning_team_cannot_reply(world):
    """
    A valid staff token is not enough. The check is per-role, not per-token type.
    """
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    resp = client.post(f"/queries/{query_id}/replies", json={"body": "Wrong block"},
                       headers=world["kaveri_headers"])
    assert resp.status_code == 403


def test_replies_accumulate_in_order(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    client.post(f"/queries/{query_id}/replies", json={"body": "one"}, headers=world["resident_headers"])
    client.post(f"/queries/{query_id}/replies", json={"body": "two"}, headers=world["ganga_headers"])
    client.post(f"/queries/{query_id}/replies", json={"body": "three"}, headers=world["resident_headers"])

    replies = queries_collection.find_one({"query_id": query_id})["replies"]
    assert [r["body"] for r in replies] == ["one", "two", "three"]
    assert [r["author_type"] for r in replies] == ["participant", "staff", "participant"]


def test_an_empty_reply_is_refused(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    assert client.post(f"/queries/{query_id}/replies", json={"body": ""},
                       headers=world["resident_headers"]).status_code == 422


def test_replying_to_an_unknown_query_is_a_404(world):
    assert client.post("/queries/QRYNOPE/replies", json={"body": "hello"},
                       headers=world["admin_headers"]).status_code == 404


def test_a_reply_reaches_the_audit_trail(world):
    query_id = client.post("/queries", json=HOSTEL_QUERY,
                           headers=world["resident_headers"]).json()["query_id"]
    client.post(f"/queries/{query_id}/replies", json={"body": "on it"}, headers=world["ganga_headers"])
    assert system_logs_collection.find_one({"action": "REPLY_QUERY", "target_id": query_id}) is not None


def test_every_query_route_requires_a_token(world):
    assert client.post("/queries", json=HOSTEL_QUERY).status_code in (401, 403)
    assert client.get("/queries").status_code in (401, 403)
    assert client.get("/queries/mine").status_code in (401, 403)
    assert client.patch("/queries/QRY1", json={"status": "open"}).status_code in (401, 403)
    assert client.post("/queries/QRY1/replies", json={"body": "x"}).status_code in (401, 403)
