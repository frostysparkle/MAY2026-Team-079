"""
Endpoint tests for /participants — the admin dashboard's read and write halves.

`/statistics` and the roster are deliberately separate endpoints: a dashboard that
shows totals to whoever can see the dashboard must not be the thing that leaks a
list of names. Both are asserted here, including the projection that keeps
`password_hash` and `qr_secrets` from ever leaving the collection.
"""
from datetime import datetime, timedelta

import pytest

import database
from testing.helpers import auth_headers


@pytest.fixture()
def population(make_participant):
    """A mixed population, so every counter has something to count."""
    mess = database.mess_collection.insert_one({"mess_id": "MESS1", "type": "jain"}).inserted_id
    day = datetime(2026, 6, 10, 9, 0)
    return [
        make_participant(
            participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
            profile={"full_name": "Asha", "house": "Gir", "gender": "female",
                     "program": "DS", "course_stage": "diploma"},
            mess={"registered": True, "mess_id": mess},
            accommodation={"registered": True, "hostel_id": "HSTL111", "inside": True},
            events=[{"event_id": "x"}], workshops=[{"slot_id": "D1S1"}],
            created_at=day,
        ),
        make_participant(
            participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
            profile={"full_name": "Bala", "house": "Gir", "gender": "male",
                     "program": "MS", "course_stage": "degree"},
            mess={"registered": True, "mess_id": None},
            accommodation={"registered": True, "hostel_id": None, "inside": False},
            created_at=day,
        ),
        make_participant(
            participant_id="DS23F000003", email="c@ds.study.iitm.ac.in",
            profile={},  # signed up, profile not completed
            created_at=day + timedelta(days=1),
        ),
    ]


# ---------------------------------------------------------------------------
# Authorization — all three routes are super-admin only
# ---------------------------------------------------------------------------

ROUTES = [
    ("get", "/participants/statistics"),
    ("get", "/participants"),
    ("patch", "/participants/DS23F000001"),
]


@pytest.mark.parametrize("method,path", ROUTES)
def test_a_participant_token_is_refused_at_the_auth_layer(client, participant, method, path):
    response = getattr(client, method)(path, headers=auth_headers(participant),
                                       **({"json": {}} if method == "patch" else {}))
    assert response.status_code == 403
    assert response.json()["detail"] == "Staff credentials required. Use /auth/admin/login."


@pytest.mark.parametrize("method,path", ROUTES)
def test_ordinary_staff_are_refused_by_the_route(client, staff_headers, method, path):
    response = getattr(client, method)(path, headers=staff_headers,
                                       **({"json": {}} if method == "patch" else {}))
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized"


@pytest.mark.parametrize("method,path", ROUTES)
def test_no_token_is_refused(client, method, path):
    response = getattr(client, method)(path, **({"json": {}} if method == "patch" else {}))
    assert response.status_code in (401, 403)


def test_a_refusal_is_recorded_with_the_operation(client, staff_headers, audit):
    client.get("/participants", headers=staff_headers)
    row = audit.latest("AUTHZ_DENIED")
    assert row["details"]["reason"] == "not_super_admin"
    assert row["details"]["resource"] == "participants"
    assert row["details"]["status"] == 403


def test_the_role_is_read_from_mongo_so_a_forged_claim_cannot_escalate(client, plain_staff):
    from datetime import timedelta as _td

    from security import create_access_token

    forged = create_access_token(
        {"sub": plain_staff["paradox_id"], "type": "staff", "role": "super_admin"},
        expires_delta=_td(minutes=5),
    )
    response = client.get("/participants", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# GET /participants/statistics
# ---------------------------------------------------------------------------

def test_statistics_on_an_empty_collection(client, admin_headers):
    body = client.get("/participants/statistics", headers=admin_headers).json()
    assert body["total_registered"] == 0
    assert body["profile_complete"] == 0
    assert body["profile_incomplete"] == 0
    assert body["by_house"] == {}
    assert body["signups_by_day"] == {}


def test_statistics_counts_the_whole_population(client, admin_headers, population):
    body = client.get("/participants/statistics", headers=admin_headers).json()
    assert body["total_registered"] == 3
    # `full_name` is what separates "signed up" from "ready".
    assert body["profile_complete"] == 2
    assert body["profile_incomplete"] == 1
    assert body["mess_registered"] == 2
    assert body["mess_allotted"] == 1
    assert body["hostel_registered"] == 2
    assert body["hostel_allotted"] == 1
    assert body["currently_on_campus"] == 1
    assert body["with_event_registrations"] == 1
    assert body["with_workshop_registrations"] == 1


def test_registration_and_allotment_are_counted_independently(client, admin_headers, population):
    """A participant may be registered without a hall, which is what
    `hostel_pending` reports."""
    body = client.get("/participants/statistics", headers=admin_headers).json()
    assert body["hostel_pending"] == 1


def test_hostel_pending_never_goes_negative(client, admin_headers, make_participant):
    """Allocation can only ever catch up with the queue."""
    make_participant(accommodation={"registered": False, "hostel_id": "HSTL111"})
    assert client.get("/participants/statistics",
                      headers=admin_headers).json()["hostel_pending"] == 0


def test_the_breakdowns_group_by_value(client, admin_headers, population):
    body = client.get("/participants/statistics", headers=admin_headers).json()
    assert body["by_house"] == {"Gir": 2}
    assert body["by_gender"] == {"female": 1, "male": 1}
    assert body["by_program"] == {"DS": 1, "MS": 1}
    assert body["by_course_stage"] == {"diploma": 1, "degree": 1}


def test_signups_are_bucketed_by_day_in_chronological_order(client, admin_headers, population):
    body = client.get("/participants/statistics", headers=admin_headers).json()
    assert list(body["signups_by_day"]) == ["2026-06-10", "2026-06-11"]
    assert body["signups_by_day"] == {"2026-06-10": 2, "2026-06-11": 1}


def test_a_string_created_at_is_skipped_rather_than_crashing(
    client, admin_headers, make_participant
):
    """`hasattr(created, "strftime")` guards a seeded document whose timestamp is
    an ISO string rather than a BSON date."""
    make_participant(participant_id="DS23F000009", email="s@ds.study.iitm.ac.in",
                     created_at="2026-06-10T09:00:00")
    body = client.get("/participants/statistics", headers=admin_headers).json()
    assert body["total_registered"] == 1
    assert body["signups_by_day"] == {}


def test_a_null_created_at_is_skipped(client, admin_headers, make_participant):
    make_participant(created_at=None)
    assert client.get("/participants/statistics",
                      headers=admin_headers).json()["signups_by_day"] == {}


def test_statistics_returns_counts_only_and_never_a_roster(client, admin_headers, population):
    """The whole reason this is a separate endpoint from the roster below."""
    body = client.get("/participants/statistics", headers=admin_headers).json()
    serialised = str(body)
    for identifying in ("Asha", "DS23F000001", "a@ds.study.iitm.ac.in", "$2b$", "PRIVATE"):
        assert identifying not in serialised


def test_statistics_writes_no_audit_row(client, admin_headers, population, audit):
    client.get("/participants/statistics", headers=admin_headers)
    assert audit.rows("UPDATE_PARTICIPANT") == []


# ---------------------------------------------------------------------------
# GET /participants
# ---------------------------------------------------------------------------

def test_the_roster_returns_a_count_and_the_rows(client, admin_headers, population):
    body = client.get("/participants", headers=admin_headers).json()
    assert body["count"] == 3
    assert len(body["participants"]) == 3


def test_credentials_never_leave_the_collection(client, admin_headers, population):
    """An inclusion allow-list, so a field added later stays private until named."""
    serialised = str(client.get("/participants", headers=admin_headers).json())
    for secret in ("password_hash", "$2b$", "qr_secrets", "private_key", "embedding"):
        assert secret not in serialised


def test_photos_are_excluded_for_size(client, admin_headers, make_participant):
    make_participant(photo="a" * 5000)
    assert "photo" not in str(client.get("/participants", headers=admin_headers).json())


def test_the_arrays_are_replaced_by_counts(client, admin_headers, population):
    rows = client.get("/participants", headers=admin_headers).json()["participants"]
    asha = next(r for r in rows if r["participant_id"] == "DS23F000001")
    assert asha["event_count"] == 1
    assert asha["workshop_count"] == 1
    assert "events" not in asha and "workshops" not in asha


def test_object_ids_are_stringified_rather_than_crashing_the_response(
    client, admin_headers, population
):
    rows = client.get("/participants", headers=admin_headers).json()["participants"]
    asha = next(r for r in rows if r["participant_id"] == "DS23F000001")
    assert isinstance(asha["mess"]["mess_id"], str)


def test_a_null_mess_id_stays_null(client, admin_headers, population):
    rows = client.get("/participants", headers=admin_headers).json()["participants"]
    bala = next(r for r in rows if r["participant_id"] == "DS23F000002")
    assert bala["mess"]["mess_id"] is None


def test_an_event_registration_object_id_is_stringified(client, admin_headers, make_participant):
    from bson import ObjectId

    oid = ObjectId()
    make_participant(events=[{"event_id": oid, "team_id": None}])
    response = client.get("/participants", headers=admin_headers)
    assert response.status_code == 200, "an unstringified ObjectId would 500 here"
    assert response.json()["participants"][0]["event_count"] == 1


@pytest.mark.parametrize("needle,expected", [
    ("Asha", "DS23F000001"),
    ("asha", "DS23F000001"),
    ("DS23F000002", "DS23F000002"),
    ("b@ds.study", "DS23F000002"),
])
def test_the_search_matches_name_email_or_id_case_insensitively(
    client, admin_headers, population, needle, expected
):
    body = client.get(f"/participants?q={needle}", headers=admin_headers).json()
    assert [r["participant_id"] for r in body["participants"]] == [expected]


def test_regex_metacharacters_are_escaped(client, admin_headers, population):
    """`re.escape`, so a search for `.*` matches literally rather than everything."""
    assert client.get("/participants?q=.*", headers=admin_headers).json()["count"] == 0


def test_the_search_term_is_stripped(client, admin_headers, population):
    assert client.get("/participants?q=  Asha  ", headers=admin_headers).json()["count"] == 1


def test_the_house_filter_is_exact(client, admin_headers, population):
    assert client.get("/participants?house=Gir", headers=admin_headers).json()["count"] == 2
    assert client.get("/participants?house=gir", headers=admin_headers).json()["count"] == 0


def test_the_filters_combine(client, admin_headers, population):
    body = client.get("/participants?house=Gir&q=Bala", headers=admin_headers).json()
    assert [r["participant_id"] for r in body["participants"]] == ["DS23F000002"]


def test_the_limit_caps_the_page(client, admin_headers, population):
    assert client.get("/participants?limit=2", headers=admin_headers).json()["count"] == 2


def test_a_non_numeric_limit_is_a_422(client, admin_headers):
    assert client.get("/participants?limit=abc", headers=admin_headers).status_code == 422


@pytest.mark.xfail(
    strict=False,
    reason="KNOWN DEFECT: `limit` is unvalidated, and `limit=0` means 'no limit' in "
           "Mongo semantics rather than 'no rows'. A client paging with a computed "
           "limit that reaches 0 receives the entire roster.",
)
def test_a_zero_limit_returns_no_rows(client, admin_headers, population):
    assert client.get("/participants?limit=0", headers=admin_headers).json()["count"] == 0


# ---------------------------------------------------------------------------
# PATCH /participants/{participant_id}
# ---------------------------------------------------------------------------

def test_an_admin_can_correct_one_field(client, admin_headers, participant):
    response = client.patch(f"/participants/{participant['participant_id']}",
                            json={"full_name": "Corrected Name"}, headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["profile"]["full_name"] == "Corrected Name"


def test_untouched_profile_fields_survive(client, admin_headers, participant):
    """Dotted `$set` keys, so a form that fixes a phone number cannot blank an
    address."""
    client.patch(f"/participants/{participant['participant_id']}",
                 json={"phone": "9111111111"}, headers=admin_headers)
    profile = database.participants_collection.find_one(
        {"_id": participant["_id"]}
    )["profile"]
    assert profile["phone"] == "9111111111"
    assert profile["full_name"] == "Test Participant"
    assert profile["address"] == "1 Test Street"


def test_an_unknown_participant_is_a_404(client, admin_headers):
    response = client.patch("/participants/DS23F999999", json={"phone": "9"},
                            headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Participant not found"


def test_an_empty_body_is_a_400(client, admin_headers, participant):
    response = client.patch(f"/participants/{participant['participant_id']}",
                            json={}, headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Nothing to update"


def test_an_all_null_body_is_also_a_400(client, admin_headers, participant):
    """`exclude_none=True`, so a null-filled form cannot blank the profile."""
    response = client.patch(f"/participants/{participant['participant_id']}",
                            json={"phone": None, "city": None}, headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Nothing to update"


def test_an_out_of_vocabulary_value_is_a_422(client, admin_headers, participant):
    response = client.patch(f"/participants/{participant['participant_id']}",
                            json={"house": "Hogwarts"}, headers=admin_headers)
    assert response.status_code == 422


def test_a_nested_emergency_contact_is_written(client, admin_headers, participant):
    contact = {"name": "Ravi", "relation": "father", "phone": "9000000009"}
    body = client.patch(f"/participants/{participant['participant_id']}",
                        json={"emergency_contact": contact}, headers=admin_headers).json()
    assert body["profile"]["emergency_contact"] == contact


def test_identity_and_allocation_fields_are_unreachable(client, admin_headers, participant):
    """
    Not rejected — ignored, because they are absent from the model. The point is
    that an admin cannot rewrite an id, a credential, or a hall placement here.
    """
    client.patch(f"/participants/{participant['participant_id']}",
                 json={"full_name": "Fine", "email": "hijack@x.com",
                       "participant_id": "DS23F999999", "password_hash": "x",
                       "mess": {"mess_id": "forced"}},
                 headers=admin_headers)
    document = database.participants_collection.find_one({"_id": participant["_id"]})
    assert document["email"] == participant["email"]
    assert document["participant_id"] == participant["participant_id"]
    assert document["password_hash"] == participant["password_hash"]
    assert document["mess"]["mess_id"] is None


def test_the_edit_is_audited_with_field_names_only(client, admin_headers, participant, audit):
    client.patch(f"/participants/{participant['participant_id']}",
                 json={"phone": "9111111111", "city": "Madurai"}, headers=admin_headers)
    row = audit.one("UPDATE_PARTICIPANT")
    assert row["target_id"] == participant["participant_id"]
    assert row["details"]["fields_updated"] == ["city", "phone"]
    assert "9111111111" not in str(row["details"])


def test_the_acting_admin_is_named_in_the_row(client, admin_headers, participant, super_admin, audit):
    client.patch(f"/participants/{participant['participant_id']}",
                 json={"phone": "9"}, headers=admin_headers)
    row = audit.one("UPDATE_PARTICIPANT")
    assert row["actor_id"] == super_admin["paradox_id"]
    assert row["actor_type"] == "staff"
    assert row["actor_role"] == "super_admin"


def test_updated_at_is_stamped(client, admin_headers, participant):
    client.patch(f"/participants/{participant['participant_id']}",
                 json={"phone": "9"}, headers=admin_headers)
    assert database.participants_collection.find_one(
        {"_id": participant["_id"]}
    )["updated_at"] >= participant["updated_at"]


def test_the_statistics_path_is_not_captured_as_a_participant_id(client, admin_headers):
    """`PATCH /participants/statistics` has no handler of its own, so it routes
    into the id route and reports a missing participant."""
    response = client.patch("/participants/statistics", json={"phone": "9"},
                            headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Participant not found"


def test_an_edit_is_reflected_in_the_statistics_breakdown(client, admin_headers, participant):
    """Cross-checks that the write and the read agree."""
    client.patch(f"/participants/{participant['participant_id']}",
                 json={"house": "Gir"}, headers=admin_headers)
    body = client.get("/participants/statistics", headers=admin_headers).json()
    assert body["by_house"] == {"Gir": 1}
