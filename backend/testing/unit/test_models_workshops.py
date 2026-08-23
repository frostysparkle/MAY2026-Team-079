"""
Unit tests for `parse_instant_utc`, the workshop-slot models, the workshop
models, and the backend-team models in backend/models.py.

`parse_instant_utc` is the single timestamp parser every model and several routes
share, so its normalisation rules decide whether an offset-bearing request body
compares correctly against `datetime.utcnow()`.
"""
from datetime import datetime

import pytest
from pydantic import ValidationError

from models import (
    BACKEND_TEAM_DEPARTMENTS,
    BACKEND_TEAM_ROLES,
    SLOT_ID_PATTERN,
    BackendTeamCreateRequest,
    BackendTeamUpdateRequest,
    WorkshopAssignVolunteerRequest,
    WorkshopCreateRequest,
    WorkshopParticipantUpdateRequest,
    WorkshopSlotCreateRequest,
    WorkshopSlotUpdateRequest,
    WorkshopUpdateRequest,
    parse_instant_utc,
)

VALID_WORKSHOP = {
    "slot_id": "D1S1",
    "name": "Intro to ML",
    "description": "A hands-on session.",
    "venue": "Lab 1",
    "capacity": 20,
    "instructions": "Bring a laptop.",
    "registration_start": "2026-06-01T10:00:00Z",
    "registration_end": "2026-06-10T10:00:00Z",
}


# ---------------------------------------------------------------------------
# parse_instant_utc
# ---------------------------------------------------------------------------

def test_a_naive_instant_is_returned_unchanged():
    assert parse_instant_utc("2026-06-13T10:00:00", "start_time") == datetime(2026, 6, 13, 10, 0)


@pytest.mark.parametrize("suffix", ["Z", "z"])
def test_a_trailing_zulu_marker_is_accepted_either_case(suffix):
    parsed = parse_instant_utc(f"2026-06-13T10:00:00{suffix}", "start_time")
    assert parsed == datetime(2026, 6, 13, 10, 0)
    assert parsed.tzinfo is None, "the result must be naive to compare against utcnow()"


def test_an_offset_is_converted_to_utc_then_stripped():
    """+05:30 at 15:30 is 10:00 UTC; storing the local time would shift an entire
    evening's scans into the wrong day."""
    assert parse_instant_utc("2026-06-13T15:30:00+05:30", "start_time") == datetime(2026, 6, 13, 10, 0)


def test_a_negative_offset_is_converted_too():
    assert parse_instant_utc("2026-06-13T05:00:00-05:00", "start_time") == datetime(2026, 6, 13, 10, 0)


def test_surrounding_whitespace_is_tolerated():
    assert parse_instant_utc("  2026-06-13T10:00:00Z  ", "start_time") == datetime(2026, 6, 13, 10, 0)


def test_a_date_only_value_is_accepted_as_midnight():
    assert parse_instant_utc("2026-06-13", "start_time") == datetime(2026, 6, 13, 0, 0)


@pytest.mark.parametrize("value", ["not-a-date", "13/06/2026", "", "2026-13-45T00:00:00"])
def test_an_unparseable_value_names_the_field_in_the_error(value):
    with pytest.raises(ValueError) as excinfo:
        parse_instant_utc(value, "registration_end")
    assert "registration_end must be an ISO 8601 datetime" in str(excinfo.value)


# ---------------------------------------------------------------------------
# Workshop slots
# ---------------------------------------------------------------------------

def test_slot_id_pattern_is_anchored():
    assert SLOT_ID_PATTERN == r"^D\d+S\d+$"


@pytest.mark.parametrize("slot_id", ["D1S1", "D2S3", "D10S12", "D999S1"])
def test_well_formed_slot_ids(slot_id):
    assert WorkshopSlotCreateRequest(
        slot_id=slot_id, start_time="2026-06-13T10:00:00Z", end_time="2026-06-13T12:00:00Z"
    ).slot_id == slot_id


@pytest.mark.parametrize("slot_id", ["d1s1", "D1", "S1", "DS1", "D1S", "XD1S1", "D1S1X", "D1-S1", ""])
def test_malformed_slot_ids_are_rejected(slot_id):
    with pytest.raises(ValidationError):
        WorkshopSlotCreateRequest(
            slot_id=slot_id, start_time="2026-06-13T10:00:00Z", end_time="2026-06-13T12:00:00Z"
        )


def test_slot_end_must_be_after_start():
    with pytest.raises(ValidationError) as excinfo:
        WorkshopSlotCreateRequest(
            slot_id="D1S1", start_time="2026-06-13T12:00:00Z", end_time="2026-06-13T10:00:00Z"
        )
    assert "end_time must be after start_time" in str(excinfo.value)


def test_slot_end_equal_to_start_is_rejected():
    with pytest.raises(ValidationError):
        WorkshopSlotCreateRequest(
            slot_id="D1S1", start_time="2026-06-13T10:00:00Z", end_time="2026-06-13T10:00:00Z"
        )


def test_slot_times_are_compared_after_offset_normalisation():
    """10:00Z is before 16:00+05:30 (=10:30Z), so this is valid despite the
    wall-clock strings suggesting otherwise."""
    assert WorkshopSlotCreateRequest(
        slot_id="D1S1", start_time="2026-06-13T10:00:00Z", end_time="2026-06-13T16:00:00+05:30"
    )


def test_slot_update_allows_a_single_bound():
    """Both fields optional so a caller can push one; the route re-validates
    against the stored document, which the model cannot see."""
    assert WorkshopSlotUpdateRequest(start_time="2026-06-13T10:00:00Z").end_time is None
    assert WorkshopSlotUpdateRequest(end_time="2026-06-13T10:00:00Z").start_time is None
    assert WorkshopSlotUpdateRequest().start_time is None


def test_slot_update_cross_checks_only_when_both_are_present():
    with pytest.raises(ValidationError):
        WorkshopSlotUpdateRequest(
            start_time="2026-06-13T12:00:00Z", end_time="2026-06-13T10:00:00Z"
        )


def test_slot_update_rejects_an_unparseable_bound_when_both_are_sent():
    with pytest.raises(ValidationError):
        WorkshopSlotUpdateRequest(start_time="nonsense", end_time="2026-06-13T10:00:00Z")


# ---------------------------------------------------------------------------
# Workshop create / update
# ---------------------------------------------------------------------------

def test_a_valid_workshop_create_request():
    request = WorkshopCreateRequest(**VALID_WORKSHOP)
    assert request.registration_open is True, "registration is open by default"


@pytest.mark.parametrize("field", ["slot_id", "name", "description", "venue", "capacity",
                                   "instructions", "registration_start", "registration_end"])
def test_every_workshop_field_but_registration_open_is_required(field):
    payload = dict(VALID_WORKSHOP)
    payload.pop(field)
    with pytest.raises(ValidationError):
        WorkshopCreateRequest(**payload)


@pytest.mark.parametrize("capacity", [0, -1, -100])
def test_capacity_must_be_positive(capacity):
    with pytest.raises(ValidationError):
        WorkshopCreateRequest(**{**VALID_WORKSHOP, "capacity": capacity})


def test_capacity_of_one_is_allowed():
    assert WorkshopCreateRequest(**{**VALID_WORKSHOP, "capacity": 1}).capacity == 1


@pytest.mark.parametrize("field", ["name", "description", "venue", "instructions"])
def test_text_fields_may_not_be_empty(field):
    with pytest.raises(ValidationError):
        WorkshopCreateRequest(**{**VALID_WORKSHOP, field: ""})


def test_registration_end_must_be_after_start():
    with pytest.raises(ValidationError) as excinfo:
        WorkshopCreateRequest(**{
            **VALID_WORKSHOP,
            "registration_start": "2026-06-10T10:00:00Z",
            "registration_end": "2026-06-01T10:00:00Z",
        })
    assert "registration_end must be after registration_start" in str(excinfo.value)


def test_create_does_not_accept_a_workshop_id_or_start_time():
    """Both are backend-assigned: `workshop_id` from the generator, `start_time`
    denormalised from the slot."""
    assert "workshop_id" not in WorkshopCreateRequest.model_fields
    assert "start_time" not in WorkshopCreateRequest.model_fields


def test_update_is_entirely_optional():
    request = WorkshopUpdateRequest()
    assert request.model_dump(exclude_unset=True) == {}


def test_update_omits_slot_id_and_start_time_deliberately():
    """A workshop's slot is fixed at creation because bookings reference it;
    `start_time` only ever changes through a cascaded slot edit."""
    assert "slot_id" not in WorkshopUpdateRequest.model_fields
    assert "start_time" not in WorkshopUpdateRequest.model_fields


def test_update_capacity_must_still_be_positive_when_given():
    assert WorkshopUpdateRequest(capacity=5).capacity == 5
    with pytest.raises(ValidationError):
        WorkshopUpdateRequest(capacity=0)


def test_update_cross_checks_the_window_only_when_both_bounds_are_present():
    assert WorkshopUpdateRequest(registration_start="2026-06-13T10:00:00Z")
    with pytest.raises(ValidationError):
        WorkshopUpdateRequest(
            registration_start="2026-06-13T12:00:00Z",
            registration_end="2026-06-13T10:00:00Z",
        )


# ---------------------------------------------------------------------------
# Volunteer assignment / participant correction
# ---------------------------------------------------------------------------

def test_volunteer_assignment_defaults():
    request = WorkshopAssignVolunteerRequest(user_id="VLWO1111")
    assert request.role == "workshop_volunteer"
    assert request.attendance is True


def test_volunteer_assignment_requires_a_user_id():
    with pytest.raises(ValidationError):
        WorkshopAssignVolunteerRequest()


def test_volunteer_role_is_a_free_string():
    """Unlike hostel/event team roles, this is not a closed set; pinned so a
    later tightening is deliberate."""
    assert WorkshopAssignVolunteerRequest(user_id="X", role="anything").role == "anything"


def test_participant_correction_is_entirely_optional():
    request = WorkshopParticipantUpdateRequest()
    assert request.attended is None and request.booking_type is None


def test_participant_correction_booking_type_is_validated_in_the_route_not_here():
    """The route raises 400 "booking_type must be 'pre-registered' or 'on-spot'",
    so the model accepts anything — a 400, not a 422."""
    assert WorkshopParticipantUpdateRequest(booking_type="teleported").booking_type == "teleported"


def test_participant_correction_carries_no_identity_fields():
    assert set(WorkshopParticipantUpdateRequest.model_fields) == {"attended", "booking_type"}


# ---------------------------------------------------------------------------
# Backend team models
# ---------------------------------------------------------------------------

VALID_STAFF = {
    "email": "staff@ds.study.iitm.ac.in",
    "password": "longenough",
    "role": "admin",
    "department": "technical",
    "designation": "Technical Admin",
}


def test_a_valid_staff_create_request():
    assert BackendTeamCreateRequest(**VALID_STAFF).name is None


@pytest.mark.parametrize("role", sorted(BACKEND_TEAM_ROLES))
def test_every_role_in_the_vocabulary_is_accepted(role):
    assert BackendTeamCreateRequest(**{**VALID_STAFF, "role": role}).role == role


@pytest.mark.parametrize("department", sorted(BACKEND_TEAM_DEPARTMENTS))
def test_every_department_in_the_vocabulary_is_accepted(department):
    assert BackendTeamCreateRequest(**{**VALID_STAFF, "department": department}).department == department


@pytest.mark.parametrize("role", ["wizard", "Admin", "", "superadmin"])
def test_an_unknown_role_is_a_422_which_is_what_shields_the_id_generator(role):
    with pytest.raises(ValidationError):
        BackendTeamCreateRequest(**{**VALID_STAFF, "role": role})


@pytest.mark.parametrize("department", ["quidditch", "Technical", "", "technicals"])
def test_an_unknown_department_is_rejected(department):
    with pytest.raises(ValidationError):
        BackendTeamCreateRequest(**{**VALID_STAFF, "department": department})


def test_three_of_the_four_event_types_have_a_matching_department():
    """
    `events.view_participation` compares a staff member's `department` straight
    against an event's `event_type` with no translation table, so the overlap
    between the two vocabularies is exactly the set of events a department admin
    can reach that way.
    """
    from models import EVENT_TYPES

    overlap = set(EVENT_TYPES) & set(BACKEND_TEAM_DEPARTMENTS)
    assert overlap == {"technical", "culturals", "sports"}


@pytest.mark.xfail(
    strict=False,
    reason="KNOWN GAP: models.py documents the department vocabulary as lining up "
           "'exactly' with event_type, but there is no 'others' department. No "
           "department admin can ever satisfy the is_dept_admin branch of "
           "events.view_participation for an event of type 'others' — only a super "
           "admin, that event's own team, or uhc can read its participation.",
)
def test_every_event_type_has_a_matching_department():
    from models import EVENT_TYPES

    assert set(EVENT_TYPES) <= set(BACKEND_TEAM_DEPARTMENTS)


def test_designation_may_not_be_blank():
    with pytest.raises(ValidationError):
        BackendTeamCreateRequest(**{**VALID_STAFF, "designation": ""})


def test_staff_password_minimum_matches_registration():
    with pytest.raises(ValidationError):
        BackendTeamCreateRequest(**{**VALID_STAFF, "password": "short"})


def test_staff_update_carries_only_designation_and_name():
    assert set(BackendTeamUpdateRequest.model_fields) == {"designation", "name"}


def test_role_and_department_are_immutable_by_omission():
    """Both drive the `paradox_id` prefix, so changing either means a new
    account, not a patch."""
    assert "role" not in BackendTeamUpdateRequest.model_fields
    assert "department" not in BackendTeamUpdateRequest.model_fields


def test_staff_update_rejects_a_blank_designation_but_allows_omission():
    assert BackendTeamUpdateRequest().designation is None
    with pytest.raises(ValidationError):
        BackendTeamUpdateRequest(designation="")
