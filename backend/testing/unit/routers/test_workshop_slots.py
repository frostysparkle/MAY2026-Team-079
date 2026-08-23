"""
Endpoint tests for /workshop-slots.

A slot is the thing a Super Admin schedules independently; a workshop denormalises
its `start_time` from one. So the cascades are the point of this file: editing a
slot must keep every workshop referencing it in agreement about when it runs, and
deleting one must not leave a participant holding a booking for a workshop that no
longer exists.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers, iso_from_now

CREATE = {
    "slot_id": "D1S1",
    "start_time": "2026-06-13T10:00:00Z",
    "end_time": "2026-06-13T12:00:00Z",
}


# ---------------------------------------------------------------------------
# GET — deliberately unauthenticated
# ---------------------------------------------------------------------------

def test_the_catalogue_needs_no_token(client):
    """A create-workshop form has to read the slots before anyone signs in, and a
    slot carries no participant, staff, or bookkeeping data."""
    assert client.get("/workshop-slots").status_code == 200


def test_internal_fields_are_projected_out(client, super_admin):
    database.workshop_slots_collection.insert_one(
        factories.slot_doc(created_by=super_admin["_id"])
    )
    rows = client.get("/workshop-slots").json()
    assert rows
    assert "created_by" not in rows[0]
    assert "_id" not in rows[0]


def test_the_catalogue_lists_every_slot(client):
    database.workshop_slots_collection.insert_many([
        factories.slot_doc("D1S1"), factories.slot_doc("D2S1"),
    ])
    assert {row["slot_id"] for row in client.get("/workshop-slots").json()} == {"D1S1", "D2S1"}


# ---------------------------------------------------------------------------
# Authorization on the writes
# ---------------------------------------------------------------------------

WRITES = [
    ("post", "/workshop-slots", {"json": CREATE}),
    ("put", "/workshop-slots/D1S1", {"json": {"start_time": "2026-06-13T09:00:00Z"}}),
    ("delete", "/workshop-slots/D1S1", {}),
]


@pytest.mark.parametrize("method,path,kwargs", WRITES)
def test_ordinary_staff_cannot_manage_slots(client, staff_headers, method, path, kwargs):
    response = getattr(client, method)(path, headers=staff_headers, **kwargs)
    assert response.status_code == 403
    assert response.json()["detail"] == "Only Super Admins can perform this action"


@pytest.mark.parametrize("method,path,kwargs", WRITES)
def test_a_participant_cannot_manage_slots(client, participant, method, path, kwargs):
    response = getattr(client, method)(path, headers=auth_headers(participant), **kwargs)
    assert response.status_code == 403


@pytest.mark.parametrize("method,path,kwargs", WRITES)
def test_no_token_cannot_manage_slots(client, method, path, kwargs):
    assert getattr(client, method)(path, **kwargs).status_code in (401, 403)


# ---------------------------------------------------------------------------
# POST
# ---------------------------------------------------------------------------

def test_a_slot_is_created(client, admin_headers, super_admin):
    response = client.post("/workshop-slots", json=CREATE, headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Workshop slot created"}

    document = database.workshop_slots_collection.find_one({"slot_id": "D1S1"})
    assert document["start_time"] == CREATE["start_time"]
    assert document["end_time"] == CREATE["end_time"]
    assert document["created_by"] == super_admin["_id"]
    assert document["created_at"] and document["updated_at"]


def test_a_duplicate_slot_id_is_refused(client, admin_headers):
    client.post("/workshop-slots", json=CREATE, headers=admin_headers)
    response = client.post("/workshop-slots", json=CREATE, headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "A slot with this slot_id already exists"
    assert database.workshop_slots_collection.count_documents({}) == 1


@pytest.mark.parametrize("slot_id", ["d1s1", "D1", "S1", "D1-S1", "slot1", ""])
def test_a_malformed_slot_id_is_a_422(client, admin_headers, slot_id):
    """The closed pattern is what makes "same slot => same time block" a
    guarantee the slot-clash check can rely on."""
    assert client.post("/workshop-slots", json={**CREATE, "slot_id": slot_id},
                       headers=admin_headers).status_code == 422


def test_an_inverted_window_is_a_422(client, admin_headers):
    assert client.post("/workshop-slots",
                       json={**CREATE, "start_time": "2026-06-13T12:00:00Z",
                             "end_time": "2026-06-13T10:00:00Z"},
                       headers=admin_headers).status_code == 422


def test_an_unparseable_timestamp_is_a_422(client, admin_headers):
    assert client.post("/workshop-slots", json={**CREATE, "start_time": "tomorrow"},
                       headers=admin_headers).status_code == 422


def test_creation_is_audited(client, admin_headers, audit):
    client.post("/workshop-slots", json=CREATE, headers=admin_headers)
    assert audit.one("CREATE_WORKSHOP_SLOT")["target_id"] == "D1S1"


# ---------------------------------------------------------------------------
# PUT — merge, validate, cascade
# ---------------------------------------------------------------------------

@pytest.fixture()
def slot(client, admin_headers):
    database.workshop_slots_collection.insert_one(factories.slot_doc(
        "D1S1", start_offset_minutes=0, duration_minutes=120,
    ))
    return database.workshop_slots_collection.find_one({"slot_id": "D1S1"})


def test_an_unknown_slot_is_a_404(client, admin_headers):
    response = client.put("/workshop-slots/D9S9", json={"start_time": iso_from_now(60)},
                          headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop slot not found"


def test_a_path_that_is_not_even_slot_shaped_is_a_404_not_a_422(client, admin_headers):
    """The path parameter is not pattern-validated, unlike the body field."""
    assert client.put("/workshop-slots/whatever", json={"start_time": iso_from_now(60)},
                      headers=admin_headers).status_code == 404


def test_an_empty_body_is_a_400(client, admin_headers, slot):
    response = client.put("/workshop-slots/D1S1", json={}, headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Nothing to update"


def test_one_bound_may_be_pushed_alone(client, admin_headers, slot):
    new_end = iso_from_now(300)
    response = client.put("/workshop-slots/D1S1", json={"end_time": new_end},
                          headers=admin_headers)
    assert response.status_code == 200
    assert database.workshop_slots_collection.find_one({"slot_id": "D1S1"})["end_time"] == new_end


def test_a_single_bound_is_validated_against_the_stored_other_one(client, admin_headers, slot):
    """
    The key case the model alone cannot catch: only `start_time` is sent, and it
    lands after the `end_time` already on file.
    """
    response = client.put("/workshop-slots/D1S1", json={"start_time": iso_from_now(600)},
                          headers=admin_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "end_time must be after start_time"


def test_an_inverted_pair_is_rejected_by_the_model_as_a_422(client, admin_headers, slot):
    assert client.put("/workshop-slots/D1S1",
                      json={"start_time": iso_from_now(300), "end_time": iso_from_now(60)},
                      headers=admin_headers).status_code == 422


def test_a_rejected_edit_writes_nothing(client, admin_headers, slot):
    client.put("/workshop-slots/D1S1", json={"start_time": iso_from_now(600)},
               headers=admin_headers)
    assert database.workshop_slots_collection.find_one(
        {"slot_id": "D1S1"}
    )["start_time"] == slot["start_time"]


def test_moving_a_slot_cascades_to_its_workshops(client, admin_headers, slot):
    """Only `start_time` is denormalised onto a workshop — that is what the
    scan-window guard and the slot-clash check read."""
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D1S1"),
        factories.workshop_doc("WKSP113", slot_id="D2S1"),
    ])
    new_start = iso_from_now(30)

    response = client.put("/workshop-slots/D1S1", json={"start_time": new_start},
                          headers=admin_headers)

    assert response.status_code == 200
    assert response.json() == {"message": "Workshop slot updated", "workshops_updated": 2}
    for workshop_id in ("WKSP111", "WKSP112"):
        assert database.workshops_collection.find_one(
            {"workshop_id": workshop_id}
        )["start_time"] == new_start
    # A workshop in another slot is untouched.
    assert database.workshops_collection.find_one(
        {"workshop_id": "WKSP113"}
    )["start_time"] != new_start


def test_changing_only_the_end_time_leaves_workshops_alone(client, admin_headers, slot):
    database.workshops_collection.insert_one(factories.workshop_doc("WKSP111", slot_id="D1S1"))
    before = database.workshops_collection.find_one({"workshop_id": "WKSP111"})["start_time"]

    response = client.put("/workshop-slots/D1S1", json={"end_time": iso_from_now(300)},
                          headers=admin_headers)

    assert response.json()["workshops_updated"] == 0
    assert database.workshops_collection.find_one(
        {"workshop_id": "WKSP111"}
    )["start_time"] == before


def test_pushing_an_unchanged_start_time_still_counts_as_an_update(client, admin_headers, slot):
    """
    `workshops_updated` is a `modified_count`, and the cascade also writes
    `updated_at`, so a workshop is modified even when its `start_time` was already
    the value being pushed. The figure therefore reports "workshops touched", not
    "workshops whose time changed".
    """
    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", start_time=slot["start_time"])
    )
    response = client.put("/workshop-slots/D1S1", json={"start_time": slot["start_time"]},
                          headers=admin_headers)
    assert response.json()["workshops_updated"] == 1


def test_a_slot_with_no_workshops_reports_zero(client, admin_headers, slot):
    assert client.put("/workshop-slots/D1S1", json={"start_time": iso_from_now(30)},
                      headers=admin_headers).json()["workshops_updated"] == 0


def test_the_cascade_size_is_audited(client, admin_headers, slot, audit):
    database.workshops_collection.insert_one(factories.workshop_doc("WKSP111", slot_id="D1S1"))
    client.put("/workshop-slots/D1S1", json={"start_time": iso_from_now(30)},
               headers=admin_headers)
    row = audit.one("UPDATE_WORKSHOP_SLOT")
    assert row["target_id"] == "D1S1"
    assert row["details"]["workshops_updated"] == 1


# ---------------------------------------------------------------------------
# DELETE — cascade to workshops and to participants' bookings
# ---------------------------------------------------------------------------

def test_deleting_an_unknown_slot_is_a_404(client, admin_headers):
    response = client.delete("/workshop-slots/D9S9", headers=admin_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop slot not found"


def test_an_empty_slot_is_deleted_cleanly(client, admin_headers, slot):
    response = client.delete("/workshop-slots/D1S1", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"message": "Workshop slot deleted", "workshops_deleted": 0}
    assert database.workshop_slots_collection.find_one({"slot_id": "D1S1"}) is None


def test_deleting_a_slot_removes_its_workshops(client, admin_headers, slot):
    """A workshop with no slot has no time and no way to be scheduled again, so
    it is removed rather than left dangling."""
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D1S1"),
        factories.workshop_doc("WKSP113", slot_id="D2S1"),
    ])
    response = client.delete("/workshop-slots/D1S1", headers=admin_headers)

    assert response.json()["workshops_deleted"] == 2
    assert database.workshops_collection.count_documents({}) == 1
    assert database.workshops_collection.find_one({"workshop_id": "WKSP113"})


def test_participants_bookings_are_pulled_so_none_dangles(
    client, admin_headers, slot, make_participant
):
    database.workshops_collection.insert_one(factories.workshop_doc("WKSP111", slot_id="D1S1"))
    workshop = database.workshops_collection.find_one({"workshop_id": "WKSP111"})
    person = make_participant(
        workshops=[factories.workshop_booking(workshop["_id"], "D1S1")]
    )

    client.delete("/workshop-slots/D1S1", headers=admin_headers)

    assert database.participants_collection.find_one({"_id": person["_id"]})["workshops"] == []


def test_a_booking_for_another_slot_survives(client, admin_headers, slot, make_participant):
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D2S1"),
    ])
    doomed = database.workshops_collection.find_one({"workshop_id": "WKSP111"})
    kept = database.workshops_collection.find_one({"workshop_id": "WKSP112"})
    person = make_participant(workshops=[
        factories.workshop_booking(doomed["_id"], "D1S1"),
        factories.workshop_booking(kept["_id"], "D2S1"),
    ])

    client.delete("/workshop-slots/D1S1", headers=admin_headers)

    remaining = database.participants_collection.find_one({"_id": person["_id"]})["workshops"]
    assert [entry["slot_id"] for entry in remaining] == ["D2S1"]


def test_each_removed_workshop_gets_its_own_audit_row(client, admin_headers, slot, audit):
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D1S1"),
    ])
    client.delete("/workshop-slots/D1S1", headers=admin_headers)

    deletions = audit.rows("DELETE_WORKSHOP")
    assert {row["target_id"] for row in deletions} == {"WKSP111", "WKSP112"}
    assert all(row["details"]["reason"] == "slot_deleted" for row in deletions)
    assert all(row["details"]["slot_id"] == "D1S1" for row in deletions)

    summary = audit.one("DELETE_WORKSHOP_SLOT")
    assert summary["details"]["workshops_deleted"] == 2


def test_the_slot_catalogue_reflects_the_deletion(client, admin_headers, slot):
    client.delete("/workshop-slots/D1S1", headers=admin_headers)
    assert client.get("/workshop-slots").json() == []
