"""
Endpoint tests for /events — 22 routes, organised by concern.

The authorization model is the widest in the API: super admins, event heads, plain
event-team members, UHC staff, department admins, and registered participants each
see a different slice. Every one of those paths is exercised, because the
difference between them is the whole design.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers, corrupt_qr, iso_from_now, make_qr

CREATE = {
    "event_type": "technical",
    "name": "Hackathon",
    "description": "24 hours of building.",
    "team": {"min": 1, "max": 1},
    "registration": {
        "start_time": "2026-06-01T10:00:00Z",
        "end_time": "2026-06-10T10:00:00Z",
    },
}


@pytest.fixture()
def event():
    """An event whose registration window is currently open."""
    doc = factories.event_doc("EVTEC1111")
    database.event_collection.insert_one(doc)
    return database.event_collection.find_one({"_id": doc["_id"]})


@pytest.fixture()
def head(make_staff):
    return make_staff(paradox_id="ADTE2222", email="head@ds.study.iitm.ac.in",
                      role="admin", department="technical", designation="Event Head")


@pytest.fixture()
def event_with_head(event, head):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": head["paradox_id"], "role": "event_head"}}},
    )
    return database.event_collection.find_one({"_id": event["_id"]})


def stored(event_id="EVTEC1111"):
    return database.event_collection.find_one({"event_id": event_id})


def registrations(person):
    return database.participants_collection.find_one({"_id": person["_id"]})["events"]


# ===========================================================================
# Create, read, update, delete
# ===========================================================================

def test_an_event_is_created_with_backend_assigned_ids(client, admin_headers, super_admin):
    payload = {**CREATE, "schedule": [
        {"name": "Round 1", "start_time": "2026-06-13T10:00:00Z",
         "end_time": "2026-06-13T12:00:00Z"},
    ]}
    response = client.post("/events", json=payload, headers=admin_headers)

    assert response.status_code == 200
    assert response.json() == {"message": "Event created", "event_id": "EVTEC1111"}
    document = stored()
    assert document["schedule"][0]["round_id"] == "RNDTEC11111"
    assert document["event_team"] == []
    assert document["announcements"] == []
    assert document["created_by"] == super_admin["_id"]
    assert len(document["embedding"]) == 768


def test_only_super_admins_can_create(client, staff_headers):
    response = client.post("/events", json=CREATE, headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can perform this action"


def test_a_participant_cannot_create(client, participant):
    assert client.post("/events", json=CREATE,
                       headers=auth_headers(participant)).status_code == 403


@pytest.mark.parametrize("payload,reason", [
    ({"event_type": "quidditch"}, "unknown type"),
    ({"team": {"min": 4, "max": 2}}, "min above max"),
    ({"registration": {"start_time": "2026-06-10T10:00:00Z",
                       "end_time": "2026-06-01T10:00:00Z"}}, "inverted window"),
    ({"name": ""}, "blank name"),
])
def test_schema_violations_are_422(client, admin_headers, payload, reason):
    assert client.post("/events", json={**CREATE, **payload},
                       headers=admin_headers).status_code == 422, reason


def test_an_inverted_round_is_a_422(client, admin_headers):
    payload = {**CREATE, "schedule": [
        {"name": "R", "start_time": "2026-06-13T12:00:00Z", "end_time": "2026-06-13T10:00:00Z"},
    ]}
    assert client.post("/events", json=payload, headers=admin_headers).status_code == 422


def test_creation_is_audited(client, admin_headers, audit):
    client.post("/events", json=CREATE, headers=admin_headers)
    row = audit.one("CREATE_EVENT")
    assert row["target_id"] == "EVTEC1111"
    assert row["details"]["event_name"] == "Hackathon"


def test_the_listing_attaches_the_derived_open_state(client, participant, event):
    rows = client.get("/events", headers=auth_headers(participant)).json()
    assert rows[0]["registration"]["is_open"] is True


def test_the_derived_state_is_never_stored(client, participant, event):
    client.get("/events", headers=auth_headers(participant))
    assert "is_open" not in stored()["registration"]


def test_a_closed_window_reads_as_closed(client, participant):
    database.event_collection.insert_one(
        factories.event_doc("EVTEC1111", registration_open=False)
    )
    rows = client.get("/events", headers=auth_headers(participant)).json()
    assert rows[0]["registration"]["is_open"] is False


def test_the_kill_switch_shows_as_closed(client, participant):
    database.event_collection.insert_one(
        factories.event_doc("EVTEC1111", registration_allowed=False)
    )
    rows = client.get("/events", headers=auth_headers(participant)).json()
    assert rows[0]["registration"]["is_open"] is False


def test_the_listing_hides_the_creating_admin(client, participant, event):
    """A raw ObjectId here would make the endpoint 500."""
    assert "created_by" not in client.get("/events", headers=auth_headers(participant)).json()[0]


def test_the_listing_needs_a_token(client):
    assert client.get("/events").status_code in (401, 403)


def test_the_brochure_needs_no_token(client, event):
    response = client.get("/events/public")
    assert response.status_code == 200
    assert response.json()[0]["event_id"] == "EVTEC1111"


def test_the_brochure_hides_staff_and_form_fields(client, event, head):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": head["paradox_id"], "role": "event_head"}},
         "$set": {"registration_fields": [factories.registration_field()],
                  "announcements": [factories.announcement()]}},
    )
    row = client.get("/events/public").json()[0]
    for hidden in ("event_team", "registration_fields", "announcements", "created_by"):
        assert hidden not in row


def test_the_brochure_still_reports_the_open_state(client, event):
    assert client.get("/events/public").json()[0]["registration"]["is_open"] is True


def test_an_event_can_be_edited(client, admin_headers, event):
    response = client.put("/events/EVTEC1111", json={"name": "Renamed"}, headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Event updated successfully"}
    assert stored()["name"] == "Renamed"


def test_editing_an_unknown_event_is_a_404(client, admin_headers):
    response = client.put("/events/EVTEC9999", json={"name": "x"}, headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"


@pytest.mark.xfail(
    strict=False,
    reason="KNOWN DEFECT: the 404 lookup runs before _require_super_admin, so any "
           "valid staff token can distinguish an existing event from a missing one "
           "before being refused. Every sibling route gates authorisation first.",
)
def test_existence_is_not_leaked_to_unauthorised_staff(client, staff_headers, event):
    missing = client.put("/events/EVTEC9999", json={"name": "x"}, headers=staff_headers)
    existing = client.put("/events/EVTEC1111", json={"name": "x"}, headers=staff_headers)
    assert missing.status_code == existing.status_code


def test_the_registration_window_is_merged_not_replaced(client, admin_headers, event):
    """So a request that only flips `allowed` cannot blank the bounds."""
    response = client.put("/events/EVTEC1111", json={"registration": {"allowed": False}},
                          headers=admin_headers)
    assert response.status_code == 200
    registration = stored()["registration"]
    assert registration["allowed"] is False
    assert registration["start_time"] == event["registration"]["start_time"]


def test_an_inverted_merged_window_is_a_422(client, admin_headers, event):
    """Note events answer 422 here where workshops answer 400."""
    response = client.put("/events/EVTEC1111",
                          json={"registration": {"start_time": iso_from_now(600)}},
                          headers=admin_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == "registration.end_time must be after start_time"


def test_an_incomplete_merged_window_is_a_422(client, admin_headers):
    doc = factories.event_doc("EVTEC1111")
    doc["registration"] = {"allowed": True}
    database.event_collection.insert_one(doc)

    response = client.put("/events/EVTEC1111", json={"registration": {"allowed": False}},
                          headers=admin_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == "registration.start_time and end_time are required"


def test_a_supplied_round_id_is_preserved_and_a_missing_one_minted(
    client, admin_headers, event
):
    payload = {"schedule": [
        {"round_id": "RNDTEC99999", "name": "Kept",
         "start_time": iso_from_now(60), "end_time": iso_from_now(120)},
        {"name": "Fresh", "start_time": iso_from_now(180), "end_time": iso_from_now(240)},
    ]}
    client.put("/events/EVTEC1111", json=payload, headers=admin_headers)

    schedule = stored()["schedule"]
    assert schedule[0]["round_id"] == "RNDTEC99999"
    assert schedule[1]["round_id"].startswith("RNDTEC")


def test_a_corrupt_stored_event_type_is_a_422_not_a_500(client, admin_headers, event):
    """
    A document written outside the API can hold an `event_type` no id generator
    recognises — `EventCreateRequest` cannot prevent that. Minting a round id from it
    used to crash; it now names the offending field.
    """
    database.event_collection.update_one(
        {"_id": event["_id"]}, {"$set": {"event_type": "quidditch"}}
    )
    response = client.put("/events/EVTEC1111", json={"schedule": [
        {"name": "Round 1", "start_time": iso_from_now(60), "end_time": iso_from_now(120)},
    ]}, headers=admin_headers)

    assert response.status_code == 422
    assert "quidditch" in response.json()["detail"]


def test_a_corrupt_stored_event_type_is_reported_as_an_integrity_event(
    client, admin_headers, event, caplog
):
    import logging

    database.event_collection.update_one(
        {"_id": event["_id"]}, {"$set": {"event_type": "quidditch"}}
    )
    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        client.put("/events/EVTEC1111", json={"schedule": [
            {"name": "R", "start_time": iso_from_now(60), "end_time": iso_from_now(120)},
        ]}, headers=admin_headers)

    assert any(getattr(record, "reason", None) == "stored_event_type_unknown"
               for record in caplog.records)


def test_a_supplied_round_id_sidesteps_generation_entirely(client, admin_headers, event):
    """No id needs minting, so a corrupt stored type is not consulted."""
    database.event_collection.update_one(
        {"_id": event["_id"]}, {"$set": {"event_type": "quidditch"}}
    )
    response = client.put("/events/EVTEC1111", json={"schedule": [
        {"round_id": "RNDTEC99999", "name": "R", "start_time": iso_from_now(60),
         "end_time": iso_from_now(120)},
    ]}, headers=admin_headers)
    assert response.status_code == 200


def test_registering_a_team_on_a_corrupt_event_is_a_422(client, participant):
    doc = factories.event_doc("EVTEC1111", team_min=2, team_max=3)
    doc["event_type"] = "quidditch"
    database.event_collection.insert_one(doc)

    response = client.post("/events/EVTEC1111/register", json={"team_name": "Rockets"},
                           headers=auth_headers(participant))
    assert response.status_code == 422


def test_a_solo_registration_on_a_corrupt_event_still_works(client, participant):
    """Only team creation mints an id, so a solo sign-up is unaffected."""
    doc = factories.event_doc("EVTEC1111")
    doc["event_type"] = "quidditch"
    database.event_collection.insert_one(doc)
    assert client.post("/events/EVTEC1111/register",
                       headers=auth_headers(participant)).status_code == 200


def test_an_empty_list_overwrites_rather_than_being_ignored(client, admin_headers, event):
    """`[]` is not None, so it is written — easy to mistake for a no-op."""
    client.put("/events/EVTEC1111", json={"prize_money": []}, headers=admin_headers)
    assert stored()["prize_money"] == []


def test_the_description_is_re_embedded_only_on_a_real_change(
    client, admin_headers, event, monkeypatch
):
    from routers import events as module

    calls = []
    monkeypatch.setattr(module, "generate_embedding",
                        lambda text: calls.append(text) or [0.5] * 768)

    client.put("/events/EVTEC1111", json={"description": event["description"]},
               headers=admin_headers)
    assert calls == []
    client.put("/events/EVTEC1111", json={"description": "Something else"},
               headers=admin_headers)
    assert calls == ["Something else"]


def test_an_edit_is_audited_with_field_names(client, admin_headers, event, audit):
    client.put("/events/EVTEC1111", json={"name": "Renamed"}, headers=admin_headers)
    assert "name" in audit.one("UPDATE_EVENT")["details"]["fields_updated"]


def test_deleting_an_event_removes_it_and_its_registrations(
    client, admin_headers, event, make_participant
):
    person = make_participant(events=[factories.event_registration(event["_id"])])
    response = client.delete("/events/EVTEC1111", headers=admin_headers)

    assert response.status_code == 200
    assert stored() is None
    assert registrations(person) == []


def test_only_super_admins_can_delete(client, staff_headers, event):
    assert client.delete("/events/EVTEC1111", headers=staff_headers).status_code == 403


@pytest.mark.xfail(
    strict=False,
    reason="KNOWN DEFECT: deleting an event that does not exist returns 200 'Event "
           "deleted' and audits a deletion that never happened, so a client cannot "
           "tell a real deletion from a typo'd id.",
)
def test_deleting_an_unknown_event_is_a_404(client, admin_headers):
    assert client.delete("/events/EVTEC9999", headers=admin_headers).status_code == 404


# ===========================================================================
# Team management
# ===========================================================================

def test_a_staff_member_is_added_to_the_team(client, admin_headers, event, head):
    response = client.post("/events/EVTEC1111/team",
                           json={"user_id": head["paradox_id"], "role": "event_head"},
                           headers=admin_headers)
    assert response.status_code == 200
    assert stored()["event_team"] == [{"user_id": head["paradox_id"], "role": "event_head"}]


def test_the_user_must_be_an_existing_staff_account(client, admin_headers, event):
    """An id nobody holds would grant scanning and broadcasting to nothing."""
    response = client.post("/events/EVTEC1111/team",
                           json={"user_id": "GHOST", "role": "member"}, headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "user_id must reference an existing backend_teams member"


def test_adding_the_same_person_twice_is_a_409(client, admin_headers, event_with_head, head):
    response = client.post("/events/EVTEC1111/team",
                           json={"user_id": head["paradox_id"], "role": "member"},
                           headers=admin_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == \
        "Already on this event's team; use PATCH to change their role"


def test_one_person_may_sit_on_only_one_events_team(
    client, admin_headers, event_with_head, head
):
    database.event_collection.insert_one(factories.event_doc("EVTEC1112"))
    response = client.post("/events/EVTEC1112/team",
                           json={"user_id": head["paradox_id"], "role": "member"},
                           headers=admin_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "user_id is already on the team of event EVTEC1111; "
        "a person may be on only one event's team"
    )


def test_adding_to_an_unknown_event_is_a_404(client, admin_headers, head):
    response = client.post("/events/EVTEC9999/team",
                           json={"user_id": head["paradox_id"], "role": "member"},
                           headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"


def test_an_unknown_team_role_is_a_422(client, admin_headers, event, head):
    assert client.post("/events/EVTEC1111/team",
                       json={"user_id": head["paradox_id"], "role": "organiser"},
                       headers=admin_headers).status_code == 422


def test_a_role_can_be_changed(client, admin_headers, event_with_head, head):
    response = client.patch(f"/events/EVTEC1111/team/{head['paradox_id']}",
                            json={"role": "volunteer"}, headers=admin_headers)
    assert response.status_code == 200
    assert stored()["event_team"][0]["role"] == "volunteer"


def test_changing_a_non_members_role_is_a_404(client, admin_headers, event):
    response = client.patch("/events/EVTEC1111/team/GHOST", json={"role": "member"},
                            headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "user_id is not on this event's team"


def test_a_member_can_be_removed_and_then_reassigned(
    client, admin_headers, event_with_head, head
):
    """Removal is what frees somebody up for a different event."""
    assert client.delete(f"/events/EVTEC1111/team/{head['paradox_id']}",
                         headers=admin_headers).status_code == 200
    assert stored()["event_team"] == []

    database.event_collection.insert_one(factories.event_doc("EVTEC1112"))
    assert client.post("/events/EVTEC1112/team",
                       json={"user_id": head["paradox_id"], "role": "member"},
                       headers=admin_headers).status_code == 200


def test_removing_a_non_member_is_a_404(client, admin_headers, event):
    assert client.delete("/events/EVTEC1111/team/GHOST",
                         headers=admin_headers).status_code == 404


def test_team_changes_are_audited(client, admin_headers, event, head, audit):
    client.post("/events/EVTEC1111/team",
                json={"user_id": head["paradox_id"], "role": "event_head"},
                headers=admin_headers)
    client.patch(f"/events/EVTEC1111/team/{head['paradox_id']}", json={"role": "member"},
                 headers=admin_headers)
    client.delete(f"/events/EVTEC1111/team/{head['paradox_id']}", headers=admin_headers)

    assert audit.one("ASSIGN_EVENT_TEAM")["details"]["assigned_user"] == head["paradox_id"]
    assert audit.one("UPDATE_EVENT_TEAM_ROLE")["details"]["role"] == "member"
    assert audit.one("REMOVE_EVENT_TEAM_MEMBER")["details"]["team_user_id"] == head["paradox_id"]


# ===========================================================================
# Registration
# ===========================================================================

def test_a_participant_can_register_solo(client, participant, event):
    response = client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    assert response.status_code == 200
    assert response.json() == {"message": "Registered for event successfully.",
                               "team_role": "member"}
    entry = registrations(participant)[0]
    assert entry["event_id"] == event["_id"]
    assert entry["team_id"] is None
    assert entry["registration_data"] == {}


def test_the_body_may_be_omitted_entirely(client, participant, event):
    assert client.post("/events/EVTEC1111/register",
                       headers=auth_headers(participant)).status_code == 200


def test_registering_for_an_unknown_event_is_a_404(client, participant):
    response = client.post("/events/EVTEC9999/register", headers=auth_headers(participant))
    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"


def test_registering_outside_the_window_is_refused(client, participant):
    database.event_collection.insert_one(
        factories.event_doc("EVTEC1111", registration_open=False)
    )
    response = client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == "Registration is closed for this event"


def test_registering_twice_is_a_409(client, participant, event):
    client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    response = client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    assert response.status_code == 409
    assert response.json()["detail"] == "User is already registered for this event."


def test_an_event_team_member_cannot_register_for_their_own_event(
    client, event, make_participant, make_staff
):
    """Resolved through `backend_teams.admin_id`, which links a staff account back
    to its participant record."""
    person = make_participant(participant_id="DS23F000050", email="head@ds.study.iitm.ac.in")
    staff = make_staff(paradox_id="ADTE2222", email="head@ds.study.iitm.ac.in",
                       role="admin", department="technical", admin_id=person["_id"])
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": staff["paradox_id"], "role": "event_head"}}},
    )
    response = client.post("/events/EVTEC1111/register", headers=auth_headers(person))
    assert response.status_code == 403
    assert response.json()["detail"] == \
        "Event team members cannot register as participants for their own event."


def test_a_team_member_of_another_event_may_still_register(
    client, event, make_participant, make_staff
):
    person = make_participant(participant_id="DS23F000050", email="head@ds.study.iitm.ac.in")
    staff = make_staff(paradox_id="ADTE2222", email="head@ds.study.iitm.ac.in",
                       role="admin", department="technical", admin_id=person["_id"])
    other = factories.event_doc("EVTEC1112")
    other["event_team"] = [{"user_id": staff["paradox_id"], "role": "event_head"}]
    database.event_collection.insert_one(other)

    assert client.post("/events/EVTEC1111/register",
                       headers=auth_headers(person)).status_code == 200


def test_a_missing_required_field_is_a_422(client, participant, event):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$set": {"registration_fields": [factories.registration_field("tshirt", "T-shirt size")]}},
    )
    response = client.post("/events/EVTEC1111/register", json={"registration_data": {}},
                           headers=auth_headers(participant))
    assert response.status_code == 422
    assert response.json()["detail"] == "Missing required registration field(s): T-shirt size"


def test_supplied_registration_data_is_stored(client, participant, event):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$set": {"registration_fields": [factories.registration_field("tshirt")]}},
    )
    client.post("/events/EVTEC1111/register", json={"registration_data": {"tshirt": "L"}},
                headers=auth_headers(participant))
    assert registrations(participant)[0]["registration_data"] == {"tshirt": "L"}


def test_creating_a_team_returns_its_minted_id(client, participant):
    database.event_collection.insert_one(
        factories.event_doc("EVTEC1111", team_min=2, team_max=3)
    )
    response = client.post("/events/EVTEC1111/register", json={"team_name": "Rockets"},
                           headers=auth_headers(participant))
    assert response.status_code == 200
    body = response.json()
    assert body["team_role"] == "leader"
    assert body["team_id"].startswith("TMTEC")


def test_a_teammate_joins_with_that_id(client, make_participant):
    database.event_collection.insert_one(
        factories.event_doc("EVTEC1111", team_min=2, team_max=3)
    )
    leader = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in")
    member = make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in")

    team_id = client.post("/events/EVTEC1111/register", json={"team_name": "Rockets"},
                          headers=auth_headers(leader)).json()["team_id"]
    response = client.post("/events/EVTEC1111/register", json={"team_id": team_id},
                           headers=auth_headers(member))

    assert response.status_code == 200
    assert response.json()["team_role"] == "member"
    assert registrations(member)[0]["team_id"] == team_id


def test_a_full_team_is_refused(client, make_participant):
    database.event_collection.insert_one(
        factories.event_doc("EVTEC1111", team_min=1, team_max=2)
    )
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in") for i in range(1, 4)]
    team_id = client.post("/events/EVTEC1111/register", json={"team_name": "Rockets"},
                          headers=auth_headers(people[0])).json()["team_id"]
    client.post("/events/EVTEC1111/register", json={"team_id": team_id},
                headers=auth_headers(people[1]))

    response = client.post("/events/EVTEC1111/register", json={"team_id": team_id},
                           headers=auth_headers(people[2]))
    assert response.status_code == 400
    assert response.json()["detail"] == "This team is already full"


def test_joining_a_team_that_does_not_exist_is_a_404(client, participant):
    database.event_collection.insert_one(factories.event_doc("EVTEC1111", team_max=3))
    response = client.post("/events/EVTEC1111/register", json={"team_id": "TMTEC999999"},
                           headers=auth_headers(participant))
    assert response.status_code == 404


def test_a_team_input_on_a_solo_event_is_refused(client, participant, event):
    response = client.post("/events/EVTEC1111/register", json={"team_name": "Rockets"},
                           headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == "This event does not support team registration"


def test_an_event_that_requires_a_team_refuses_a_bare_registration(client, participant):
    database.event_collection.insert_one(factories.event_doc(
        "EVTEC1111", team_min=2, team_max=4, allow_single_registration=False,
    ))
    response = client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    assert response.status_code == 400
    assert "requires team registration" in response.json()["detail"]


def test_a_name_and_an_id_together_are_a_422(client, participant):
    database.event_collection.insert_one(factories.event_doc("EVTEC1111", team_max=3))
    assert client.post("/events/EVTEC1111/register",
                       json={"team_name": "Rockets", "team_id": "TMTEC111111"},
                       headers=auth_headers(participant)).status_code == 422


def test_registration_is_audited(client, participant, event, audit):
    client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    row = audit.one("EVENT_REGISTER")
    assert row["target_id"] == "EVTEC1111"
    assert row["details"]["team_role"] == "member"


def test_registration_data_can_be_edited(client, participant, event):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$set": {"registration_fields": [factories.registration_field("tshirt")]}},
    )
    client.post("/events/EVTEC1111/register", json={"registration_data": {"tshirt": "L"}},
                headers=auth_headers(participant))
    response = client.put("/events/EVTEC1111/register",
                          json={"registration_data": {"tshirt": "XL"}},
                          headers=auth_headers(participant))
    assert response.status_code == 200
    assert registrations(participant)[0]["registration_data"] == {"tshirt": "XL"}


def test_editing_without_registering_is_a_404(client, participant, event):
    response = client.put("/events/EVTEC1111/register", json={"registration_data": {}},
                          headers=auth_headers(participant))
    assert response.status_code == 404
    assert response.json()["detail"] == "Not registered for this event"


def test_editing_after_the_window_shuts_is_refused(client, make_participant, event):
    person = make_participant(events=[factories.event_registration(event["_id"])])
    database.event_collection.update_one(
        {"_id": event["_id"]}, {"$set": {"registration.allowed": False}}
    )
    response = client.put("/events/EVTEC1111/register", json={"registration_data": {}},
                          headers=auth_headers(person))
    assert response.status_code == 400
    assert response.json()["detail"] == "Registration is closed"


def test_a_participant_can_deregister(client, participant, event):
    client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    response = client.delete("/events/EVTEC1111/register", headers=auth_headers(participant))
    assert response.status_code == 200
    assert registrations(participant) == []


def test_deregistering_after_the_window_shuts_is_refused(client, make_participant, event):
    """Cancelling becomes impossible once registration closes."""
    person = make_participant(events=[factories.event_registration(event["_id"])])
    database.event_collection.update_one(
        {"_id": event["_id"]}, {"$set": {"registration.allowed": False}}
    )
    response = client.delete("/events/EVTEC1111/register", headers=auth_headers(person))
    assert response.status_code == 400
    assert response.json()["detail"] == "Registration is closed"


def test_deregistering_when_never_registered_still_answers_200(client, participant, event):
    assert client.delete("/events/EVTEC1111/register",
                         headers=auth_headers(participant)).status_code == 200


def test_my_registrations_stringifies_the_event_id(client, make_participant, event):
    person = make_participant(events=[factories.event_registration(event["_id"], team_id="TM1")])
    rows = client.get("/events/my_registrations", headers=auth_headers(person)).json()
    assert rows[0]["event_id"] == str(event["_id"])
    assert rows[0]["team_id"] == "TM1"


def test_my_registrations_is_empty_by_default(client, participant):
    assert client.get("/events/my_registrations", headers=auth_headers(participant)).json() == []


def test_a_staff_token_cannot_read_my_registrations(client, admin_headers):
    assert client.get("/events/my_registrations", headers=admin_headers).status_code == 403


# ===========================================================================
# Capacity, participation, logs
# ===========================================================================

def test_capacity_returns_two_integers_and_nothing_identifying(
    client, participant, event, make_participant
):
    """
    The only fullness figure a participant can read. It is safe to expose precisely
    because there is nothing in it to leak.
    """
    make_participant(participant_id="DS23F000009", email="z@ds.study.iitm.ac.in",
                     events=[factories.event_registration(event["_id"])])
    body = client.get("/events/EVTEC1111/capacity", headers=auth_headers(participant)).json()

    assert body == {"event_id": "EVTEC1111", "registered": 1, "attended_today": 0}


def test_capacity_falls_when_somebody_cancels(client, participant, event):
    client.post("/events/EVTEC1111/register", headers=auth_headers(participant))
    assert client.get("/events/EVTEC1111/capacity",
                      headers=auth_headers(participant)).json()["registered"] == 1
    client.delete("/events/EVTEC1111/register", headers=auth_headers(participant))
    assert client.get("/events/EVTEC1111/capacity",
                      headers=auth_headers(participant)).json()["registered"] == 0


def test_capacity_for_an_unknown_event_is_a_404(client, participant):
    assert client.get("/events/EVTEC9999/capacity",
                      headers=auth_headers(participant)).status_code == 404


def test_participation_is_readable_by_a_super_admin(client, admin_headers, event):
    body = client.get("/events/EVTEC1111/participation", headers=admin_headers).json()
    assert body["count"] == 0
    assert body["participants"] == []
    assert "total_daily_scans" in body


def test_participation_lists_registrants_with_their_team(
    client, admin_headers, event, make_participant
):
    make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                     profile={"full_name": "Asha", "phone": "9000000001", "house": "Gir"},
                     events=[factories.event_registration(event["_id"], team_id="TM1",
                                                          team_role="leader")])
    row = client.get("/events/EVTEC1111/participation", headers=admin_headers).json()["participants"][0]
    assert row["name"] == "Asha"
    assert row["team_id"] == "TM1"
    assert row["team_role"] == "leader"


def test_an_event_team_member_can_read_participation(client, event_with_head, head):
    assert client.get("/events/EVTEC1111/participation",
                      headers=auth_headers(head)).status_code == 200


def test_a_department_admin_can_read_participation_for_their_own_type(
    client, event, make_staff
):
    """`department` is compared straight against `event_type`."""
    staff = make_staff(paradox_id="ADTE3333", email="dept@x.com", role="admin",
                       department="technical")
    assert client.get("/events/EVTEC1111/participation",
                      headers=auth_headers(staff)).status_code == 200


def test_a_department_admin_cannot_read_another_type(client, event, make_staff):
    staff = make_staff(paradox_id="ADSP3333", email="sport@x.com", role="admin",
                       department="sports")
    response = client.get("/events/EVTEC1111/participation", headers=auth_headers(staff))
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to view participation details"


def test_uhc_staff_see_only_their_own_house(client, event, make_staff, make_participant):
    """The house is derived from the email local part before the dash."""
    uhc = make_staff(paradox_id="OTUH3333", email="gir-uhc@ds.study.iitm.ac.in",
                     role="other", department="uhc")
    make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                     profile={"full_name": "In House", "house": "Gir"},
                     events=[factories.event_registration(event["_id"])])
    make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
                     profile={"full_name": "Other House", "house": "Kanha"},
                     events=[factories.event_registration(event["_id"])])

    body = client.get("/events/EVTEC1111/participation", headers=auth_headers(uhc)).json()
    assert [row["name"] for row in body["participants"]] == ["In House"]


def test_a_registrant_with_no_house_does_not_crash_the_uhc_view(
    client, event, make_staff, make_participant
):
    """
    `prof.get("house", "")` returns None for a profile that stores an explicit null —
    the default only applies to a *missing* key — so `.lower()` used to raise
    AttributeError and answer 500. An incomplete profile is ordinary: `profile` is
    `{}` from registration until the student fills it in.
    """
    uhc = make_staff(paradox_id="OTUH3333", email="gir-uhc@ds.study.iitm.ac.in",
                     role="other", department="uhc")
    make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                     profile={"full_name": "No House", "house": None},
                     events=[factories.event_registration(event["_id"])])

    response = client.get("/events/EVTEC1111/participation", headers=auth_headers(uhc))
    assert response.status_code == 200
    # Nobody's house matches, so the roster is empty rather than broken.
    assert response.json()["participants"] == []


def test_a_registrant_with_no_house_is_visible_to_a_super_admin(
    client, admin_headers, event, make_participant
):
    """The house filter is UHC-only, so a null house is no obstacle here."""
    make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                     profile={"full_name": "No House", "house": None},
                     events=[factories.event_registration(event["_id"])])
    body = client.get("/events/EVTEC1111/participation", headers=admin_headers).json()
    assert [row["name"] for row in body["participants"]] == ["No House"]
    assert body["participants"][0]["house"] is None


def test_a_uhc_admin_whose_email_has_no_house_prefix_sees_nobody(
    client, event, make_staff, make_participant
):
    """`admin_house` is None when the email carries no dash, which matches no
    participant — pinned so the behaviour is deliberate rather than incidental."""
    uhc = make_staff(paradox_id="OTUH4444", email="uhc@ds.study.iitm.ac.in",
                     role="other", department="uhc")
    make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                     profile={"full_name": "In Gir", "house": "Gir"},
                     events=[factories.event_registration(event["_id"])])
    response = client.get("/events/EVTEC1111/participation", headers=auth_headers(uhc))
    assert response.status_code == 200
    assert response.json()["participants"] == []


def test_uhc_staff_do_not_receive_the_daily_scan_total(client, event, make_staff):
    uhc = make_staff(paradox_id="OTUH3333", email="gir-uhc@x.com", role="other",
                     department="uhc")
    assert "total_daily_scans" not in client.get(
        "/events/EVTEC1111/participation", headers=auth_headers(uhc)
    ).json()


def test_participation_for_an_unknown_event_is_a_404(client, admin_headers):
    assert client.get("/events/EVTEC9999/participation",
                      headers=admin_headers).status_code == 404


def test_a_participant_cannot_read_participation(client, participant, event):
    assert client.get("/events/EVTEC1111/participation",
                      headers=auth_headers(participant)).status_code == 403


def test_the_event_log_is_super_admin_only(client, event_with_head, head):
    response = client.get("/events/EVTEC1111/logs", headers=auth_headers(head))
    assert response.status_code == 403


def test_the_event_log_returns_scan_rows_newest_first(client, admin_headers, event):
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    database.event_logs_collection.insert_many([
        {"event_id": str(event["_id"]), "participant_id": "DS23F000001",
         "scanned_by": "ADTE2222", "day": now.strftime("%Y-%m-%d"),
         "timestamp": now - timedelta(minutes=5)},
        {"event_id": str(event["_id"]), "participant_id": "DS23F000002",
         "scanned_by": "ADTE2222", "day": now.strftime("%Y-%m-%d"), "timestamp": now},
    ])
    logs = client.get("/events/EVTEC1111/logs", headers=admin_headers).json()["logs"]
    assert [row["participant_id"] for row in logs] == ["DS23F000002", "DS23F000001"]
    assert "_id" not in logs[0]


def test_logs_for_an_unknown_event_are_a_404(client, admin_headers):
    assert client.get("/events/EVTEC9999/logs", headers=admin_headers).status_code == 404
