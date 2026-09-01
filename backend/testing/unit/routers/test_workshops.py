"""
Endpoint tests for /workshops — the largest surface in the API.

Organised by concern: CRUD and visibility, registration and seats, attendance
scanning, and the workshop desk. The seat accounting is the part worth reading
closely: a walk-in who was pre-registered for another workshop in the same slot
releases that seat, and the same-workshop case must net to zero.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers, iso_from_now, make_qr

CREATE = {
    "slot_id": "D1S1",
    "name": "Intro to ML",
    "description": "A hands-on session.",
    "venue": "Lab 1",
    "capacity": 20,
    "instructions": "Bring a laptop.",
    "registration_start": "2026-06-01T10:00:00Z",
    "registration_end": "2026-06-10T10:00:00Z",
}


@pytest.fixture()
def slot():
    database.workshop_slots_collection.insert_one(factories.slot_doc("D1S1"))
    return database.workshop_slots_collection.find_one({"slot_id": "D1S1"})


@pytest.fixture()
def workshop(slot):
    """An open workshop whose scan window is currently open."""
    doc = factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=2,
                                 start_offset_minutes=5)
    database.workshops_collection.insert_one(doc)
    return database.workshops_collection.find_one({"_id": doc["_id"]})


def stored(workshop_id="WKSP111"):
    return database.workshops_collection.find_one({"workshop_id": workshop_id})


# ===========================================================================
# CRUD and visibility
# ===========================================================================

def test_a_workshop_is_created_from_its_slot(client, admin_headers, slot, super_admin):
    response = client.post("/workshops", json=CREATE, headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Workshop created", "workshop_id": "WKSP111"}

    document = stored()
    # The time comes from the slot, never from the request.
    assert document["start_time"] == slot["start_time"]
    assert document["registration_count"] == 0
    assert document["participant_count"] == 0
    assert document["registration_closed_by_system"] is False
    assert document["workshop_team"] == []
    assert document["created_by"] == super_admin["_id"]
    assert len(document["embedding"]) == 2048


def test_creating_against_a_missing_slot_is_a_404(client, admin_headers):
    response = client.post("/workshops", json=CREATE, headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == \
        "Workshop slot not found. Create it via POST /workshop-slots first."


def test_only_super_admins_can_create(client, staff_headers, slot):
    response = client.post("/workshops", json=CREATE, headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can create workshops"


def test_a_participant_cannot_create(client, participant, slot):
    assert client.post("/workshops", json=CREATE,
                       headers=auth_headers(participant)).status_code == 403


def test_creation_is_audited(client, admin_headers, slot, audit):
    client.post("/workshops", json=CREATE, headers=admin_headers)
    row = audit.one("CREATE_WORKSHOP")
    assert row["target_id"] == "WKSP111"
    assert row["details"]["capacity"] == 20
    assert row["details"]["slot_id"] == "D1S1"


def test_the_listing_needs_a_token(client):
    assert client.get("/workshops").status_code in (401, 403)


def test_a_participant_does_not_see_the_workshop_team(client, participant, workshop):
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    rows = client.get("/workshops", headers=auth_headers(participant)).json()
    assert rows and "workshop_team" not in rows[0]


def test_a_super_admin_does_see_the_workshop_team(client, admin_headers, workshop):
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    rows = client.get("/workshops", headers=admin_headers).json()
    assert rows[0]["workshop_team"][0]["user_id"] == "OTWO1111"


def test_the_listing_never_returns_internal_bookkeeping(client, admin_headers, workshop):
    row = client.get("/workshops", headers=admin_headers).json()[0]
    assert "created_by" not in row, "a raw ObjectId would make this 500"
    assert "registration_closed_by_system" not in row
    assert "_id" not in row


def test_a_lapsed_workshop_reads_as_closed_on_the_first_listing(client, admin_headers, slot):
    """The lazy auto-close: there is no scheduler, so it happens on read."""
    doc = factories.workshop_doc("WKSP111", slot_id="D1S1", registration_end_offset=-1)
    database.workshops_collection.insert_one(doc)

    assert client.get("/workshops", headers=admin_headers).json()[0]["registration_open"] is False
    assert stored()["registration_open"] is False, "and the close is persisted"


def test_the_public_catalogue_needs_no_token(client, workshop):
    response = client.get("/workshops/public")
    assert response.status_code == 200
    assert response.json()[0]["workshop_id"] == "WKSP111"


def test_the_public_catalogue_hides_staff_and_internal_fields(client, workshop):
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    row = client.get("/workshops/public").json()[0]
    assert "workshop_team" not in row
    assert "registration_closed_by_system" not in row
    assert "participant_count" not in row
    assert "created_by" not in row


def test_the_public_catalogue_publishes_the_schedule_and_seats(client, workshop):
    row = client.get("/workshops/public").json()[0]
    assert row["capacity"] == 2
    assert row["registration_count"] == 0
    assert row["start_time"] and row["registration_end"]


def test_public_is_not_captured_as_a_workshop_id(client):
    """The literal path is declared before any `/{workshop_id}` route."""
    assert client.get("/workshops/public").status_code == 200


def test_my_registrations_is_empty_for_a_new_participant(client, participant):
    assert client.get("/workshops/my_registrations",
                      headers=auth_headers(participant)).json() == []


def test_my_registrations_resolves_the_booking_to_the_workshop(
    client, make_participant, workshop
):
    person = make_participant(workshops=[factories.workshop_booking(workshop["_id"], "D1S1")])
    rows = client.get("/workshops/my_registrations", headers=auth_headers(person)).json()
    assert rows[0]["workshop_id"] == "WKSP111"
    assert rows[0]["name"] == "Workshop WKSP111"
    assert rows[0]["booking_type"] == "pre-registered"
    assert rows[0]["attended"] is False


def test_a_deleted_workshop_still_reports_its_slot(client, make_participant, workshop):
    """A booking whose workshop is gone yields a row with nulls, but the slot is
    kept so the clash rule stays visible."""
    person = make_participant(workshops=[factories.workshop_booking(workshop["_id"], "D1S1")])
    database.workshops_collection.delete_one({"_id": workshop["_id"]})

    row = client.get("/workshops/my_registrations", headers=auth_headers(person)).json()[0]
    assert row["workshop_id"] is None
    assert row["name"] is None
    assert row["slot_id"] == "D1S1"
    assert row["booking_type"] == "pre-registered"


def test_a_staff_token_cannot_read_my_registrations(client, admin_headers):
    assert client.get("/workshops/my_registrations", headers=admin_headers).status_code == 403


# ---------------------------------------------------------------------------
# PUT / DELETE
# ---------------------------------------------------------------------------

def test_a_workshop_can_be_edited(client, admin_headers, workshop):
    response = client.put("/workshops/WKSP111", json={"venue": "Lab 2", "capacity": 30},
                          headers=admin_headers)
    assert response.status_code == 200
    document = stored()
    assert document["venue"] == "Lab 2"
    assert document["capacity"] == 30


def test_editing_an_unknown_workshop_is_a_404(client, admin_headers):
    response = client.put("/workshops/WKSP999", json={"venue": "x"}, headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop not found"


def test_only_super_admins_can_edit(client, staff_headers, workshop):
    response = client.put("/workshops/WKSP111", json={"venue": "x"}, headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can edit workshops"


def test_the_description_is_re_embedded_only_when_it_changes(
    client, admin_headers, workshop, monkeypatch
):
    from routers import workshops as module

    calls = []
    monkeypatch.setattr(module, "generate_embedding",
                        lambda text: calls.append(text) or [0.5] * 768)

    client.put("/workshops/WKSP111", json={"description": workshop["description"]},
               headers=admin_headers)
    assert calls == []

    client.put("/workshops/WKSP111", json={"description": "Something new"},
               headers=admin_headers)
    assert calls == ["Something new"]


def test_an_incomplete_merged_window_is_a_422(client, admin_headers, slot):
    doc = factories.workshop_doc("WKSP111", slot_id="D1S1")
    doc["registration_end"] = None
    database.workshops_collection.insert_one(doc)

    response = client.put("/workshops/WKSP111", json={"registration_start": iso_from_now(10)},
                          headers=admin_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == "registration_start and registration_end are required"


def test_an_inverted_merged_window_is_a_400(client, admin_headers, workshop):
    """
    Note the code asymmetry with events, which answers 422 for the same shape of
    error — pinned so the difference is deliberate rather than accidental.
    """
    response = client.put("/workshops/WKSP111", json={"registration_start": iso_from_now(600)},
                          headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "registration_end must be after registration_start"


def test_pushing_a_new_deadline_re_arms_the_auto_close(client, admin_headers, slot):
    doc = factories.workshop_doc("WKSP111", slot_id="D1S1", registration_end_offset=-1)
    database.workshops_collection.insert_one(doc)
    client.get("/workshops/public")  # spends the one-shot close
    assert stored()["registration_closed_by_system"] is True

    client.put("/workshops/WKSP111",
               json={"registration_end": iso_from_now(120), "registration_open": True},
               headers=admin_headers)
    assert stored()["registration_closed_by_system"] is False


def test_reopening_without_a_new_deadline_leaves_the_bit_alone(client, admin_headers, slot):
    """This is what makes an admin's override survive later reads."""
    doc = factories.workshop_doc("WKSP111", slot_id="D1S1", registration_end_offset=-1)
    database.workshops_collection.insert_one(doc)
    client.get("/workshops/public")

    client.put("/workshops/WKSP111", json={"registration_open": True}, headers=admin_headers)
    assert stored()["registration_closed_by_system"] is True
    assert client.get("/workshops/public").json()[0]["registration_open"] is True


def test_slot_id_and_start_time_are_silently_ignored_on_edit(client, admin_headers, workshop):
    """Absent from the model on purpose: bookings reference the slot."""
    client.put("/workshops/WKSP111", json={"slot_id": "D9S9", "start_time": "2020-01-01T00:00:00Z"},
               headers=admin_headers)
    document = stored()
    assert document["slot_id"] == "D1S1"
    assert document["start_time"] == workshop["start_time"]


def test_an_empty_edit_still_answers_200_and_audits(client, admin_headers, workshop, audit):
    assert client.put("/workshops/WKSP111", json={}, headers=admin_headers).status_code == 200
    assert audit.rows("UPDATE_WORKSHOP")


def test_the_embedding_is_kept_out_of_the_audit_row(client, admin_headers, workshop, audit):
    client.put("/workshops/WKSP111", json={"description": "Something new"},
               headers=admin_headers)
    assert "embedding" not in audit.latest("UPDATE_WORKSHOP")["details"]


def test_deleting_a_workshop_removes_it_and_its_bookings(
    client, admin_headers, workshop, make_participant
):
    person = make_participant(workshops=[factories.workshop_booking(workshop["_id"], "D1S1")])
    response = client.delete("/workshops/WKSP111", headers=admin_headers)

    assert response.status_code == 200
    assert stored() is None
    assert database.participants_collection.find_one({"_id": person["_id"]})["workshops"] == []


def test_only_super_admins_can_delete(client, staff_headers, workshop):
    response = client.delete("/workshops/WKSP111", headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can delete workshops"


def test_deleting_an_unknown_workshop_is_a_404(client, admin_headers):
    response = client.delete("/workshops/WKSP999", headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop not found"


def test_a_refused_deletion_is_not_recorded_as_a_deletion(client, admin_headers, audit):
    """The trail must not carry a deletion that never happened — a mistyped id used
    to write the same DELETE_WORKSHOP row a real deletion writes."""
    client.delete("/workshops/WKSP999", headers=admin_headers)

    audit.none("DELETE_WORKSHOP")
    assert audit.one("DELETE_WORKSHOP_DENIED")["details"]["reason"] == "workshop_not_found"


def test_a_real_deletion_records_what_it_destroyed(
    client, admin_headers, workshop, make_participant, audit
):
    make_participant(workshops=[factories.workshop_booking(workshop["_id"], "D1S1")])
    client.delete("/workshops/WKSP111", headers=admin_headers)

    row = audit.one("DELETE_WORKSHOP")
    assert row["target_id"] == "WKSP111"
    assert row["details"]["bookings_removed"] == 1


# ===========================================================================
# Volunteers
# ===========================================================================

def test_a_volunteer_is_added_to_the_team(client, admin_headers, workshop):
    response = client.post("/workshops/WKSP111/volunteers",
                           json={"user_id": "OTWO1111"}, headers=admin_headers)
    assert response.status_code == 200
    team = stored()["workshop_team"]
    assert team == [{"role": "workshop_volunteer", "user_id": "OTWO1111", "attendance": True}]


def test_only_super_admins_can_assign_volunteers(client, staff_headers, workshop):
    response = client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                           headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can assign volunteers"


def test_assigning_to_an_unknown_workshop_is_refused(client, admin_headers):
    """It used to answer 200 while writing nothing — the volunteer found out at the
    desk, refused with "Not authorized to scan for this workshop"."""
    response = client.post("/workshops/WKSP999/volunteers", json={"user_id": "OTWO1111"},
                           headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop not found"


def test_assigning_the_same_volunteer_twice_is_refused(client, admin_headers, workshop):
    """
    Duplicates were not merely untidy: every membership lookup is a `next(...)` over
    `workshop_team`, so a volunteer stood down by one entry could still scan through
    another.
    """
    client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                headers=admin_headers)
    second = client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                         headers=admin_headers)
    assert second.status_code == 409
    assert second.json()["detail"] == "Volunteer already assigned to this workshop"
    assert len(stored()["workshop_team"]) == 1


def test_a_refused_assignment_is_recorded(client, admin_headers, workshop, audit):
    client.post("/workshops/WKSP999/volunteers", json={"user_id": "OTWO1111"},
                headers=admin_headers)
    client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                headers=admin_headers)
    client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                headers=admin_headers)

    reasons = [row["details"]["reason"]
               for row in audit.rows("ASSIGN_WORKSHOP_VOLUNTEER_DENIED")]
    assert reasons == ["workshop_not_found", "already_on_team"]


def test_the_same_person_may_staff_two_different_workshops(client, admin_headers, slot):
    """The uniqueness is per workshop, not global — one volunteer covers several
    desks across a fest."""
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D1S1"),
    ])
    for workshop_id in ("WKSP111", "WKSP112"):
        assert client.post(f"/workshops/{workshop_id}/volunteers",
                           json={"user_id": "OTWO1111"},
                           headers=admin_headers).status_code == 200


def test_a_removed_volunteer_can_be_assigned_again(client, admin_headers, workshop):
    client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                headers=admin_headers)
    client.delete("/workshops/WKSP111/volunteers/OTWO1111", headers=admin_headers)
    assert client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                       headers=admin_headers).status_code == 200


def test_assigning_a_volunteer_is_audited(client, admin_headers, workshop, audit):
    """Who may scan a workshop's door is a privilege decision, recorded alongside
    the removals that were already audited."""
    client.post("/workshops/WKSP111/volunteers", json={"user_id": "OTWO1111"},
                headers=admin_headers)
    row = audit.one("ASSIGN_WORKSHOP_VOLUNTEER")
    assert row["target_id"] == "WKSP111"
    assert row["details"]["volunteer_user_id"] == "OTWO1111"
    assert row["details"]["scanning_enabled"] is True


def test_a_refused_assignment_writes_no_success_row(client, admin_headers, audit):
    """The trail must not record a privilege grant that did not happen."""
    client.post("/workshops/WKSP999/volunteers", json={"user_id": "OTWO1111"},
                headers=admin_headers)
    audit.none("ASSIGN_WORKSHOP_VOLUNTEER")


def toggle(client, admin_headers, user_id="OTWO1111", attendance="false",
           workshop_id="WKSP111"):
    return client.put(
        f"/workshops/{workshop_id}/volunteers/{user_id}/toggle_scan"
        f"?attendance={attendance}",
        headers=admin_headers,
    )


def test_the_volunteer_in_the_path_is_the_one_toggled(client, admin_headers, workshop):
    """
    The handler used to read a `volunteer_user_id` parameter that appears nowhere
    in the path, which FastAPI therefore made a required *query* parameter — so
    this call, the one the route's own path advertises, was a 422, and the
    `{user_id}` segment was ignored entirely.
    """
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    response = toggle(client, admin_headers)
    assert response.status_code == 200
    assert stored()["workshop_team"][0]["attendance"] is False


def test_the_attendance_flag_is_still_required(client, admin_headers, workshop):
    """`attendance` is the one genuine query parameter — nothing in the path
    carries the state being set."""
    assert client.put("/workshops/WKSP111/volunteers/OTWO1111/toggle_scan",
                      headers=admin_headers).status_code == 422


def test_a_stray_volunteer_user_id_query_parameter_is_ignored(
    client, admin_headers, workshop
):
    """The path is now the only place the volunteer is named, so an old client
    still sending the query parameter cannot toggle somebody else."""
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    response = client.put(
        "/workshops/WKSP111/volunteers/OTWO1111/toggle_scan"
        "?volunteer_user_id=GHOST&attendance=false",
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert stored()["workshop_team"][0]["attendance"] is False


def test_toggling_a_non_member_is_refused(client, admin_headers, workshop):
    """It used to answer 200 'Volunteer scanning toggled' having changed nothing,
    so an admin found out only when the volunteer was refused at the desk."""
    response = toggle(client, admin_headers, user_id="GHOST", attendance="true")
    assert response.status_code == 404
    assert response.json()["detail"] == "That member is not on this workshop's team"


def test_toggling_on_an_unknown_workshop_is_a_404(client, admin_headers):
    response = toggle(client, admin_headers, workshop_id="WKSP999", attendance="true")
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop not found"


def test_a_refused_toggle_writes_no_success_row(client, admin_headers, workshop, audit):
    toggle(client, admin_headers, user_id="GHOST", attendance="true")

    audit.none("TOGGLE_WORKSHOP_SCAN")
    assert audit.one("TOGGLE_WORKSHOP_SCAN_DENIED")["details"]["reason"] == \
        "volunteer_not_on_team"


def test_a_real_toggle_is_audited(client, admin_headers, workshop, audit):
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    toggle(client, admin_headers, attendance="false")

    row = audit.one("TOGGLE_WORKSHOP_SCAN")
    assert row["details"]["volunteer_user_id"] == "OTWO1111"
    assert row["details"]["scanning_enabled"] is False


def test_a_volunteer_can_be_removed(client, admin_headers, workshop):
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    response = client.delete("/workshops/WKSP111/volunteers/OTWO1111", headers=admin_headers)
    assert response.status_code == 200
    assert stored()["workshop_team"] == []


def test_removing_a_non_member_is_a_404(client, admin_headers, workshop):
    response = client.delete("/workshops/WKSP111/volunteers/GHOST", headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "That member is not on this workshop's team"


def test_removal_keeps_the_scans_that_person_already_made(
    client, admin_headers, workshop, audit
):
    """An attendance record must not disappear when a shift ends."""
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$push": {"workshop_team": factories.workshop_team_member("OTWO1111")}},
    )
    database.workshop_logs_collection.insert_one({
        "workshop_id": str(workshop["_id"]), "action": "attendance", "scanned_by": "OTWO1111",
    })
    client.delete("/workshops/WKSP111/volunteers/OTWO1111", headers=admin_headers)

    assert database.workshop_logs_collection.count_documents({"scanned_by": "OTWO1111"}) == 1
    assert audit.one("REMOVE_WORKSHOP_VOLUNTEER")["details"]["user_id"] == "OTWO1111"


def test_only_super_admins_can_remove_volunteers(client, staff_headers, workshop):
    response = client.delete("/workshops/WKSP111/volunteers/OTWO1111", headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can remove volunteers"


# ===========================================================================
# Logs
# ===========================================================================

def test_the_log_view_is_super_admin_only(client, staff_headers, workshop):
    response = client.get("/workshops/WKSP111/logs", headers=staff_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can view logs"


def test_logs_key_on_the_stringified_object_id(client, admin_headers, workshop):
    database.workshop_logs_collection.insert_one({
        "workshop_id": str(workshop["_id"]), "action": "registration",
        "participant_id": "DS23F000001",
    })
    body = client.get("/workshops/WKSP111/logs", headers=admin_headers).json()
    assert len(body["logs"]) == 1
    assert body["logs"][0]["participant_id"] == "DS23F000001"
    assert "_id" not in body["logs"][0]


def test_logs_for_an_unknown_workshop_are_a_404(client, admin_headers):
    response = client.get("/workshops/WKSP999/logs", headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop not found"
