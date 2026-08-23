"""
End-to-end lifecycle flows, built entirely from HTTP calls with real tokens.

Each test walks one journey the way the people involved would: an organiser sets
something up, a student uses it, a volunteer works the door, and an admin reads the
result back. A unit test proves one branch; these prove the branches join up.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers, iso_from_now, make_qr

pytestmark = pytest.mark.integration


# ===========================================================================
# Signing up and signing in
# ===========================================================================

@pytest.mark.slow
def test_a_student_registers_completes_their_profile_and_changes_their_password(
    client, password
):
    email = "23f200001@ds.study.iitm.ac.in"

    created = client.post("/auth/register", json={"email": email, "password": password})
    assert created.status_code == 200
    assert created.json()["participant_id"] == "DS23F200001"

    login = client.post("/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    # Nothing is filled in yet.
    assert login.json()["full_name"] is None

    profile = client.patch("/profile/complete", json={
        "full_name": "Asha Nair", "dob": "2004-05-01", "house": "Gir", "gender": "female",
        "phone": "9000000001", "country": "India", "state": "TN", "city": "Chennai",
        "address": "1 Test Street", "program": "DS", "course_stage": "diploma",
        "mess_preference": "south_indian__veg",
    }, headers=headers)
    assert profile.status_code == 200

    # The next sign-in returns the completed profile.
    again = client.post("/auth/login", json={"email": email, "password": password}).json()
    assert again["full_name"] == "Asha Nair"
    assert again["house"] == "Gir"

    changed = client.post("/auth/password/change",
                          json={"current_password": password, "new_password": "a-new-password"},
                          headers=headers)
    assert changed.status_code == 200
    assert client.post("/auth/login", json={"email": email, "password": password}).status_code == 401
    assert client.post("/auth/login",
                       json={"email": email, "password": "a-new-password"}).status_code == 200


@pytest.mark.slow
def test_an_organiser_creates_a_staff_account_that_can_then_act(
    client, admin, register_participant, password
):
    """A privileged role must resolve to a registered participant."""
    person = register_participant(email="volunteer@ds.study.iitm.ac.in")

    created = client.post("/backend_teams", json={
        "email": person["email"], "password": password, "role": "volunteer",
        "department": "mess", "designation": "Mess Volunteer",
    }, headers=admin)
    assert created.status_code == 200
    assert created.json()["paradox_id"].startswith("VLME")

    login = client.post("/auth/admin/login",
                        json={"email": person["email"], "password": password})
    assert login.status_code == 200
    assert login.json()["role"] == "volunteer"

    staff_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    # A valid staff token, but no authority: they are not a Super Admin.
    assert client.get("/participants", headers=staff_headers).status_code == 403
    # Their own participant account still works independently.
    assert client.get("/workshops/my_registrations",
                      headers=person["headers"]).status_code == 200


# ===========================================================================
# Workshops
# ===========================================================================

@pytest.mark.slow
def test_the_full_workshop_journey(client, admin, register_participant, make_duty_staff):
    """
    Slot, workshop, volunteer, registration, scan, correction, roster — and then the
    slot is deleted and everything it held goes with it.
    """
    assert client.post("/workshop-slots", json={
        "slot_id": "D1S1", "start_time": iso_from_now(-5), "end_time": iso_from_now(85),
    }, headers=admin).status_code == 200

    workshop_id = client.post("/workshops", json={
        "slot_id": "D1S1", "name": "Intro to ML", "description": "Hands on.",
        "venue": "Lab 1", "capacity": 20, "instructions": "Bring a laptop.",
        "registration_start": iso_from_now(-60), "registration_end": iso_from_now(60),
    }, headers=admin).json()["workshop_id"]

    volunteer = make_duty_staff(role="other", department="workshops", designation="Desk")
    assert client.post(f"/workshops/{workshop_id}/volunteers",
                       json={"user_id": volunteer["paradox_id"]},
                       headers=admin).status_code == 200

    attending = register_participant()
    absent = register_participant()
    for person in (attending, absent):
        assert client.post(f"/workshops/{workshop_id}/register",
                           headers=person["headers"]).status_code == 200

    # The student can read their own booking back.
    mine = client.get("/workshops/my_registrations", headers=attending["headers"]).json()
    assert [row["workshop_id"] for row in mine] == [workshop_id]

    # One is scanned in at the door.
    scanned = client.post(f"/workshops/{workshop_id}/attendance?scan_type=pre-registered",
                          json=make_qr(attending["document"]), headers=volunteer["headers"])
    assert scanned.status_code == 200
    assert scanned.json()["message"] == "Pre-registered attendee marked present"

    # The other turns out to have been there, and is corrected by hand.
    corrected = client.patch(
        f"/workshops/{workshop_id}/participants/{absent['participant_id']}",
        json={"attended": True}, headers=volunteer["headers"],
    )
    assert corrected.status_code == 200

    roster = client.get(f"/workshops/{workshop_id}/participation",
                        headers=volunteer["headers"]).json()
    assert roster["count"] == 2
    assert roster["attended_count"] == 2
    assert roster["registration_count"] == 2

    # A Super Admin can tell the hand-set mark from the scan.
    logs = client.get(f"/workshops/{workshop_id}/logs", headers=admin).json()["logs"]
    assert {row["action"] for row in logs} == {"registration", "attendance",
                                              "attendance_override"}

    # Deleting the slot takes the workshop and both bookings with it.
    deleted = client.delete("/workshop-slots/D1S1", headers=admin)
    assert deleted.json() == {"message": "Workshop slot deleted", "workshops_deleted": 1}
    assert client.get("/workshops/my_registrations",
                      headers=attending["headers"]).json() == []


@pytest.mark.slow
def test_a_walk_in_releases_the_seat_they_held_elsewhere(
    client, admin, register_participant, make_duty_staff
):
    """The cross-workshop seat accounting, driven entirely through HTTP."""
    client.post("/workshop-slots", json={
        "slot_id": "D1S1", "start_time": iso_from_now(-5), "end_time": iso_from_now(85),
    }, headers=admin)
    common = {"slot_id": "D1S1", "description": "d", "venue": "v", "capacity": 20,
              "instructions": "i", "registration_start": iso_from_now(-60),
              "registration_end": iso_from_now(60)}
    booked = client.post("/workshops", json={**common, "name": "Booked"},
                         headers=admin).json()["workshop_id"]
    walked_into = client.post("/workshops", json={**common, "name": "Walked into"},
                              headers=admin).json()["workshop_id"]

    volunteer = make_duty_staff(role="other", department="workshops")
    client.post(f"/workshops/{walked_into}/volunteers",
                json={"user_id": volunteer["paradox_id"]}, headers=admin)

    student = register_participant()
    client.post(f"/workshops/{booked}/register", headers=student["headers"])

    response = client.post(f"/workshops/{walked_into}/attendance?scan_type=on-spot",
                           json=make_qr(student["document"]), headers=volunteer["headers"])
    assert response.status_code == 200

    catalogue = {row["workshop_id"]: row for row in client.get("/workshops/public").json()}
    assert catalogue[booked]["registration_count"] == 0, "the released seat came back"
    assert catalogue[walked_into]["registration_count"] == 1
    # The student now holds exactly one booking, for the room they actually entered.
    mine = client.get("/workshops/my_registrations", headers=student["headers"]).json()
    assert [row["workshop_id"] for row in mine] == [walked_into]


# ===========================================================================
# Events
# ===========================================================================

@pytest.mark.slow
def test_the_full_event_journey(client, admin, register_participant, make_duty_staff):
    """Create, staff, register as a team, scan at the gate, announce, then read back."""
    event_id = client.post("/events", json={
        "event_type": "technical", "name": "Hackathon", "description": "24 hours.",
        "team": {"min": 2, "max": 2},
        "registration": {"start_time": iso_from_now(-60), "end_time": iso_from_now(60)},
        "registration_fields": [{"field_id": "tshirt", "label": "T-shirt size", "type": "text"}],
    }, headers=admin).json()["event_id"]

    head = make_duty_staff(role="other", department="technical", designation="Event Head")
    assert client.post(f"/events/{event_id}/team",
                       json={"user_id": head["paradox_id"], "role": "event_head"},
                       headers=admin).status_code == 200

    leader = register_participant()
    teammate = register_participant()

    # A required field must be answered.
    refused = client.post(f"/events/{event_id}/register",
                          json={"team_name": "Rockets", "registration_data": {}},
                          headers=leader["headers"])
    assert refused.status_code == 422

    created = client.post(f"/events/{event_id}/register",
                          json={"team_name": "Rockets",
                                "registration_data": {"tshirt": "L"}},
                          headers=leader["headers"]).json()
    team_id = created["team_id"]
    assert created["team_role"] == "leader"

    joined = client.post(f"/events/{event_id}/register",
                         json={"team_id": team_id, "registration_data": {"tshirt": "M"}},
                         headers=teammate["headers"])
    assert joined.status_code == 200
    assert joined.json()["team_role"] == "member"

    # A third person cannot squeeze into a team of two.
    third = register_participant()
    assert client.post(f"/events/{event_id}/register",
                       json={"team_id": team_id, "registration_data": {"tshirt": "S"}},
                       headers=third["headers"]).json()["detail"] == "This team is already full"

    assert client.get(f"/events/{event_id}/capacity",
                      headers=leader["headers"]).json()["registered"] == 2

    # The gate admits both, and the head's own tally reflects it.
    for person in (leader, teammate):
        scan = client.post(f"/events/{event_id}/scan", json=make_qr(person["document"]),
                           headers=head["headers"])
        assert scan.status_code == 200
        assert scan.json()["is_participating"] is True
    assert client.get(f"/events/{event_id}/my_daily_scans",
                      headers=head["headers"]).json()["daily_unique_scans"] == 2
    assert client.get(f"/events/{event_id}/capacity",
                      headers=leader["headers"]).json()["attended_today"] == 2

    # The head broadcasts, and registrants can read it.
    assert client.post(f"/events/{event_id}/announcements",
                       json={"message": "Report at 9am", "priority": "high"},
                       headers=head["headers"]).status_code == 200
    announcements = client.get(f"/events/{event_id}/announcements",
                               headers=leader["headers"]).json()
    assert announcements[0]["message"] == "Report at 9am"
    # Somebody who never registered cannot.
    assert client.get(f"/events/{event_id}/announcements",
                      headers=third["headers"]).status_code == 403

    roster = client.get(f"/events/{event_id}/participation", headers=head["headers"]).json()
    # Two, not three: the third person's registration was refused, so they were
    # never recorded against the event at all.
    assert roster["count"] == 2
    assert {row["team_id"] for row in roster["participants"]} == {team_id}
    assert {row["team_role"] for row in roster["participants"]} == {"leader", "member"}


@pytest.mark.slow
def test_solo_registrants_are_allocated_into_teams_by_the_event_head(
    client, admin, register_participant, make_duty_staff
):
    event_id = client.post("/events", json={
        "event_type": "sports", "name": "Relay", "description": "Track.",
        "team": {"min": 2, "max": 2},
        "registration": {"start_time": iso_from_now(-60), "end_time": iso_from_now(60)},
    }, headers=admin).json()["event_id"]

    head = make_duty_staff(role="other", department="sports")
    client.post(f"/events/{event_id}/team",
                json={"user_id": head["paradox_id"], "role": "event_head"}, headers=admin)

    people = [register_participant() for _ in range(4)]
    for person in people:
        assert client.post(f"/events/{event_id}/register",
                           headers=person["headers"]).status_code == 200

    allocated = client.post(f"/events/{event_id}/allocate_teams", headers=head["headers"])
    assert allocated.json() == {"message": "Allocated 2 teams"}

    roster = client.get(f"/events/{event_id}/participation", headers=head["headers"]).json()
    team_ids = {row["team_id"] for row in roster["participants"]}
    assert len(team_ids) == 2
    assert None not in team_ids


# ===========================================================================
# Mess
# ===========================================================================

@pytest.mark.slow
def test_the_full_mess_journey(client, admin, register_participant, make_duty_staff):
    """Hall, menu, allocation, payment, scanning, and the meal figures behind it."""
    assert client.post("/mess", json={"mess_id": "MESS1", "name": "South Hall",
                                     "capacity": 2, "type": "south_indian__veg"},
                       headers=admin).status_code == 200

    counter = make_duty_staff(role="other", department="mess", designation="Counter")
    assert client.post("/mess/MESS1/team",
                       json={"user_id": counter["paradox_id"], "role": "other"},
                       headers=admin).status_code == 200

    # A sitting that is running right now.
    from datetime import datetime, timedelta

    start = datetime.utcnow() - timedelta(minutes=10)
    assert client.put("/mess/MESS1/menu", json={"menu": {"day_1": {
        "breakfast": {"start_time": start.isoformat(),
                      "end_time": (start + timedelta(hours=1)).isoformat(),
                      "menu": "Idli, sambar"},
    }}}, headers=counter["headers"]).status_code == 200

    diner = register_participant(mess_preference="south_indian__veg")
    assert client.post("/mess/register", headers=diner["headers"]).status_code == 200

    paid = client.post("/mess/pay", json={"method": "upi"}, headers=diner["headers"])
    assert paid.json()["amount"] == 1200

    assert client.post("/mess/allocate", headers=admin).json() == \
        {"message": "Allocated 1 participants to messes"}

    mine = client.get("/mess/my_mess", headers=diner["headers"]).json()
    assert mine["allotted_mess"] == "MESS1"
    assert [(s["slot"], s["scanned"]) for s in mine["slots"]] == [("breakfast", False)]

    # Once seated, the diet is locked.
    locked = client.patch("/profile/complete", json={
        "full_name": "Asha", "dob": "2004-01-01", "house": "Bandipur", "gender": "male",
        "phone": "9000000001", "country": "India", "state": "TN", "city": "Chennai",
        "address": "1 Test Street", "program": "DS", "course_stage": "diploma",
        "mess_preference": "jain",
    }, headers=diner["headers"])
    assert locked.status_code == 409

    # And so is the seat: they cannot withdraw the request themselves any more.
    assert client.delete("/mess/register", headers=diner["headers"]).status_code == 400

    admitted = client.post("/mess/MESS1/scan?slot=breakfast&day=1",
                           json=make_qr(diner["document"]), headers=counter["headers"])
    assert admitted.json() == {"message": "Scan successful, entry allowed"}

    # A second swipe is refused, and the meal count still reads one.
    again = client.post("/mess/MESS1/scan?slot=breakfast&day=1",
                        json=make_qr(diner["document"]), headers=counter["headers"])
    assert again.status_code == 400

    after = client.get("/mess/my_mess", headers=diner["headers"]).json()
    assert after["slots"][0]["scanned"] is True

    meals = client.get("/audit-logs/summary", headers=admin).json()["meals"]
    assert meals["meals_served"] == 1
    assert meals["by_slot"]["breakfast"] == 1

    statistics = client.get("/mess/MESS1/statistics", headers=admin).json()
    assert statistics["total_allocated"] == 1

    # Closing the hall releases the diner and clears the scan history.
    assert client.delete("/mess/MESS1", headers=admin).status_code == 200
    assert client.get("/mess/my_mess", headers=diner["headers"]).json()["allotted_mess"] is None


@pytest.mark.slow
def test_diets_are_matched_and_capacity_respected_across_two_halls(
    client, admin, register_participant
):
    client.post("/mess", json={"mess_id": "VEG", "name": "Veg", "capacity": 1,
                              "type": "north_indian__veg"}, headers=admin)
    client.post("/mess", json={"mess_id": "JAIN", "name": "Jain", "capacity": 5,
                              "type": "jain"}, headers=admin)

    vegetarian = register_participant(mess_preference="south_indian__veg")
    overflow = register_participant(mess_preference="north_indian__veg")
    jain = register_participant(mess_preference="jain")
    for person in (vegetarian, overflow, jain):
        client.post("/mess/register", headers=person["headers"])

    assert client.post("/mess/allocate", headers=admin).json() == \
        {"message": "Allocated 2 participants to messes"}

    seated = {person["participant_id"]:
              client.get("/mess/my_mess", headers=person["headers"]).json()["allotted_mess"]
              for person in (vegetarian, overflow, jain)}
    assert seated[jain["participant_id"]] == "JAIN"
    # Exactly one of the two vegetarians got the single veg seat.
    veg_seats = [seated[p["participant_id"]] for p in (vegetarian, overflow)]
    assert sorted(veg_seats, key=lambda value: value or "") == [None, "VEG"]


# ===========================================================================
# Hostels
# ===========================================================================

@pytest.mark.slow
def test_the_full_hostel_journey(client, admin, register_participant, make_duty_staff):
    """Request, allocate, arrive, step out, return, depart for good."""
    hostel_id = client.post("/hostels", json={
        "name": "Ganga", "capacity": 2, "gender": "male", "sharing": 2, "num_rooms": 1,
    }, headers=admin).json()["hostel_id"]

    guard = make_duty_staff(role="other", department="hostels", designation="Gate Guard")
    assert client.post(f"/hostels/{hostel_id}/team",
                       json={"user_id": guard["paradox_id"], "role": "guard"},
                       headers=admin).status_code == 200

    resident = register_participant(gender="male")

    # Before requesting, the two states are distinguishable.
    before = client.get("/hostels/my_hostel", headers=resident["headers"]).json()
    assert before == {"assigned_hostel": None, "room": None, "inside": False, "arrival": None,
                      "departure": None, "registered": False, "volunteers": []}

    assert client.post("/hostels/pay", json={"method": "card"},
                       headers=resident["headers"]).json()["amount"] == 900
    assert client.post("/hostels/register", headers=resident["headers"]).status_code == 200
    assert client.get("/hostels/my_hostel",
                      headers=resident["headers"]).json()["registered"] is True

    assert client.post("/hostels/allocate", headers=admin).json() == \
        {"message": "Allocated 1 participants to hostels"}

    allotted = client.get("/hostels/my_hostel", headers=resident["headers"]).json()
    assert allotted["assigned_hostel"] == hostel_id
    assert allotted["room"] == "101"
    assert allotted["volunteers"][0]["role"] == "guard"

    # Once allotted, they cannot withdraw the request themselves.
    assert client.delete("/hostels/register", headers=resident["headers"]).status_code == 400

    def door(action):
        return client.post(f"/hostels/{hostel_id}/scan?action={action}",
                           json=make_qr(resident["document"]), headers=guard["headers"])

    assert door("entry").json() == {"message": "Scan successful, entry allowed"}
    arrival = client.get("/hostels/my_hostel", headers=resident["headers"]).json()["arrival"]
    assert arrival is not None

    assert door("entry").status_code == 400, "already inside"
    assert door("exit").status_code == 200
    assert door("exit").status_code == 400, "already outside"
    assert door("entry").status_code == 200
    # The original arrival is never overwritten.
    assert client.get("/hostels/my_hostel",
                      headers=resident["headers"]).json()["arrival"] == arrival

    assert door("permanent_exit").status_code == 200
    assert door("entry").json()["detail"] == \
        "Participant has permanently departed and cannot re-enter"

    statistics = client.get(f"/hostels/{hostel_id}/statistics", headers=admin).json()
    assert statistics["total_allocated"] == 1
    assert statistics["currently_inside"] == 0
    assert statistics["current_occupancy"] == 1, "lifetime, not live"

    # Closing the block resets the resident but leaves them wanting a bed.
    assert client.delete(f"/hostels/{hostel_id}", headers=admin).json() == \
        {"message": "Hostel deleted", "participants_reset": 1}
    after = client.get("/hostels/my_hostel", headers=resident["headers"]).json()
    assert after["assigned_hostel"] is None
    assert after["registered"] is True


@pytest.mark.slow
def test_blocks_are_filled_by_gender(client, admin, register_participant):
    male = client.post("/hostels", json={"name": "Ganga", "capacity": 1, "gender": "male",
                                        "sharing": 1, "num_rooms": 1},
                       headers=admin).json()["hostel_id"]
    female = client.post("/hostels", json={"name": "Yamuna", "capacity": 1, "gender": "female",
                                          "sharing": 1, "num_rooms": 1},
                         headers=admin).json()["hostel_id"]

    man = register_participant(gender="male")
    woman = register_participant(gender="female")
    for person in (man, woman):
        client.post("/hostels/register", headers=person["headers"])

    client.post("/hostels/allocate", headers=admin)

    assert client.get("/hostels/my_hostel",
                      headers=man["headers"]).json()["assigned_hostel"] == male
    assert client.get("/hostels/my_hostel",
                      headers=woman["headers"]).json()["assigned_hostel"] == female


# ===========================================================================
# Issues and queries
# ===========================================================================

@pytest.mark.slow
def test_a_resident_reports_a_fault_and_the_block_team_resolves_it(
    client, admin, register_participant, make_duty_staff
):
    hostel_id = client.post("/hostels", json={"name": "Ganga", "capacity": 1, "gender": "male",
                                             "sharing": 1, "num_rooms": 1},
                            headers=admin).json()["hostel_id"]
    guard = make_duty_staff(role="other", department="hostels")
    client.post(f"/hostels/{hostel_id}/team",
                json={"user_id": guard["paradox_id"], "role": "hostel_volunteer"},
                headers=admin)

    resident = register_participant(gender="male")
    client.post("/hostels/register", headers=resident["headers"])
    client.post("/hostels/allocate", headers=admin)

    filed = client.post("/issues", json={
        "facility_type": "hostel", "facility_id": hostel_id, "category": "water",
        "subject": "Tap is broken", "body": "No water since morning.",
    }, headers=resident["headers"])
    assert filed.status_code == 200
    issue_id = filed.json()["issue_id"]

    # The block's own team sees it, with contact details.
    queue = client.get("/issues", headers=guard["headers"]).json()
    assert queue["count"] == 1
    assert queue["issues"][0]["reporter"]["room"] == "101"

    # Staff with no duty see nothing rather than an error.
    stranger = make_duty_staff(role="other", department="hostels")
    assert client.get("/issues", headers=stranger["headers"]).json() == {"count": 0, "issues": []}

    client.patch(f"/issues/{issue_id}", json={"status": "in_progress", "note": "Part ordered"},
                 headers=guard["headers"])
    client.patch(f"/issues/{issue_id}", json={"status": "resolved", "note": "Replaced the tap"},
                 headers=guard["headers"])

    # The reporter follows the whole story, without seeing who wrote each line.
    mine = client.get("/issues/mine", headers=resident["headers"]).json()["issues"][0]
    assert mine["status"] == "resolved"
    assert [update["note"] for update in mine["updates"]] == ["Part ordered", "Replaced the tap"]
    assert all("by" not in update for update in mine["updates"])


@pytest.mark.slow
def test_a_query_is_raised_assigned_answered_and_resolved(
    client, admin, register_participant, make_duty_staff
):
    student = register_participant()
    raised = client.post("/queries", json={
        "category": "general", "subject": "Where do I collect my kit?",
        "body": "Nothing in the schedule says.",
    }, headers=student["headers"])
    assert raised.status_code == 200
    query_id = raised.json()["query_id"]

    resolver = make_duty_staff(role="other", department="uhc", designation="Query Desk")
    # Before joining the roster there is no access at all.
    assert client.get("/queries", headers=resolver["headers"]).status_code == 403
    assert client.post(f"/queries/{query_id}/replies", json={"body": "Hello"},
                       headers=resolver["headers"]).status_code == 403

    assert client.post("/queries/team", json={"user_id": resolver["paradox_id"]},
                       headers=admin).status_code == 200

    queue = client.get("/queries", headers=resolver["headers"]).json()
    assert [row["query_id"] for row in queue] == [query_id]

    # Self-claim, then answer.
    claimed = client.patch(f"/queries/{query_id}",
                           json={"assigned_to": resolver["paradox_id"]},
                           headers=resolver["headers"]).json()
    assert claimed["query"]["status"] == "assigned"

    client.post(f"/queries/{query_id}/replies", json={"body": "Desk 3, from 9am."},
                headers=resolver["headers"])
    client.post(f"/queries/{query_id}/replies", json={"body": "Thanks."},
                headers=student["headers"])
    client.patch(f"/queries/{query_id}", json={"status": "resolved"},
                 headers=resolver["headers"])

    thread = client.get("/queries/mine", headers=student["headers"]).json()[0]
    assert thread["status"] == "resolved"
    assert thread["resolved_at"] is not None
    assert [reply["author_type"] for reply in thread["replies"]] == ["staff", "participant"]

    # Removal from the roster revokes access without unpicking the work.
    client.delete(f"/queries/team/{resolver['paradox_id']}", headers=admin)
    assert client.get("/queries", headers=resolver["headers"]).status_code == 403
    assert client.get("/queries/mine",
                      headers=student["headers"]).json()[0]["assigned_to"] == \
        resolver["paradox_id"]


@pytest.mark.slow
def test_a_query_must_name_a_facility_that_exists(client, admin, register_participant):
    student = register_participant()
    missing = client.post("/queries", json={"category": "hostel", "target_id": "HSTL999",
                                           "subject": "Broken", "body": "Something."},
                          headers=student["headers"])
    assert missing.status_code == 404

    hostel_id = client.post("/hostels", json={"name": "Ganga", "capacity": 1, "gender": "male",
                                             "sharing": 1, "num_rooms": 1},
                            headers=admin).json()["hostel_id"]
    assert client.post("/queries", json={"category": "hostel", "target_id": hostel_id,
                                        "subject": "Broken", "body": "Something."},
                       headers=student["headers"]).status_code == 200
