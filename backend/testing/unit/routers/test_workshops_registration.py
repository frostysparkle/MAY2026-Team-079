"""
Endpoint tests for workshop registration and the live seats stream.

Seat accounting is the subject. `registration_count` is what gates capacity, and
every path that touches it is asserted here: the guarded increment, the slot-clash
rule that stops one participant holding two seats in one time block, and the
`my_registrations` view that is the only way a participant can read a booking back.
"""
import asyncio
import json

import pytest

import database
from testing import factories
from testing.helpers import auth_headers, iso_from_now


@pytest.fixture()
def slot():
    database.workshop_slots_collection.insert_one(factories.slot_doc("D1S1"))
    database.workshop_slots_collection.insert_one(factories.slot_doc("D2S1"))


@pytest.fixture()
def workshop(slot):
    doc = factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=2)
    database.workshops_collection.insert_one(doc)
    return database.workshops_collection.find_one({"_id": doc["_id"]})


def stored(workshop_id="WKSP111"):
    return database.workshops_collection.find_one({"workshop_id": workshop_id})


def bookings(person):
    return database.participants_collection.find_one({"_id": person["_id"]})["workshops"]


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_a_participant_can_register(client, participant, workshop):
    response = client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    assert response.status_code == 200
    assert response.json() == {"message": "Successfully registered for workshop"}


def test_registration_charges_exactly_one_seat(client, participant, workshop):
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    document = stored()
    assert document["registration_count"] == 1
    # `participant_count` tracks attendance, not booking, so it stays put.
    assert document["participant_count"] == 0


def test_the_booking_stores_the_workshops_object_id(client, participant, workshop):
    """Not the readable id — every roster query and the delete cascade join on
    this."""
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    entry = bookings(participant)[0]
    assert entry["workshop_id"] == workshop["_id"]
    assert entry["slot_id"] == "D1S1"
    assert entry["booking_type"] == "pre-registered"
    assert entry["attended"] is False


def test_registration_writes_a_workshop_log_row(client, participant, workshop):
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    row = database.workshop_logs_collection.find_one({"action": "registration"})
    assert row["workshop_id"] == str(workshop["_id"])
    assert row["participant_id"] == participant["participant_id"]


def test_registration_is_audited(client, participant, workshop, audit):
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    row = audit.one("WORKSHOP_REGISTER")
    assert row["target_id"] == "WKSP111"
    assert row["details"]["participant_id"] == participant["participant_id"]
    assert row["details"]["slot_id"] == "D1S1"
    assert row["actor_type"] == "participant"


def test_a_registration_is_readable_back(client, participant, workshop):
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    rows = client.get("/workshops/my_registrations", headers=auth_headers(participant)).json()
    assert [row["workshop_id"] for row in rows] == ["WKSP111"]


def test_a_participant_can_register_by_slot_id(client, participant, workshop):
    """`_resolve_workshop` accepts a slot id, so this is a legal call."""
    assert client.post("/workshops/D1S1/register",
                       headers=auth_headers(participant)).status_code == 200


def test_a_participant_can_register_by_object_id(client, participant, workshop):
    assert client.post(f"/workshops/{workshop['_id']}/register",
                       headers=auth_headers(participant)).status_code == 200


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

def test_a_staff_token_cannot_register(client, admin_headers, workshop):
    response = client.post("/workshops/WKSP111/register", headers=admin_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Participant credentials required. Use /auth/login."


def test_no_token_cannot_register(client, workshop):
    assert client.post("/workshops/WKSP111/register").status_code in (401, 403)


# ---------------------------------------------------------------------------
# Refusals, in the order the route checks them
# ---------------------------------------------------------------------------

def test_an_unknown_workshop_is_a_404(client, participant):
    response = client.post("/workshops/WKSP999/register", headers=auth_headers(participant))
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop not found"


def test_a_closed_workshop_is_refused(client, participant, slot):
    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", registration_open=False)
    )
    response = client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == "Registration is closed for this workshop"


def test_a_lapsed_deadline_closes_registration_on_the_way_in(client, participant, slot):
    """`_resolve_workshop` runs the sync, so a workshop that lapsed without anyone
    reading it is still refused."""
    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", registration_end_offset=-1)
    )
    response = client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == "Registration is closed for this workshop"


def test_an_admin_override_reopens_registration_past_the_deadline(
    client, participant, admin_headers, slot
):
    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", registration_end_offset=-1)
    )
    client.get("/workshops/public")  # spend the one-shot close
    client.put("/workshops/WKSP111", json={"registration_open": True}, headers=admin_headers)

    assert client.post("/workshops/WKSP111/register",
                       headers=auth_headers(participant)).status_code == 200


def test_a_full_workshop_is_refused(client, make_participant, slot):
    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=1)
    )
    first = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in")
    second = make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in")

    assert client.post("/workshops/WKSP111/register",
                       headers=auth_headers(first)).status_code == 200
    response = client.post("/workshops/WKSP111/register", headers=auth_headers(second))
    assert response.status_code == 400
    assert response.json()["detail"] == "Workshop is full"
    assert stored()["registration_count"] == 1


def test_capacity_cannot_be_exceeded_even_with_registration_forced_open(
    client, make_participant, admin_headers, slot
):
    """An override reopens registration; it can never register past a full room."""
    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=1,
                               registration_end_offset=-1)
    )
    # The auto-close has to be spent before an override can stick: the read below
    # is what fires it, and only then does `registration_open=True` survive.
    client.get("/workshops/public")
    client.put("/workshops/WKSP111", json={"registration_open": True}, headers=admin_headers)
    first = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in")
    second = make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in")

    client.post("/workshops/WKSP111/register", headers=auth_headers(first))
    assert client.post("/workshops/WKSP111/register",
                       headers=auth_headers(second)).json()["detail"] == "Workshop is full"


def test_registering_twice_is_refused_as_a_duplicate(client, participant, workshop):
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    response = client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == "Already registered for this workshop"
    assert stored()["registration_count"] == 1, "the failed retry charged no seat"


def test_a_second_workshop_in_the_same_slot_is_refused_as_a_clash(client, participant, slot):
    """
    And the message must say *clash*, not *duplicate* — comparing slot ids in the
    duplicate check above would swallow this branch and report the wrong reason.
    """
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D1S1"),
    ])
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))

    response = client.post("/workshops/WKSP112/register", headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == "Already registered for another workshop in this time slot"


def test_a_clash_charges_no_seat_on_the_second_workshop(client, participant, slot):
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D1S1"),
    ])
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    client.post("/workshops/WKSP112/register", headers=auth_headers(participant))
    assert stored("WKSP112")["registration_count"] == 0


def test_a_workshop_in_a_different_slot_is_allowed(client, participant, slot):
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1"),
        factories.workshop_doc("WKSP112", slot_id="D2S1"),
    ])
    assert client.post("/workshops/WKSP111/register",
                       headers=auth_headers(participant)).status_code == 200
    assert client.post("/workshops/WKSP112/register",
                       headers=auth_headers(participant)).status_code == 200
    assert len(bookings(participant)) == 2


def test_the_guarded_increment_refuses_a_seat_that_vanished(
    client, participant, workshop, monkeypatch
):
    """
    The route re-checks capacity inside the update filter, so a workshop that
    filled up between the read and the write is refused rather than oversubscribed.
    """
    original = database.workshops_collection.update_one

    def fill_then_update(filter_, update, *args, **kwargs):
        if "registration_count" in filter_:
            original({"_id": workshop["_id"]}, {"$set": {"registration_count": 99}})
        return original(filter_, update, *args, **kwargs)

    monkeypatch.setattr(database.workshops_collection, "update_one", fill_then_update)
    response = client.post("/workshops/WKSP111/register", headers=auth_headers(participant))

    assert response.status_code == 400
    assert response.json()["detail"] == "Failed to register. Workshop might have just filled up."


def test_a_failed_registration_stores_no_booking(client, participant, workshop):
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    assert len(bookings(participant)) == 1


# ---------------------------------------------------------------------------
# Seats, end to end
# ---------------------------------------------------------------------------

def test_the_public_catalogue_reflects_each_registration(client, make_participant, slot):
    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=3)
    )
    assert client.get("/workshops/public").json()[0]["registration_count"] == 0

    for index in (1, 2):
        person = make_participant(participant_id=f"DS23F00000{index}",
                                  email=f"p{index}@ds.study.iitm.ac.in")
        client.post("/workshops/WKSP111/register", headers=auth_headers(person))

    assert client.get("/workshops/public").json()[0]["registration_count"] == 2


def test_deleting_a_workshop_releases_every_booking(
    client, participant, workshop, admin_headers
):
    client.post("/workshops/WKSP111/register", headers=auth_headers(participant))
    client.delete("/workshops/WKSP111", headers=admin_headers)
    assert bookings(participant) == []
    assert client.get("/workshops/my_registrations",
                      headers=auth_headers(participant)).json() == []


# ---------------------------------------------------------------------------
# GET /workshops/{id}/seats/stream — SSE
# ---------------------------------------------------------------------------

async def drain(generator, frames=1):
    """Read a bounded number of frames from an endless SSE generator."""
    collected = []
    async for frame in generator:
        collected.append(frame)
        if len(collected) >= frames:
            break
    return collected


@pytest.fixture()
def instant_sleep(monkeypatch):
    """
    Make the stream's poll interval free.

    The real `asyncio.sleep` is captured *before* patching — replacing it with a
    lambda that calls `asyncio.sleep` would recurse into itself.
    """
    real_sleep = asyncio.sleep

    async def no_wait(_seconds):
        await real_sleep(0)

    from routers import workshops as module

    monkeypatch.setattr(module.asyncio, "sleep", no_wait)


async def test_the_stream_reports_the_remaining_seats(instant_sleep, slot):
    from routers import workshops as module

    doc = factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=10)
    doc["registration_count"] = 4
    database.workshops_collection.insert_one(doc)

    response = await module.stream_workshop_seats("WKSP111")
    frames = await drain(response.body_iterator, frames=1)

    assert json.loads(frames[0].removeprefix("data: ").strip()) == {
        "remaining_seats": 6, "capacity": 10,
    }


async def test_the_stream_emits_only_when_the_count_changes(instant_sleep, slot):
    from routers import workshops as module

    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=10)
    )
    generator = (await module.stream_workshop_seats("WKSP111")).body_iterator

    first = await generator.__anext__()
    assert "\"remaining_seats\": 10" in first

    # Nothing has changed, so the next frame only arrives once the count moves.
    database.workshops_collection.update_one(
        {"workshop_id": "WKSP111"}, {"$inc": {"registration_count": 1}}
    )
    second = await generator.__anext__()
    assert "\"remaining_seats\": 9" in second
    await generator.aclose()


async def test_the_stream_reports_a_missing_workshop_and_stops():
    from routers import workshops as module

    frames = [frame async for frame in (
        await module.stream_workshop_seats("WKSP999")
    ).body_iterator]
    assert frames == ['data: {"error": "Workshop not found"}\n\n']


async def test_the_stream_accepts_a_slot_id(instant_sleep, slot):
    from routers import workshops as module

    database.workshops_collection.insert_one(
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=5)
    )
    frames = await drain((await module.stream_workshop_seats("D1S1")).body_iterator)
    assert "\"capacity\": 5" in frames[0]


def test_the_missing_workshop_frame_is_reachable_over_http(client):
    """The only terminating branch, so this is the one case a plain request can
    read to completion without hanging."""
    with client.stream("GET", "/workshops/WKSP999/seats/stream") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert "Workshop not found" in next(response.iter_text())


def test_the_stream_is_unauthenticated(client):
    """Pinned rather than endorsed: seat counts are already public through
    /workshops/public, but this endpoint has no dependency at all."""
    assert client.stream("GET", "/workshops/WKSP999/seats/stream").__enter__().status_code == 200
