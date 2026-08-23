"""
Endpoint tests for /issues.

Two rules shape everything here. A report is only accepted against the facility the
reporter is actually placed in — and the two halves of that check are asymmetric,
because `accommodation.hostel_id` stores a readable id while `mess.mess_id` stores an
ObjectId. And a staff member sees exactly the blocks and halls whose team names them,
with no duty meaning an empty list rather than a refusal.
"""
import pytest

import database
from routers.issues import MAX_OPEN_PER_FACILITY
from testing import factories
from testing.helpers import auth_headers

DUTY = "OTHO1111"


@pytest.fixture()
def hostel():
    doc = factories.hostel_doc("HSTL111", hostel_team=[factories.hostel_team_member(DUTY)])
    database.hostel_collection.insert_one(doc)
    return database.hostel_collection.find_one({"_id": doc["_id"]})


@pytest.fixture()
def mess():
    doc = factories.mess_doc("MESS1", mess_team=[factories.mess_team_member(DUTY)])
    database.mess_collection.insert_one(doc)
    return database.mess_collection.find_one({"_id": doc["_id"]})


@pytest.fixture()
def duty_staff(make_staff):
    return make_staff(paradox_id=DUTY, email="block.desk@ds.study.iitm.ac.in", role="other",
                      department="hostels", designation="Block Desk")


@pytest.fixture()
def resident(hostel, make_participant):
    return make_participant(profile={"full_name": "Asha", "phone": "9000000001"},
                            accommodation={"registered": True, "hostel_id": "HSTL111",
                                           "room": "101"})


@pytest.fixture()
def diner(mess, make_participant):
    """`mess.mess_id` must hold the hall's ObjectId, not its readable id."""
    return make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
                            mess={"registered": True, "mess_id": mess["_id"]})


HOSTEL_REPORT = {"facility_type": "hostel", "facility_id": "HSTL111", "category": "water",
                 "subject": "Tap is broken", "body": "No water since morning."}
MESS_REPORT = {"facility_type": "mess", "facility_id": "MESS1", "category": "food_quality",
               "subject": "Cold food", "body": "The dal was cold at lunch."}


def report(client, person, **overrides):
    response = client.post("/issues", json={**HOSTEL_REPORT, **overrides},
                           headers=auth_headers(person))
    assert response.status_code == 200, response.json()
    return response.json()["issue_id"]


# ===========================================================================
# POST /issues
# ===========================================================================

def test_a_resident_can_report_a_fault_in_their_own_block(client, resident):
    response = client.post("/issues", json=HOSTEL_REPORT, headers=auth_headers(resident))
    assert response.status_code == 200
    body = response.json()
    assert body["issue_id"].startswith("ISS")
    assert body["status"] == "open"


def test_a_diner_can_report_a_fault_in_their_own_hall(client, diner):
    assert client.post("/issues", json=MESS_REPORT,
                       headers=auth_headers(diner)).status_code == 200


def test_the_room_defaults_to_the_one_they_are_allotted(client, resident):
    """So the common case needs no typing, and the duty team has somewhere to go
    even on a report filed in a hurry."""
    issue_id = report(client, resident)
    assert database.issues_collection.find_one({"issue_id": issue_id})["room"] == "101"


def test_an_explicit_room_wins(client, resident):
    issue_id = report(client, resident, room=" 205 ")
    assert database.issues_collection.find_one({"issue_id": issue_id})["room"] == "205"


def test_reporting_against_a_block_you_do_not_live_in_is_a_403(client, hostel, make_participant):
    outsider = make_participant(accommodation={"registered": True, "hostel_id": "HSTL999"})
    response = client.post("/issues", json=HOSTEL_REPORT, headers=auth_headers(outsider))
    assert response.status_code == 403
    assert response.json()["detail"] == "You are not allotted to this hostel"


def test_reporting_against_a_hall_you_do_not_eat_in_is_a_403(client, mess, make_participant):
    outsider = make_participant(mess={"registered": True, "mess_id": None})
    response = client.post("/issues", json=MESS_REPORT, headers=auth_headers(outsider))
    assert response.status_code == 403
    assert response.json()["detail"] == "You are not allotted to this mess"


def test_an_unallocated_participant_cannot_report(client, hostel, participant):
    assert client.post("/issues", json=HOSTEL_REPORT,
                       headers=auth_headers(participant)).status_code == 403


def test_an_unknown_facility_is_a_404(client, resident):
    response = client.post("/issues", json={**HOSTEL_REPORT, "facility_id": "HSTL999"},
                           headers=auth_headers(resident))
    assert response.status_code == 404
    assert response.json()["detail"] == "Hostel not found"


def test_an_unknown_hall_is_a_404_naming_the_type(client, diner):
    response = client.post("/issues", json={**MESS_REPORT, "facility_id": "MESS9"},
                           headers=auth_headers(diner))
    assert response.status_code == 404
    assert response.json()["detail"] == "Mess not found"


@pytest.mark.parametrize("facility_type", ["library", "gym", ""])
def test_an_unknown_facility_type_is_a_400(client, resident, facility_type):
    response = client.post("/issues", json={**HOSTEL_REPORT, "facility_type": facility_type},
                           headers=auth_headers(resident))
    assert response.status_code == 400
    assert response.json()["detail"] == "facility_type must be 'hostel' or 'mess'"


@pytest.mark.parametrize("category", [
    "water", "electricity", "cleanliness", "furniture", "internet", "safety", "noise", "other",
])
def test_every_hostel_category_is_accepted(client, resident, category):
    assert client.post("/issues", json={**HOSTEL_REPORT, "category": category},
                       headers=auth_headers(resident)).status_code == 200


@pytest.mark.parametrize("category", [
    "food_quality", "hygiene", "service", "timing", "dietary", "other",
])
def test_every_mess_category_is_accepted(client, diner, category):
    assert client.post("/issues", json={**MESS_REPORT, "category": category},
                       headers=auth_headers(diner)).status_code == 200


def test_the_two_category_lists_are_not_interchangeable(client, resident, diner):
    """A mess has no broken furniture and a block has no dietary complaint."""
    response = client.post("/issues", json={**HOSTEL_REPORT, "category": "food_quality"},
                           headers=auth_headers(resident))
    assert response.status_code == 400
    assert response.json()["detail"] == (
        "category must be one of: cleanliness, electricity, furniture, internet, "
        "noise, other, safety, water"
    )

    response = client.post("/issues", json={**MESS_REPORT, "category": "furniture"},
                           headers=auth_headers(diner))
    assert response.status_code == 400
    assert "dietary" in response.json()["detail"]


def test_the_category_and_type_are_normalised(client, resident):
    assert client.post("/issues", json={**HOSTEL_REPORT, "facility_type": " HOSTEL ",
                                       "category": " WATER "},
                       headers=auth_headers(resident)).status_code == 200


def test_the_cap_limits_unresolved_reports_per_facility(client, resident):
    """A guard against one participant burying a block's queue under duplicates of
    the same broken shower."""
    for index in range(MAX_OPEN_PER_FACILITY):
        report(client, resident, subject=f"Fault {index}")

    response = client.post("/issues", json=HOSTEL_REPORT, headers=auth_headers(resident))
    assert response.status_code == 400
    assert response.json()["detail"] == (
        f"You already have {MAX_OPEN_PER_FACILITY} unresolved reports for this facility."
        " Wait for one to be resolved before filing another."
    )


def test_resolving_one_frees_a_slot(client, resident, duty_staff, admin_headers):
    ids = [report(client, resident, subject=f"Fault {i}") for i in range(MAX_OPEN_PER_FACILITY)]
    client.patch(f"/issues/{ids[0]}", json={"status": "resolved"}, headers=admin_headers)
    assert client.post("/issues", json=HOSTEL_REPORT,
                       headers=auth_headers(resident)).status_code == 200


def test_the_cap_is_per_facility(client, resident, mess, make_participant):
    """A full hostel queue does not block a mess report."""
    database.participants_collection.update_one(
        {"_id": resident["_id"]}, {"$set": {"mess": {"registered": True,
                                                     "mess_id": mess["_id"]}}}
    )
    for index in range(MAX_OPEN_PER_FACILITY):
        report(client, resident, subject=f"Fault {index}")
    assert client.post("/issues", json=MESS_REPORT,
                       headers=auth_headers(resident)).status_code == 200


@pytest.mark.parametrize("field,value", [
    ("subject", "ab"), ("subject", "x" * 121), ("body", "ab"), ("body", "x" * 2001),
])
def test_length_bounds_are_422(client, resident, field, value):
    assert client.post("/issues", json={**HOSTEL_REPORT, field: value},
                       headers=auth_headers(resident)).status_code == 422


def test_reporting_is_audited_against_the_facility(client, resident, audit):
    issue_id = report(client, resident)
    row = audit.one("ISSUE_REPORT")
    assert row["target_id"] == "HSTL111"
    assert row["details"]["issue_id"] == issue_id
    assert row["details"]["facility_type"] == "hostel"
    assert row["details"]["category"] == "water"


def test_a_staff_token_cannot_report(client, admin_headers, hostel):
    assert client.post("/issues", json=HOSTEL_REPORT, headers=admin_headers).status_code == 403


# ===========================================================================
# GET /issues/mine
# ===========================================================================

def test_a_reporter_sees_their_own_reports_newest_first(client, resident):
    first = report(client, resident, subject="First fault")
    second = report(client, resident, subject="Second fault")
    body = client.get("/issues/mine", headers=auth_headers(resident)).json()
    assert body["count"] == 2
    assert [row["issue_id"] for row in body["issues"]] == [second, first]


def test_mine_shows_nobody_elses_reports(client, resident, hostel, make_participant):
    report(client, resident)
    other = make_participant(participant_id="DS23F000009", email="z@ds.study.iitm.ac.in",
                             accommodation={"registered": True, "hostel_id": "HSTL111"})
    assert client.get("/issues/mine", headers=auth_headers(other)).json()["count"] == 0


def test_a_reporter_sees_the_status_history_but_not_who_wrote_it(
    client, resident, admin_headers
):
    """Which volunteer typed a note is staff bookkeeping; the audit trail keeps it."""
    issue_id = report(client, resident)
    client.patch(f"/issues/{issue_id}", json={"status": "in_progress",
                                             "note": "Part ordered"},
                 headers=admin_headers)

    row = client.get("/issues/mine", headers=auth_headers(resident)).json()["issues"][0]
    assert row["status"] == "in_progress"
    assert row["updates"][0]["note"] == "Part ordered"
    assert "by" not in row["updates"][0]


def test_mine_never_exposes_another_reporters_details(client, resident):
    report(client, resident)
    row = client.get("/issues/mine", headers=auth_headers(resident)).json()["issues"][0]
    assert "reporter" not in row
    assert "participant_id" not in row


# ===========================================================================
# GET /issues — the duty queue
# ===========================================================================

def test_a_super_admin_sees_every_report(client, admin_headers, resident, diner):
    report(client, resident)
    client.post("/issues", json=MESS_REPORT, headers=auth_headers(diner))
    assert client.get("/issues", headers=admin_headers).json()["count"] == 2


def test_duty_staff_see_only_their_own_facilities(
    client, duty_staff, resident, make_participant
):
    report(client, resident)
    # A block this staff member is not on the team of.
    database.hostel_collection.insert_one(factories.hostel_doc("HSTL112"))
    stranger = make_participant(participant_id="DS23F000009", email="z@ds.study.iitm.ac.in",
                                accommodation={"registered": True, "hostel_id": "HSTL112"})
    client.post("/issues", json={**HOSTEL_REPORT, "facility_id": "HSTL112"},
                headers=auth_headers(stranger))

    body = client.get("/issues", headers=auth_headers(duty_staff)).json()
    assert body["count"] == 1
    assert body["issues"][0]["facility_id"] == "HSTL111"


def test_a_staff_member_with_no_duty_gets_an_empty_list_not_a_403(
    client, staff_headers, resident
):
    """Having no duty is not an authorization failure, and a console that errors at
    a volunteer between postings reads as a bug."""
    report(client, resident)
    response = client.get("/issues", headers=staff_headers)
    assert response.status_code == 200
    assert response.json() == {"count": 0, "issues": []}


def test_the_duty_queue_carries_the_reporters_contact_details(
    client, duty_staff, resident
):
    """A team that cannot call the person back cannot resolve anything."""
    report(client, resident)
    row = client.get("/issues", headers=auth_headers(duty_staff)).json()["issues"][0]
    assert row["reporter"]["participant_id"] == resident["participant_id"]
    assert row["reporter"]["name"] == "Asha"
    assert row["reporter"]["phone"] == "9000000001"
    assert row["reporter"]["room"] == "101"


def test_staff_see_who_wrote_each_update(client, duty_staff, admin_headers, resident):
    issue_id = report(client, resident)
    client.patch(f"/issues/{issue_id}", json={"note": "Part ordered"}, headers=admin_headers)
    row = client.get("/issues", headers=auth_headers(duty_staff)).json()["issues"][0]
    assert row["updates"][0]["by"] is not None


def test_the_scoping_is_not_gated_on_the_scanning_flag(client, duty_staff, resident, hostel):
    """Seeing a fault on your own block is not the same permission as working its
    turnstile."""
    report(client, resident)
    database.hostel_collection.update_one(
        {"hostel_id": "HSTL111"}, {"$set": {"hostel_team.0.attendance": False}}
    )
    assert client.get("/issues", headers=auth_headers(duty_staff)).json()["count"] == 1


def test_a_mess_team_member_sees_their_halls_reports(client, mess, diner, make_staff):
    staff = make_staff(paradox_id=DUTY, email="counter@x.com", role="other", department="mess")
    client.post("/issues", json=MESS_REPORT, headers=auth_headers(diner))
    body = client.get("/issues", headers=auth_headers(staff)).json()
    assert body["count"] == 1
    assert body["issues"][0]["facility_type"] == "mess"


@pytest.mark.parametrize("query,expected", [
    ("?status=open", 1), ("?status=resolved", 0),
    ("?facility_type=hostel", 1), ("?facility_type=mess", 0),
    ("?facility_id=HSTL111", 1), ("?facility_id=HSTL999", 0),
])
def test_the_filters_narrow_the_queue(client, admin_headers, resident, query, expected):
    report(client, resident)
    assert client.get(f"/issues{query}", headers=admin_headers).json()["count"] == expected


def test_an_unknown_status_filter_is_a_400(client, admin_headers):
    response = client.get("/issues?status=pending", headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "status must be one of: in_progress, open, resolved"


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN DEFECT: the no-duty early return happens before the status is "
           "validated, so a staff member with no duty and a misspelled status "
           "receives 200 with an empty list while a super admin receives 400. The "
           "same request is valid or invalid depending on who asks.",
)
def test_a_bad_status_is_rejected_regardless_of_duty(client, staff_headers):
    assert client.get("/issues?status=pending", headers=staff_headers).status_code == 400


def test_the_limit_caps_the_page(client, admin_headers, resident):
    for index in range(3):
        report(client, resident, subject=f"Fault {index}")
    assert client.get("/issues?limit=2", headers=admin_headers).json()["count"] == 2


def test_a_participant_cannot_read_the_duty_queue(client, participant):
    assert client.get("/issues", headers=auth_headers(participant)).status_code == 403


def test_mine_is_not_captured_as_an_issue_id(client, resident):
    assert client.get("/issues/mine", headers=auth_headers(resident)).status_code == 200


# ===========================================================================
# PATCH /issues/{issue_id}
# ===========================================================================

def test_duty_staff_can_move_a_report_along(client, duty_staff, resident):
    issue_id = report(client, resident)
    response = client.patch(f"/issues/{issue_id}", json={"status": "in_progress"},
                            headers=auth_headers(duty_staff))
    assert response.status_code == 200
    assert response.json() == {"message": "Issue updated", "issue_id": issue_id,
                               "status": "in_progress"}


def test_a_note_alone_is_valid_and_leaves_the_status_alone(client, duty_staff, resident):
    """"We have ordered the part" is worth saying."""
    issue_id = report(client, resident)
    response = client.patch(f"/issues/{issue_id}", json={"note": "Part ordered"},
                            headers=auth_headers(duty_staff))
    assert response.status_code == 200
    assert response.json()["status"] == "open"
    document = database.issues_collection.find_one({"issue_id": issue_id})
    assert document["status"] == "open"
    assert document["updates"][0]["note"] == "Part ordered"


def test_the_history_is_append_only(client, duty_staff, resident):
    """So a participant sees the story rather than only the latest word."""
    issue_id = report(client, resident)
    client.patch(f"/issues/{issue_id}", json={"status": "in_progress", "note": "Looking"},
                 headers=auth_headers(duty_staff))
    client.patch(f"/issues/{issue_id}", json={"status": "resolved", "note": "Fixed"},
                 headers=auth_headers(duty_staff))

    updates = database.issues_collection.find_one({"issue_id": issue_id})["updates"]
    assert [entry["note"] for entry in updates] == ["Looking", "Fixed"]
    assert [entry["status"] for entry in updates] == ["in_progress", "resolved"]


def test_an_empty_update_is_a_400(client, duty_staff, resident):
    issue_id = report(client, resident)
    response = client.patch(f"/issues/{issue_id}", json={}, headers=auth_headers(duty_staff))
    assert response.status_code == 400
    assert response.json()["detail"] == "Provide a status, a note, or both"


def test_a_whitespace_only_note_alone_is_a_400(client, duty_staff, resident):
    issue_id = report(client, resident)
    assert client.patch(f"/issues/{issue_id}", json={"note": "   "},
                        headers=auth_headers(duty_staff)).status_code == 400


def test_an_unknown_status_is_a_400(client, duty_staff, resident):
    issue_id = report(client, resident)
    response = client.patch(f"/issues/{issue_id}", json={"status": "pending"},
                            headers=auth_headers(duty_staff))
    assert response.status_code == 400
    assert response.json()["detail"] == "status must be one of: in_progress, open, resolved"


def test_an_unknown_issue_is_a_404(client, duty_staff):
    response = client.patch("/issues/ISS-NOPE", json={"status": "open"},
                            headers=auth_headers(duty_staff))
    assert response.status_code == 404
    assert response.json()["detail"] == "Issue not found"


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN DEFECT: the body is validated before the issue is looked up, so a "
           "malformed update against a nonexistent issue reports the body error "
           "rather than the missing issue.",
)
def test_a_missing_issue_is_reported_before_the_body(client, duty_staff):
    assert client.patch("/issues/ISS-NOPE", json={}, headers=auth_headers(duty_staff))\
        .status_code == 404


def test_staff_from_another_facility_cannot_answer(client, resident, make_staff):
    other = make_staff(paradox_id="OTHO9999", email="other@x.com", role="other")
    database.hostel_collection.insert_one(
        factories.hostel_doc("HSTL112", hostel_team=[factories.hostel_team_member("OTHO9999")])
    )
    issue_id = report(client, resident)

    response = client.patch(f"/issues/{issue_id}", json={"status": "resolved"},
                            headers=auth_headers(other))
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to answer for this facility"


def test_a_reporter_cannot_resolve_their_own_report(client, resident):
    """The route is staff-token-only, so the participant has no way in at all."""
    issue_id = report(client, resident)
    assert client.patch(f"/issues/{issue_id}", json={"status": "resolved"},
                        headers=auth_headers(resident)).status_code == 403


def test_a_super_admin_can_answer_for_any_facility(client, admin_headers, resident):
    issue_id = report(client, resident)
    assert client.patch(f"/issues/{issue_id}", json={"status": "resolved"},
                        headers=admin_headers).status_code == 200


def test_an_update_is_audited_against_the_facility(client, duty_staff, resident, audit):
    issue_id = report(client, resident)
    client.patch(f"/issues/{issue_id}", json={"status": "resolved", "note": "Fixed"},
                 headers=auth_headers(duty_staff))
    row = audit.one("ISSUE_UPDATE")
    assert row["target_id"] == "HSTL111"
    assert row["details"]["issue_id"] == issue_id
    assert row["details"]["status"] == "resolved"
    assert row["details"]["noted"] is True


def test_the_reporter_sees_the_resolution(client, duty_staff, resident):
    """End to end: file, answer, read back."""
    issue_id = report(client, resident)
    client.patch(f"/issues/{issue_id}", json={"status": "resolved", "note": "Replaced the tap"},
                 headers=auth_headers(duty_staff))

    row = client.get("/issues/mine", headers=auth_headers(resident)).json()["issues"][0]
    assert row["status"] == "resolved"
    assert row["updates"][-1]["note"] == "Replaced the tap"
