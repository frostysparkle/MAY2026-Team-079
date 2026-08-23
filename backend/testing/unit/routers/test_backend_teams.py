"""
Endpoint tests for /backend_teams — staff account lifecycle.

These are the accounts that scan meals, open hostel doors, and read the audit
trail, so the tests focus on the rules that decide what an account can do:
the super-admin gate (re-read from Mongo on every call, so a forged claim is
inert), the participant link that makes a privileged account auditable, and the
immutability of `role`/`department` after creation.
"""
import pytest

import database
import security
from testing.helpers import auth_headers

STAFF = {
    "email": "new.staff@ds.study.iitm.ac.in",
    "password": "longenough1",
    "role": "other",
    "department": "hostels",
    "designation": "Block Desk",
}


@pytest.fixture()
def linked_participant(make_participant):
    """A participant whose email a privileged staff account can be linked to."""
    return make_participant(participant_id="DS23F000050",
                            email="new.staff@ds.study.iitm.ac.in",
                            profile={"full_name": "Linked Person"})


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

CALLS = [
    ("post", "/backend_teams", {"json": STAFF}),
    ("get", "/backend_teams", {}),
    ("put", "/backend_teams/OTHO1111", {"json": {"designation": "x"}}),
    ("delete", "/backend_teams/OTHO1111", {}),
]


@pytest.mark.parametrize("method,path,kwargs", CALLS)
def test_a_participant_token_is_refused_at_the_auth_layer(client, participant, method, path, kwargs):
    response = getattr(client, method)(path, headers=auth_headers(participant), **kwargs)
    assert response.status_code == 403
    assert response.json()["detail"] == "Staff credentials required. Use /auth/admin/login."


@pytest.mark.parametrize("method,path,kwargs", CALLS)
def test_ordinary_staff_are_refused(client, staff_headers, method, path, kwargs):
    response = getattr(client, method)(path, headers=staff_headers, **kwargs)
    assert response.status_code == 403


def test_the_writes_and_the_read_use_different_messages(client, staff_headers):
    assert client.post("/backend_teams", json=STAFF, headers=staff_headers).json()["detail"] \
        == "Only Super Admins can manage backend teams"
    assert client.get("/backend_teams", headers=staff_headers).json()["detail"] \
        == "Only Super Admins can view backend teams"


def test_an_admin_cannot_escalate_by_editing_their_token(client, plain_staff):
    """The role is re-read from `backend_teams` on every call."""
    from datetime import timedelta

    from security import create_access_token

    forged = create_access_token(
        {"sub": plain_staff["paradox_id"], "type": "staff", "role": "super_admin"},
        expires_delta=timedelta(minutes=5),
    )
    assert client.get("/backend_teams",
                      headers={"Authorization": f"Bearer {forged}"}).status_code == 403


def test_a_refusal_is_recorded(client, staff_headers, audit):
    client.post("/backend_teams", json=STAFF, headers=staff_headers)
    row = audit.latest("AUTHZ_DENIED")
    assert row["details"]["reason"] == "not_super_admin"
    assert row["details"]["resource"] == "backend_teams"
    assert row["details"]["operation"] == "create"


# ---------------------------------------------------------------------------
# POST /backend_teams
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_an_unlinked_other_account_can_be_created(client, admin_headers):
    """`other` is the bucket role for staff with no participant record."""
    response = client.post("/backend_teams", json=STAFF, headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["message"] == "Backend team member created"
    document = database.backend_teams_collection.find_one({"email": STAFF["email"]})
    assert document["admin_id"] is None
    assert document["role"] == "other"


@pytest.mark.slow
def test_the_paradox_id_encodes_role_and_department(client, admin_headers):
    body = client.post("/backend_teams", json=STAFF, headers=admin_headers).json()
    assert body["paradox_id"] == "OTHO1111"


@pytest.mark.slow
def test_the_password_is_stored_only_as_a_hash(client, admin_headers):
    client.post("/backend_teams", json=STAFF, headers=admin_headers)
    document = database.backend_teams_collection.find_one({"email": STAFF["email"]})
    assert document["password_hash"].startswith("$2b$")
    assert security.verify_password(STAFF["password"], document["password_hash"])
    assert STAFF["password"] not in str(document)


@pytest.mark.slow
def test_the_new_account_can_log_in(client, admin_headers):
    """End to end: creation produces credentials the staff login accepts."""
    client.post("/backend_teams", json=STAFF, headers=admin_headers)
    response = client.post("/auth/admin/login",
                           json={"email": STAFF["email"], "password": STAFF["password"]})
    assert response.status_code == 200
    assert response.json()["role"] == "other"


def test_a_duplicate_staff_email_is_refused(client, admin_headers, make_staff):
    make_staff(paradox_id="OTHO9999", email=STAFF["email"], role="other")
    response = client.post("/backend_teams", json=STAFF, headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Email already registered in backend teams"


def test_a_staff_email_may_equal_a_participant_email_by_design(
    client, admin_headers, linked_participant
):
    """That equality *is* the link between the two records."""
    assert client.post("/backend_teams", json=STAFF, headers=admin_headers).status_code == 200


@pytest.mark.parametrize("role", ["super_admin", "admin", "volunteer"])
def test_a_privileged_role_requires_a_registered_participant(client, admin_headers, role):
    response = client.post("/backend_teams", json={**STAFF, "role": role},
                           headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == (
        f"role '{role}' requires a registered participant with this email; "
        "no matching participant record was found"
    )


@pytest.mark.slow
@pytest.mark.parametrize("role", ["super_admin", "admin", "volunteer"])
def test_a_privileged_role_succeeds_once_the_participant_exists(
    client, admin_headers, linked_participant, role
):
    response = client.post("/backend_teams", json={**STAFF, "role": role},
                           headers=admin_headers)
    assert response.status_code == 200
    document = database.backend_teams_collection.find_one({"email": STAFF["email"]})
    assert document["admin_id"] == linked_participant["_id"]


@pytest.mark.slow
def test_one_participant_cannot_back_two_staff_accounts(
    client, admin_headers, linked_participant
):
    """Otherwise two accounts would both resolve every "is this really them"
    check back to the same person."""
    assert client.post("/backend_teams", json={**STAFF, "role": "admin"},
                       headers=admin_headers).status_code == 200
    database.backend_teams_collection.update_one(
        {"email": STAFF["email"]}, {"$set": {"email": "moved@ds.study.iitm.ac.in"}}
    )
    response = client.post("/backend_teams", json={**STAFF, "role": "volunteer"},
                           headers=admin_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == \
        "This participant is already linked to another backend_teams account"


def test_the_conflict_names_the_account_holding_the_link(
    client, admin_headers, linked_participant, audit
):
    database.backend_teams_collection.insert_one({
        "paradox_id": "ADHO7777", "email": "other@x.com", "role": "admin",
        "department": "hostels", "admin_id": linked_participant["_id"],
    })
    client.post("/backend_teams", json={**STAFF, "role": "admin"}, headers=admin_headers)
    row = audit.latest("CREATE_STAFF_DENIED")
    assert row["details"]["reason"] == "participant_already_linked"
    assert row["details"]["linked_to"] == "ADHO7777"


@pytest.mark.slow
def test_an_explicit_name_wins_over_the_linked_participants_name(
    client, admin_headers, linked_participant
):
    client.post("/backend_teams", json={**STAFF, "role": "admin", "name": "Preferred Name"},
                headers=admin_headers)
    assert database.backend_teams_collection.find_one(
        {"email": STAFF["email"]}
    )["name"] == "Preferred Name"


@pytest.mark.slow
def test_a_whitespace_only_name_falls_through_to_the_linked_name(
    client, admin_headers, linked_participant
):
    client.post("/backend_teams", json={**STAFF, "role": "admin", "name": "   "},
                headers=admin_headers)
    assert database.backend_teams_collection.find_one(
        {"email": STAFF["email"]}
    )["name"] == "Linked Person"


@pytest.mark.slow
def test_an_unlinked_account_with_no_name_stores_none(client, admin_headers):
    client.post("/backend_teams", json=STAFF, headers=admin_headers)
    assert database.backend_teams_collection.find_one({"email": STAFF["email"]})["name"] is None


@pytest.mark.parametrize("field,value", [
    ("role", "wizard"), ("department", "quidditch"), ("designation", ""),
    ("password", "short"), ("email", "not-an-email"),
])
def test_schema_violations_are_422(client, admin_headers, field, value):
    """The `Literal` types on role/department are what keep the id generator from
    raising a KeyError."""
    assert client.post("/backend_teams", json={**STAFF, field: value},
                       headers=admin_headers).status_code == 422


@pytest.mark.slow
def test_creation_is_audited_with_the_privileges_granted(client, admin_headers, audit):
    client.post("/backend_teams", json=STAFF, headers=admin_headers)
    row = audit.one("CREATE_STAFF")
    assert row["target_id"] == "OTHO1111"
    assert row["details"]["role"] == "other"
    assert row["details"]["department"] == "hostels"
    assert row["details"]["linked_participant"] is False
    assert row["details"]["email_local"] == "new.staff"
    assert STAFF["password"] not in str(row)


# ---------------------------------------------------------------------------
# GET /backend_teams
# ---------------------------------------------------------------------------

def test_the_roster_never_returns_a_password_hash(client, admin_headers, make_staff):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    body = client.get("/backend_teams", headers=admin_headers).json()
    assert body
    assert not any("password_hash" in row for row in body)


def test_the_roster_lists_every_account(client, admin_headers, make_staff, super_admin):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    ids = {row["paradox_id"] for row in client.get("/backend_teams", headers=admin_headers).json()}
    assert ids == {super_admin["paradox_id"], "OTHO1111"}


def test_the_roster_survives_a_participant_linked_account(client, admin_headers, make_staff,
                                                         linked_participant):
    """
    `admin_id` is a raw ObjectId on the document. Returning it unconverted made this
    endpoint 500 for any privileged account — and `super_admin`, `admin` and
    `volunteer` are all required to be linked, so the roster broke as soon as one
    existed.
    """
    make_staff(paradox_id="ADHO1111", email="a@x.com", role="admin",
               admin_id=linked_participant["_id"])
    response = client.get("/backend_teams", headers=admin_headers)
    assert response.status_code == 200

    linked = next(row for row in response.json() if row["paradox_id"] == "ADHO1111")
    assert linked["admin_id"] == str(linked_participant["_id"])


def test_an_unlinked_account_reports_a_null_link(client, admin_headers, make_staff):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    row = next(r for r in client.get("/backend_teams", headers=admin_headers).json()
               if r["paradox_id"] == "OTHO1111")
    assert row["admin_id"] is None


def test_the_roster_is_json_serialisable_end_to_end(client, admin_headers, make_staff,
                                                    linked_participant):
    """No ObjectId anywhere in the response, whatever the account shape."""
    import json

    make_staff(paradox_id="ADHO1111", email="a@x.com", role="admin",
               admin_id=linked_participant["_id"])
    make_staff(paradox_id="OTHO2222", email="b@x.com", role="other")
    json.dumps(client.get("/backend_teams", headers=admin_headers).json())


# ---------------------------------------------------------------------------
# PUT /backend_teams/{paradox_id}
# ---------------------------------------------------------------------------

def test_a_designation_can_be_changed(client, admin_headers, make_staff):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    response = client.put("/backend_teams/OTHO1111", json={"designation": "Night Desk"},
                          headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Backend team updated successfully"}
    assert database.backend_teams_collection.find_one(
        {"paradox_id": "OTHO1111"}
    )["designation"] == "Night Desk"


def test_an_unknown_account_is_a_404(client, admin_headers):
    response = client.put("/backend_teams/OTHO9999", json={"designation": "x"},
                          headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Backend team member not found"


def test_role_and_department_cannot_be_patched(client, admin_headers, make_staff):
    """Both drive the `paradox_id` prefix assigned at creation."""
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other", department="hostels")
    client.put("/backend_teams/OTHO1111",
               json={"role": "super_admin", "department": "technical", "designation": "x"},
               headers=admin_headers)
    document = database.backend_teams_collection.find_one({"paradox_id": "OTHO1111"})
    assert document["role"] == "other"
    assert document["department"] == "hostels"


def test_an_empty_body_writes_nothing_but_still_answers_200(client, admin_headers, make_staff):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    # Read back rather than reusing the in-memory fixture document: mongomock
    # truncates a datetime to millisecond precision on insert, so the two differ
    # by microseconds even when nothing has been written.
    before = database.backend_teams_collection.find_one({"paradox_id": "OTHO1111"})

    response = client.put("/backend_teams/OTHO1111", json={}, headers=admin_headers)

    assert response.status_code == 200
    after = database.backend_teams_collection.find_one({"paradox_id": "OTHO1111"})
    assert after["updated_at"] == before["updated_at"], "no write, so no new timestamp"


def test_whether_a_password_changed_is_recorded_in_the_durable_row(
    client, admin_headers, make_staff, audit, caplog
):
    """
    The row keeps the real value while the mirrored file line redacts it, because
    `password_changed` contains "password" and `redact` matches key substrings.
    Pinned so the asymmetry is deliberate rather than surprising: the durable
    trail is what answers the question, the console line does not.
    """
    import logging

    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    with caplog.at_level(logging.INFO, logger="paradox.audit"):
        client.put("/backend_teams/OTHO1111", json={"designation": "x"}, headers=admin_headers)

    assert audit.one("UPDATE_STAFF")["details"]["password_changed"] is False
    emitted = [r for r in caplog.records if r.getMessage() == "audit UPDATE_STAFF"]
    assert emitted[-1].details["password_changed"] == "[redacted]"


def test_a_no_op_update_is_recorded_as_such(client, admin_headers, make_staff, audit):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    client.put("/backend_teams/OTHO1111", json={}, headers=admin_headers)
    row = audit.one("UPDATE_STAFF")
    assert row["details"]["no_op"] is True
    assert row["details"]["fields_updated"] == []


def test_a_blank_designation_is_a_422(client, admin_headers, make_staff):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    assert client.put("/backend_teams/OTHO1111", json={"designation": ""},
                      headers=admin_headers).status_code == 422


def test_an_update_is_audited_with_field_names_and_the_targets_role(
    client, admin_headers, make_staff, audit
):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other", department="hostels")
    client.put("/backend_teams/OTHO1111", json={"designation": "Night Desk", "name": "Ravi"},
               headers=admin_headers)
    row = audit.one("UPDATE_STAFF")
    assert row["target_id"] == "OTHO1111"
    assert row["details"]["fields_updated"] == ["designation", "name"]
    assert row["details"]["password_changed"] is False
    assert row["details"]["target_role"] == "other"
    assert row["details"]["target_department"] == "hostels"


def test_a_missing_target_is_recorded(client, admin_headers, audit):
    client.put("/backend_teams/OTHO9999", json={"designation": "x"}, headers=admin_headers)
    row = audit.one("UPDATE_STAFF_DENIED")
    assert row["details"]["reason"] == "staff_not_found"
    assert row["target_id"] == "OTHO9999"


# ---------------------------------------------------------------------------
# DELETE /backend_teams/{paradox_id}
# ---------------------------------------------------------------------------

def test_an_account_can_be_deleted(client, admin_headers, make_staff):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    response = client.delete("/backend_teams/OTHO1111", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Backend team deleted"}
    assert database.backend_teams_collection.find_one({"paradox_id": "OTHO1111"}) is None


def test_deleting_an_unknown_account_is_a_404(client, admin_headers):
    response = client.delete("/backend_teams/OTHO9999", headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Backend team member not found"


def test_the_deleted_accounts_details_are_preserved_in_the_row(
    client, admin_headers, make_staff, audit
):
    """After this line they exist nowhere else, while the id stays scattered
    across team rosters and every scan the account ever made."""
    make_staff(paradox_id="OTHO1111", email="block.desk@ds.study.iitm.ac.in", role="other",
               department="hostels", designation="Block Desk", name="Ravi")
    client.delete("/backend_teams/OTHO1111", headers=admin_headers)

    row = audit.one("DELETE_STAFF")
    assert row["details"]["deleted_role"] == "other"
    assert row["details"]["deleted_department"] == "hostels"
    assert row["details"]["deleted_designation"] == "Block Desk"
    assert row["details"]["deleted_name"] == "Ravi"
    assert row["details"]["email_local"] == "block.desk"
    assert row["details"]["was_linked_to_participant"] is False


def test_a_deleted_account_can_no_longer_log_in(client, admin_headers, make_staff, password):
    make_staff(paradox_id="OTHO1111", email="a@ds.study.iitm.ac.in", role="other")
    client.delete("/backend_teams/OTHO1111", headers=admin_headers)
    assert client.post("/auth/admin/login",
                       json={"email": "a@ds.study.iitm.ac.in",
                             "password": password}).status_code == 401


def test_deletion_does_not_cascade_to_duty_rosters(client, admin_headers, make_staff):
    """
    Pinned, not endorsed: nothing cleans up `hostel_team`, `mess_team`,
    `query_team`, or event-team references to the deleted id. The audit row above
    is what keeps those references resolvable.
    """
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    database.hostel_collection.insert_one({
        "hostel_id": "HSTL111", "hostel_team": [{"user_id": "OTHO1111", "attendance": True}],
    })
    client.delete("/backend_teams/OTHO1111", headers=admin_headers)
    hostel = database.hostel_collection.find_one({"hostel_id": "HSTL111"})
    assert hostel["hostel_team"][0]["user_id"] == "OTHO1111"


def test_a_deleted_accounts_own_token_stops_working(client, admin_headers, make_staff):
    staff = make_staff(paradox_id="OTHO1111", email="a@x.com", role="other")
    headers = auth_headers(staff)
    client.delete("/backend_teams/OTHO1111", headers=admin_headers)
    response = client.get("/backend_teams", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == "Staff member not found"
