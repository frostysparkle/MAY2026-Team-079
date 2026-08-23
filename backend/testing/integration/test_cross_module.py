"""
Cross-module consistency: the audit trail as a whole, and figures that are derived in
one place from data written in another.

These are the assertions no single router can make. If `/participants/statistics`
disagrees with the per-entity rosters, or if a mutating route leaves no trace, the
fault is in the seam between modules rather than in either side.
"""
import pytest

import database
from testing.helpers import auth_headers, iso_from_now, make_qr

pytestmark = pytest.mark.integration


def actions():
    return [row["action"] for row in database.system_logs_collection.find({}, {"action": 1})]


# ===========================================================================
# Every mutating route leaves a trace
# ===========================================================================

@pytest.mark.slow
def test_a_full_days_organising_is_recoverable_from_the_trail(
    client, admin, register_participant, make_duty_staff
):
    """
    One sweep across every domain, then a single read of `/audit-logs` that has to
    account for all of it. This is the test that fails when a new mutating route
    ships without instrumentation.
    """
    student = register_participant()

    # Facilities.
    client.post("/mess", json={"mess_id": "MESS1", "name": "Hall", "capacity": 5,
                              "type": "jain"}, headers=admin)
    client.put("/mess/MESS1", json={"capacity": 6}, headers=admin)
    hostel_id = client.post("/hostels", json={"name": "Ganga", "capacity": 2, "gender": "male",
                                             "sharing": 2, "num_rooms": 1},
                            headers=admin).json()["hostel_id"]

    # Staff.
    guard = make_duty_staff(role="other", department="hostels")
    client.post(f"/hostels/{hostel_id}/team",
                json={"user_id": guard["paradox_id"], "role": "guard"}, headers=admin)
    client.put(f"/hostels/{hostel_id}/team/{guard['paradox_id']}/toggle_scan?attendance=true",
               headers=admin)

    # Programme.
    client.post("/workshop-slots", json={"slot_id": "D1S1", "start_time": iso_from_now(60),
                                        "end_time": iso_from_now(120)}, headers=admin)
    workshop_id = client.post("/workshops", json={
        "slot_id": "D1S1", "name": "W", "description": "d", "venue": "v", "capacity": 5,
        "instructions": "i", "registration_start": iso_from_now(-60),
        "registration_end": iso_from_now(60),
    }, headers=admin).json()["workshop_id"]
    event_id = client.post("/events", json={
        "event_type": "technical", "name": "E", "description": "d",
        "team": {"min": 1, "max": 1},
        "registration": {"start_time": iso_from_now(-60), "end_time": iso_from_now(60)},
    }, headers=admin).json()["event_id"]

    # Participant activity.
    client.post(f"/workshops/{workshop_id}/register", headers=student["headers"])
    client.post(f"/events/{event_id}/register", headers=student["headers"])
    client.post("/hostels/register", headers=student["headers"])
    client.post("/hostels/pay", json={"method": "upi"}, headers=student["headers"])
    client.post("/mess/pay", json={"method": "upi"}, headers=student["headers"])
    client.post("/hostels/allocate", headers=admin)
    client.post("/queries", json={"category": "general", "subject": "s", "body": "b"},
                headers=student["headers"])

    # Admin corrections and reads.
    client.patch(f"/participants/{student['participant_id']}", json={"phone": "9111111111"},
                 headers=admin)
    client.get(f"/hostels/{hostel_id}/statistics", headers=admin)

    recorded = set(actions())
    for expected in {
        "CREATE_STAFF", "CREATE_MESS", "UPDATE_MESS", "CREATE_HOSTEL",
        "ASSIGN_HOSTEL_TEAM", "TOGGLE_HOSTEL_SCAN", "CREATE_WORKSHOP_SLOT",
        "CREATE_WORKSHOP", "CREATE_EVENT", "WORKSHOP_REGISTER", "EVENT_REGISTER",
        "ACCOMMODATION_REGISTER", "HOSTEL_PAYMENT", "MESS_PAYMENT",
        "ALLOCATE_HOSTELS", "RAISE_QUERY", "UPDATE_PARTICIPANT",
        "READ_HOSTEL_ROSTER", "PROFILE_UPDATE",
    }:
        assert expected in recorded, f"{expected} left no trace"


@pytest.mark.slow
def test_the_trail_names_the_people_in_it(client, admin, register_participant, founder):
    """
    A row written by a staff member carries their name at the time; a row that
    mentions a participant resolves to theirs. Neither requires the reader to know
    which id namespace they are looking at.
    """
    student = register_participant(full_name="Asha Nair")
    client.patch(f"/participants/{student['participant_id']}", json={"phone": "9111111111"},
                 headers=admin)

    row = next(entry for entry in client.get("/audit-logs", headers=admin).json()
               if entry["action"] == "UPDATE_PARTICIPANT")
    assert row["actor_id"] == founder["paradox_id"]
    assert row["actor_name"] == "Super Admin"
    assert row["actor_type"] == "staff"
    assert row["names"][student["participant_id"]] == "Asha Nair"


@pytest.mark.slow
def test_a_refusal_and_its_cause_are_joinable(client, admin, register_participant,
                                              make_duty_staff):
    """
    The scenario the refusal trail exists for: a volunteer's scanning is revoked,
    they are refused at the counter, and the two events can be tied together.
    """
    client.post("/mess", json={"mess_id": "MESS1", "name": "Hall", "capacity": 5,
                              "type": "jain"}, headers=admin)
    counter = make_duty_staff(role="other", department="mess")
    client.post("/mess/MESS1/team", json={"user_id": counter["paradox_id"], "role": "other"},
                headers=admin)

    from datetime import datetime, timedelta

    start = datetime.utcnow() - timedelta(minutes=5)
    client.put("/mess/MESS1/menu", json={"menu": {"day_1": {"breakfast": {
        "start_time": start.isoformat(),
        "end_time": (start + timedelta(hours=1)).isoformat(),
        "menu": "Idli",
    }}}}, headers=admin)

    client.put(f"/mess/MESS1/team/{counter['paradox_id']}/toggle_scan?logging=false",
               headers=admin)

    diner = register_participant()
    client.post("/mess/register", headers=diner["headers"])
    client.post("/mess/allocate", headers=admin)

    refused = client.post("/mess/MESS1/scan?slot=breakfast&day=1",
                          json=make_qr(diner["document"]), headers=counter["headers"])
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Scanning disabled for you"

    trail = client.get("/audit-logs?target_id=MESS1", headers=admin).json()
    revoked = next(row for row in trail if row["action"] == "TOGGLE_MESS_SCAN")
    denied = next(row for row in trail if row["action"] == "MESS_SCAN_DENIED")

    assert revoked["details"]["scanning_enabled"] is False
    assert revoked["details"]["team_user_id"] == counter["paradox_id"]
    assert denied["details"]["reason"] == "scanning_disabled_for_member"
    assert denied["actor_id"] == counter["paradox_id"]


@pytest.mark.slow
def test_a_participants_own_history_reads_as_one_filterable_sequence(
    client, admin, register_participant
):
    """Requested, paid, allotted — all filed against the same participant id."""
    student = register_participant(gender="male")
    client.post("/hostels", json={"name": "Ganga", "capacity": 1, "gender": "male",
                                 "sharing": 1, "num_rooms": 1}, headers=admin)
    client.post("/hostels/pay", json={"method": "upi"}, headers=student["headers"])
    client.post("/hostels/register", headers=student["headers"])
    client.delete("/hostels/register", headers=student["headers"])

    trail = client.get(f"/audit-logs?target_id={student['participant_id']}",
                       headers=admin).json()
    assert {row["action"] for row in trail} >= {
        "HOSTEL_PAYMENT", "ACCOMMODATION_REGISTER", "ACCOMMODATION_CANCEL", "PROFILE_UPDATE",
    }


@pytest.mark.slow
def test_the_summary_and_the_table_never_disagree(client, admin, register_participant):
    student = register_participant()
    for index in range(3):
        client.post("/queries", json={"category": "general", "subject": f"Q{index}",
                                     "body": "b"}, headers=student["headers"])

    table = client.get("/audit-logs?action=RAISE_QUERY", headers=admin).json()
    summary = client.get("/audit-logs/summary?action=RAISE_QUERY", headers=admin).json()
    assert summary["total"] == len(table) == 3
    assert summary["by_action"] == {"RAISE_QUERY": 3}
    assert summary["actor_ids"] == [student["participant_id"]]


# ===========================================================================
# Derived figures agree with their sources
# ===========================================================================

@pytest.mark.slow
def test_the_dashboard_totals_match_the_per_entity_rosters(
    client, admin, register_participant
):
    """
    `/participants/statistics` counts from the participants collection while the
    per-entity `/statistics` endpoints count from their own side of the link. The two
    must agree, or the dashboard contradicts the roster it links to.
    """
    client.post("/mess", json={"mess_id": "MESS1", "name": "Hall", "capacity": 5,
                              "type": "jain"}, headers=admin)
    hostel_id = client.post("/hostels", json={"name": "Ganga", "capacity": 4, "gender": "male",
                                             "sharing": 2, "num_rooms": 2},
                            headers=admin).json()["hostel_id"]

    seated = [register_participant(gender="male", mess_preference="jain") for _ in range(2)]
    housed_only = register_participant(gender="male")
    for person in seated:
        client.post("/mess/register", headers=person["headers"])
    for person in seated + [housed_only]:
        client.post("/hostels/register", headers=person["headers"])

    client.post("/mess/allocate", headers=admin)
    client.post("/hostels/allocate", headers=admin)

    overview = client.get("/participants/statistics", headers=admin).json()
    mess_roster = client.get("/mess/MESS1/statistics", headers=admin).json()
    hostel_roster = client.get(f"/hostels/{hostel_id}/statistics", headers=admin).json()

    assert overview["total_registered"] == 3
    assert overview["mess_allotted"] == mess_roster["total_allocated"] == 2
    assert overview["hostel_allotted"] == hostel_roster["total_allocated"] == 3
    assert overview["mess_registered"] == 2
    assert overview["hostel_registered"] == 3
    # The invariant the `registered` filter exists to protect.
    assert overview["mess_allotted"] <= overview["mess_registered"]
    assert overview["hostel_allotted"] <= overview["hostel_registered"]
    assert overview["hostel_pending"] == 0


@pytest.mark.slow
def test_the_roster_and_the_statistics_see_the_same_population(
    client, admin, register_participant
):
    for _ in range(3):
        register_participant()
    roster = client.get("/participants", headers=admin).json()
    statistics = client.get("/participants/statistics", headers=admin).json()
    assert roster["count"] == statistics["total_registered"] == 3
    assert statistics["profile_complete"] == 3


@pytest.mark.slow
def test_workshop_counters_agree_with_the_roster_after_a_scan(
    client, admin, register_participant, make_duty_staff
):
    client.post("/workshop-slots", json={"slot_id": "D1S1", "start_time": iso_from_now(-5),
                                        "end_time": iso_from_now(85)}, headers=admin)
    workshop_id = client.post("/workshops", json={
        "slot_id": "D1S1", "name": "W", "description": "d", "venue": "v", "capacity": 5,
        "instructions": "i", "registration_start": iso_from_now(-60),
        "registration_end": iso_from_now(60),
    }, headers=admin).json()["workshop_id"]
    volunteer = make_duty_staff(role="other", department="workshops")
    client.post(f"/workshops/{workshop_id}/volunteers",
                json={"user_id": volunteer["paradox_id"]}, headers=admin)

    people = [register_participant() for _ in range(2)]
    for person in people:
        client.post(f"/workshops/{workshop_id}/register", headers=person["headers"])
    client.post(f"/workshops/{workshop_id}/attendance?scan_type=pre-registered",
                json=make_qr(people[0]["document"]), headers=volunteer["headers"])

    roster = client.get(f"/workshops/{workshop_id}/participation",
                        headers=volunteer["headers"]).json()
    public = next(row for row in client.get("/workshops/public").json()
                  if row["workshop_id"] == workshop_id)

    assert roster["count"] == roster["registration_count"] == public["registration_count"] == 2
    assert roster["attended_count"] == roster["participant_count"] == 1
    assert roster["absent_count"] == 1
    assert public["capacity"] - public["registration_count"] == 3


@pytest.mark.slow
def test_event_capacity_agrees_with_the_participation_roster(
    client, admin, register_participant, make_duty_staff
):
    event_id = client.post("/events", json={
        "event_type": "culturals", "name": "E", "description": "d",
        "team": {"min": 1, "max": 1},
        "registration": {"start_time": iso_from_now(-60), "end_time": iso_from_now(60)},
    }, headers=admin).json()["event_id"]
    head = make_duty_staff(role="other", department="culturals")
    client.post(f"/events/{event_id}/team",
                json={"user_id": head["paradox_id"], "role": "event_head"}, headers=admin)

    people = [register_participant() for _ in range(2)]
    for person in people:
        client.post(f"/events/{event_id}/register", headers=person["headers"])
    client.post(f"/events/{event_id}/scan", json=make_qr(people[0]["document"]),
                headers=head["headers"])

    capacity = client.get(f"/events/{event_id}/capacity",
                          headers=people[0]["headers"]).json()
    roster = client.get(f"/events/{event_id}/participation", headers=head["headers"]).json()

    assert capacity["registered"] == roster["count"] == 2
    assert capacity["attended_today"] == roster["total_daily_scans"] == 1


@pytest.mark.slow
def test_deregistering_is_visible_everywhere_at_once(
    client, admin, register_participant, make_duty_staff
):
    event_id = client.post("/events", json={
        "event_type": "sports", "name": "E", "description": "d",
        "team": {"min": 1, "max": 1},
        "registration": {"start_time": iso_from_now(-60), "end_time": iso_from_now(60)},
    }, headers=admin).json()["event_id"]
    head = make_duty_staff(role="other", department="sports")
    client.post(f"/events/{event_id}/team",
                json={"user_id": head["paradox_id"], "role": "event_head"}, headers=admin)

    student = register_participant()
    client.post(f"/events/{event_id}/register", headers=student["headers"])
    client.delete(f"/events/{event_id}/register", headers=student["headers"])

    assert client.get("/events/my_registrations", headers=student["headers"]).json() == []
    assert client.get(f"/events/{event_id}/capacity",
                      headers=student["headers"]).json()["registered"] == 0
    assert client.get(f"/events/{event_id}/participation",
                      headers=head["headers"]).json()["count"] == 0
    assert client.get("/participants", headers=admin).json()["participants"][0]["event_count"] == 0


@pytest.mark.slow
def test_credentials_never_appear_in_any_staff_facing_response(
    client, admin, register_participant, make_duty_staff
):
    """
    One sweep of every roster and read endpoint a staff member can reach, checking
    that no password hash, RSA key, or embedding vector is anywhere in the output.
    """
    student = register_participant()
    client.post("/mess", json={"mess_id": "MESS1", "name": "Hall", "capacity": 5,
                              "type": "jain"}, headers=admin)
    hostel_id = client.post("/hostels", json={"name": "Ganga", "capacity": 1, "gender": "male",
                                             "sharing": 1, "num_rooms": 1},
                            headers=admin).json()["hostel_id"]
    client.post("/hostels/register", headers=student["headers"])
    client.post("/hostels/allocate", headers=admin)

    reads = [
        "/participants", "/participants/statistics", "/mess/MESS1/statistics",
        f"/hostels/{hostel_id}/statistics", "/audit-logs", "/audit-logs/summary",
        "/mess", "/hostels", "/events", "/workshops", "/issues",
    ]
    for path in reads:
        response = client.get(path, headers=admin)
        assert response.status_code == 200, path
        serialised = str(response.json())
        for secret in ("password_hash", "$2b$", "BEGIN PRIVATE KEY", "qr_secrets"):
            assert secret not in serialised, f"{secret} leaked from {path}"


@pytest.mark.slow
def test_a_participant_facing_response_never_exposes_another_participant(
    client, admin, register_participant
):
    first = register_participant(full_name="First Student")
    second = register_participant(full_name="Second Student")
    client.post("/queries", json={"category": "general", "subject": "s", "body": "b"},
                headers=second["headers"])

    for path in ("/queries/mine", "/issues/mine", "/events/my_registrations",
                 "/workshops/my_registrations", "/mess/my_mess", "/hostels/my_hostel"):
        response = client.get(path, headers=first["headers"])
        assert response.status_code == 200, path
        assert "Second Student" not in str(response.json()), path
        assert second["participant_id"] not in str(response.json()), path
