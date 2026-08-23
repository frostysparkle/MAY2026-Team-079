"""
Endpoint tests for event operations: team allocation, gate scanning, announcements,
and the resumable announcement stream.

Two rules carry the weight. Scans dedupe on `(event, participant, scanner, day)`
*including the scanner*, so each volunteer keeps an accurate tally of their own gate
while attendance figures count heads. And announcements are an event-head decision,
not something any team member can broadcast.
"""
import asyncio
import json
from datetime import datetime, timedelta

import pytest

import database
from testing import factories
from testing.helpers import auth_headers, corrupt_qr, make_qr

SCANNER = "ADTE2222"


@pytest.fixture()
def head(make_staff):
    return make_staff(paradox_id=SCANNER, email="head@ds.study.iitm.ac.in", role="admin",
                      department="technical", designation="Event Head")


@pytest.fixture()
def member(make_staff):
    return make_staff(paradox_id="OTTE4444", email="crew@ds.study.iitm.ac.in", role="other",
                      department="technical", designation="Crew")


@pytest.fixture()
def event(head):
    doc = factories.event_doc("EVTEC1111")
    doc["event_team"] = [{"user_id": head["paradox_id"], "role": "event_head"}]
    database.event_collection.insert_one(doc)
    return database.event_collection.find_one({"_id": doc["_id"]})


@pytest.fixture()
def team_event(head):
    doc = factories.event_doc("EVTEC1111", team_min=2, team_max=2)
    doc["event_team"] = [{"user_id": head["paradox_id"], "role": "event_head"}]
    database.event_collection.insert_one(doc)
    return database.event_collection.find_one({"_id": doc["_id"]})


def register(event, person, **kwargs):
    database.participants_collection.update_one(
        {"_id": person["_id"]},
        {"$push": {"events": factories.event_registration(event["_id"], **kwargs)}},
    )


def entry_for(person, event):
    document = database.participants_collection.find_one({"_id": person["_id"]})
    return next(e for e in document["events"] if str(e["event_id"]) == str(event["_id"]))


# ===========================================================================
# POST /events/{id}/allocate_teams
# ===========================================================================

def test_only_an_event_head_may_allocate(client, event, member):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": member["paradox_id"], "role": "member"}}},
    )
    response = client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(member))
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Event Heads are authorized to allocate teams"


def test_a_super_admin_who_is_not_the_head_may_not_allocate(client, event, admin_headers):
    assert client.post("/events/EVTEC1111/allocate_teams",
                       headers=admin_headers).status_code == 403


def test_allocating_for_an_unknown_event_is_a_404(client, head):
    assert client.post("/events/EVTEC9999/allocate_teams",
                       headers=auth_headers(head)).status_code == 404


def test_a_solo_event_reports_that_there_is_nothing_to_do(client, event, head):
    response = client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(head))
    assert response.status_code == 200
    assert response.json() == {"message": "Not a team event"}


def test_solo_registrants_are_grouped_into_teams(client, team_event, head, make_participant):
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in") for i in range(1, 5)]
    for person in people:
        register(team_event, person)

    response = client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(head))

    assert response.json() == {"message": "Allocated 2 teams"}
    team_ids = {entry_for(person, team_event)["team_id"] for person in people}
    assert len(team_ids) == 2
    assert all(team_id is not None for team_id in team_ids)


def test_everyone_allocated_becomes_a_member(client, team_event, head, make_participant):
    """Including somebody who had previously formed their own team as leader."""
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in") for i in range(1, 3)]
    for person in people:
        register(team_event, person)

    client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(head))
    assert {entry_for(person, team_event)["team_role"] for person in people} == {"member"}


def test_participants_who_already_have_a_team_are_left_alone(
    client, team_event, head, make_participant
):
    settled = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in")
    register(team_event, settled, team_id="TMTEC999999", team_role="leader")

    client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(head))

    entry = entry_for(settled, team_event)
    assert entry["team_id"] == "TMTEC999999"
    assert entry["team_role"] == "leader"


def test_a_remainder_smaller_than_the_minimum_is_left_unassigned(
    client, team_event, head, make_participant
):
    """
    Three solo registrants with `team.min` of 2 yield one team of two and one
    person left over. Pinned as current behaviour: the leftover is silent in the
    response, and only the batch summary records the shortfall.
    """
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in") for i in range(1, 4)]
    for person in people:
        register(team_event, person)

    response = client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(head))

    assert response.json() == {"message": "Allocated 1 teams"}
    assigned = [p for p in people if entry_for(p, team_event)["team_id"] is not None]
    assert len(assigned) == 2


def test_a_house_versus_house_event_never_mixes_houses(
    client, head, make_participant, monkeypatch
):
    from routers import events as module

    monkeypatch.setattr(module.random, "shuffle", lambda _seq: None)
    doc = factories.event_doc("EVTEC1111", team_min=2, team_max=2, house_vs_house_event=True)
    doc["event_team"] = [{"user_id": SCANNER, "role": "event_head"}]
    database.event_collection.insert_one(doc)
    event = database.event_collection.find_one({"_id": doc["_id"]})

    by_house = {}
    for index, house in enumerate(["Gir", "Gir", "Kanha", "Kanha"], start=1):
        person = make_participant(participant_id=f"DS23F00000{index}",
                                  email=f"p{index}@ds.study.iitm.ac.in",
                                  profile={"house": house})
        register(event, person)
        by_house.setdefault(house, []).append(person)

    client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(head))

    for house, members in by_house.items():
        team_ids = {entry_for(person, event)["team_id"] for person in members}
        assert len(team_ids) == 1, f"{house} was split across teams"
    gir = entry_for(by_house["Gir"][0], event)["team_id"]
    kanha = entry_for(by_house["Kanha"][0], event)["team_id"]
    assert gir != kanha


def test_allocation_is_audited_with_the_count(client, team_event, head, make_participant, audit):
    for index in (1, 2):
        person = make_participant(participant_id=f"DS23F00000{index}",
                                  email=f"p{index}@ds.study.iitm.ac.in")
        register(team_event, person)
    client.post("/events/EVTEC1111/allocate_teams", headers=auth_headers(head))
    assert audit.one("ALLOCATE_EVENT_TEAMS")["details"]["teams_created"] == 1


def test_allocating_with_no_registrants_creates_nothing(client, team_event, head):
    assert client.post("/events/EVTEC1111/allocate_teams",
                       headers=auth_headers(head)).json() == {"message": "Allocated 0 teams"}


# ===========================================================================
# PUT /events/{id}/participant_teams/{participant_id}
# ===========================================================================

def test_an_event_head_can_move_a_participant_between_teams(
    client, team_event, head, make_participant
):
    person = make_participant()
    register(team_event, person, team_id="TM1")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_id": "TM2", "team_role": "leader"}, headers=auth_headers(head),
    )
    assert response.status_code == 200
    entry = entry_for(person, team_event)
    assert entry["team_id"] == "TM2"
    assert entry["team_role"] == "leader"


def test_only_an_event_head_can_move_a_participant(client, event, member, make_participant):
    person = make_participant()
    register(event, person)
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": member["paradox_id"], "role": "member"}}},
    )
    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_id": "TM2"}, headers=auth_headers(member),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == \
        "Only Event Heads are authorized to modify participant teams"


def test_moving_an_unregistered_participant_is_a_404(client, event, head, participant):
    response = client.put(
        f"/events/EVTEC1111/participant_teams/{participant['participant_id']}",
        json={"team_id": "TM2"}, headers=auth_headers(head),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Participant not registered for this event"


def test_an_empty_move_is_refused(client, team_event, head, make_participant):
    """A request naming neither field asked for nothing; it used to null both and
    drop the participant out of their team."""
    person = make_participant()
    register(team_event, person, team_id="TM1", team_role="leader")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={}, headers=auth_headers(head),
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Provide team_id or team_role to update"
    entry = entry_for(person, team_event)
    assert entry["team_id"] == "TM1"
    assert entry["team_role"] == "leader"


def test_an_empty_move_writes_no_success_row(client, team_event, head, make_participant, audit):
    person = make_participant()
    register(team_event, person, team_id="TM1", team_role="leader")
    client.put(f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
               json={}, headers=auth_headers(head))

    audit.none("UPDATE_EVENT_TEAM")
    assert audit.one("UPDATE_EVENT_TEAM_DENIED")["details"]["reason"] == \
        "no_fields_supplied"


def test_a_role_change_alone_leaves_the_team_alone(client, team_event, head, make_participant):
    person = make_participant()
    register(team_event, person, team_id="TM1", team_role="member")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_role": "leader"}, headers=auth_headers(head),
    )
    assert response.status_code == 200
    entry = entry_for(person, team_event)
    assert entry["team_id"] == "TM1"
    assert entry["team_role"] == "leader"


def test_a_move_alone_leaves_the_role_alone(client, team_event, head, make_participant):
    person = make_participant()
    register(team_event, person, team_id="TM1", team_role="leader")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_id": "TM2"}, headers=auth_headers(head),
    )
    assert response.status_code == 200
    entry = entry_for(person, team_event)
    assert entry["team_id"] == "TM2"
    assert entry["team_role"] == "leader"


def test_clearing_a_team_demotes_its_leader(client, team_event, head, make_participant, audit):
    """An explicit null takes them off the team — and nobody holds a leadership
    role over a team they are not on."""
    person = make_participant()
    register(team_event, person, team_id="TM1", team_role="leader")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_id": None}, headers=auth_headers(head),
    )
    assert response.status_code == 200
    entry = entry_for(person, team_event)
    assert entry["team_id"] is None
    assert entry["team_role"] == "member"

    row = audit.one("UPDATE_EVENT_TEAM")
    assert row["details"]["team_cleared"] is True
    assert row["details"]["previous_team_id"] == "TM1"


def test_naming_a_leader_of_no_team_is_refused(client, team_event, head, make_participant):
    person = make_participant()
    register(team_event, person, team_id="TM1", team_role="leader")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_id": None, "team_role": "leader"}, headers=auth_headers(head),
    )
    assert response.status_code == 400
    assert response.json()["detail"] == \
        "A participant with no team cannot hold the team leader role"


@pytest.mark.parametrize("role", ["captain", "Leader", "event_head", ""])
def test_an_invented_role_is_refused(client, team_event, head, make_participant, role):
    """`leader` and `member` are the whole vocabulary — registration writes no
    others, so a hand-move may not introduce one."""
    person = make_participant()
    register(team_event, person, team_id="TM1")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_id": "TM1", "team_role": role}, headers=auth_headers(head),
    )
    assert response.status_code == 422


def test_overfilling_a_team_by_hand_is_refused(client, team_event, head, make_participant):
    """`team.max` is 2 for this event, and two people already hold TM1."""
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in") for i in range(1, 4)]
    for person in people:
        register(team_event, person, team_id="TM1")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{people[2]['participant_id']}",
        json={"team_id": "TM1", "team_role": "member"}, headers=auth_headers(head),
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "This team is already full"


def test_a_full_team_still_admits_the_person_already_on_it(
    client, team_event, head, make_participant
):
    """The ceiling counts everyone *else*, so re-stating a member of a team that is
    exactly full is not an overfill."""
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in") for i in range(1, 3)]
    for person in people:
        register(team_event, person, team_id="TM1")

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{people[1]['participant_id']}",
        json={"team_id": "TM1", "team_role": "leader"}, headers=auth_headers(head),
    )
    assert response.status_code == 200
    assert entry_for(people[1], team_event)["team_role"] == "leader"


def test_a_solo_event_admits_no_teams_by_hand(client, event, head, make_participant):
    """`team.max` of 1 is refused at registration; the same rule holds here."""
    person = make_participant()
    register(event, person)

    response = client.put(
        f"/events/EVTEC1111/participant_teams/{person['participant_id']}",
        json={"team_id": "TM1"}, headers=auth_headers(head),
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "This event does not support team registration"


# ===========================================================================
# POST /events/{id}/scan  and  /my_daily_scans
# ===========================================================================

def scan(client, actor, person, event_id="EVTEC1111"):
    return client.post(f"/events/{event_id}/scan", json=make_qr(person),
                       headers=auth_headers(actor))


@pytest.mark.slow
def test_scanning_a_registrant_reports_them_as_participating(
    client, event, head, make_participant
):
    person = make_participant(profile={"full_name": "Asha Nair"})
    register(event, person)

    response = scan(client, head, person)

    assert response.status_code == 200
    assert response.json() == {"name": "Asha Nair", "email": person["email"],
                               "is_participating": True}


@pytest.mark.slow
def test_a_successful_scan_writes_one_log_row(client, event, head, make_participant):
    person = make_participant()
    register(event, person)
    scan(client, head, person)

    row = database.event_logs_collection.find_one({})
    assert row["event_id"] == str(event["_id"])
    assert row["participant_id"] == person["participant_id"]
    assert row["scanned_by"] == SCANNER
    assert row["day"] == datetime.utcnow().strftime("%Y-%m-%d")


@pytest.mark.slow
def test_scanning_a_non_registrant_answers_200_and_writes_nothing(
    client, event, head, participant
):
    """Pinned as current behaviour: the gate reports the fact rather than refusing."""
    response = scan(client, head, participant)
    assert response.status_code == 200
    assert response.json()["is_participating"] is False
    assert database.event_logs_collection.count_documents({}) == 0


@pytest.mark.slow
def test_the_same_scanner_rescanning_writes_no_second_row(client, event, head, make_participant):
    person = make_participant()
    register(event, person)
    scan(client, head, person)
    scan(client, head, person)
    assert database.event_logs_collection.count_documents({}) == 1


@pytest.mark.slow
def test_two_scanners_write_two_rows_but_one_attendee(
    client, event, head, member, make_participant
):
    """
    The dedupe key includes the scanner so each volunteer's own tally stays
    accurate; attendance figures then have to count heads.
    """
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": member["paradox_id"], "role": "volunteer"}}},
    )
    person = make_participant()
    register(event, person)

    scan(client, head, person)
    scan(client, member, person)

    assert database.event_logs_collection.count_documents({}) == 2
    assert client.get("/events/EVTEC1111/capacity",
                      headers=auth_headers(person)).json()["attended_today"] == 1


def test_a_staff_member_not_on_the_team_cannot_scan(client, event, member, participant):
    response = scan(client, member, participant)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to scan for this event"


def test_a_super_admin_is_not_exempt_from_the_team_requirement(
    client, event, admin_headers, participant
):
    response = client.post("/events/EVTEC1111/scan", json=make_qr(participant),
                           headers=admin_headers)
    assert response.status_code == 403


def test_scanning_for_an_unknown_event_is_a_404(client, head, participant):
    assert scan(client, head, participant, event_id="EVTEC9999").status_code == 404


@pytest.mark.slow
def test_a_corrupt_code_is_refused_and_recorded(client, event, head, participant, audit):
    response = client.post("/events/EVTEC1111/scan", json=corrupt_qr(participant),
                           headers=auth_headers(head))
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or corrupted QR code"
    assert audit.latest("QR_VERIFY_FAILED")["details"]["scan_domain"] == "event"


@pytest.mark.slow
def test_a_volunteer_sees_only_their_own_daily_tally(
    client, event, head, member, make_participant
):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": member["paradox_id"], "role": "volunteer"}}},
    )
    person = make_participant()
    register(event, person)
    scan(client, head, person)

    assert client.get("/events/EVTEC1111/my_daily_scans",
                      headers=auth_headers(head)).json() == {"daily_unique_scans": 1}
    assert client.get("/events/EVTEC1111/my_daily_scans",
                      headers=auth_headers(member)).json() == {"daily_unique_scans": 0}


def test_yesterdays_scans_are_not_in_todays_tally(client, event, head):
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    database.event_logs_collection.insert_one({
        "event_id": str(event["_id"]), "participant_id": "DS23F000001",
        "scanned_by": SCANNER, "day": yesterday,
    })
    assert client.get("/events/EVTEC1111/my_daily_scans",
                      headers=auth_headers(head)).json()["daily_unique_scans"] == 0


def test_a_non_member_cannot_read_the_tally(client, event, member):
    response = client.get("/events/EVTEC1111/my_daily_scans", headers=auth_headers(member))
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized"


# ===========================================================================
# Announcements
# ===========================================================================

def test_an_event_head_can_publish(client, event, head):
    response = client.post("/events/EVTEC1111/announcements",
                           json={"message": "Report at 9am", "priority": "high"},
                           headers=auth_headers(head))
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Announcement published"
    assert body["announcement"]["message"] == "Report at 9am"
    assert body["announcement"]["priority"] == "high"
    assert body["announcement"]["announcement_id"].startswith("ANN")
    assert body["announcement"]["created_by"] == SCANNER


def test_a_super_admin_can_also_publish(client, event, admin_headers):
    assert client.post("/events/EVTEC1111/announcements", json={"message": "m"},
                       headers=admin_headers).status_code == 200


def test_a_plain_team_member_cannot_broadcast(client, event, member):
    """A volunteer can scan and read participation; broadcasting to every
    registrant is a head-of-event decision."""
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": member["paradox_id"], "role": "member"}}},
    )
    response = client.post("/events/EVTEC1111/announcements", json={"message": "m"},
                           headers=auth_headers(member))
    assert response.status_code == 403
    assert response.json()["detail"] == "Only the Event Head can post announcements for this event"


def test_a_participant_cannot_publish(client, event, participant):
    assert client.post("/events/EVTEC1111/announcements", json={"message": "m"},
                       headers=auth_headers(participant)).status_code == 403


def test_publishing_to_an_unknown_event_is_a_404(client, head):
    assert client.post("/events/EVTEC9999/announcements", json={"message": "m"},
                       headers=auth_headers(head)).status_code == 404


def test_an_empty_message_is_a_422(client, event, head):
    assert client.post("/events/EVTEC1111/announcements", json={"message": ""},
                       headers=auth_headers(head)).status_code == 422


def test_the_announcement_is_appended_to_the_event(client, event, head):
    client.post("/events/EVTEC1111/announcements", json={"message": "First"},
                headers=auth_headers(head))
    client.post("/events/EVTEC1111/announcements", json={"message": "Second"},
                headers=auth_headers(head))
    stored = database.event_collection.find_one({"event_id": "EVTEC1111"})
    assert [a["message"] for a in stored["announcements"]] == ["First", "Second"]


def test_publishing_is_audited(client, event, head, audit):
    client.post("/events/EVTEC1111/announcements", json={"message": "m", "priority": "high"},
                headers=auth_headers(head))
    row = audit.one("CREATE_ANNOUNCEMENT")
    assert row["target_id"] == "EVTEC1111"
    assert row["details"]["priority"] == "high"


def test_a_registered_participant_reads_announcements_newest_first(
    client, event, make_participant
):
    person = make_participant()
    register(event, person)
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"announcements": {"$each": [
            factories.announcement("ANN1", "Older", created_offset_seconds=-60),
            factories.announcement("ANN2", "Newer"),
        ]}}},
    )
    rows = client.get("/events/EVTEC1111/announcements", headers=auth_headers(person)).json()
    assert [row["message"] for row in rows] == ["Newer", "Older"]


def test_an_unregistered_participant_is_refused(client, event, participant):
    response = client.get("/events/EVTEC1111/announcements", headers=auth_headers(participant))
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to read this event's announcements"


def test_the_event_team_and_super_admins_can_read(client, event, head, admin_headers):
    assert client.get("/events/EVTEC1111/announcements",
                      headers=auth_headers(head)).status_code == 200
    assert client.get("/events/EVTEC1111/announcements",
                      headers=admin_headers).status_code == 200


def test_unrelated_staff_cannot_read(client, event, member):
    assert client.get("/events/EVTEC1111/announcements",
                      headers=auth_headers(member)).status_code == 403


def test_reading_announcements_for_an_unknown_event_is_a_404(client, admin_headers):
    assert client.get("/events/EVTEC9999/announcements",
                      headers=admin_headers).status_code == 404


def test_a_published_announcement_is_immediately_readable(client, event, make_participant, head):
    person = make_participant()
    register(event, person)
    client.post("/events/EVTEC1111/announcements", json={"message": "Report at 9am"},
                headers=auth_headers(head))
    rows = client.get("/events/EVTEC1111/announcements", headers=auth_headers(person)).json()
    assert rows[0]["message"] == "Report at 9am"


# ---------------------------------------------------------------------------
# GET /events/{id}/announcements/stream — SSE
# ---------------------------------------------------------------------------

class FakeRequest:
    """A `Request` stand-in that disconnects after a fixed number of polls."""

    def __init__(self, headers=None, disconnect_after=1):
        self.headers = headers or {}
        self._polls = 0
        self._limit = disconnect_after

    async def is_disconnected(self):
        self._polls += 1
        return self._polls > self._limit


@pytest.fixture()
def instant_sleep(monkeypatch):
    real_sleep = asyncio.sleep

    async def no_wait(_seconds):
        await real_sleep(0)

    from routers import events as module

    monkeypatch.setattr(module.asyncio, "sleep", no_wait)


def frames_of(collected):
    return [f for f in collected if f.startswith("id:")]


async def test_the_stream_emits_each_announcement_once(instant_sleep, event):
    from routers import events as module

    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"announcements": factories.announcement("ANN1", "Report at 9am")}},
    )
    collected = [
        frame async for frame in module._announcement_stream(
            "EVTEC1111", event["_id"], FakeRequest(disconnect_after=2)
        )
    ]
    emitted = frames_of(collected)
    assert len(emitted) == 1
    assert "event: announcement" in emitted[0]
    payload = json.loads(emitted[0].split("data: ", 1)[1].strip())
    assert payload["message"] == "Report at 9am"
    assert payload["created_at"].endswith("Z")


async def test_announcements_are_emitted_in_chronological_order(instant_sleep, event):
    from routers import events as module

    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"announcements": {"$each": [
            factories.announcement("ANN2", "Second"),
            factories.announcement("ANN1", "First", created_offset_seconds=-60),
        ]}}},
    )
    collected = [
        frame async for frame in module._announcement_stream(
            "EVTEC1111", event["_id"], FakeRequest(disconnect_after=1)
        )
    ]
    messages = [json.loads(f.split("data: ", 1)[1].strip())["message"] for f in frames_of(collected)]
    assert messages == ["First", "Second"]


async def test_a_reconnecting_client_is_not_replayed_history(instant_sleep, event):
    """The standard `Last-Event-ID` contract: seed everything up to and including
    the id the client already holds."""
    from routers import events as module

    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"announcements": {"$each": [
            factories.announcement("ANN1", "Seen", created_offset_seconds=-60),
            factories.announcement("ANN2", "Unseen"),
        ]}}},
    )
    collected = [
        frame async for frame in module._announcement_stream(
            "EVTEC1111", event["_id"],
            FakeRequest(headers={"last-event-id": "ANN1"}, disconnect_after=1),
        )
    ]
    messages = [json.loads(f.split("data: ", 1)[1].strip())["message"] for f in frames_of(collected)]
    assert messages == ["Unseen"]


async def unknown_resume_frames(module, event):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"announcements": factories.announcement("ANN1", "Only")}},
    )
    collected = [
        frame async for frame in module._announcement_stream(
            "EVTEC1111", event["_id"],
            FakeRequest(headers={"last-event-id": "ANN-NOPE"}, disconnect_after=1),
        )
    ]
    return frames_of(collected)


@pytest.mark.xfail(
    strict=False,
    reason="KNOWN DEFECT: the resume loop marks every announcement as seen and only "
           "stops when it reaches the client's Last-Event-ID, so an id that matches "
           "nothing marks the whole history seen and the client is shown nothing at "
           "all. Reachable whenever a client resumes with a stale id — after the "
           "announcement it names has been removed, or against a different event.",
)
async def test_an_unknown_last_event_id_still_delivers_announcements(instant_sleep, event):
    from routers import events as module

    assert len(await unknown_resume_frames(module, event)) == 1


async def test_an_unknown_last_event_id_currently_suppresses_everything(instant_sleep, event):
    """Characterises today's behaviour, paired with the xfail above."""
    from routers import events as module

    assert await unknown_resume_frames(module, event) == []


async def test_the_stream_stops_when_the_client_disconnects(instant_sleep, event):
    from routers import events as module

    collected = [
        frame async for frame in module._announcement_stream(
            "EVTEC1111", event["_id"], FakeRequest(disconnect_after=0)
        )
    ]
    assert collected == []


async def test_a_heartbeat_is_sent_while_nothing_happens(instant_sleep, event):
    from routers import events as module

    collected = [
        frame async for frame in module._announcement_stream(
            "EVTEC1111", event["_id"], FakeRequest(disconnect_after=6)
        )
    ]
    assert ": heartbeat\n\n" in collected


def test_the_stream_refuses_an_unknown_event_before_streaming(client, admin_headers):
    """The 404 and 403 guards run before the StreamingResponse, so both are
    cheaply testable over HTTP."""
    assert client.get("/events/EVTEC9999/announcements/stream",
                      headers=admin_headers).status_code == 404


def test_the_stream_refuses_an_unauthorised_reader(client, event, participant):
    assert client.get("/events/EVTEC1111/announcements/stream",
                      headers=auth_headers(participant)).status_code == 403
