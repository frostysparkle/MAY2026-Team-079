"""
Endpoint tests for /queries.

The access model is flat: a super admin or any member of the query resolution team
sees the whole queue, across every category. Anyone else is refused outright. So the
tests centre on the roster being the thing that grants access, and on the thread
being readable by exactly its two sides.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers

RAISE = {"category": "general", "subject": "Need help", "body": "Something is unclear."}


@pytest.fixture()
def resolver(make_staff):
    """A staff account on the query team."""
    staff = make_staff(paradox_id="OTUH1111", email="queries@ds.study.iitm.ac.in",
                       role="other", department="uhc", designation="Query Desk")
    database.query_team_collection.insert_one({
        "user_id": staff["paradox_id"], "added_at": None, "added_by": "SAWO1111",
    })
    return staff


def raised(client, person, **overrides):
    response = client.post("/queries", json={**RAISE, **overrides},
                           headers=auth_headers(person))
    assert response.status_code == 200, response.json()
    return response.json()["query_id"]


def stored(query_id):
    return database.queries_collection.find_one({"query_id": query_id})


# ===========================================================================
# POST /queries
# ===========================================================================

def test_a_participant_can_raise_a_general_query(client, participant):
    response = client.post("/queries", json=RAISE, headers=auth_headers(participant))
    assert response.status_code == 200
    body = response.json()
    assert body["query_id"].startswith("QRY")
    assert body["query"]["status"] == "open"
    assert body["query"]["assigned_to"] is None
    assert body["query"]["replies"] == []
    assert "_id" not in body["query"]


def test_the_raiser_is_snapshotted_onto_the_query(client, make_participant):
    person = make_participant(profile={"full_name": "Asha Nair", "house": "Gir"})
    body = client.post("/queries", json=RAISE, headers=auth_headers(person)).json()["query"]
    assert body["participant_id"] == person["participant_id"]
    assert body["participant_name"] == "Asha Nair"
    assert body["participant_house"] == "Gir"


def test_an_unknown_category_is_a_400(client, participant):
    response = client.post("/queries", json={**RAISE, "category": "weather"},
                           headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == \
        "Invalid category. Must be one of: event, general, hostel, mess, workshop"


def test_the_category_is_normalised(client, participant):
    body = client.post("/queries", json={**RAISE, "category": "  GENERAL  "},
                       headers=auth_headers(participant)).json()
    assert body["query"]["category"] == "general"


@pytest.mark.parametrize("category", ["hostel", "mess", "event", "workshop"])
def test_a_routed_category_must_name_a_target(client, participant, category):
    response = client.post("/queries", json={**RAISE, "category": category},
                           headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == f"A {category} query must name a {category}"


@pytest.mark.parametrize("category,collection,field,value", [
    ("hostel", "hostel_collection", "hostel_id", "HSTL111"),
    ("mess", "mess_collection", "mess_id", "MESS1"),
    ("event", "event_collection", "event_id", "EVTEC1111"),
    ("workshop", "workshops_collection", "workshop_id", "WKSP111"),
])
def test_a_named_target_must_exist(client, participant, category, collection, field, value):
    """
    Validated at write time: a query naming a block that does not exist would
    otherwise be accepted, routed to nobody, and sit looking exactly like one
    nobody has got to yet.
    """
    response = client.post("/queries", json={**RAISE, "category": category, "target_id": value},
                           headers=auth_headers(participant))
    assert response.status_code == 404
    assert response.json()["detail"] == f"No {category} found with id {value}"

    getattr(database, collection).insert_one({field: value})
    assert client.post("/queries", json={**RAISE, "category": category, "target_id": value},
                       headers=auth_headers(participant)).status_code == 200


def test_a_general_query_stores_no_target(client, participant):
    body = client.post("/queries", json=RAISE, headers=auth_headers(participant)).json()
    assert body["query"]["target_id"] is None


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN DEFECT: the code's own comment calls a general query with a "
           "target_id 'a category error', but the route silently discards the value "
           "instead of refusing it, so a mis-categorised query is accepted and its "
           "target is lost.",
)
def test_a_general_query_with_a_target_is_refused(client, participant):
    response = client.post("/queries", json={**RAISE, "target_id": "HSTL111"},
                           headers=auth_headers(participant))
    assert response.status_code == 400


def test_the_subject_and_body_are_stripped(client, participant):
    body = client.post("/queries", json={**RAISE, "subject": "  Padded  ", "body": "  Text  "},
                       headers=auth_headers(participant)).json()
    assert body["query"]["subject"] == "Padded"
    assert body["query"]["body"] == "Text"


def test_an_empty_subject_is_a_422(client, participant):
    assert client.post("/queries", json={**RAISE, "subject": ""},
                       headers=auth_headers(participant)).status_code == 422


def test_raising_is_audited(client, participant, audit):
    client.post("/queries", json=RAISE, headers=auth_headers(participant))
    row = audit.one("RAISE_QUERY")
    assert row["details"]["category"] == "general"
    assert row["actor_type"] == "participant"


def test_a_staff_token_cannot_raise_a_query(client, admin_headers):
    assert client.post("/queries", json=RAISE, headers=admin_headers).status_code == 403


# ===========================================================================
# GET /queries/mine
# ===========================================================================

def test_a_participant_tracks_their_own_queries_newest_first(client, participant):
    first = raised(client, participant, subject="First")
    second = raised(client, participant, subject="Second")
    rows = client.get("/queries/mine", headers=auth_headers(participant)).json()
    assert [row["query_id"] for row in rows] == [second, first]


def test_mine_shows_nobody_elses_queries(client, participant, other_participant):
    raised(client, other_participant)
    assert client.get("/queries/mine", headers=auth_headers(participant)).json() == []


def test_mine_includes_the_replies(client, participant, resolver):
    query_id = raised(client, participant)
    client.post(f"/queries/{query_id}/replies", json={"body": "On it"},
                headers=auth_headers(resolver))
    rows = client.get("/queries/mine", headers=auth_headers(participant)).json()
    assert rows[0]["replies"][0]["body"] == "On it"


def test_mine_is_not_captured_as_a_query_id(client, participant):
    assert client.get("/queries/mine", headers=auth_headers(participant)).status_code == 200


# ===========================================================================
# GET /queries — the shared queue
# ===========================================================================

def test_the_queue_is_refused_to_staff_on_neither_list(client, staff_headers):
    response = client.get("/queries", headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to access queries"


def test_a_super_admin_sees_the_queue(client, admin_headers, participant):
    raised(client, participant)
    assert len(client.get("/queries", headers=admin_headers).json()) == 1


def test_joining_the_roster_immediately_grants_the_queue(
    client, admin_headers, plain_staff, participant
):
    """Membership is the thing that grants access, so adding somebody flips them
    from 403 to 200 with no other change."""
    raised(client, participant)
    assert client.get("/queries", headers=auth_headers(plain_staff)).status_code == 403

    client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                headers=admin_headers)
    assert client.get("/queries", headers=auth_headers(plain_staff)).status_code == 200


def test_the_queue_spans_every_category_including_general(client, resolver, participant):
    database.hostel_collection.insert_one({"hostel_id": "HSTL111"})
    raised(client, participant, category="hostel", target_id="HSTL111")
    raised(client, participant)
    rows = client.get("/queries", headers=auth_headers(resolver)).json()
    assert {row["category"] for row in rows} == {"hostel", "general"}


def test_the_queue_is_newest_first(client, resolver, participant):
    first = raised(client, participant, subject="First")
    second = raised(client, participant, subject="Second")
    rows = client.get("/queries", headers=auth_headers(resolver)).json()
    assert [row["query_id"] for row in rows] == [second, first]


def test_the_status_filter_narrows_the_queue(client, resolver, admin_headers, participant):
    open_id = raised(client, participant, subject="Still open")
    resolved_id = raised(client, participant, subject="Done")
    client.patch(f"/queries/{resolved_id}", json={"status": "resolved"}, headers=admin_headers)

    rows = client.get("/queries?status=open", headers=auth_headers(resolver)).json()
    assert [row["query_id"] for row in rows] == [open_id]


def test_resolved_queries_stay_in_the_queue_by_default(
    client, resolver, admin_headers, participant
):
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=admin_headers)
    assert len(client.get("/queries", headers=auth_headers(resolver)).json()) == 1


def test_an_unknown_status_filter_is_a_400(client, resolver):
    response = client.get("/queries?status=pending", headers=auth_headers(resolver))
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid status. Must be one of: assigned, open, resolved"


def test_the_category_filter_narrows_the_queue(client, resolver, participant):
    database.mess_collection.insert_one({"mess_id": "MESS1"})
    mess_id = raised(client, participant, category="mess", target_id="MESS1")
    raised(client, participant)
    rows = client.get("/queries?category=mess", headers=auth_headers(resolver)).json()
    assert [row["query_id"] for row in rows] == [mess_id]


def test_the_limit_caps_the_page(client, resolver, participant):
    for index in range(3):
        raised(client, participant, subject=f"Q{index}")
    assert len(client.get("/queries?limit=2", headers=auth_headers(resolver)).json()) == 2


def test_a_participant_cannot_read_the_queue(client, participant):
    assert client.get("/queries", headers=auth_headers(participant)).status_code == 403


# ===========================================================================
# PATCH /queries/{query_id}
# ===========================================================================

def test_a_status_can_be_set(client, admin_headers, participant):
    query_id = raised(client, participant)
    response = client.patch(f"/queries/{query_id}", json={"status": "resolved"},
                            headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["query"]["status"] == "resolved"


def test_resolving_stamps_the_time(client, admin_headers, participant):
    """So "how long did that take" is answerable from the record alone."""
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=admin_headers)
    assert stored(query_id)["resolved_at"] is not None


def test_assigning_somebody_implies_the_assigned_status(client, admin_headers, participant):
    query_id = raised(client, participant)
    body = client.patch(f"/queries/{query_id}", json={"assigned_to": "OTUH1111"},
                        headers=admin_headers).json()
    assert body["query"]["assigned_to"] == "OTUH1111"
    assert body["query"]["status"] == "assigned"


def test_an_explicit_status_wins_over_the_implied_one(client, admin_headers, participant):
    """So resolve-and-assign in one request works."""
    query_id = raised(client, participant)
    body = client.patch(f"/queries/{query_id}",
                        json={"assigned_to": "OTUH1111", "status": "resolved"},
                        headers=admin_headers).json()
    assert body["query"]["status"] == "resolved"


def test_a_team_member_can_self_claim(client, resolver, participant):
    query_id = raised(client, participant)
    body = client.patch(f"/queries/{query_id}", json={"assigned_to": resolver["paradox_id"]},
                        headers=auth_headers(resolver)).json()
    assert body["query"]["assigned_to"] == resolver["paradox_id"]


def test_only_the_supplied_fields_are_written(client, admin_headers, participant):
    """A screen that reassigns a query cannot blank its status on the way past."""
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"assigned_team": "Ganga Block desk"},
                 headers=admin_headers)
    document = stored(query_id)
    assert document["assigned_team"] == "Ganga Block desk"
    assert document["status"] == "assigned" or document["status"] == "open"


def test_an_empty_update_is_a_400(client, admin_headers, participant):
    query_id = raised(client, participant)
    response = client.patch(f"/queries/{query_id}", json={}, headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Nothing to update"


def test_an_unknown_status_is_a_400(client, admin_headers, participant):
    query_id = raised(client, participant)
    response = client.patch(f"/queries/{query_id}", json={"status": "pending"},
                            headers=admin_headers)
    assert response.status_code == 400


def test_an_unknown_query_is_a_404(client, admin_headers):
    response = client.patch("/queries/QRY-NOPE", json={"status": "open"}, headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Query not found"


def test_unauthorised_staff_are_refused_before_the_lookup(client, staff_headers):
    """So a staff member off the team cannot probe which query ids exist."""
    response = client.patch("/queries/QRY-NOPE", json={"status": "open"}, headers=staff_headers)
    assert response.status_code == 403


def test_an_update_is_audited_with_the_field_names(client, admin_headers, participant, audit):
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=admin_headers)
    row = audit.one("UPDATE_QUERY")
    assert row["target_id"] == query_id
    assert "status" in row["details"]["fields_updated"]


def test_the_team_path_is_not_captured_as_a_query_id(client, admin_headers):
    """`PATCH /queries/team` has no handler, so it falls into the id route."""
    response = client.patch("/queries/team", json={"status": "open"}, headers=admin_headers)
    assert response.status_code == 404


def test_reopening_preserves_the_first_resolution_time(client, admin_headers, participant):
    """
    `resolved_at` is the only record of when the work was actually finished, so
    reopening must not destroy it. `status` already says the query is open again; the
    two fields together are the history.
    """
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=admin_headers)
    first = stored(query_id)["resolved_at"]
    assert first is not None

    client.patch(f"/queries/{query_id}", json={"status": "open"}, headers=admin_headers)
    assert stored(query_id)["resolved_at"] == first
    assert stored(query_id)["status"] == "open"


def test_resolving_again_restamps_the_time(client, admin_headers, participant):
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=admin_headers)
    first = stored(query_id)["resolved_at"]
    client.patch(f"/queries/{query_id}", json={"status": "open"}, headers=admin_headers)
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=admin_headers)
    assert stored(query_id)["resolved_at"] >= first


def test_an_unresolved_query_has_no_resolution_time(client, admin_headers, participant):
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"status": "assigned"}, headers=admin_headers)
    assert stored(query_id)["resolved_at"] is None


def test_an_assignment_can_be_cleared(client, admin_headers, participant):
    """
    An explicit null releases the query. Previously indistinguishable from "field
    omitted", so a query handed to somebody who left the fest stayed theirs forever.
    """
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"assigned_to": "OTUH1111"}, headers=admin_headers)
    assert stored(query_id)["assigned_to"] == "OTUH1111"

    response = client.patch(f"/queries/{query_id}", json={"assigned_to": None},
                            headers=admin_headers)
    assert response.status_code == 200
    assert stored(query_id)["assigned_to"] is None


def test_releasing_a_query_does_not_force_it_back_to_assigned(
    client, admin_headers, participant
):
    """Clearing the owner implies nothing about the status — only handing it to
    somebody does."""
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"assigned_to": "OTUH1111"}, headers=admin_headers)
    client.patch(f"/queries/{query_id}", json={"assigned_to": None, "status": "open"},
                 headers=admin_headers)
    document = stored(query_id)
    assert document["assigned_to"] is None
    assert document["status"] == "open"


def test_releasing_alone_leaves_the_status_untouched(client, admin_headers, participant):
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"assigned_to": "OTUH1111"}, headers=admin_headers)
    assert stored(query_id)["status"] == "assigned"

    client.patch(f"/queries/{query_id}", json={"assigned_to": None}, headers=admin_headers)
    assert stored(query_id)["status"] == "assigned", "the caller did not ask to change it"


def test_the_owning_team_label_can_also_be_cleared(client, admin_headers, participant):
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"assigned_team": "Ganga Block desk"},
                 headers=admin_headers)
    client.patch(f"/queries/{query_id}", json={"assigned_team": None}, headers=admin_headers)
    assert stored(query_id)["assigned_team"] is None


def test_omitting_a_field_still_leaves_it_alone(client, admin_headers, participant):
    """The distinction the fix rests on: omitted is not the same as null."""
    query_id = raised(client, participant)
    client.patch(f"/queries/{query_id}", json={"assigned_to": "OTUH1111"}, headers=admin_headers)
    client.patch(f"/queries/{query_id}", json={"status": "resolved"}, headers=admin_headers)
    assert stored(query_id)["assigned_to"] == "OTUH1111"


# ===========================================================================
# POST /queries/{query_id}/replies
# ===========================================================================

def test_the_raiser_can_reply_to_their_own_query(client, participant):
    query_id = raised(client, participant)
    response = client.post(f"/queries/{query_id}/replies", json={"body": "Any update?"},
                           headers=auth_headers(participant))
    assert response.status_code == 200
    reply = response.json()["reply"]
    assert reply["author_type"] == "participant"
    assert reply["author_id"] == participant["participant_id"]
    assert reply["body"] == "Any update?"


def test_a_team_member_can_reply(client, participant, resolver):
    query_id = raised(client, participant)
    reply = client.post(f"/queries/{query_id}/replies", json={"body": "Looking into it"},
                        headers=auth_headers(resolver)).json()["reply"]
    assert reply["author_type"] == "staff"
    assert reply["author_name"] == "Query Desk"


def test_a_super_admin_can_reply(client, participant, admin_headers):
    query_id = raised(client, participant)
    assert client.post(f"/queries/{query_id}/replies", json={"body": "Noted"},
                       headers=admin_headers).status_code == 200


def test_another_participant_cannot_reply(client, participant, other_participant):
    query_id = raised(client, participant)
    response = client.post(f"/queries/{query_id}/replies", json={"body": "Me too"},
                           headers=auth_headers(other_participant))
    assert response.status_code == 403
    assert response.json()["detail"] == "Not your query"


def test_staff_off_the_team_cannot_reply(client, participant, staff_headers):
    """Checked per role rather than per token, so a valid staff token is not
    enough."""
    query_id = raised(client, participant)
    response = client.post(f"/queries/{query_id}/replies", json={"body": "Hello"},
                           headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to handle this query"


def test_replying_to_an_unknown_query_is_a_404(client, participant):
    response = client.post("/queries/QRY-NOPE/replies", json={"body": "Hello"},
                           headers=auth_headers(participant))
    assert response.status_code == 404
    assert response.json()["detail"] == "Query not found"


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN DEFECT: the 404 lookup runs before either authorisation branch, so "
           "any authenticated user can probe which query ids exist.",
)
def test_query_existence_is_not_leaked(client, participant, other_participant):
    query_id = raised(client, participant)
    missing = client.post("/queries/QRY-NOPE/replies", json={"body": "x"},
                          headers=auth_headers(other_participant))
    existing = client.post(f"/queries/{query_id}/replies", json={"body": "x"},
                           headers=auth_headers(other_participant))
    assert missing.status_code == existing.status_code


def test_replies_accumulate_in_order(client, participant, resolver):
    query_id = raised(client, participant)
    client.post(f"/queries/{query_id}/replies", json={"body": "First"},
                headers=auth_headers(participant))
    client.post(f"/queries/{query_id}/replies", json={"body": "Second"},
                headers=auth_headers(resolver))
    assert [r["body"] for r in stored(query_id)["replies"]] == ["First", "Second"]


def test_replying_does_not_change_the_status(client, participant, resolver):
    """Deliberate: answering is not resolving."""
    query_id = raised(client, participant)
    client.post(f"/queries/{query_id}/replies", json={"body": "Working on it"},
                headers=auth_headers(resolver))
    assert stored(query_id)["status"] == "open"


def test_an_empty_reply_is_a_422(client, participant):
    query_id = raised(client, participant)
    assert client.post(f"/queries/{query_id}/replies", json={"body": ""},
                       headers=auth_headers(participant)).status_code == 422


def test_a_reply_is_audited(client, participant, audit):
    query_id = raised(client, participant)
    client.post(f"/queries/{query_id}/replies", json={"body": "Any update?"},
                headers=auth_headers(participant))
    assert audit.one("REPLY_QUERY")["details"]["author_type"] == "participant"


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN DEFECT: a staff reply's author_name falls back designation -> role, "
           "skipping `name` entirely, so a staff member with a name but no "
           "designation appears to the participant as their raw role, e.g. "
           "'super_admin'.",
)
def test_a_staff_replys_name_is_used_when_present(client, participant, admin_headers,
                                                  super_admin):
    database.backend_teams_collection.update_one(
        {"_id": super_admin["_id"]}, {"$unset": {"designation": ""}, "$set": {"name": "Priya"}}
    )
    query_id = raised(client, participant)
    reply = client.post(f"/queries/{query_id}/replies", json={"body": "Noted"},
                        headers=admin_headers).json()["reply"]
    assert reply["author_name"] == "Priya"


# ===========================================================================
# The roster
# ===========================================================================

def test_a_member_is_added_to_the_roster(client, admin_headers, plain_staff):
    response = client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                           headers=admin_headers)
    assert response.status_code == 200
    member = response.json()["member"]
    assert member["user_id"] == plain_staff["paradox_id"]
    assert member["department"] == "technical"


def test_the_member_must_be_an_existing_staff_account(client, admin_headers):
    """The roster grants query access on top of an account; it does not create
    one."""
    response = client.post("/queries/team", json={"user_id": "GHOST"}, headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "user_id must reference an existing backend_teams member"


def test_adding_twice_is_a_400(client, admin_headers, plain_staff):
    client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                headers=admin_headers)
    response = client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                           headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "This staff member is already on the query team"


def test_the_roster_is_listed_oldest_first(client, admin_headers, plain_staff, other_role_staff):
    client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                headers=admin_headers)
    client.post("/queries/team", json={"user_id": other_role_staff["paradox_id"]},
                headers=admin_headers)
    rows = client.get("/queries/team", headers=admin_headers).json()
    assert [row["user_id"] for row in rows] == [plain_staff["paradox_id"],
                                                other_role_staff["paradox_id"]]


def test_a_member_can_be_removed(client, admin_headers, plain_staff):
    client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                headers=admin_headers)
    response = client.delete(f"/queries/team/{plain_staff['paradox_id']}",
                             headers=admin_headers)
    assert response.status_code == 200
    assert client.get("/queries/team", headers=admin_headers).json() == []


def test_removal_revokes_access_to_the_queue(client, admin_headers, plain_staff):
    client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                headers=admin_headers)
    assert client.get("/queries", headers=auth_headers(plain_staff)).status_code == 200
    client.delete(f"/queries/team/{plain_staff['paradox_id']}", headers=admin_headers)
    assert client.get("/queries", headers=auth_headers(plain_staff)).status_code == 403


def test_removal_leaves_what_they_already_did_intact(
    client, admin_headers, participant, resolver
):
    query_id = raised(client, participant)
    client.post(f"/queries/{query_id}/replies", json={"body": "Mine"},
                headers=auth_headers(resolver))
    client.patch(f"/queries/{query_id}", json={"assigned_to": resolver["paradox_id"]},
                 headers=admin_headers)

    client.delete(f"/queries/team/{resolver['paradox_id']}", headers=admin_headers)

    document = stored(query_id)
    assert document["replies"][0]["body"] == "Mine"
    assert document["assigned_to"] == resolver["paradox_id"]


def test_removing_a_non_member_is_a_404(client, admin_headers):
    response = client.delete("/queries/team/GHOST", headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "user_id is not on the query team"


@pytest.mark.parametrize("method,path,kwargs", [
    ("post", "/queries/team", {"json": {"user_id": "OTUH1111"}}),
    ("get", "/queries/team", {}),
    ("delete", "/queries/team/OTUH1111", {}),
])
def test_the_roster_is_super_admin_only(client, resolver, method, path, kwargs):
    """Even a query-team member cannot manage the roster."""
    response = getattr(client, method)(path, headers=auth_headers(resolver), **kwargs)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can manage the query team"


def test_roster_changes_are_audited(client, admin_headers, plain_staff, audit):
    client.post("/queries/team", json={"user_id": plain_staff["paradox_id"]},
                headers=admin_headers)
    client.delete(f"/queries/team/{plain_staff['paradox_id']}", headers=admin_headers)
    assert audit.one("ASSIGN_QUERY_TEAM")["target_id"] == plain_staff["paradox_id"]
    assert audit.one("REMOVE_QUERY_TEAM_MEMBER")["target_id"] == plain_staff["paradox_id"]
