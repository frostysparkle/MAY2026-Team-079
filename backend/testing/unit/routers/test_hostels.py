"""
Endpoint tests for /hostels.

The entry/exit state machine is the most safety-relevant logic in the API:
`accommodation.inside` is what answers "who is in this building" if it ever has to
be evacuated, and `arrival`/`departure` answer "was this student ever here". Every
transition and every refusal is asserted, together with the state recorded alongside
each refusal.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers, corrupt_qr, make_qr

CREATE = {"name": "Ganga", "capacity": 4, "gender": "male", "sharing": 2, "num_rooms": 2}
GUARD = "OTHO1111"


@pytest.fixture()
def guard(make_staff):
    """Hostel duty staff must hold role `other`."""
    return make_staff(paradox_id=GUARD, email="gate@ds.study.iitm.ac.in", role="other",
                      department="hostels", designation="Gate Guard")


def make_hostel(hostel_id="HSTL111", **kwargs):
    doc = factories.hostel_doc(hostel_id, **kwargs)
    database.hostel_collection.insert_one(doc)
    return database.hostel_collection.find_one({"_id": doc["_id"]})


def stored(hostel_id="HSTL111"):
    return database.hostel_collection.find_one({"hostel_id": hostel_id})


def accommodation(person):
    return database.participants_collection.find_one({"_id": person["_id"]})["accommodation"]


# ===========================================================================
# Create / read / delete
# ===========================================================================

def test_a_block_is_created_with_generated_rooms(client, admin_headers):
    response = client.post("/hostels", json=CREATE, headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Hostel created", "hostel_id": "HSTL111"}

    document = stored()
    assert [room["room_number"] for room in document["rooms"]] == ["101", "102"]
    assert all(room["occupants"] == [] for room in document["rooms"])
    assert document["current_occupancy"] == 0
    assert document["hostel_team"] == []


def test_the_gender_decision_is_recorded_because_it_cannot_be_changed(
    client, admin_headers, audit
):
    client.post("/hostels", json=CREATE, headers=admin_headers)
    details = audit.one("CREATE_HOSTEL")["details"]
    assert details["gender"] == "male"
    assert details["beds"] == 4
    assert details["num_rooms"] == 2


def test_ids_are_handed_out_sequentially(client, admin_headers):
    first = client.post("/hostels", json=CREATE, headers=admin_headers).json()["hostel_id"]
    second = client.post("/hostels", json=CREATE, headers=admin_headers).json()["hostel_id"]
    assert (first, second) == ("HSTL111", "HSTL112")


def test_an_id_collision_is_reported_rather_than_silently_duplicated(
    client, admin_headers, audit, caplog
):
    """
    The counter restarts from its seed on every process restart and there is no
    unique index, so a collision would produce two blocks sharing one id.
    """
    import logging

    make_hostel("HSTL111")
    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        client.post("/hostels", json=CREATE, headers=admin_headers)

    assert audit.one("ID_COLLISION")["details"]["reason"] == "hostel_id_collision"
    assert any(getattr(r, "reason", None) == "hostel_id_collision" for r in caplog.records)


@pytest.mark.parametrize("bad,reason", [
    ({"gender": "other"}, "unknown gender"),
    ({"capacity": 0}, "non-positive capacity"),
    ({"sharing": 0}, "non-positive sharing"),
    ({"num_rooms": 0}, "non-positive rooms"),
    ({"capacity": 10, "sharing": 2, "num_rooms": 2}, "rooms cannot hold the capacity"),
])
def test_schema_violations_are_422(client, admin_headers, bad, reason):
    assert client.post("/hostels", json={**CREATE, **bad},
                       headers=admin_headers).status_code == 422, reason


def test_gender_is_normalised(client, admin_headers):
    client.post("/hostels", json={**CREATE, "gender": " FEMALE "}, headers=admin_headers)
    assert stored()["gender"] == "female"


def test_only_super_admins_can_create(client, staff_headers):
    response = client.post("/hostels", json=CREATE, headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized"


def test_a_refusal_names_the_resource(client, staff_headers, audit):
    client.post("/hostels", json=CREATE, headers=staff_headers)
    assert audit.latest("AUTHZ_DENIED")["details"]["resource"] == "hostels"


def test_any_authenticated_user_can_list_blocks(client, participant):
    make_hostel()
    rows = client.get("/hostels", headers=auth_headers(participant)).json()
    assert rows[0]["hostel_id"] == "HSTL111"
    assert "_id" not in rows[0]


def test_a_single_block_is_readable_and_a_missing_one_is_a_404(client, participant):
    make_hostel()
    assert client.get("/hostels/HSTL111",
                      headers=auth_headers(participant)).json()["hostel_id"] == "HSTL111"
    response = client.get("/hostels/NOPE", headers=auth_headers(participant))
    assert response.status_code == 404
    assert response.json()["detail"] == "Hostel not found"


def test_deleting_a_block_resets_its_residents(client, admin_headers, make_participant):
    from datetime import datetime

    make_hostel()
    person = make_participant(accommodation={
        "registered": True, "hostel_id": "HSTL111", "room": "101",
        "inside": True, "arrival": datetime.utcnow(), "departure": None,
    })
    response = client.delete("/hostels/HSTL111", headers=admin_headers)

    assert response.status_code == 200
    assert response.json() == {"message": "Hostel deleted", "participants_reset": 1}
    after = accommodation(person)
    assert after["hostel_id"] is None
    assert after["room"] is None
    assert after["inside"] is False
    assert after["arrival"] is None
    assert after["departure"] is None
    assert after["registered"] is True, "they still want a bed, just not this one"


def test_the_deletion_captures_who_lived_there(client, admin_headers, make_participant, audit):
    """Afterwards nothing links these people to this block, and `arrival` — the
    record of whether they were physically present — is gone."""
    from datetime import datetime

    make_hostel()
    person = make_participant(accommodation={
        "registered": True, "hostel_id": "HSTL111", "room": "101",
        "inside": True, "arrival": datetime.utcnow(),
    })
    client.delete("/hostels/HSTL111", headers=admin_headers)

    details = audit.one("DELETE_HOSTEL")["details"]
    assert details["residents"] == [
        {"participant_id": person["participant_id"], "room": "101",
         "was_inside": True, "had_arrived": True},
    ]
    assert details["were_inside_at_deletion"] == [person["participant_id"]]


def test_deleting_a_block_with_residents_inside_is_flagged(
    client, admin_headers, make_participant, caplog
):
    import logging

    make_hostel()
    make_participant(accommodation={"registered": True, "hostel_id": "HSTL111", "inside": True})
    with caplog.at_level(logging.WARNING, logger="paradox.hostels"):
        client.delete("/hostels/HSTL111", headers=admin_headers)
    assert any(getattr(r, "reason", None) == "deleted_with_residents_inside"
               for r in caplog.records)


def test_deleting_an_unknown_block_is_a_404(client, admin_headers):
    assert client.delete("/hostels/NOPE", headers=admin_headers).status_code == 404


# ===========================================================================
# Team
# ===========================================================================

def test_duty_staff_are_assigned(client, admin_headers, guard):
    make_hostel()
    response = client.post("/hostels/HSTL111/team", json={"user_id": GUARD, "role": "guard"},
                           headers=admin_headers)
    assert response.status_code == 200
    assert stored()["hostel_team"] == [{"user_id": GUARD, "role": "guard", "attendance": True}]


def test_the_member_must_hold_role_other(client, admin_headers, plain_staff):
    """This stops a super admin's own id, or an admin from another department,
    being added as a block's duty staff by mistake."""
    make_hostel()
    response = client.post("/hostels/HSTL111/team",
                           json={"user_id": plain_staff["paradox_id"], "role": "guard"},
                           headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == \
        "user_id must reference an existing backend_teams member with role 'other'"


def test_the_wrong_role_is_distinguished_from_no_account_at_all(
    client, admin_headers, plain_staff, audit
):
    make_hostel()
    client.post("/hostels/HSTL111/team", json={"user_id": plain_staff["paradox_id"],
                                              "role": "guard"}, headers=admin_headers)
    row = audit.latest("ASSIGN_HOSTEL_TEAM_DENIED")
    assert row["details"]["reason"] == "staff_role_not_other"
    assert row["details"]["actual_staff_role"] == "admin"

    client.post("/hostels/HSTL111/team", json={"user_id": "GHOST", "role": "guard"},
                headers=admin_headers)
    assert audit.rows("ASSIGN_HOSTEL_TEAM_DENIED")[-1]["details"]["reason"] == "staff_not_found"


def test_assigning_to_an_unknown_block_is_a_404(client, admin_headers, guard):
    response = client.post("/hostels/NOPE/team", json={"user_id": GUARD, "role": "guard"},
                           headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Hostel not found"


def test_assigning_the_same_person_twice_is_a_409(client, admin_headers, guard):
    make_hostel()
    client.post("/hostels/HSTL111/team", json={"user_id": GUARD, "role": "guard"},
                headers=admin_headers)
    response = client.post("/hostels/HSTL111/team", json={"user_id": GUARD, "role": "guard"},
                           headers=admin_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == "Team member already assigned to this hostel"


@pytest.mark.parametrize("role", ["volunteer", "warden", ""])
def test_an_unknown_role_is_a_422(client, admin_headers, guard, role):
    make_hostel()
    assert client.post("/hostels/HSTL111/team", json={"user_id": GUARD, "role": role},
                       headers=admin_headers).status_code == 422


def test_assigning_with_scanning_off_is_flagged(client, admin_headers, guard, caplog):
    """A guard on the roster who is refused at the door looks identical to a broken
    scanner from where they are standing."""
    import logging

    make_hostel()
    with caplog.at_level(logging.WARNING, logger="paradox.hostels"):
        client.post("/hostels/HSTL111/team",
                    json={"user_id": GUARD, "role": "guard", "attendance": False},
                    headers=admin_headers)
    assert any(getattr(r, "reason", None) == "assigned_without_scanning"
               for r in caplog.records)


def test_scanning_can_be_revoked_and_is_audited(client, admin_headers, guard, audit):
    make_hostel(hostel_team=[factories.hostel_team_member(GUARD)])
    response = client.put(f"/hostels/HSTL111/team/{GUARD}/toggle_scan?attendance=false",
                          headers=admin_headers)
    assert response.status_code == 200
    assert stored()["hostel_team"][0]["attendance"] is False
    row = audit.one("TOGGLE_HOSTEL_SCAN")
    assert row["details"]["applied"] is True
    assert row["details"]["scanning_enabled"] is False


def test_toggling_a_non_member_reports_that_nothing_applied(client, admin_headers, audit):
    make_hostel()
    response = client.put("/hostels/HSTL111/team/GHOST/toggle_scan?attendance=true",
                          headers=admin_headers)
    assert response.status_code == 200
    assert audit.one("TOGGLE_HOSTEL_SCAN")["details"]["applied"] is False


# ===========================================================================
# Registration and allocation
# ===========================================================================

def test_a_participant_opts_in(client, participant):
    response = client.post("/hostels/register", headers=auth_headers(participant))
    assert response.status_code == 200
    assert response.json() == {"message": "Accommodation requested"}
    assert accommodation(participant)["registered"] is True


def test_asking_twice_is_not_an_error(client, participant):
    client.post("/hostels/register", headers=auth_headers(participant))
    assert client.post("/hostels/register", headers=auth_headers(participant)).status_code == 200


def test_the_request_records_whether_a_gender_is_on_file(client, participant, audit):
    """That is what decides, later, whether allocation can place them at all."""
    client.post("/hostels/register", headers=auth_headers(participant))
    row = audit.one("ACCOMMODATION_REGISTER")
    assert row["target_id"] == participant["participant_id"]
    assert row["details"]["gender"] == "male"


def test_a_request_can_be_withdrawn(client, participant):
    client.post("/hostels/register", headers=auth_headers(participant))
    response = client.delete("/hostels/register", headers=auth_headers(participant))
    assert response.status_code == 200
    assert accommodation(participant)["registered"] is False


def test_neither_request_nor_withdrawal_is_allowed_once_allotted(
    client, make_participant
):
    """Releasing an allocated bed is an organiser decision, not self-service."""
    person = make_participant(accommodation={"registered": True, "hostel_id": "HSTL111"})
    for method in ("post", "delete"):
        response = getattr(client, method)("/hostels/register", headers=auth_headers(person))
        assert response.status_code == 400
        assert response.json()["detail"] == "Accommodation already allotted"


def test_the_refusal_names_the_block(client, make_participant, audit):
    person = make_participant(accommodation={"registered": True, "hostel_id": "HSTL111"})
    client.post("/hostels/register", headers=auth_headers(person))
    row = audit.latest("ACCOMMODATION_REGISTER_DENIED")
    assert row["details"]["reason"] == "already_allotted"
    assert row["details"]["hostel_id"] == "HSTL111"


def test_a_staff_token_cannot_request_accommodation(client, admin_headers):
    assert client.post("/hostels/register", headers=admin_headers).status_code == 403


def test_registrants_are_placed_into_a_block_of_their_gender(
    client, admin_headers, make_participant
):
    make_hostel("HSTL111", gender="male", sharing=1, num_rooms=1)
    make_hostel("HSTL112", gender="female", sharing=1, num_rooms=1)
    man = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                           profile={"gender": "male"},
                           accommodation={"registered": True, "hostel_id": None})
    woman = make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
                             profile={"gender": "female"},
                             accommodation={"registered": True, "hostel_id": None})

    response = client.post("/hostels/allocate", headers=admin_headers)

    assert response.json() == {"message": "Allocated 2 participants to hostels"}
    assert accommodation(man)["hostel_id"] == "HSTL111"
    assert accommodation(woman)["hostel_id"] == "HSTL112"


def test_a_placed_participant_gets_a_room_and_the_block_counts_them(
    client, admin_headers, make_participant
):
    make_hostel(sharing=2, num_rooms=2)
    person = make_participant(profile={"gender": "male"},
                              accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)

    assert accommodation(person)["room"] == "101"
    document = stored()
    assert document["rooms"][0]["occupants"] == [person["participant_id"]]
    assert document["current_occupancy"] == 1


def test_rooms_fill_before_the_next_one_opens(client, admin_headers, make_participant):
    make_hostel(sharing=2, num_rooms=2)
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in",
                               profile={"gender": "male"},
                               accommodation={"registered": True, "hostel_id": None})
              for i in range(1, 4)]
    client.post("/hostels/allocate", headers=admin_headers)

    rooms = {room["room_number"]: room["occupants"] for room in stored()["rooms"]}
    assert len(rooms["101"]) == 2
    assert len(rooms["102"]) == 1


def test_only_registrants_are_placed(client, admin_headers, make_participant):
    make_hostel()
    optout = make_participant(profile={"gender": "male"},
                              accommodation={"registered": False, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)
    assert accommodation(optout)["hostel_id"] is None


def test_a_participant_with_no_gender_is_reported_individually(
    client, admin_headers, make_participant, audit
):
    make_hostel()
    person = make_participant(profile={"gender": None},
                              accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)

    assert accommodation(person)["hostel_id"] is None
    row = audit.one("HOSTEL_ALLOCATION_SKIPPED")
    assert row["details"]["reason"] == "missing_gender"


def test_no_block_for_a_gender_is_a_distinct_reason(client, admin_headers, make_participant, audit):
    make_hostel(gender="male")
    make_participant(profile={"gender": "female"},
                     accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)
    assert audit.one("HOSTEL_ALLOCATION_SKIPPED")["details"]["reason"] == "no_block_for_gender"


def test_exhausted_beds_are_a_third_reason(client, admin_headers, make_participant, audit):
    make_hostel(sharing=1, num_rooms=1)
    for index in (1, 2):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         profile={"gender": "male"},
                         accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)
    assert audit.one("HOSTEL_ALLOCATION_SKIPPED")["details"]["reason"] == "capacity_exhausted"


@pytest.fixture()
def candidate_with_absent_key(make_participant):
    person = make_participant(profile={"gender": "male"}, accommodation={"registered": True})
    database.participants_collection.update_one(
        {"_id": person["_id"]}, {"$unset": {"accommodation.hostel_id": ""}}
    )
    return person


def test_a_participant_with_no_hostel_id_key_is_still_placed(
    client, admin_headers, candidate_with_absent_key
):
    """
    The code comments describe `{"accommodation.hostel_id": None}` as matching only
    an explicit null, and warn that a participant whose key is *absent* can never
    be placed. Mongo does not work that way: an equality match against null also
    matches a missing field, so such a candidate is found and placed normally.
    """
    make_hostel()
    client.post("/hostels/allocate", headers=admin_headers)
    assert accommodation(candidate_with_absent_key)["hostel_id"] == "HSTL111"


@pytest.mark.xfail(
    strict=False,
    reason="KNOWN DEFECT: `excluded_by_null_filter` counts candidates whose "
           "`accommodation.hostel_id` key is absent and reports them as excluded, "
           "plus a WARNING naming them as unplaceable. They are not excluded — an "
           "equality match against null also matches a missing field — so the figure "
           "and the warning both describe a problem that does not exist, while the "
           "same participants are counted again in allocated_count.",
)
def test_absent_keys_are_not_reported_as_excluded(
    client, admin_headers, candidate_with_absent_key, audit
):
    make_hostel()
    client.post("/hostels/allocate", headers=admin_headers)
    assert audit.one("ALLOCATE_HOSTELS")["details"]["excluded_by_null_filter"] == 0


def test_the_spurious_exclusion_warning_is_currently_emitted(
    client, admin_headers, candidate_with_absent_key, audit, caplog
):
    """Characterises today's behaviour, paired with the xfail above."""
    import logging

    make_hostel()
    with caplog.at_level(logging.WARNING, logger="paradox.hostels"):
        client.post("/hostels/allocate", headers=admin_headers)

    assert audit.one("ALLOCATE_HOSTELS")["details"]["excluded_by_null_filter"] == 1
    assert any(getattr(r, "reason", None) == "candidates_excluded_by_null_filter"
               for r in caplog.records)


def test_the_batch_summary_reports_the_candidate_and_placement_counts(
    client, admin_headers, make_participant, audit
):
    make_hostel(sharing=1, num_rooms=2)
    make_participant(profile={"gender": "male"},
                     accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)

    details = audit.one("ALLOCATE_HOSTELS")["details"]
    assert details["allocated_count"] == 1
    assert details["candidates"] == 1
    assert details["skipped_count"] == 0


def test_beds_remaining_accounts_for_the_beds_just_filled(
    client, admin_headers, make_participant, audit
):
    """
    It used to be computed from the occupancy read before the sweep, so it counted
    beds the same run had just filled.
    """
    make_hostel(capacity=2, sharing=1, num_rooms=2)
    make_participant(profile={"gender": "male"},
                     accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)

    assert audit.one("ALLOCATE_HOSTELS")["details"]["beds_remaining"] == {"HSTL111": 1}
    assert stored()["current_occupancy"] == 1


def test_beds_remaining_uses_the_same_ceiling_the_sweep_enforced(
    client, admin_headers, audit
):
    """Capacity 2 across three double rooms is two places, not six."""
    make_hostel(capacity=2, sharing=2, num_rooms=3)
    client.post("/hostels/allocate", headers=admin_headers)
    assert audit.one("ALLOCATE_HOSTELS")["details"]["beds_remaining"] == {"HSTL111": 2}


def test_beds_remaining_reaches_zero_on_a_full_block(
    client, admin_headers, make_participant, audit
):
    make_hostel(capacity=1, sharing=1, num_rooms=1)
    make_participant(profile={"gender": "male"},
                     accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)
    assert audit.one("ALLOCATE_HOSTELS")["details"]["beds_remaining"] == {"HSTL111": 0}


def test_capacity_is_respected_during_allocation(client, admin_headers, make_participant):
    """
    Allocation used to consult only the room maths, so a block with more beds than its
    stated capacity took everyone the rooms could hold — and `hostel_statistics` then
    reported an occupancy above capacity, which cannot be true.
    """
    make_hostel(capacity=2, sharing=2, num_rooms=3)
    for index in range(1, 5):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         profile={"gender": "male"},
                         accommodation={"registered": True, "hostel_id": None})

    response = client.post("/hostels/allocate", headers=admin_headers)

    assert response.json() == {"message": "Allocated 2 participants to hostels"}
    assert stored()["current_occupancy"] == 2


def test_the_tighter_of_the_two_bounds_wins(client, admin_headers, make_participant):
    """When the rooms are the tighter bound, they still are — capacity is not a floor."""
    make_hostel(capacity=10, sharing=1, num_rooms=2)
    for index in range(1, 5):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         profile={"gender": "male"},
                         accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)
    assert stored()["current_occupancy"] == 2


def test_participants_turned_away_by_capacity_are_reported(
    client, admin_headers, make_participant, audit
):
    make_hostel(capacity=1, sharing=2, num_rooms=2)
    for index in (1, 2):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         profile={"gender": "male"},
                         accommodation={"registered": True, "hostel_id": None})

    client.post("/hostels/allocate", headers=admin_headers)

    assert audit.one("HOSTEL_ALLOCATION_SKIPPED")["details"]["reason"] == "capacity_exhausted"
    assert audit.one("ALLOCATE_HOSTELS")["details"]["skipped_by_reason"] == \
        {"capacity_exhausted": 1}


def test_a_full_block_is_skipped_in_favour_of_the_next_one(
    client, admin_headers, make_participant
):
    """The ceiling moves the sweep on to another block rather than stopping it."""
    make_hostel("HSTL111", capacity=1, sharing=2, num_rooms=2)
    make_hostel("HSTL112", capacity=5, sharing=2, num_rooms=2)
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in",
                               profile={"gender": "male"},
                               accommodation={"registered": True, "hostel_id": None})
              for i in (1, 2)]

    client.post("/hostels/allocate", headers=admin_headers)

    placements = {accommodation(person)["hostel_id"] for person in people}
    assert placements == {"HSTL111", "HSTL112"}


def test_capacity_already_reached_before_the_sweep_is_honoured(
    client, admin_headers, make_participant
):
    """A block at capacity from a previous run takes nobody new."""
    make_hostel(capacity=1, sharing=2, num_rooms=2)
    database.hostel_collection.update_one(
        {"hostel_id": "HSTL111"}, {"$set": {"current_occupancy": 1}}
    )
    person = make_participant(profile={"gender": "male"},
                              accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)
    assert accommodation(person)["hostel_id"] is None


def test_statistics_can_no_longer_report_occupancy_above_capacity(
    client, admin_headers, make_participant
):
    """The invariant the ceiling exists to protect."""
    make_hostel(capacity=2, sharing=2, num_rooms=3)
    for index in range(1, 6):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         profile={"gender": "male"},
                         accommodation={"registered": True, "hostel_id": None})
    client.post("/hostels/allocate", headers=admin_headers)

    body = client.get("/hostels/HSTL111/statistics", headers=admin_headers).json()
    assert body["current_occupancy"] <= body["capacity"]
    assert body["total_allocated"] <= body["capacity"]


def test_only_super_admins_can_allocate(client, staff_headers):
    assert client.post("/hostels/allocate", headers=staff_headers).status_code == 403


# ===========================================================================
# Payment and my_hostel
# ===========================================================================

def test_paying_the_hostel_fee_records_a_fixed_amount(client, participant):
    body = client.post("/hostels/pay", json={"method": "card"},
                       headers=auth_headers(participant)).json()
    assert body["amount"] == 900
    assert body["transaction_id"].startswith("PDX-HOSTEL-")
    assert accommodation(participant)["payment"]["amount"] == 900


def test_paying_does_not_request_accommodation(client, participant):
    client.post("/hostels/pay", json={"method": "upi"}, headers=auth_headers(participant))
    after = accommodation(participant)
    assert after["registered"] is False
    assert after["hostel_id"] is None


def test_paying_twice_records_the_replaced_transaction(client, participant, audit):
    first = client.post("/hostels/pay", json={"method": "upi"},
                        headers=auth_headers(participant)).json()
    client.post("/hostels/pay", json={"method": "upi"}, headers=auth_headers(participant))
    assert audit.latest("HOSTEL_PAYMENT")["details"]["replaced_transaction_id"] == \
        first["transaction_id"]


def test_my_hostel_before_allocation(client, participant):
    body = client.get("/hostels/my_hostel", headers=auth_headers(participant)).json()
    assert body["assigned_hostel"] is None
    assert body["registered"] is False
    assert body["volunteers"] == []


def test_my_hostel_distinguishes_never_requested_from_awaiting_allocation(
    client, participant
):
    """Two states that need very different things said to them."""
    client.post("/hostels/register", headers=auth_headers(participant))
    body = client.get("/hostels/my_hostel", headers=auth_headers(participant)).json()
    assert body["registered"] is True
    assert body["assigned_hostel"] is None


def test_my_hostel_reports_the_room_and_the_duty_staff(
    client, make_participant, make_staff
):
    linked = make_participant(participant_id="DS23F000050", email="gate@ds.study.iitm.ac.in",
                              profile={"phone": "9000000055"})
    make_staff(paradox_id=GUARD, email="gate@ds.study.iitm.ac.in", role="other",
               name="Ravi Guard", admin_id=linked["_id"])
    make_hostel(hostel_team=[factories.hostel_team_member(GUARD)])
    resident = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                                accommodation={"registered": True, "hostel_id": "HSTL111",
                                               "room": "101"})

    body = client.get("/hostels/my_hostel", headers=auth_headers(resident)).json()

    assert body["assigned_hostel"] == "HSTL111"
    assert body["room"] == "101"
    assert body["volunteers"] == [{"name": "Ravi Guard", "email": "gate@ds.study.iitm.ac.in",
                                  "phone": "9000000055", "role": "guard"}]


def test_a_staff_member_with_no_participant_record_has_no_phone(
    client, make_participant, make_staff
):
    make_staff(paradox_id=GUARD, email="gate@x.com", role="other", name="Ravi Guard")
    make_hostel(hostel_team=[factories.hostel_team_member(GUARD)])
    resident = make_participant(accommodation={"registered": True, "hostel_id": "HSTL111"})
    volunteers = client.get("/hostels/my_hostel",
                            headers=auth_headers(resident)).json()["volunteers"]
    assert volunteers[0]["phone"] is None


# ===========================================================================
# The entry / exit state machine
# ===========================================================================

@pytest.fixture()
def block(guard):
    return make_hostel(hostel_team=[factories.hostel_team_member(GUARD)])


@pytest.fixture()
def resident(block, make_participant):
    return make_participant(accommodation={
        "registered": True, "hostel_id": "HSTL111", "room": "101",
        "inside": False, "arrival": None, "departure": None,
    })


def door(client, actor, person, action, hostel_id="HSTL111"):
    return client.post(f"/hostels/{hostel_id}/scan?action={action}",
                       json=make_qr(person), headers=auth_headers(actor))


@pytest.mark.slow
def test_an_entry_marks_the_resident_inside_and_stamps_arrival(client, guard, resident):
    response = door(client, guard, resident, "entry")
    assert response.status_code == 200
    assert response.json() == {"message": "Scan successful, entry allowed"}
    after = accommodation(resident)
    assert after["inside"] is True
    assert after["arrival"] is not None


@pytest.mark.slow
def test_an_exit_marks_them_outside_without_touching_departure(client, guard, resident):
    door(client, guard, resident, "entry")
    response = door(client, guard, resident, "exit")
    assert response.status_code == 200
    after = accommodation(resident)
    assert after["inside"] is False
    assert after["departure"] is None


@pytest.mark.slow
def test_arrival_is_stamped_only_once_ever(client, guard, resident):
    door(client, guard, resident, "entry")
    first_arrival = accommodation(resident)["arrival"]
    door(client, guard, resident, "exit")
    door(client, guard, resident, "entry")
    assert accommodation(resident)["arrival"] == first_arrival


@pytest.mark.slow
def test_a_permanent_exit_sets_departure(client, guard, resident):
    door(client, guard, resident, "entry")
    response = door(client, guard, resident, "permanent_exit")
    assert response.status_code == 200
    after = accommodation(resident)
    assert after["inside"] is False
    assert after["departure"] is not None


@pytest.mark.slow
def test_entering_twice_is_refused(client, guard, resident):
    door(client, guard, resident, "entry")
    response = door(client, guard, resident, "entry")
    assert response.status_code == 400
    assert response.json()["detail"] == "Participant is already inside"


@pytest.mark.slow
def test_exiting_when_already_outside_is_refused(client, guard, resident):
    response = door(client, guard, resident, "exit")
    assert response.status_code == 400
    assert response.json()["detail"] == "Participant is already outside"


@pytest.mark.slow
def test_a_permanent_exit_requires_being_inside(client, guard, resident):
    response = door(client, guard, resident, "permanent_exit")
    assert response.status_code == 400
    assert response.json()["detail"] == \
        "Participant must be inside the hostel to mark a permanent exit"


@pytest.mark.slow
def test_after_a_permanent_exit_every_action_is_refused(client, guard, resident):
    door(client, guard, resident, "entry")
    door(client, guard, resident, "permanent_exit")

    assert door(client, guard, resident, "entry").json()["detail"] == \
        "Participant has permanently departed and cannot re-enter"
    assert door(client, guard, resident, "exit").json()["detail"] == \
        "Participant is already outside"
    assert door(client, guard, resident, "permanent_exit").json()["detail"] == \
        "Participant has already permanently departed"


@pytest.mark.slow
def test_every_refusal_records_the_state_that_caused_it(client, guard, resident, audit):
    """Not just "already inside", but since when, and whether they ever arrived."""
    door(client, guard, resident, "entry")
    door(client, guard, resident, "entry")

    row = audit.latest("HOSTEL_SCAN_DENIED")
    assert row["details"]["reason"] == "already_inside"
    assert row["details"]["inside"] is True
    assert row["details"]["arrival"] is not None
    assert row["details"]["room"] == "101"


@pytest.mark.slow
def test_a_successful_scan_records_the_transition(client, guard, resident, audit):
    door(client, guard, resident, "entry")
    row = audit.one("HOSTEL_ENTRY")
    assert row["details"]["inside_before"] is False
    assert row["details"]["inside_after"] is True
    assert row["details"]["arrival_stamped"] is True
    assert row["details"]["scan_domain"] == "hostel"


@pytest.mark.slow
def test_each_action_files_its_own_audit_action(client, guard, resident, audit):
    door(client, guard, resident, "entry")
    door(client, guard, resident, "exit")
    door(client, guard, resident, "entry")
    door(client, guard, resident, "permanent_exit")

    assert len(audit.rows("HOSTEL_ENTRY")) == 2
    assert len(audit.rows("HOSTEL_EXIT")) == 1
    assert audit.one("HOSTEL_PERMANENT_EXIT")["details"]["departure_stamped"] is True


@pytest.mark.parametrize("action", ["", "leave", "ENTRY", "permanent-exit"])
def test_an_invalid_action_is_a_400(client, guard, resident, action):
    response = door(client, guard, resident, action)
    assert response.status_code == 400
    assert response.json()["detail"] == \
        "Invalid action. Must be 'entry', 'exit', or 'permanent_exit'"


def test_the_action_is_required(client, guard, resident):
    assert client.post("/hostels/HSTL111/scan", json=make_qr(resident),
                       headers=auth_headers(guard)).status_code == 422


def test_an_unknown_block_is_a_404(client, guard, resident):
    assert door(client, guard, resident, "entry", hostel_id="NOPE").status_code == 404


def test_a_staff_member_not_on_the_team_is_refused(client, block, resident, make_staff):
    outsider = make_staff(paradox_id="OTHO9999", email="other@x.com", role="other")
    response = door(client, outsider, resident, "entry")
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to scan for this hostel"


def test_a_super_admin_who_is_not_on_the_team_is_refused(client, block, resident, super_admin):
    assert door(client, super_admin, resident, "entry").status_code == 403


def test_a_guard_with_scanning_revoked_is_refused(client, block, resident, guard, audit):
    database.hostel_collection.update_one(
        {"hostel_id": "HSTL111"}, {"$set": {"hostel_team.0.attendance": False}}
    )
    response = door(client, guard, resident, "entry")
    assert response.status_code == 403
    assert response.json()["detail"] == "Scanning disabled for you"
    assert audit.latest("HOSTEL_SCAN_DENIED")["details"]["reason"] == \
        "scanning_disabled_for_member"


@pytest.mark.slow
def test_a_resident_of_another_block_is_refused(client, guard, block, make_participant):
    make_hostel("HSTL112")
    person = make_participant(accommodation={"registered": True, "hostel_id": "HSTL112"})
    response = door(client, guard, person, "entry")
    assert response.status_code == 400
    assert response.json()["detail"] == "Participant not allotted to this hostel"


@pytest.mark.slow
def test_the_wrong_block_refusal_names_the_right_one(client, guard, block, make_participant, audit):
    make_hostel("HSTL112")
    person = make_participant(accommodation={"registered": True, "hostel_id": "HSTL112"})
    door(client, guard, person, "entry")
    row = audit.latest("HOSTEL_SCAN_DENIED")
    assert row["details"]["reason"] == "not_allotted_to_this_hostel"
    assert row["details"]["allotted_hostel_id"] == "HSTL112"


@pytest.mark.slow
def test_a_corrupt_code_is_refused_and_recorded(client, guard, resident, audit):
    response = client.post("/hostels/HSTL111/scan?action=entry", json=corrupt_qr(resident),
                           headers=auth_headers(guard))
    assert response.status_code == 400
    assert audit.latest("QR_VERIFY_FAILED")["details"]["scan_domain"] == "hostel"


# ===========================================================================
# Statistics
# ===========================================================================

def test_statistics_separate_lifetime_occupancy_from_who_is_inside(
    client, admin_headers, make_participant
):
    make_hostel(capacity=4, sharing=2, num_rooms=2)
    inside = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                              profile={"full_name": "Asha"},
                              accommodation={"registered": True, "hostel_id": "HSTL111",
                                             "room": "101", "inside": True})
    make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
                     accommodation={"registered": True, "hostel_id": "HSTL111",
                                    "room": "101", "inside": False})
    database.hostel_collection.update_one({"hostel_id": "HSTL111"},
                                         {"$set": {"current_occupancy": 2}})

    body = client.get("/hostels/HSTL111/statistics", headers=admin_headers).json()

    assert body["total_allocated"] == 2
    assert body["current_occupancy"] == 2
    assert body["currently_inside"] == 1
    assert body["capacity"] == 4
    assert {row["participant_id"] for row in body["allotted_participants"]} == \
        {"DS23F000001", "DS23F000002"}
    assert next(r for r in body["allotted_participants"]
                if r["participant_id"] == inside["participant_id"])["name"] == "Asha"


@pytest.mark.slow
def test_lifetime_occupancy_never_falls_when_somebody_leaves(
    client, admin_headers, guard, block, make_participant
):
    """
    Pinned as designed: `current_occupancy` is a lifetime count, and
    `currently_inside` is the only live figure. The two will diverge over a fest.
    """
    resident = make_participant(accommodation={"registered": True, "hostel_id": "HSTL111",
                                               "room": "101", "inside": False})
    database.hostel_collection.update_one({"hostel_id": "HSTL111"},
                                         {"$set": {"current_occupancy": 1}})
    door(client, guard, resident, "entry")
    door(client, guard, resident, "permanent_exit")

    body = client.get("/hostels/HSTL111/statistics", headers=admin_headers).json()
    assert body["current_occupancy"] == 1
    assert body["currently_inside"] == 0


def test_reading_the_roster_is_audited_with_the_occupancy_snapshot(
    client, admin_headers, audit
):
    """This endpoint is the snapshot somebody would be asked to produce after an
    incident, so what it said at the time is part of the record."""
    make_hostel()
    client.get("/hostels/HSTL111/statistics", headers=admin_headers)
    row = audit.one("READ_HOSTEL_ROSTER")
    assert row["details"]["returned"] == 0
    assert row["details"]["currently_inside"] == 0


def test_statistics_are_super_admin_only(client, staff_headers):
    make_hostel()
    assert client.get("/hostels/HSTL111/statistics", headers=staff_headers).status_code == 403


def test_statistics_for_an_unknown_block_are_a_404(client, admin_headers):
    assert client.get("/hostels/NOPE/statistics", headers=admin_headers).status_code == 404


# ===========================================================================
# Route ordering
# ===========================================================================

def test_delete_register_is_not_captured_as_a_block_id(client, participant):
    """`DELETE /hostels/register` is declared before `DELETE /hostels/{hostel_id}`,
    which is the only reason withdrawing a request works."""
    make_hostel()
    client.post("/hostels/register", headers=auth_headers(participant))
    response = client.delete("/hostels/register", headers=auth_headers(participant))
    assert response.status_code == 200
    assert response.json() == {"message": "Accommodation request withdrawn"}
    assert stored() is not None, "the block itself was not deleted"


@pytest.mark.parametrize("path", ["/hostels/my_hostel", "/hostels/allocate"])
def test_literal_paths_are_not_captured_as_block_ids(client, participant, admin_headers, path):
    make_hostel()
    if path == "/hostels/my_hostel":
        assert client.get(path, headers=auth_headers(participant)).status_code == 200
    else:
        assert client.post(path, headers=admin_headers).status_code == 200
