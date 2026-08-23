"""
Unit tests for the private helpers in backend/routers/events.py.

`_registration_open` is the one to read first: unlike a workshop's stored flag, an
event's open/closed state is *derived* on every read from `registration.allowed`
AND the time window, so it can never drift from the fields it comes from.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

import database
from routers import events as module
from routers.events import (
    _event_team_role,
    _is_event_head,
    _is_event_team_member,
    _is_registered_for,
    _is_super_admin,
    _may_read_announcements,
    _registration_open,
    _require_super_admin,
    _resolve_registration_team,
    _team_size,
    _unique_attendance_today,
    _validate_registration_data,
    _with_computed_registration,
)
from testing import factories
from testing.helpers import fake_datetime, iso


def window(start_minutes, end_minutes, allowed=True):
    now = datetime.utcnow()
    return {
        "registration": {
            "start_time": iso(now + timedelta(minutes=start_minutes)),
            "end_time": iso(now + timedelta(minutes=end_minutes)),
            "allowed": allowed,
        }
    }


# ---------------------------------------------------------------------------
# _is_super_admin / _require_super_admin
# ---------------------------------------------------------------------------

def test_a_super_admin_is_recognised_from_the_collection(super_admin):
    assert _is_super_admin(super_admin) is True


def test_the_document_itself_is_also_accepted():
    """A staff token loads the `backend_teams` document, so its own `role` field
    is a valid second source."""
    assert _is_super_admin({"paradox_id": "SAWO9999", "role": "super_admin"}) is True


def test_an_ordinary_admin_is_not(plain_staff):
    assert _is_super_admin(plain_staff) is False


def test_require_raises_403_with_the_shared_message(plain_staff):
    with pytest.raises(HTTPException) as excinfo:
        _require_super_admin(plain_staff)
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Only Super Admins can perform this action"


# ---------------------------------------------------------------------------
# _registration_open
# ---------------------------------------------------------------------------

def test_registration_is_open_inside_the_window():
    assert _registration_open(window(-60, 60)) is True


def test_registration_is_closed_before_and_after_the_window():
    assert _registration_open(window(60, 120)) is False
    assert _registration_open(window(-120, -60)) is False


def test_the_manual_kill_switch_closes_an_otherwise_open_window():
    """An admin can force-close early."""
    assert _registration_open(window(-60, 60, allowed=False)) is False


def test_the_switch_cannot_force_registration_open_outside_the_window():
    """Neither the flag nor the clock alone is authoritative."""
    assert _registration_open(window(-120, -60, allowed=True)) is False


def test_allowed_defaults_to_true_when_absent():
    event = window(-60, 60)
    del event["registration"]["allowed"]
    assert _registration_open(event) is True


@pytest.mark.parametrize("registration", [
    {}, {"allowed": True}, {"start_time": "2026-06-01T00:00:00Z"},
    {"end_time": "2026-06-01T00:00:00Z"},
])
def test_a_missing_bound_reads_as_closed(registration):
    """An event with no window has no reliable answer, so it is not open."""
    assert _registration_open({"registration": registration}) is False


def test_an_unparseable_bound_reads_as_closed():
    assert _registration_open({
        "registration": {"start_time": "nonsense", "end_time": "nonsense"}
    }) is False


def test_a_missing_registration_map_reads_as_closed():
    assert _registration_open({}) is False
    assert _registration_open({"registration": None}) is False


def test_both_boundaries_are_inclusive(monkeypatch):
    moment = datetime(2026, 6, 13, 12, 0, 0)
    event = {"registration": {"start_time": iso(moment), "end_time": iso(moment)}}
    monkeypatch.setattr(module, "datetime", fake_datetime(moment))
    assert _registration_open(event) is True


def test_the_computed_state_is_attached_without_being_stored():
    event = {"event_id": "EVTEC1111", **window(-60, 60)}
    decorated = _with_computed_registration(event)
    assert decorated["registration"]["is_open"] is True
    assert "is_open" not in event["registration"], "the caller's document is untouched"


def test_the_computed_state_survives_a_missing_registration_map():
    assert _with_computed_registration({"event_id": "X"})["registration"] == {"is_open": False}


# ---------------------------------------------------------------------------
# Event team helpers
# ---------------------------------------------------------------------------

TEAM = {"event_team": [
    {"user_id": "SAWO1111", "role": "event_head"},
    {"user_id": "ADTE2222", "role": "member"},
    {"user_id": "OTUH3333", "role": "volunteer"},
]}


@pytest.mark.parametrize("user_id,role", [
    ("SAWO1111", "event_head"), ("ADTE2222", "member"), ("OTUH3333", "volunteer"),
])
def test_a_members_role_is_found(user_id, role):
    assert _event_team_role(TEAM, user_id) == role


def test_a_non_member_has_no_role():
    assert _event_team_role(TEAM, "GHOST") is None
    assert _is_event_team_member(TEAM, "GHOST") is False


def test_membership_covers_every_role():
    for user_id in ("SAWO1111", "ADTE2222", "OTUH3333"):
        assert _is_event_team_member(TEAM, user_id) is True


def test_only_the_event_head_is_a_head():
    assert _is_event_head(TEAM, "SAWO1111") is True
    assert _is_event_head(TEAM, "ADTE2222") is False
    assert _is_event_head(TEAM, "GHOST") is False


def test_ids_are_compared_as_strings():
    assert _is_event_team_member({"event_team": [{"user_id": 42, "role": "member"}]}, "42") is True


def test_an_empty_team_has_no_members():
    assert _is_event_team_member({}, "SAWO1111") is False


# ---------------------------------------------------------------------------
# _validate_registration_data
# ---------------------------------------------------------------------------

def test_no_registration_fields_means_nothing_to_validate():
    _validate_registration_data({}, {})
    _validate_registration_data({"registration_fields": []}, None)


def test_a_required_field_must_be_present():
    event = {"registration_fields": [factories.registration_field("tshirt", "T-shirt size")]}
    with pytest.raises(HTTPException) as excinfo:
        _validate_registration_data(event, {})
    assert excinfo.value.status_code == 422
    assert excinfo.value.detail == "Missing required registration field(s): T-shirt size"


def test_a_blank_string_does_not_satisfy_a_required_field():
    event = {"registration_fields": [factories.registration_field("tshirt", "T-shirt size")]}
    with pytest.raises(HTTPException):
        _validate_registration_data(event, {"tshirt": "   "})


def test_a_supplied_required_field_passes():
    event = {"registration_fields": [factories.registration_field("tshirt")]}
    _validate_registration_data(event, {"tshirt": "L"})


def test_a_falsy_but_non_blank_value_passes():
    """`0` and `False` are answers, not omissions."""
    event = {"registration_fields": [factories.registration_field("count", field_type="number")]}
    _validate_registration_data(event, {"count": 0})
    _validate_registration_data(event, {"count": False})


def test_optional_fields_are_never_required():
    event = {"registration_fields": [factories.registration_field("notes", required=False)]}
    _validate_registration_data(event, {})


def test_every_missing_label_is_listed():
    event = {"registration_fields": [
        factories.registration_field("a", "First"),
        factories.registration_field("b", "Second"),
    ]}
    with pytest.raises(HTTPException) as excinfo:
        _validate_registration_data(event, {})
    assert excinfo.value.detail == "Missing required registration field(s): First, Second"


def test_the_field_id_is_the_fallback_label():
    event = {"registration_fields": [{"field_id": "tshirt", "required": True}]}
    with pytest.raises(HTTPException) as excinfo:
        _validate_registration_data(event, {})
    assert "tshirt" in excinfo.value.detail


# ---------------------------------------------------------------------------
# _team_size and _resolve_registration_team
# ---------------------------------------------------------------------------

@pytest.fixture()
def event():
    doc = factories.event_doc("EVTEC1111", team_min=2, team_max=3)
    database.event_collection.insert_one(doc)
    return database.event_collection.find_one({"_id": doc["_id"]})


def test_team_size_counts_registrations_on_the_participants_collection(
    event, make_participant
):
    """Membership lives only on `participants.events[]` — there is no roster
    mirror on the event."""
    assert _team_size(event, "TMTEC111111") == 0
    make_participant(events=[factories.event_registration(event["_id"], team_id="TMTEC111111")])
    assert _team_size(event, "TMTEC111111") == 1


def test_team_size_ignores_another_events_team(event, make_participant):
    from bson import ObjectId

    make_participant(events=[factories.event_registration(ObjectId(), team_id="TMTEC111111")])
    assert _team_size(event, "TMTEC111111") == 0


def test_a_solo_event_rejects_any_team_input():
    from models import EventRegistrationInput

    solo = {"team": {"max": 1, "allow_single_registration": True}}
    with pytest.raises(HTTPException) as excinfo:
        _resolve_registration_team(solo, EventRegistrationInput(team_name="Rockets"))
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "This event does not support team registration"


def test_creating_a_team_mints_an_id_and_makes_the_creator_leader(event):
    from models import EventRegistrationInput

    team_id, role = _resolve_registration_team(event, EventRegistrationInput(team_name="Rockets"))
    assert team_id.startswith("TMTEC")
    assert role == "leader"


def test_joining_an_unknown_team_is_a_404(event):
    from models import EventRegistrationInput

    with pytest.raises(HTTPException) as excinfo:
        _resolve_registration_team(event, EventRegistrationInput(team_id="TMTEC999999"))
    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "No team found with that team_id for this event"


def test_joining_an_existing_team_makes_you_a_member(event, make_participant):
    from models import EventRegistrationInput

    make_participant(events=[factories.event_registration(event["_id"], team_id="TMTEC111111")])
    team_id, role = _resolve_registration_team(
        event, EventRegistrationInput(team_id="TMTEC111111")
    )
    assert (team_id, role) == ("TMTEC111111", "member")


def test_joining_a_full_team_is_refused(event, make_participant):
    from models import EventRegistrationInput

    for index in range(3):  # team.max is 3
        make_participant(participant_id=f"DS23F00000{index}",
                         email=f"p{index}@ds.study.iitm.ac.in",
                         events=[factories.event_registration(event["_id"],
                                                              team_id="TMTEC111111")])
    with pytest.raises(HTTPException) as excinfo:
        _resolve_registration_team(event, EventRegistrationInput(team_id="TMTEC111111"))
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "This team is already full"


def test_a_solo_registration_on_a_solo_event_needs_no_team():
    assert _resolve_registration_team({"team": {"max": 1}}, None) == (None, "member")


def test_a_team_event_that_forbids_solo_refuses_a_bare_registration():
    strict = {"team": {"max": 4, "min": 2, "allow_single_registration": False}}
    with pytest.raises(HTTPException) as excinfo:
        _resolve_registration_team(strict, None)
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == (
        "This event requires team registration; provide team_name to create a "
        "team or team_id to join one"
    )


def test_a_team_event_that_allows_solo_permits_a_bare_registration():
    relaxed = {"team": {"max": 4, "min": 2, "allow_single_registration": True}}
    assert _resolve_registration_team(relaxed, None) == (None, "member")


def test_a_missing_team_rule_defaults_to_solo():
    assert _resolve_registration_team({}, None) == (None, "member")


# ---------------------------------------------------------------------------
# _unique_attendance_today
# ---------------------------------------------------------------------------

def scan_row(event, participant_id, scanned_by, day=None):
    return {
        "event_id": str(event["_id"]),
        "participant_id": participant_id,
        "scanned_by": scanned_by,
        "day": day or datetime.utcnow().strftime("%Y-%m-%d"),
        "timestamp": datetime.utcnow(),
    }


def test_attendance_counts_heads_not_scan_rows(event):
    """
    Scans dedupe per scanner, so one participant admitted by two volunteers
    writes two rows. Counting rows reported a half-empty venue as full.
    """
    database.event_logs_collection.insert_many([
        scan_row(event, "DS23F000001", "SAWO1111"),
        scan_row(event, "DS23F000001", "ADTE2222"),
    ])
    assert _unique_attendance_today(event) == 1


def test_distinct_participants_are_counted_separately(event):
    database.event_logs_collection.insert_many([
        scan_row(event, "DS23F000001", "SAWO1111"),
        scan_row(event, "DS23F000002", "SAWO1111"),
    ])
    assert _unique_attendance_today(event) == 2


def test_yesterdays_scans_are_not_counted(event):
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    database.event_logs_collection.insert_one(
        scan_row(event, "DS23F000001", "SAWO1111", day=yesterday)
    )
    assert _unique_attendance_today(event) == 0


def test_another_events_scans_are_not_counted(event):
    from bson import ObjectId

    database.event_logs_collection.insert_one({
        "event_id": str(ObjectId()), "participant_id": "DS23F000001",
        "scanned_by": "SAWO1111", "day": datetime.utcnow().strftime("%Y-%m-%d"),
    })
    assert _unique_attendance_today(event) == 0


def test_no_scans_means_zero(event):
    assert _unique_attendance_today(event) == 0


# ---------------------------------------------------------------------------
# Announcement read access
# ---------------------------------------------------------------------------

def test_a_registered_participant_may_read(event, make_participant):
    person = make_participant(events=[factories.event_registration(event["_id"])])
    assert _is_registered_for(event, person) is True
    assert _may_read_announcements(event, person) is True


def test_an_unregistered_participant_may_not(event, participant):
    assert _is_registered_for(event, participant) is False
    assert _may_read_announcements(event, participant) is False


def test_a_staff_document_is_never_registered(event, super_admin):
    assert _is_registered_for(event, super_admin) is False


def test_a_super_admin_may_read(event, super_admin):
    assert _may_read_announcements(event, super_admin) is True


def test_an_event_team_member_may_read(event, plain_staff):
    database.event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"event_team": {"user_id": plain_staff["paradox_id"], "role": "member"}}},
    )
    updated = database.event_collection.find_one({"_id": event["_id"]})
    assert _may_read_announcements(updated, plain_staff) is True


def test_unrelated_staff_may_not_read(event, plain_staff):
    assert _may_read_announcements(event, plain_staff) is False


# ---------------------------------------------------------------------------
# _serialise_announcement
# ---------------------------------------------------------------------------

def test_a_datetime_is_rendered_with_a_zulu_marker():
    from routers.events import _serialise_announcement

    body = _serialise_announcement(factories.announcement())
    assert body["created_at"].endswith("Z")


def test_the_original_announcement_is_not_mutated():
    from routers.events import _serialise_announcement

    original = factories.announcement()
    _serialise_announcement(original)
    assert isinstance(original["created_at"], datetime)


def test_a_non_datetime_created_at_passes_through():
    from routers.events import _serialise_announcement

    assert _serialise_announcement({"created_at": "already-a-string"})["created_at"] == \
        "already-a-string"


def test_the_public_projection_hides_staff_and_form_fields():
    from routers.events import PUBLIC_EVENT_FIELDS

    for hidden in ("event_team", "registration_fields", "announcements", "created_by"):
        assert hidden not in PUBLIC_EVENT_FIELDS
