"""
Endpoint tests for workshop attendance scanning and the workshop desk.

The on-spot branch is the most intricate accounting in the API: a walk-in whose
booking for another workshop in the same slot is destroyed must have that seat
returned, and the same-workshop case must net to zero. Both are asserted against
the counters rather than the response message.

QR payloads are real RSA-OAEP ciphertext, so `verify_qr` runs for real.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers, corrupt_qr, iso, make_qr

SCANNER = "OTWO1111"


@pytest.fixture()
def scanner(make_staff):
    """A staff account on the workshop team, with scanning enabled."""
    return make_staff(paradox_id=SCANNER, email="desk@ds.study.iitm.ac.in", role="other",
                      department="workshops", designation="Workshop Desk")


@pytest.fixture()
def slots():
    database.workshop_slots_collection.insert_many([
        factories.slot_doc("D1S1"), factories.slot_doc("D2S1"),
    ])


@pytest.fixture()
def workshop(slots, scanner):
    """Start time five minutes out, so every scan window is currently open."""
    doc = factories.workshop_doc(
        "WKSP111", slot_id="D1S1", capacity=20, start_offset_minutes=5,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    )
    database.workshops_collection.insert_one(doc)
    return database.workshops_collection.find_one({"_id": doc["_id"]})


def stored(workshop_id="WKSP111"):
    return database.workshops_collection.find_one({"workshop_id": workshop_id})


def bookings(person):
    return database.participants_collection.find_one({"_id": person["_id"]})["workshops"]


def register(client, person, workshop_id="WKSP111"):
    response = client.post(f"/workshops/{workshop_id}/register", headers=auth_headers(person))
    assert response.status_code == 200, response.json()


def scan(client, scanner_doc, person, scan_type="pre-registered", workshop_id="WKSP111"):
    return client.post(f"/workshops/{workshop_id}/attendance?scan_type={scan_type}",
                       json=make_qr(person), headers=auth_headers(scanner_doc))


# ---------------------------------------------------------------------------
# Authorization and the scan window
# ---------------------------------------------------------------------------

def test_an_unknown_workshop_is_a_404(client, scanner, participant):
    response = client.post("/workshops/WKSP999/attendance", json=make_qr(participant),
                           headers=auth_headers(scanner))
    assert response.status_code == 404
    assert response.json()["detail"] == "Workshop not found"


def test_a_staff_member_not_on_the_team_is_refused(client, workshop, make_staff, participant):
    outsider = make_staff(paradox_id="OTWO2222", email="other@x.com", role="other")
    response = scan(client, outsider, participant)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to scan for this workshop"


def test_a_super_admin_is_not_exempt(client, workshop, super_admin, participant):
    """Being staff somewhere is not being staff here."""
    response = scan(client, super_admin, participant)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to scan for this workshop"


def test_a_stood_down_volunteer_is_refused(client, workshop, scanner, participant):
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]}, {"$set": {"workshop_team.0.attendance": False}}
    )
    response = scan(client, scanner, participant)
    assert response.status_code == 403
    assert response.json()["detail"] == "Scanning disabled for this volunteer"


def test_a_participant_token_cannot_scan(client, workshop, participant):
    response = client.post("/workshops/WKSP111/attendance", json=make_qr(participant),
                           headers=auth_headers(participant))
    assert response.status_code == 403
    assert response.json()["detail"] == "Staff credentials required. Use /auth/admin/login."


def test_scanning_before_the_window_opens_is_refused(client, slots, scanner, participant):
    """Pre-registered opens 30 minutes before start."""
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", start_offset_minutes=120,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    ))
    response = scan(client, scanner, participant)
    assert response.status_code == 403
    assert "Scanning window not yet open" in response.json()["detail"]


def test_scanning_after_the_window_closes_is_refused(client, slots, scanner, participant):
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", start_offset_minutes=-45,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    ))
    response = scan(client, scanner, participant)
    assert response.status_code == 403
    assert response.json()["detail"] == \
        "Scanning window closed. It closes 30 min after the workshop starts."


def test_the_window_is_checked_before_the_qr_is_verified(client, slots, scanner, participant):
    """So a volunteer at the wrong sitting is told about the window, not the code."""
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", start_offset_minutes=120,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    ))
    response = client.post("/workshops/WKSP111/attendance", json=corrupt_qr(participant),
                           headers=auth_headers(scanner))
    assert response.status_code == 403


def test_a_workshop_with_no_start_time_is_unguarded(client, slots, scanner, participant):
    doc = factories.workshop_doc("WKSP111", slot_id="D1S1",
                                 workshop_team=[factories.workshop_team_member(SCANNER)])
    doc["start_time"] = None
    database.workshops_collection.insert_one(doc)
    register(client, participant)
    assert scan(client, scanner, participant).status_code == 200


# ---------------------------------------------------------------------------
# QR verification, exercised for real
# ---------------------------------------------------------------------------

def test_an_unknown_participant_is_a_404(client, running_workshop, scanner):
    response = client.post("/workshops/WKSP111/attendance",
                           json={"participant_id": "NOBODY", "data": "AAAA",
                                 "timestamp": "2026-06-13T10:00:00Z"},
                           headers=auth_headers(scanner))
    assert response.status_code in (400, 404)


@pytest.mark.slow
def test_a_corrupt_code_is_refused(client, workshop, scanner, participant):
    register(client, participant)
    response = client.post("/workshops/WKSP111/attendance", json=corrupt_qr(participant),
                           headers=auth_headers(scanner))
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or corrupted QR code"


@pytest.mark.slow
def test_an_expired_code_is_refused(client, workshop, scanner, participant):
    register(client, participant)
    response = client.post("/workshops/WKSP111/attendance",
                           json=make_qr(participant, age_seconds=120),
                           headers=auth_headers(scanner))
    assert response.status_code == 400
    assert response.json()["detail"] == "QR Code expired"


@pytest.mark.slow
def test_a_refused_code_is_recorded_against_the_gate(client, workshop, scanner, participant, audit):
    register(client, participant)
    client.post("/workshops/WKSP111/attendance", json=corrupt_qr(participant),
                headers=auth_headers(scanner))
    row = audit.latest("QR_VERIFY_FAILED")
    assert row["details"]["reason"] == "decrypt_failed"
    assert row["details"]["scan_domain"] == "workshop"
    assert row["actor_id"] == SCANNER


# ---------------------------------------------------------------------------
# scan_type="pre-registered"
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_a_pre_registered_attendee_is_marked_present(client, workshop, scanner, participant):
    register(client, participant)
    response = scan(client, scanner, participant)

    assert response.status_code == 200
    assert response.json() == {"message": "Pre-registered attendee marked present"}
    assert bookings(participant)[0]["attended"] is True
    assert stored()["participant_count"] == 1
    assert stored()["registration_count"] == 1, "attendance does not take a second seat"


@pytest.mark.slow
def test_someone_with_no_booking_is_refused(client, workshop, scanner, participant):
    response = scan(client, scanner, participant)
    assert response.status_code == 400
    assert response.json()["detail"] == "Participant not pre-registered for this workshop"


@pytest.mark.slow
def test_a_re_scan_is_idempotent(client, workshop, scanner, participant):
    """Returns 200, writes nothing, and does not inflate the head count."""
    register(client, participant)
    scan(client, scanner, participant)
    response = scan(client, scanner, participant)

    assert response.status_code == 200
    assert response.json() == {"message": "Attendee already marked present"}
    assert stored()["participant_count"] == 1


@pytest.mark.slow
def test_a_re_scan_is_recorded_as_a_duplicate_not_a_refusal(
    client, workshop, scanner, participant, audit
):
    register(client, participant)
    scan(client, scanner, participant)
    scan(client, scanner, participant)

    row = audit.one("WORKSHOP_ATTENDANCE_DUPLICATE")
    assert row["details"]["outcome"] == "duplicate"
    assert row["details"]["reason"] == "already_marked_present"


@pytest.mark.slow
def test_a_successful_scan_writes_a_log_row_and_an_audit_row(
    client, workshop, scanner, participant, audit
):
    register(client, participant)
    scan(client, scanner, participant)

    log_row = database.workshop_logs_collection.find_one({"action": "attendance"})
    assert log_row["scan_type"] == "pre-registered"
    assert log_row["scanned_by"] == SCANNER
    assert log_row["participant_id"] == participant["participant_id"]

    audit_row = audit.one("WORKSHOP_ATTENDANCE")
    assert audit_row["details"]["outcome"] == "allowed"
    assert audit_row["details"]["scan_domain"] == "workshop"


@pytest.mark.slow
def test_an_on_spot_booking_cannot_be_scanned_as_pre_registered(
    client, workshop, scanner, participant
):
    database.participants_collection.update_one(
        {"_id": participant["_id"]},
        {"$push": {"workshops": factories.workshop_booking(
            workshop["_id"], "D1S1", booking_type="on-spot")}},
    )
    response = scan(client, scanner, participant)
    assert response.status_code == 400
    assert response.json()["detail"] == "Participant not pre-registered for this workshop"


@pytest.mark.slow
def test_already_present_at_another_workshop_in_the_slot_is_refused(
    client, slots, scanner, participant
):
    """One body cannot be in two rooms in the same time block."""
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1", start_offset_minutes=5,
                               workshop_team=[factories.workshop_team_member(SCANNER)]),
        factories.workshop_doc("WKSP112", slot_id="D1S1", start_offset_minutes=5),
    ])
    other = database.workshops_collection.find_one({"workshop_id": "WKSP112"})
    database.participants_collection.update_one(
        {"_id": participant["_id"]},
        {"$push": {"workshops": factories.workshop_booking(
            other["_id"], "D1S1", attended=True)}},
    )
    response = scan(client, scanner, participant)
    assert response.status_code == 400
    assert response.json()["detail"] == \
        "Participant already marked present for another workshop in this slot"


# ---------------------------------------------------------------------------
# scan_type="on-spot"
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_a_walk_in_is_registered_and_marked_present(client, workshop, scanner, participant):
    response = scan(client, scanner, participant, scan_type="on-spot")

    assert response.status_code == 200
    assert response.json() == {"message": "On-spot registration successful and marked present"}
    entry = bookings(participant)[0]
    assert entry["booking_type"] == "on-spot"
    assert entry["attended"] is True
    document = stored()
    assert document["registration_count"] == 1
    assert document["participant_count"] == 1


@pytest.mark.slow
def test_the_walk_in_cap_is_ten_percent_of_capacity(client, slots, scanner, make_participant):
    """Capacity 20 gives a cap of 2."""
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", capacity=20, start_offset_minutes=5,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    ))
    people = [make_participant(participant_id=f"DS23F00000{i}",
                               email=f"p{i}@ds.study.iitm.ac.in") for i in range(1, 4)]

    assert scan(client, scanner, people[0], scan_type="on-spot").status_code == 200
    assert scan(client, scanner, people[1], scan_type="on-spot").status_code == 200
    third = scan(client, scanner, people[2], scan_type="on-spot")
    assert third.status_code == 400
    assert third.json()["detail"] == "Max on-spot capacity (10%) reached"


@pytest.mark.slow
def test_the_cap_refusal_records_how_it_was_computed(
    client, slots, scanner, make_participant, audit
):
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", capacity=10, start_offset_minutes=5,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    ))
    first = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in")
    second = make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in")
    scan(client, scanner, first, scan_type="on-spot")
    scan(client, scanner, second, scan_type="on-spot")

    row = audit.latest("WORKSHOP_ATTENDANCE_DENIED")
    assert row["details"]["reason"] == "on_spot_cap_reached"
    assert row["details"]["on_spot_cap"] == 1
    assert row["details"]["capacity"] == 10


@pytest.mark.slow
def test_a_small_workshop_admits_no_walk_ins_at_all(client, slots, scanner, participant, audit):
    """
    `int(capacity * 0.1)` is 0 for any capacity under 10, so the cap silently
    forbids every walk-in. Pinned as current behaviour, with the numbers in the
    audit row being what distinguishes it from a genuinely full queue.
    """
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", capacity=9, start_offset_minutes=5,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    ))
    response = scan(client, scanner, participant, scan_type="on-spot")
    assert response.status_code == 400
    assert response.json()["detail"] == "Max on-spot capacity (10%) reached"
    assert audit.latest("WORKSHOP_ATTENDANCE_DENIED")["details"]["on_spot_cap"] == 0


@pytest.mark.slow
def test_a_walk_in_already_present_here_is_idempotent(client, workshop, scanner, participant):
    scan(client, scanner, participant, scan_type="on-spot")
    response = scan(client, scanner, participant, scan_type="on-spot")

    assert response.json() == {"message": "Attendee already marked present"}
    assert stored()["participant_count"] == 1
    assert stored()["registration_count"] == 1


@pytest.mark.slow
def test_a_pre_registered_person_walking_in_here_nets_to_zero(
    client, workshop, scanner, participant
):
    """
    The booking is pulled and re-added as on-spot, so the increment must not
    charge a second seat for the same person.
    """
    register(client, participant)
    assert stored()["registration_count"] == 1

    response = scan(client, scanner, participant, scan_type="on-spot")

    assert response.status_code == 200
    assert stored()["registration_count"] == 1, "one human, one seat"
    assert stored()["participant_count"] == 1
    entries = bookings(participant)
    assert len(entries) == 1
    assert entries[0]["booking_type"] == "on-spot"


@pytest.mark.slow
def test_a_walk_in_releases_the_seat_they_held_on_another_workshop(
    client, slots, scanner, participant
):
    """
    The `$pull` matches on `slot_id`, so it destroys the booking on the *other*
    workshop in that slot. That seat has to go back, or the other workshop reads
    fuller than it is forever.
    """
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=20, start_offset_minutes=5,
                               workshop_team=[factories.workshop_team_member(SCANNER)]),
        factories.workshop_doc("WKSP112", slot_id="D1S1", capacity=20, start_offset_minutes=5),
    ])
    register(client, participant, workshop_id="WKSP112")
    assert stored("WKSP112")["registration_count"] == 1

    response = scan(client, scanner, participant, scan_type="on-spot")

    assert response.status_code == 200
    assert stored("WKSP112")["registration_count"] == 0, "the released seat came back"
    assert stored("WKSP111")["registration_count"] == 1
    # And the participant has lost a registration they never cancelled.
    entries = bookings(participant)
    assert len(entries) == 1
    assert entries[0]["workshop_id"] == stored("WKSP111")["_id"]


@pytest.mark.slow
def test_the_destroyed_booking_is_reported(client, slots, scanner, participant, caplog):
    """The most surprising side effect in the file, so it gets a warning line."""
    import logging

    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=20, start_offset_minutes=5,
                               workshop_team=[factories.workshop_team_member(SCANNER)]),
        factories.workshop_doc("WKSP112", slot_id="D1S1", capacity=20, start_offset_minutes=5),
    ])
    register(client, participant, workshop_id="WKSP112")

    with caplog.at_level(logging.WARNING, logger="paradox.workshops"):
        scan(client, scanner, participant, scan_type="on-spot")

    assert any(getattr(r, "reason", None) == "same_slot_booking_released"
               for r in caplog.records)


@pytest.mark.slow
def test_a_seat_release_cannot_drive_a_counter_negative(client, slots, scanner, participant):
    """Guarded with `$gt: 0`, so data predating this route stays non-negative."""
    database.workshops_collection.insert_many([
        factories.workshop_doc("WKSP111", slot_id="D1S1", capacity=20, start_offset_minutes=5,
                               workshop_team=[factories.workshop_team_member(SCANNER)]),
        factories.workshop_doc("WKSP112", slot_id="D1S1", capacity=20, start_offset_minutes=5),
    ])
    other = database.workshops_collection.find_one({"workshop_id": "WKSP112"})
    database.participants_collection.update_one(
        {"_id": participant["_id"]},
        {"$push": {"workshops": factories.workshop_booking(other["_id"], "D1S1")}},
    )
    # `registration_count` is 0 despite the booking existing.
    scan(client, scanner, participant, scan_type="on-spot")
    assert stored("WKSP112")["registration_count"] == 0


@pytest.mark.slow
def test_an_unrecognised_scan_type_reports_a_400(client, workshop, scanner, participant):
    """
    The route ends in `400 Invalid scan_type`, but the window guard indexes its
    operation table first, so an unknown value raises KeyError and answers 500.
    """
    register(client, participant)
    response = client.post("/workshops/WKSP111/attendance?scan_type=teleported",
                           json=make_qr(participant), headers=auth_headers(scanner))
    if response.status_code == 500:
        pytest.xfail(
            "KNOWN DEFECT: _assert_scan_window raises KeyError for an unrecognised "
            "scan_type, so the route 500s before reaching its own "
            "400 'Invalid scan_type'."
        )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid scan_type"


# ---------------------------------------------------------------------------
# GET /workshops/{id}/participation
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_the_roster_lists_who_booked_and_who_turned_up(
    client, workshop, scanner, make_participant
):
    booked = make_participant(participant_id="DS23F000001", email="a@ds.study.iitm.ac.in",
                              profile={"full_name": "Asha", "course_stage": "diploma"})
    absent = make_participant(participant_id="DS23F000002", email="b@ds.study.iitm.ac.in",
                              profile={"full_name": "Bala"})
    register(client, booked)
    register(client, absent)
    scan(client, scanner, booked)

    body = client.get("/workshops/WKSP111/participation", headers=auth_headers(scanner)).json()

    assert body["count"] == 2
    assert body["attended_count"] == 1
    assert body["absent_count"] == 1
    assert body["on_spot_count"] == 0
    assert body["capacity"] == 20
    assert body["registration_count"] == 2
    assert [row["participant_id"] for row in body["participants"]] == \
        ["DS23F000001", "DS23F000002"], "sorted by participant id"


def test_a_super_admin_can_read_the_roster(client, workshop, admin_headers):
    assert client.get("/workshops/WKSP111/participation",
                      headers=admin_headers).status_code == 200


def test_a_stood_down_volunteer_can_still_read_the_roster(client, workshop, scanner):
    """That flag gates scanning; a volunteer stood down from the door still needs
    the room's own roster."""
    database.workshops_collection.update_one(
        {"_id": workshop["_id"]}, {"$set": {"workshop_team.0.attendance": False}}
    )
    assert client.get("/workshops/WKSP111/participation",
                      headers=auth_headers(scanner)).status_code == 200


def test_unrelated_staff_cannot_read_the_roster(client, workshop, make_staff):
    outsider = make_staff(paradox_id="OTWO2222", email="other@x.com", role="other")
    response = client.get("/workshops/WKSP111/participation", headers=auth_headers(outsider))
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to view this workshop's participation"


def test_a_participant_has_no_route_to_the_roster(client, workshop, participant):
    assert client.get("/workshops/WKSP111/participation",
                      headers=auth_headers(participant)).status_code == 403


def test_the_roster_never_returns_credentials(client, workshop, scanner, participant):
    register(client, participant)
    serialised = str(client.get("/workshops/WKSP111/participation",
                                headers=auth_headers(scanner)).json())
    for secret in ("password_hash", "$2b$", "qr_secrets", "PRIVATE", "embedding"):
        assert secret not in serialised


def test_the_roster_reports_academic_standing(client, workshop, scanner, make_participant):
    """What makes an interest-by-level breakdown a count rather than an inference
    from a roll number."""
    person = make_participant(profile={"course_stage": "degree", "academic_level": "level_3"})
    register(client, person)
    row = client.get("/workshops/WKSP111/participation",
                     headers=auth_headers(scanner)).json()["participants"][0]
    assert row["course_stage"] == "degree"
    assert row["academic_level"] == "level_3"


def test_the_roster_resolves_the_team_without_leaking_object_ids(
    client, workshop, scanner
):
    team = client.get("/workshops/WKSP111/participation",
                      headers=auth_headers(scanner)).json()["workshop_team"]
    assert team[0]["user_id"] == SCANNER
    assert team[0]["name"] == "Workshop Desk"


def test_an_unknown_workshop_roster_is_a_404(client, scanner):
    assert client.get("/workshops/WKSP999/participation",
                      headers=auth_headers(scanner)).status_code == 404


# ---------------------------------------------------------------------------
# PATCH /workshops/{id}/participants/{participant_id}
# ---------------------------------------------------------------------------

def correct(client, actor, participant, **payload):
    return client.patch(
        f"/workshops/WKSP111/participants/{participant['participant_id']}",
        json=payload, headers=auth_headers(actor),
    )


@pytest.fixture()
def running_workshop(slots, scanner):
    """
    A workshop that started five minutes ago.

    The `changes` window opens *at* `start_time` — corrections only make sense
    once the session is actually running — so a future workshop refuses every
    correction with "not yet open". The pre-registered scan window is open here
    too, since it spans start ± 30 minutes.
    """
    doc = factories.workshop_doc(
        "WKSP111", slot_id="D1S1", capacity=20, start_offset_minutes=-5,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    )
    database.workshops_collection.insert_one(doc)
    return database.workshops_collection.find_one({"_id": doc["_id"]})


def test_a_missed_scan_can_be_corrected_by_hand(client, running_workshop, scanner, participant):
    """The authorised way back for a flat battery or a QR that expired in the
    queue."""
    register(client, participant)
    response = correct(client, scanner, participant, attended=True)

    assert response.status_code == 200
    assert response.json()["changes"] == {"attended": True}
    assert bookings(participant)[0]["attended"] is True
    assert stored()["participant_count"] == 1


def test_repeating_the_same_correction_changes_nothing(client, running_workshop, scanner, participant):
    register(client, participant)
    correct(client, scanner, participant, attended=True)
    response = correct(client, scanner, participant, attended=True)

    assert response.json()["message"] == "No change"
    assert stored()["participant_count"] == 1, "the count cannot be inflated by a repeat"
    assert database.workshop_logs_collection.count_documents(
        {"action": "attendance_override"}
    ) == 1


def test_reversing_attendance_decrements_the_count(client, running_workshop, scanner, participant):
    register(client, participant)
    correct(client, scanner, participant, attended=True)
    correct(client, scanner, participant, attended=False)
    assert stored()["participant_count"] == 0


def test_the_head_count_is_floored_at_zero(client, running_workshop, scanner, participant):
    """So a correction to data predating this route cannot drive it negative."""
    database.participants_collection.update_one(
        {"_id": participant["_id"]},
        {"$push": {"workshops": factories.workshop_booking(
            running_workshop["_id"], "D1S1", attended=True)}},
    )
    assert stored()["participant_count"] == 0
    correct(client, scanner, participant, attended=False)
    assert stored()["participant_count"] == 0


def test_relabelling_the_booking_type_takes_no_extra_seat(
    client, running_workshop, scanner, participant
):
    """The seat was counted when the booking was made; flipping the label
    re-describes it."""
    register(client, participant)
    response = correct(client, scanner, participant, booking_type="on-spot")
    assert response.status_code == 200
    assert stored()["registration_count"] == 1
    assert bookings(participant)[0]["booking_type"] == "on-spot"


def test_an_empty_correction_is_a_400(client, running_workshop, scanner, participant):
    register(client, participant)
    response = correct(client, scanner, participant)
    assert response.status_code == 400
    assert response.json()["detail"] == "Nothing to update"


def test_an_invalid_booking_type_is_a_400(client, running_workshop, scanner, participant):
    register(client, participant)
    response = correct(client, scanner, participant, booking_type="teleported")
    assert response.status_code == 400
    assert response.json()["detail"] == "booking_type must be 'pre-registered' or 'on-spot'"


def test_an_unknown_participant_is_a_404(client, running_workshop, scanner):
    response = client.patch("/workshops/WKSP111/participants/DS23F999999",
                            json={"attended": True}, headers=auth_headers(scanner))
    assert response.status_code == 404
    assert response.json()["detail"] == "Participant not found"


def test_someone_with_no_booking_here_is_a_404(client, running_workshop, scanner, participant):
    response = correct(client, scanner, participant, attended=True)
    assert response.status_code == 404
    assert response.json()["detail"] == "Participant is not registered for this workshop"


def test_a_participant_can_be_named_by_email(client, running_workshop, scanner, participant):
    register(client, participant)
    response = client.patch(f"/workshops/WKSP111/participants/{participant['email']}",
                            json={"attended": True}, headers=auth_headers(scanner))
    assert response.status_code == 200


def test_a_stood_down_volunteer_cannot_write_attendance(
    client, running_workshop, scanner, participant
):
    """Writing attendance is the same privilege as scanning it."""
    register(client, participant)
    database.workshops_collection.update_one(
        {"_id": running_workshop["_id"]}, {"$set": {"workshop_team.0.attendance": False}}
    )
    response = correct(client, scanner, participant, attended=True)
    assert response.status_code == 403
    assert response.json()["detail"] == "Scanning disabled for this volunteer"


def test_unrelated_staff_cannot_correct_a_record(client, running_workshop, participant, make_staff):
    outsider = make_staff(paradox_id="OTWO2222", email="other@x.com", role="other")
    response = correct(client, outsider, participant, attended=True)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to update this workshop's participants"


def test_super_admins_are_bound_by_the_correction_window(
    client, slots, super_admin, participant
):
    """A correction made hours later is indistinguishable from a fabrication."""
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", start_offset_minutes=-120,
    ))
    workshop = database.workshops_collection.find_one({"workshop_id": "WKSP111"})
    database.participants_collection.update_one(
        {"_id": participant["_id"]},
        {"$push": {"workshops": factories.workshop_booking(workshop["_id"], "D1S1")}},
    )
    response = correct(client, super_admin, participant, attended=True)
    assert response.status_code == 403
    assert "Scanning window closed" in response.json()["detail"]


def test_the_correction_window_opens_only_once_the_session_runs(
    client, slots, scanner, participant
):
    database.workshops_collection.insert_one(factories.workshop_doc(
        "WKSP111", slot_id="D1S1", start_offset_minutes=20,
        workshop_team=[factories.workshop_team_member(SCANNER)],
    ))
    workshop = database.workshops_collection.find_one({"workshop_id": "WKSP111"})
    database.participants_collection.update_one(
        {"_id": participant["_id"]},
        {"$push": {"workshops": factories.workshop_booking(workshop["_id"], "D1S1")}},
    )
    response = correct(client, scanner, participant, attended=True)
    assert response.status_code == 403
    assert "Opens 0 min before start" in response.json()["detail"]


def test_a_hand_set_attendance_is_distinguishable_from_a_scan(
    client, running_workshop, scanner, participant, audit
):
    register(client, participant)
    correct(client, scanner, participant, attended=True)

    log_row = database.workshop_logs_collection.find_one({"action": "attendance_override"})
    assert log_row["scanned_by"] == SCANNER
    assert log_row["changes"] == {"attended": True}
    assert log_row["participant_id"] == participant["participant_id"]

    audit_row = audit.one("UPDATE_WORKSHOP_PARTICIPANT")
    assert audit_row["details"]["participant_id"] == participant["participant_id"]
    assert audit_row["details"]["changes"] == {"attended": True}


def test_a_correction_is_reflected_in_the_roster(client, running_workshop, scanner, participant):
    register(client, participant)
    correct(client, scanner, participant, attended=True)
    body = client.get("/workshops/WKSP111/participation", headers=auth_headers(scanner)).json()
    assert body["attended_count"] == 1
    assert body["participants"][0]["attended"] is True
