"""
Endpoint tests for /mess.

Allocation and scanning are the substance. Allocation matches a participant's diet
against a hall's dietary axis and respects capacity; scanning admits one person to
one sitting, once, inside a ±15 minute window, at the hall they were actually
seated in. Both are asserted against the stored documents rather than the response
message.

Note the id asymmetry the factories encode: `participants.mess.mess_id` holds the
hall's **ObjectId**, while `accommodation.hostel_id` holds a readable string.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers, corrupt_qr, make_qr

CREATE = {"mess_id": "MESS1", "name": "North Hall", "capacity": 50,
          "type": "north_indian__veg"}
SCANNER = "OTME1111"


@pytest.fixture()
def scanner(make_staff):
    return make_staff(paradox_id=SCANNER, email="counter@ds.study.iitm.ac.in", role="other",
                      department="mess", designation="Mess Counter")


def make_mess(mess_id="MESS1", **kwargs):
    doc = factories.mess_doc(mess_id, **kwargs)
    database.mess_collection.insert_one(doc)
    return database.mess_collection.find_one({"_id": doc["_id"]})


def stored(mess_id="MESS1"):
    return database.mess_collection.find_one({"mess_id": mess_id})


def participant_doc(person):
    return database.participants_collection.find_one({"_id": person["_id"]})


# ===========================================================================
# CRUD
# ===========================================================================

def test_a_hall_is_created(client, admin_headers):
    response = client.post("/mess", json=CREATE, headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Mess created"}
    document = stored()
    assert document["capacity"] == 50
    assert document["type"] == "north_indian__veg"
    assert document["menu"] == {}
    assert document["mess_team"] == []


def test_a_duplicate_mess_id_is_a_409(client, admin_headers):
    client.post("/mess", json=CREATE, headers=admin_headers)
    response = client.post("/mess", json=CREATE, headers=admin_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == "A mess with this mess_id already exists"


def test_only_super_admins_can_create(client, staff_headers):
    response = client.post("/mess", json=CREATE, headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized"


def test_a_refusal_is_recorded_with_the_operation(client, staff_headers, audit):
    client.post("/mess", json=CREATE, headers=staff_headers)
    row = audit.latest("AUTHZ_DENIED")
    assert row["details"]["resource"] == "mess"
    assert row["details"]["operation"] == "create"


@pytest.mark.parametrize("bad", [{"type": "veg"}, {"type": "Jain"}, {"capacity": 0}])
def test_schema_violations_are_422(client, admin_headers, bad):
    assert client.post("/mess", json={**CREATE, **bad},
                       headers=admin_headers).status_code == 422


def test_creation_is_audited(client, admin_headers, audit):
    client.post("/mess", json=CREATE, headers=admin_headers)
    row = audit.one("CREATE_MESS")
    assert row["target_id"] == "MESS1"
    assert row["details"]["type"] == "north_indian__veg"


def test_any_authenticated_user_can_list_halls(client, participant):
    make_mess()
    rows = client.get("/mess", headers=auth_headers(participant)).json()
    assert rows[0]["mess_id"] == "MESS1"
    assert "_id" not in rows[0]


def test_listing_needs_a_token(client):
    assert client.get("/mess").status_code in (401, 403)


def test_a_single_hall_is_readable(client, participant):
    make_mess()
    assert client.get("/mess/MESS1",
                      headers=auth_headers(participant)).json()["mess_id"] == "MESS1"


def test_an_unknown_hall_is_a_404(client, participant):
    response = client.get("/mess/NOPE", headers=auth_headers(participant))
    assert response.status_code == 404
    assert response.json()["detail"] == "Mess not found"


def test_a_hall_can_be_updated(client, admin_headers):
    make_mess()
    response = client.put("/mess/MESS1", json={"capacity": 80}, headers=admin_headers)
    assert response.status_code == 200
    assert stored()["capacity"] == 80


def test_updating_an_unknown_hall_is_a_404(client, admin_headers):
    assert client.put("/mess/NOPE", json={"capacity": 1},
                      headers=admin_headers).status_code == 404


def test_an_empty_update_is_a_400(client, admin_headers):
    make_mess()
    response = client.put("/mess/MESS1", json={}, headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Nothing to update"


def test_an_update_records_the_previous_type_and_capacity(client, admin_headers, audit):
    """`type` is what allocation matches diets against, so a change silently
    re-purposes the hall for everyone already seated."""
    make_mess()
    client.put("/mess/MESS1", json={"type": "jain", "capacity": 10}, headers=admin_headers)
    details = audit.one("UPDATE_MESS")["details"]
    assert details["previous_type"] == "north_indian__veg"
    assert details["previous_capacity"] == 50
    assert details["seated"] == 0


def test_cutting_capacity_below_the_number_seated_is_flagged(
    client, admin_headers, make_participant, caplog
):
    import logging

    mess = make_mess(capacity=10)
    for index in (1, 2):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         mess={"registered": True, "mess_id": mess["_id"]})

    with caplog.at_level(logging.WARNING, logger="paradox.mess"):
        client.put("/mess/MESS1", json={"capacity": 1}, headers=admin_headers)

    assert any(getattr(r, "reason", None) == "capacity_below_occupancy"
               for r in caplog.records)
    assert stored()["capacity"] == 1, "the cut is applied rather than refused"


def test_deleting_a_hall_releases_its_diners_and_clears_their_scans(
    client, admin_headers, make_participant
):
    mess = make_mess()
    person = make_participant(mess={
        "registered": True, "mess_id": mess["_id"],
        "scans": {"day_1": {"breakfast": {"scanned": True}}},
    })
    response = client.delete("/mess/MESS1", headers=admin_headers)

    assert response.status_code == 200
    assert stored() is None
    after = participant_doc(person)["mess"]
    assert after["mess_id"] is None
    assert after["scans"] == {}
    assert after["registered"] is True, "they still want a meal plan"


def test_the_deletion_names_everyone_affected(client, admin_headers, make_participant, audit):
    """Captured before the cascade, because afterwards the link is gone."""
    mess = make_mess()
    person = make_participant(mess={"registered": True, "mess_id": mess["_id"]})
    client.delete("/mess/MESS1", headers=admin_headers)

    details = audit.one("DELETE_MESS")["details"]
    assert details["participants_released"] == 1
    assert details["scan_history_cleared_for"] == [person["participant_id"]]
    assert details["type"] == "north_indian__veg"


def test_deleting_an_unknown_hall_is_a_404(client, admin_headers):
    assert client.delete("/mess/NOPE", headers=admin_headers).status_code == 404


# ===========================================================================
# Menu
# ===========================================================================

MENU = {"menu": {"day_1": {
    "breakfast": {"start_time": "2026-06-13T07:00:00", "end_time": "2026-06-13T09:00:00",
                  "menu": "Idli, sambar"},
    "lunch": {"start_time": "2026-06-13T12:00:00", "end_time": "2026-06-13T14:00:00",
              "menu": "Rice, dal"},
}}}


def test_a_menu_is_replaced_wholesale(client, admin_headers):
    make_mess(menu=factories.mess_menu({9: ["dinner"]}))
    response = client.put("/mess/MESS1/menu", json=MENU, headers=admin_headers)

    assert response.status_code == 200
    menu = stored()["menu"]
    assert set(menu) == {"day_1"}, "day_9 is gone, because this is a replacement"
    assert set(menu["day_1"]) == {"breakfast", "lunch"}


def test_the_menu_edit_stamps_who_made_it(client, admin_headers, super_admin):
    make_mess()
    client.put("/mess/MESS1/menu", json=MENU, headers=admin_headers)
    assert stored()["updated_by"] == super_admin["paradox_id"]


def test_a_mess_team_member_can_edit_the_menu(client, scanner):
    make_mess(mess_team=[factories.mess_team_member(SCANNER)])
    assert client.put("/mess/MESS1/menu", json=MENU,
                      headers=auth_headers(scanner)).status_code == 200


def test_unrelated_staff_cannot_edit_the_menu(client, staff_headers):
    make_mess()
    response = client.put("/mess/MESS1/menu", json=MENU, headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to edit this menu"


@pytest.mark.xfail(
    strict=False,
    reason="KNOWN DEFECT: the 404 lookup runs before the authorisation check on this "
           "route alone, so any staff token can distinguish an existing hall from a "
           "missing one. Every sibling route gates authorisation first.",
)
def test_hall_existence_is_not_leaked_to_unauthorised_staff(client, staff_headers):
    make_mess()
    missing = client.put("/mess/NOPE/menu", json=MENU, headers=staff_headers)
    existing = client.put("/mess/MESS1/menu", json=MENU, headers=staff_headers)
    assert missing.status_code == existing.status_code


def test_removing_a_sitting_is_recorded_because_scans_will_start_failing(
    client, admin_headers, audit, caplog
):
    """A removed sitting makes `scan_mess` answer "No lunch scheduled for day 1",
    which reads as a scanner fault to the volunteer holding it."""
    import logging

    make_mess(menu=factories.mess_menu({1: ["breakfast", "lunch"]}))
    with caplog.at_level(logging.WARNING, logger="paradox.mess"):
        client.put("/mess/MESS1/menu",
                   json={"menu": {"day_1": {"breakfast": MENU["menu"]["day_1"]["breakfast"]}}},
                   headers=admin_headers)

    details = audit.one("UPDATE_MESS_MENU")["details"]
    assert details["slots_removed"] == ["day_1.lunch"]
    assert details["edited_as"] == "super_admin"
    assert any(getattr(r, "reason", None) == "menu_slots_removed" for r in caplog.records)


def test_added_sittings_are_recorded(client, admin_headers, audit):
    make_mess()
    client.put("/mess/MESS1/menu", json=MENU, headers=admin_headers)
    assert sorted(audit.one("UPDATE_MESS_MENU")["details"]["slots_added"]) == \
        ["day_1.breakfast", "day_1.lunch"]


@pytest.mark.parametrize("menu", [
    {"day_0": {"breakfast": MENU["menu"]["day_1"]["breakfast"]}},
    {"day_1": {"brunch": MENU["menu"]["day_1"]["breakfast"]}},
])
def test_a_malformed_menu_is_a_422(client, admin_headers, menu):
    make_mess()
    assert client.put("/mess/MESS1/menu", json={"menu": menu},
                      headers=admin_headers).status_code == 422


def test_an_empty_menu_clears_the_hall(client, admin_headers):
    make_mess(menu=factories.mess_menu({1: ["breakfast"]}))
    client.put("/mess/MESS1/menu", json={"menu": {}}, headers=admin_headers)
    assert stored()["menu"] == {}


# ===========================================================================
# Team
# ===========================================================================

def test_a_volunteer_is_assigned_with_scanning_on(client, admin_headers):
    make_mess()
    response = client.post("/mess/MESS1/team", json={"user_id": SCANNER, "role": "volunteer"},
                           headers=admin_headers)
    assert response.status_code == 200
    assert stored()["mess_team"][0]["logging"] is True


def test_desk_staff_with_no_id_can_be_recorded_by_name(client, admin_headers):
    make_mess()
    client.post("/mess/MESS1/team",
                json={"role": "other", "name": "Ravi", "phone": "9000000000"},
                headers=admin_headers)
    member = stored()["mess_team"][0]
    assert member["user_id"] is None
    assert member["name"] == "Ravi"
    assert member["logging"] is True


def test_an_unrecognised_role_lands_with_scanning_off_and_is_flagged(
    client, admin_headers, caplog
):
    """
    A whitelist rather than a default: the volunteer then stands at a counter being
    refused, with nothing connecting that to a typo hours earlier — hence the
    warning.
    """
    import logging

    make_mess()
    with caplog.at_level(logging.WARNING, logger="paradox.mess"):
        client.post("/mess/MESS1/team", json={"user_id": SCANNER, "role": "helper"},
                    headers=admin_headers)

    assert stored()["mess_team"][0]["logging"] is False
    assert any(getattr(r, "reason", None) == "unrecognised_team_role" for r in caplog.records)


def test_assigning_the_same_person_twice_is_a_409(client, admin_headers):
    make_mess()
    client.post("/mess/MESS1/team", json={"user_id": SCANNER, "role": "volunteer"},
                headers=admin_headers)
    response = client.post("/mess/MESS1/team", json={"user_id": SCANNER, "role": "volunteer"},
                           headers=admin_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == "Team member already assigned to this mess"


def test_assigning_to_a_hall_that_does_not_exist_is_recorded(client, admin_headers, audit, caplog):
    """
    Pinned as current behaviour: the route answers 200 and writes nothing, but the
    no-op is no longer silent.
    """
    import logging

    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        response = client.post("/mess/NOPE/team", json={"user_id": SCANNER, "role": "volunteer"},
                               headers=admin_headers)

    assert response.status_code == 200
    assert audit.one("ASSIGN_MESS_TEAM")["details"]["hall_exists"] is False
    assert any(getattr(r, "reason", None) == "mess_not_found_on_assign" for r in caplog.records)


def test_scanning_can_be_revoked_and_the_revocation_is_audited(client, admin_headers, audit):
    make_mess(mess_team=[factories.mess_team_member(SCANNER)])
    response = client.put(f"/mess/MESS1/team/{SCANNER}/toggle_scan?logging=false",
                          headers=admin_headers)
    assert response.status_code == 200
    assert stored()["mess_team"][0]["logging"] is False

    row = audit.one("TOGGLE_MESS_SCAN")
    assert row["details"]["scanning_enabled"] is False
    assert row["details"]["applied"] is True


def test_toggling_a_non_member_reports_that_nothing_was_applied(
    client, admin_headers, audit, caplog
):
    import logging

    make_mess()
    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        response = client.put("/mess/MESS1/team/GHOST/toggle_scan?logging=true",
                              headers=admin_headers)

    assert response.status_code == 200
    assert audit.one("TOGGLE_MESS_SCAN")["details"]["applied"] is False
    assert any(getattr(r, "reason", None) == "team_member_not_found_on_toggle"
               for r in caplog.records)


def test_the_toggle_flag_is_required(client, admin_headers):
    make_mess()
    assert client.put(f"/mess/MESS1/team/{SCANNER}/toggle_scan",
                      headers=admin_headers).status_code == 422


# ===========================================================================
# Allocation
# ===========================================================================

def seated_in(person):
    return participant_doc(person)["mess"]["mess_id"]


def test_a_registrant_is_seated_in_a_hall_matching_their_diet(
    client, admin_headers, make_participant
):
    veg = make_mess("MESS1", mess_type="north_indian__veg")
    make_mess("MESS2", mess_type="south_indian__non_veg")
    person = make_participant(profile={"mess_preference": "south_indian__veg"},
                              mess={"registered": True, "mess_id": None})

    response = client.post("/mess/allocate", headers=admin_headers)

    assert response.json() == {"message": "Allocated 1 participants to messes"}
    # Cuisine is ignored; only the diet is matched.
    assert seated_in(person) == veg["_id"]


def test_only_registrants_are_seated(client, admin_headers, make_participant):
    make_mess()
    optout = make_participant(mess={"registered": False, "mess_id": None})
    client.post("/mess/allocate", headers=admin_headers)
    assert seated_in(optout) is None


def test_the_registered_filter_keeps_allotted_at_or_below_registered(
    client, admin_headers, make_participant
):
    """The invariant the filter exists for: a dashboard cannot show more people
    fed than signed up."""
    make_mess()
    make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                     mess={"registered": True, "mess_id": None})
    make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
                     mess={"registered": False, "mess_id": None})
    client.post("/mess/allocate", headers=admin_headers)

    stats = client.get("/participants/statistics", headers=admin_headers).json()
    assert stats["mess_allotted"] <= stats["mess_registered"]


def test_somebody_already_seated_is_not_moved(client, admin_headers, make_participant):
    first = make_mess("MESS1")
    make_mess("MESS2")
    person = make_participant(mess={"registered": True, "mess_id": first["_id"]})
    client.post("/mess/allocate", headers=admin_headers)
    assert seated_in(person) == first["_id"]


def test_a_missing_preference_defaults_to_vegetarian(client, admin_headers, make_participant):
    veg = make_mess("MESS1", mess_type="north_indian__veg")
    person = make_participant(profile={"mess_preference": None},
                              mess={"registered": True, "mess_id": None})
    client.post("/mess/allocate", headers=admin_headers)
    assert seated_in(person) == veg["_id"]


def test_a_bare_diet_still_places_correctly(client, admin_headers, make_participant):
    """Written before combined values existed, or by an older client."""
    veg = make_mess("MESS1", mess_type="south_indian__veg")
    person = make_participant(profile={"mess_preference": "veg"},
                              mess={"registered": True, "mess_id": None})
    client.post("/mess/allocate", headers=admin_headers)
    assert seated_in(person) == veg["_id"]


def test_capacity_is_the_ceiling(client, admin_headers, make_participant):
    make_mess("MESS1", capacity=1)
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in",
                               mess={"registered": True, "mess_id": None})
              for i in (1, 2)]

    response = client.post("/mess/allocate", headers=admin_headers)

    assert response.json() == {"message": "Allocated 1 participants to messes"}
    assert len([p for p in people if seated_in(p) is not None]) == 1


def test_capacity_accounts_for_who_is_already_seated(client, admin_headers, make_participant):
    mess = make_mess("MESS1", capacity=1)
    make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                     mess={"registered": True, "mess_id": mess["_id"]})
    waiting = make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
                              mess={"registered": True, "mess_id": None})

    client.post("/mess/allocate", headers=admin_headers)
    assert seated_in(waiting) is None


def test_somebody_whose_diet_has_no_hall_is_reported_individually(
    client, admin_headers, make_participant, audit
):
    """"23 people were not placed" is not something anybody can act on."""
    make_mess("MESS1", mess_type="north_indian__veg")
    person = make_participant(profile={"mess_preference": "jain"},
                              mess={"registered": True, "mess_id": None})

    client.post("/mess/allocate", headers=admin_headers)

    assert seated_in(person) is None
    row = audit.one("MESS_ALLOCATION_SKIPPED")
    assert row["target_id"] == person["participant_id"]
    assert row["details"]["reason"] == "no_hall_for_diet"
    assert row["details"]["diet"] == "jain"


def test_an_exhausted_hall_is_reported_differently_from_a_missing_one(
    client, admin_headers, make_participant, audit
):
    make_mess("MESS1", capacity=1, mess_type="north_indian__veg")
    for index in (1, 2):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         mess={"registered": True, "mess_id": None})
    client.post("/mess/allocate", headers=admin_headers)
    assert audit.one("MESS_ALLOCATION_SKIPPED")["details"]["reason"] == "capacity_exhausted"


def test_the_batch_summary_reports_the_complement(
    client, admin_headers, make_participant, audit
):
    make_mess("MESS1", capacity=1, mess_type="north_indian__veg")
    for index in (1, 2, 3):
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         mess={"registered": True, "mess_id": None})
    client.post("/mess/allocate", headers=admin_headers)

    details = audit.one("ALLOCATE_MESSES")["details"]
    assert details["allocated_count"] == 1
    assert details["candidates"] == 3
    assert details["skipped_count"] == 2
    assert details["skipped_by_reason"] == {"capacity_exhausted": 2}
    assert details["seats_remaining"] == {"MESS1": 0}


def test_allocation_with_no_candidates_is_a_no_op(client, admin_headers):
    make_mess()
    assert client.post("/mess/allocate", headers=admin_headers).json() == \
        {"message": "Allocated 0 participants to messes"}


def test_only_super_admins_can_allocate(client, staff_headers):
    assert client.post("/mess/allocate", headers=staff_headers).status_code == 403


# ===========================================================================
# Payment and my_mess
# ===========================================================================

def test_paying_the_mess_fee_records_a_fixed_amount(client, participant):
    response = client.post("/mess/pay", json={"method": "upi"},
                           headers=auth_headers(participant))
    assert response.status_code == 200
    body = response.json()
    assert body["paid"] is True
    assert body["amount"] == 1200
    assert body["transaction_id"].startswith("PDX-MESS-")
    assert participant_doc(participant)["mess"]["payment"]["amount"] == 1200


def test_the_client_cannot_choose_the_amount(client, participant):
    """`MockPaymentRequest` carries only `method`, so an amount is ignored."""
    body = client.post("/mess/pay", json={"method": "upi", "amount": 1},
                       headers=auth_headers(participant)).json()
    assert body["amount"] == 1200


def test_an_invalid_method_is_a_422(client, participant):
    assert client.post("/mess/pay", json={"method": "cash"},
                       headers=auth_headers(participant)).status_code == 422


def test_paying_does_not_register_for_a_meal_plan(client, participant):
    """Deliberately independent, so the two can happen in either order."""
    client.post("/mess/pay", json={"method": "upi"}, headers=auth_headers(participant))
    mess = participant_doc(participant)["mess"]
    assert mess["registered"] is False
    assert mess["mess_id"] is None


def test_paying_twice_overwrites_and_the_old_transaction_is_recorded(
    client, participant, audit, caplog
):
    """The route is not idempotent; the earlier transaction survives only in the
    trail, which is what a refund conversation needs."""
    import logging

    first = client.post("/mess/pay", json={"method": "upi"},
                        headers=auth_headers(participant)).json()
    with caplog.at_level(logging.WARNING, logger="paradox.mess"):
        second = client.post("/mess/pay", json={"method": "card"},
                             headers=auth_headers(participant)).json()

    assert second["transaction_id"] != first["transaction_id"]
    assert any(getattr(r, "reason", None) == "payment_overwritten" for r in caplog.records)
    assert audit.latest("MESS_PAYMENT")["details"]["replaced_transaction_id"] == \
        first["transaction_id"]


def test_the_payment_row_names_the_payer(client, participant, audit):
    client.post("/mess/pay", json={"method": "upi"}, headers=auth_headers(participant))
    assert audit.one("MESS_PAYMENT")["target_id"] == participant["participant_id"]


def test_a_staff_token_cannot_pay(client, admin_headers):
    assert client.post("/mess/pay", json={"method": "upi"},
                       headers=admin_headers).status_code == 403


def test_my_mess_is_empty_before_allocation(client, participant):
    body = client.get("/mess/my_mess", headers=auth_headers(participant)).json()
    assert body == {"allotted_mess": None, "mess_details": None, "slots": []}


def test_my_mess_merges_scan_markers_onto_the_current_menu(client, make_participant):
    mess = make_mess(menu=factories.mess_menu({1: ["breakfast", "lunch"]}))
    person = make_participant(mess={
        "registered": True, "mess_id": mess["_id"],
        "scans": {"day_1": {"breakfast": {"scanned": True, "scanned_at": None}}},
    })
    body = client.get("/mess/my_mess", headers=auth_headers(person)).json()

    assert body["allotted_mess"] == "MESS1"
    assert [(s["slot"], s["scanned"]) for s in body["slots"]] == \
        [("breakfast", True), ("lunch", False)]


def test_a_removed_day_disappears_from_my_mess(client, make_participant):
    """The response is derived from the hall's *current* menu, so a sitting the
    admin has since dropped does not linger."""
    mess = make_mess(menu={})
    person = make_participant(mess={
        "registered": True, "mess_id": mess["_id"],
        "scans": {"day_1": {"breakfast": {"scanned": True}}},
    })
    assert client.get("/mess/my_mess", headers=auth_headers(person)).json()["slots"] == []


def test_days_are_ordered_numerically(client, make_participant):
    mess = make_mess(menu=factories.mess_menu({10: ["breakfast"], 2: ["breakfast"]}))
    person = make_participant(mess={"registered": True, "mess_id": mess["_id"]})
    slots = client.get("/mess/my_mess", headers=auth_headers(person)).json()["slots"]
    assert [s["day"] for s in slots] == ["day_2", "day_10"]


def test_slots_are_ordered_breakfast_lunch_dinner(client, make_participant):
    mess = make_mess(menu=factories.mess_menu({1: ["dinner", "breakfast", "lunch"]}))
    person = make_participant(mess={"registered": True, "mess_id": mess["_id"]})
    slots = client.get("/mess/my_mess", headers=auth_headers(person)).json()["slots"]
    assert [s["slot"] for s in slots] == ["breakfast", "lunch", "dinner"]


# ===========================================================================
# Scanning
# ===========================================================================

@pytest.fixture()
def hall(scanner):
    return make_mess(menu=factories.mess_menu({1: ["breakfast", "lunch"]}),
                     mess_team=[factories.mess_team_member(SCANNER)])


@pytest.fixture()
def diner(hall, make_participant):
    return make_participant(mess={"registered": True, "mess_id": hall["_id"], "scans": {}})


def scan(client, actor, person, slot="breakfast", day=1, mess_id="MESS1"):
    return client.post(f"/mess/{mess_id}/scan?slot={slot}&day={day}",
                       json=make_qr(person), headers=auth_headers(actor))


@pytest.mark.slow
def test_a_diner_is_admitted(client, scanner, diner):
    response = scan(client, scanner, diner)
    assert response.status_code == 200
    assert response.json() == {"message": "Scan successful, entry allowed"}
    marker = participant_doc(diner)["mess"]["scans"]["day_1"]["breakfast"]
    assert marker["scanned"] is True
    assert marker["scanned_at"] is not None


@pytest.mark.slow
def test_a_successful_scan_writes_the_row_the_meal_figures_depend_on(
    client, scanner, diner, audit
):
    scan(client, scanner, diner, slot="lunch")
    row = audit.one("MESS_SCAN")
    assert row["target_id"] == "MESS1"
    assert row["details"]["participant_id"] == diner["participant_id"]
    assert row["details"]["slot"] == "lunch"
    assert row["details"]["day"] == 1
    assert row["details"]["outcome"] == "allowed"


@pytest.mark.slow
def test_scanning_the_same_sitting_twice_is_refused(client, scanner, diner):
    scan(client, scanner, diner)
    response = scan(client, scanner, diner)
    assert response.status_code == 400
    assert response.json()["detail"] == "Already logged in for breakfast on day 1"


@pytest.mark.slow
def test_the_duplicate_refusal_records_the_original_time(client, scanner, diner, audit):
    """What settles a double-swipe at a busy counter against a genuine second
    attempt hours later."""
    scan(client, scanner, diner)
    scan(client, scanner, diner)
    row = audit.latest("MESS_SCAN_DENIED")
    assert row["details"]["reason"] == "already_scanned"
    assert row["details"]["first_scanned_at"] is not None


@pytest.mark.slow
def test_a_different_sitting_on_the_same_day_is_allowed(client, scanner, diner):
    scan(client, scanner, diner, slot="breakfast")
    assert scan(client, scanner, diner, slot="lunch").status_code == 200


@pytest.mark.parametrize("slot", ["brunch", "Breakfast", ""])
def test_an_invalid_slot_is_a_400(client, scanner, diner, slot):
    response = scan(client, scanner, diner, slot=slot)
    assert response.status_code == 400
    assert response.json()["detail"] == \
        "slot must be one of ('breakfast', 'lunch', 'dinner')"


def test_a_non_positive_day_is_a_400(client, scanner, diner):
    response = scan(client, scanner, diner, day=0)
    assert response.status_code == 400
    assert response.json()["detail"] == "day must be a positive integer"


def test_an_unknown_hall_is_a_404(client, scanner, diner):
    assert scan(client, scanner, diner, mess_id="NOPE").status_code == 404


def test_a_staff_member_not_on_the_team_is_refused(client, hall, diner, make_staff):
    outsider = make_staff(paradox_id="OTME9999", email="other@x.com", role="other")
    response = scan(client, outsider, diner)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to scan for this mess"


def test_a_super_admin_who_is_not_on_the_team_is_refused(client, hall, diner, super_admin):
    """Scanning authority is per-hall membership, not seniority."""
    assert scan(client, super_admin, diner).status_code == 403


def test_a_member_with_scanning_revoked_is_refused(client, hall, diner, scanner, audit):
    database.mess_collection.update_one(
        {"mess_id": "MESS1"}, {"$set": {"mess_team.0.logging": False}}
    )
    response = scan(client, scanner, diner)
    assert response.status_code == 403
    assert response.json()["detail"] == "Scanning disabled for you"
    assert audit.latest("MESS_SCAN_DENIED")["details"]["reason"] == \
        "scanning_disabled_for_member"


def test_a_sitting_not_on_the_menu_is_a_400(client, scanner, diner, audit):
    response = scan(client, scanner, diner, slot="dinner")
    assert response.status_code == 400
    assert response.json()["detail"] == "No dinner scheduled for day 1"
    assert audit.latest("MESS_SCAN_DENIED")["details"]["menu_days"] == ["day_1"]


def test_a_day_not_on_the_menu_is_a_400(client, scanner, diner):
    response = scan(client, scanner, diner, day=9)
    assert response.status_code == 400
    assert response.json()["detail"] == "No breakfast scheduled for day 9"


def test_scanning_outside_the_window_is_refused(client, scanner, make_participant):
    mess = make_mess(menu={"day_1": {"breakfast": factories.meal_slot(
        start_offset_minutes=300, duration_minutes=60)}},
        mess_team=[factories.mess_team_member(SCANNER)])
    person = make_participant(mess={"registered": True, "mess_id": mess["_id"]})
    response = scan(client, scanner, person)
    assert response.status_code == 403
    assert response.json()["detail"] == "Scanning window not yet open for this slot"


@pytest.mark.slow
def test_a_diner_from_another_hall_is_refused(client, scanner, hall, make_participant):
    other = make_mess("MESS2", mess_type="jain")
    person = make_participant(mess={"registered": True, "mess_id": other["_id"]})
    response = scan(client, scanner, person)
    assert response.status_code == 400
    assert response.json()["detail"] == "Participant not allotted to this mess"


@pytest.mark.slow
def test_the_wrong_hall_refusal_names_both_halls(client, scanner, hall, make_participant, audit):
    other = make_mess("MESS2", mess_type="jain")
    person = make_participant(mess={"registered": True, "mess_id": other["_id"]})
    scan(client, scanner, person)
    row = audit.latest("MESS_SCAN_DENIED")
    assert row["details"]["reason"] == "not_allotted_to_this_mess"
    assert row["details"]["allotted_mess_oid"] == str(other["_id"])


@pytest.mark.slow
def test_an_unallocated_participant_is_refused(client, scanner, hall, participant):
    assert scan(client, scanner, participant).status_code == 400


@pytest.mark.slow
def test_a_corrupt_code_is_refused_and_recorded_against_the_counter(
    client, scanner, diner, audit
):
    response = client.post("/mess/MESS1/scan?slot=breakfast&day=1",
                           json=corrupt_qr(diner), headers=auth_headers(scanner))
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or corrupted QR code"
    row = audit.latest("QR_VERIFY_FAILED")
    assert row["details"]["scan_domain"] == "mess"
    assert row["actor_id"] == SCANNER


# ===========================================================================
# Statistics
# ===========================================================================

def test_statistics_lists_who_is_seated(client, admin_headers, make_participant):
    mess = make_mess(capacity=50)
    make_participant(profile={"full_name": "Asha", "phone": "9000000001"},
                     mess={"registered": True, "mess_id": mess["_id"]})
    body = client.get("/mess/MESS1/statistics", headers=admin_headers).json()

    assert body["total_allocated"] == 1
    assert body["capacity"] == 50
    assert body["allotted_participants"][0]["name"] == "Asha"
    assert body["allotted_participants"][0]["phone"] == "9000000001"


def test_reading_the_roster_is_audited_because_it_carries_contact_details(
    client, admin_headers, audit
):
    make_mess()
    client.get("/mess/MESS1/statistics", headers=admin_headers)
    row = audit.one("READ_MESS_ROSTER")
    assert row["target_id"] == "MESS1"
    assert row["details"]["returned"] == 0


def test_statistics_are_super_admin_only(client, staff_headers):
    make_mess()
    assert client.get("/mess/MESS1/statistics", headers=staff_headers).status_code == 403


def test_statistics_for_an_unknown_hall_are_a_404(client, admin_headers):
    assert client.get("/mess/NOPE/statistics", headers=admin_headers).status_code == 404


# ===========================================================================
# Route ordering
# ===========================================================================

@pytest.mark.parametrize("path", ["/mess/my_mess", "/mess/allocate"])
def test_literal_paths_are_not_captured_as_hall_ids(client, participant, admin_headers, path):
    """`GET /mess/{mess_id}` is declared last precisely so these keep working."""
    make_mess()
    if path == "/mess/my_mess":
        assert client.get(path, headers=auth_headers(participant)).status_code == 200
    else:
        assert client.post(path, headers=admin_headers).status_code == 200
