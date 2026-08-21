"""
`/issues` — Story 5.4, report a hostel or mess fault.

This is the only participant-writable free text in the API that another user can
read, so the tests below are mostly about the two boundaries that makes: who may
file (the facility's own residents, and nobody else) and who may read and answer
(that facility's own duty team, plus a Super Admin, and nobody else).

The rest cover the parts a screen depends on being true: that a report comes back
to its author with its status history, that an update appends rather than
overwrites, and that the reporter's phone number reaches the team who has to call
them back but not anybody else.
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
    issues_collection,
    hostel_collection,
    mess_collection,
    participants_collection,
    backend_teams_collection,
    system_logs_collection,
)
import security

client = TestClient(app)


def _participant(room):
    """A registered participant with a completed profile. Returns their context."""
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"}).json()
    token = login["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.patch("/profile/complete", json={
        "full_name": "Anita Rao", "dob": "2003-05-01", "house": "Ganga",
        "gender": "female", "phone": "9876500011", "mess_preference": "veg",
        "country": "India", "state": "TN", "city": "Chennai", "address": "IITM",
        "program": "DS", "course_stage": "degree",
    }, headers=headers)
    return {"id": login["id"], "headers": headers, "room": room}


def _staff(role):
    """A backend team member, signed in. Returns (paradox_id, headers)."""
    rand = random.randint(100000, 999999)
    email = f"bt{rand}@ds.study.iitm.ac.in"
    paradox_id = f"BT{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id,
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": "hostels",
        "designation": "Block Volunteer",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post(
        "/auth/admin/login", json={"email": email, "password": "secure_password"}
    ).json()
    return paradox_id, {"Authorization": f"Bearer {login['access_token']}"}


@pytest.fixture
def world():
    """
    One block and one hall, a resident placed in both, the volunteer on each
    team, a super admin, and an unrelated staffer on no team at all.
    """
    issues_collection.delete_many({})

    block_volunteer, block_headers = _staff(role="volunteer")
    hall_volunteer, hall_headers = _staff(role="volunteer")
    outsider_id, outsider_headers = _staff(role="volunteer")
    _, admin_headers = _staff(role="super_admin")

    hostel_id = f"HSTL_ISS_{random.randint(1000, 9999)}"
    hostel_collection.insert_one({
        "hostel_id": hostel_id,
        "name": "Ganga Block",
        "capacity": 400,
        "gender": "female",
        "coordinator": "Meera Iyer",
        "phone": "9876500099",
        # logging False on purpose: seeing a fault on your own block is not the
        # same permission as working its turnstile.
        "hostel_team": [
            {"user_id": block_volunteer, "role": "volunteer", "name": "Ravi", "logging": False}
        ],
        "created_at": datetime.utcnow(),
    })

    mess_id = f"MESS_ISS_{random.randint(1000, 9999)}"
    hall_oid = mess_collection.insert_one({
        "mess_id": mess_id,
        "name": "Nilgiri Mess",
        "capacity": 400,
        "preference": "veg",
        "cuisines": ["south_indian"],
        "mess_team": [
            {"user_id": hall_volunteer, "role": "volunteer", "name": "Suresh", "logging": True}
        ],
        "created_at": datetime.utcnow(),
    }).inserted_id

    resident = _participant(room="101")
    participants_collection.update_one(
        {"participant_id": resident["id"]},
        {"$set": {
            "accommodation.hostel_id": hostel_id,
            "accommodation.room": "101",
            "accommodation.registered": True,
            "mess.mess_id": hall_oid,
        }},
    )

    return {
        "resident": resident,
        "block_headers": block_headers,
        "block_volunteer": block_volunteer,
        "hall_headers": hall_headers,
        "outsider_id": outsider_id,
        "outsider_headers": outsider_headers,
        "admin_headers": admin_headers,
        "hostel_id": hostel_id,
        "mess_id": mess_id,
    }


def _report(world, **overrides):
    body = {
        "facility_type": "hostel",
        "facility_id": world["hostel_id"],
        "category": "water",
        "subject": "No hot water since morning",
        "body": "The geyser on the second floor has been cold since 6am.",
    }
    body.update(overrides)
    return client.post("/issues", json=body, headers=world["resident"]["headers"])


# --- filing -----------------------------------------------------------------

def test_a_resident_can_file_against_their_own_block(world):
    resp = _report(world)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "open"
    assert payload["issue_id"].startswith("ISS")

    stored = issues_collection.find_one({"issue_id": payload["issue_id"]})
    assert stored["participant_id"] == world["resident"]["id"]
    assert stored["facility_type"] == "hostel"
    assert stored["updates"] == []


def test_a_diner_can_file_against_their_own_hall(world):
    resp = _report(
        world,
        facility_type="mess",
        facility_id=world["mess_id"],
        category="food_quality",
        subject="Sambar was cold at lunch",
    )
    assert resp.status_code == 200
    assert resp.json()["issue_id"]
    assert issues_collection.find_one(
        {"issue_id": resp.json()["issue_id"]}
    )["facility_type"] == "mess"


def test_the_room_defaults_to_the_one_they_are_allotted(world):
    resp = _report(world)
    stored = issues_collection.find_one({"issue_id": resp.json()["issue_id"]})
    assert stored["room"] == "101"


def test_a_stated_room_wins_over_the_allotted_one(world):
    resp = _report(world, room="Common bathroom, 2nd floor")
    stored = issues_collection.find_one({"issue_id": resp.json()["issue_id"]})
    assert stored["room"] == "Common bathroom, 2nd floor"


def test_a_participant_not_placed_in_the_block_is_refused(world):
    stranger = _participant(room="900")
    resp = client.post("/issues", json={
        "facility_type": "hostel",
        "facility_id": world["hostel_id"],
        "category": "water",
        "subject": "Not my block",
        "body": "Filing against somewhere I do not live.",
    }, headers=stranger["headers"])
    assert resp.status_code == 403
    assert resp.json()["detail"] == "You are not allotted to this hostel"
    assert issues_collection.count_documents({}) == 0


def test_a_participant_not_placed_in_the_hall_is_refused(world):
    stranger = _participant(room="900")
    resp = client.post("/issues", json={
        "facility_type": "mess",
        "facility_id": world["mess_id"],
        "category": "hygiene",
        "subject": "Not my hall",
        "body": "Filing against somewhere I do not eat.",
    }, headers=stranger["headers"])
    assert resp.status_code == 403
    assert resp.json()["detail"] == "You are not allotted to this mess"


def test_an_unknown_facility_is_a_404(world):
    resp = _report(world, facility_id="NO_SUCH_BLOCK")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Hostel not found"


def test_a_category_from_the_other_facilitys_list_is_refused(world):
    resp = _report(world, category="food_quality")
    assert resp.status_code == 400
    assert "category must be one of" in resp.json()["detail"]
    assert "water" in resp.json()["detail"]


def test_an_unknown_facility_type_is_refused(world):
    resp = _report(world, facility_type="library")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "facility_type must be 'hostel' or 'mess'"


def test_an_empty_subject_or_body_is_refused_by_the_schema(world):
    assert _report(world, subject="").status_code == 422
    assert _report(world, body="x").status_code == 422


def test_staff_cannot_file_a_report(world):
    resp = client.post("/issues", json={
        "facility_type": "hostel",
        "facility_id": world["hostel_id"],
        "category": "water",
        "subject": "Staff filing",
        "body": "Should be refused at the auth layer.",
    }, headers=world["block_headers"])
    assert resp.status_code == 403
    assert "Participant credentials required" in resp.json()["detail"]


def test_filing_requires_signing_in(world):
    assert client.post("/issues", json={
        "facility_type": "hostel",
        "facility_id": world["hostel_id"],
        "category": "water",
        "subject": "Anonymous",
        "body": "No token at all.",
    }).status_code in (401, 403)


def test_outstanding_reports_are_capped_but_resolving_frees_a_slot(world):
    for i in range(10):
        assert _report(world, subject=f"Fault number {i}").status_code == 200

    blocked = _report(world, subject="One too many")
    assert blocked.status_code == 400
    assert "10 unresolved reports" in blocked.json()["detail"]

    first = issues_collection.find_one({"subject": "Fault number 0"})
    client.patch(
        f"/issues/{first['issue_id']}",
        json={"status": "resolved"},
        headers=world["admin_headers"],
    )
    assert _report(world, subject="Now there is room").status_code == 200


def test_filing_reaches_the_audit_trail(world):
    issue_id = _report(world).json()["issue_id"]
    row = system_logs_collection.find_one(
        {"action": "ISSUE_REPORT", "details.issue_id": issue_id}
    )
    assert row is not None
    assert row["actor_id"] == world["resident"]["id"]
    assert row["target_id"] == world["hostel_id"]


# --- the reporter's own view ------------------------------------------------

def test_a_participant_reads_their_own_reports_newest_first(world):
    _report(world, subject="Older fault")
    _report(world, subject="Newer fault")
    resp = client.get("/issues/mine", headers=world["resident"]["headers"])
    assert resp.status_code == 200
    assert resp.json()["count"] == 2
    assert [i["subject"] for i in resp.json()["issues"]] == ["Newer fault", "Older fault"]


def test_a_participant_sees_only_their_own_reports(world):
    _report(world)
    other = _participant(room="202")
    participants_collection.update_one(
        {"participant_id": other["id"]},
        {"$set": {
            "accommodation.hostel_id": world["hostel_id"],
            "accommodation.room": "202",
        }},
    )
    client.post("/issues", json={
        "facility_type": "hostel",
        "facility_id": world["hostel_id"],
        "category": "noise",
        "subject": "Somebody else's report",
        "body": "Should not appear in the first resident's list.",
    }, headers=other["headers"])

    resp = client.get("/issues/mine", headers=world["resident"]["headers"]).json()
    assert resp["count"] == 1
    assert resp["issues"][0]["subject"] != "Somebody else's report"


def test_the_status_history_reaches_the_reporter_without_naming_the_volunteer(world):
    issue_id = _report(world).json()["issue_id"]
    client.patch(
        f"/issues/{issue_id}",
        json={"status": "in_progress", "note": "Plumber called, arriving at 4pm."},
        headers=world["block_headers"],
    )

    mine = client.get("/issues/mine", headers=world["resident"]["headers"]).json()
    assert mine["issues"][0]["status"] == "in_progress"
    assert len(mine["issues"][0]["updates"]) == 1
    assert mine["issues"][0]["updates"][0]["note"] == "Plumber called, arriving at 4pm."
    assert "by" not in mine["issues"][0]["updates"][0]


def test_a_participant_never_sees_another_reporters_details(world):
    _report(world)
    mine = client.get("/issues/mine", headers=world["resident"]["headers"]).json()
    assert "reporter" not in mine["issues"][0]
    assert "participant_id" not in mine["issues"][0]


# --- the answering team's view ----------------------------------------------

def test_the_blocks_volunteer_sees_reports_for_their_block(world):
    _report(world)
    resp = client.get("/issues", headers=world["block_headers"])
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
    assert resp.json()["issues"][0]["facility_id"] == world["hostel_id"]


def test_the_blocks_volunteer_does_not_see_the_halls_reports(world):
    _report(world, facility_type="mess", facility_id=world["mess_id"], category="hygiene")
    assert client.get("/issues", headers=world["block_headers"]).json()["count"] == 0
    assert client.get("/issues", headers=world["hall_headers"]).json()["count"] == 1


def test_a_staffer_on_no_team_sees_an_empty_list_rather_than_an_error(world):
    _report(world)
    resp = client.get("/issues", headers=world["outsider_headers"])
    assert resp.status_code == 200
    assert resp.json() == {"count": 0, "issues": []}


def test_a_super_admin_sees_both_facilities(world):
    _report(world)
    _report(world, facility_type="mess", facility_id=world["mess_id"], category="service")
    assert client.get("/issues", headers=world["admin_headers"]).json()["count"] == 2


def test_the_answering_team_gets_the_reporters_number(world):
    _report(world)
    row = client.get("/issues", headers=world["block_headers"]).json()["issues"][0]
    assert row["reporter"]["participant_id"] == world["resident"]["id"]
    assert row["reporter"]["name"] == "Anita Rao"
    assert row["reporter"]["phone"] == "9876500011"
    assert row["reporter"]["room"] == "101"


def test_a_participant_cannot_read_the_staff_list(world):
    resp = client.get("/issues", headers=world["resident"]["headers"])
    assert resp.status_code == 403
    assert "Staff credentials required" in resp.json()["detail"]


def test_the_staff_list_filters_by_status_facility_and_type(world):
    open_id = _report(world, subject="Still open").json()["issue_id"]
    done_id = _report(world, subject="Done").json()["issue_id"]
    admin = world["admin_headers"]
    client.patch(f"/issues/{done_id}", json={"status": "resolved"}, headers=admin)

    assert [i["issue_id"] for i in
            client.get("/issues?status=open", headers=admin).json()["issues"]] == [open_id]
    assert [i["issue_id"] for i in
            client.get("/issues?status=resolved", headers=admin).json()["issues"]] == [done_id]
    assert client.get("/issues?facility_type=mess", headers=admin).json()["count"] == 0
    assert client.get(
        f"/issues?facility_id={world['hostel_id']}", headers=admin
    ).json()["count"] == 2


def test_an_unknown_status_filter_is_refused_rather_than_matching_nothing(world):
    resp = client.get("/issues?status=pending", headers=world["admin_headers"])
    assert resp.status_code == 400
    assert "status must be one of" in resp.json()["detail"]


# --- answering --------------------------------------------------------------

def test_the_blocks_volunteer_can_move_a_report_along(world):
    issue_id = _report(world).json()["issue_id"]
    resp = client.patch(
        f"/issues/{issue_id}", json={"status": "in_progress"}, headers=world["block_headers"]
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"
    assert issues_collection.find_one({"issue_id": issue_id})["status"] == "in_progress"


def test_a_note_with_no_status_change_is_a_valid_update(world):
    issue_id = _report(world).json()["issue_id"]
    resp = client.patch(
        f"/issues/{issue_id}",
        json={"note": "Part has been ordered."},
        headers=world["block_headers"],
    )
    assert resp.status_code == 200
    stored = issues_collection.find_one({"issue_id": issue_id})
    assert stored["status"] == "open"
    assert len(stored["updates"]) == 1
    assert stored["updates"][0]["note"] == "Part has been ordered."


def test_updates_append_rather_than_overwrite(world):
    issue_id = _report(world).json()["issue_id"]
    client.patch(
        f"/issues/{issue_id}",
        json={"status": "in_progress", "note": "Looking at it."},
        headers=world["block_headers"],
    )
    client.patch(
        f"/issues/{issue_id}",
        json={"status": "resolved", "note": "Fixed."},
        headers=world["block_headers"],
    )
    stored = issues_collection.find_one({"issue_id": issue_id})
    assert len(stored["updates"]) == 2
    assert [u["note"] for u in stored["updates"]] == ["Looking at it.", "Fixed."]
    assert stored["status"] == "resolved"


def test_an_empty_patch_is_refused(world):
    issue_id = _report(world).json()["issue_id"]
    resp = client.patch(f"/issues/{issue_id}", json={}, headers=world["block_headers"])
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Provide a status, a note, or both"


def test_an_invented_status_is_refused(world):
    issue_id = _report(world).json()["issue_id"]
    resp = client.patch(
        f"/issues/{issue_id}", json={"status": "wontfix"}, headers=world["block_headers"]
    )
    assert resp.status_code == 400
    assert "status must be one of" in resp.json()["detail"]
    assert issues_collection.find_one({"issue_id": issue_id})["status"] == "open"


def test_a_staffer_on_another_facilitys_team_cannot_answer(world):
    issue_id = _report(world).json()["issue_id"]
    resp = client.patch(
        f"/issues/{issue_id}", json={"status": "resolved"}, headers=world["hall_headers"]
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Not authorized to answer for this facility"
    assert issues_collection.find_one({"issue_id": issue_id})["status"] == "open"


def test_the_reporter_cannot_resolve_their_own_report(world):
    issue_id = _report(world).json()["issue_id"]
    resp = client.patch(
        f"/issues/{issue_id}",
        json={"status": "resolved"},
        headers=world["resident"]["headers"],
    )
    assert resp.status_code == 403
    assert issues_collection.find_one({"issue_id": issue_id})["status"] == "open"


def test_an_unknown_issue_is_a_404(world):
    resp = client.patch(
        "/issues/ISS0000000000",
        json={"status": "resolved"},
        headers=world["admin_headers"],
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Issue not found"


def test_updating_reaches_the_audit_trail(world):
    issue_id = _report(world).json()["issue_id"]
    client.patch(
        f"/issues/{issue_id}",
        json={"status": "resolved", "note": "Done."},
        headers=world["block_headers"],
    )
    row = system_logs_collection.find_one(
        {"action": "ISSUE_UPDATE", "details.issue_id": issue_id}
    )
    assert row is not None
    assert row["actor_id"] == world["block_volunteer"]
    assert row["target_id"] == world["hostel_id"]
    assert row["details"]["noted"] is True


def test_no_existing_route_learned_about_issues(world):
    """
    The change is additive, and the two routes closest to it should be able to
    prove that: a hall document and a participant's own hostel read are exactly
    what they were before any report was filed.
    """
    before_hostel = client.get(
        "/hostels/my_hostel", headers=world["resident"]["headers"]
    ).json()
    before_mess = client.get("/mess", headers=world["admin_headers"]).json()

    _report(world)

    assert client.get(
        "/hostels/my_hostel", headers=world["resident"]["headers"]
    ).json() == before_hostel
    assert client.get("/mess", headers=world["admin_headers"]).json() == before_mess
