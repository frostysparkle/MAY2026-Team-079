"""
Unit tests for the private helpers in backend/routers/workshops.py.

These are called directly rather than through an endpoint, because each encodes a
rule that several routes depend on: the one-shot registration auto-close, the
three-way workshop lookup, and the scan-window arithmetic.
"""
from datetime import datetime, timedelta

import pytest
from bson import ObjectId
from fastapi import HTTPException

import database
from routers import workshops as module
from routers.workshops import (
    _WINDOW_CLOSE_MINUTES,
    _WINDOW_OPEN_MINUTES,
    _assert_scan_window,
    _is_super_admin,
    _resolve_workshop,
    _sync_registration_state,
    _workshop_team_details,
    _workshop_team_member,
)
from testing import factories
from testing.helpers import fake_datetime, iso, iso_from_now


def insert(**kwargs):
    doc = factories.workshop_doc(**kwargs)
    database.workshops_collection.insert_one(doc)
    return database.workshops_collection.find_one({"_id": doc["_id"]})


# ---------------------------------------------------------------------------
# _sync_registration_state — the one-shot auto-close
# ---------------------------------------------------------------------------

def test_a_none_workshop_passes_through():
    assert _sync_registration_state(None) is None


def test_a_workshop_with_no_registration_end_is_left_alone():
    workshop = insert(registration_end=None)
    assert _sync_registration_state(workshop)["registration_open"] is True


def test_an_already_closed_workshop_is_left_alone():
    """Nothing to auto-close, so the bit is not spent."""
    workshop = insert(registration_open=False, registration_end_offset=-60)
    synced = _sync_registration_state(workshop)
    assert synced["registration_open"] is False
    assert synced.get("registration_closed_by_system") is False


def test_a_lapsed_workshop_is_closed_and_the_change_is_persisted():
    workshop = insert(registration_end_offset=-1)
    synced = _sync_registration_state(workshop)
    assert synced["registration_open"] is False
    assert synced["registration_closed_by_system"] is True
    stored = database.workshops_collection.find_one({"_id": workshop["_id"]})
    assert stored["registration_open"] is False
    assert stored["registration_closed_by_system"] is True


def test_a_workshop_still_inside_its_window_stays_open():
    workshop = insert(registration_end_offset=60)
    assert _sync_registration_state(workshop)["registration_open"] is True
    assert database.workshops_collection.find_one(
        {"_id": workshop["_id"]}
    )["registration_closed_by_system"] is False


def test_the_auto_close_is_used_only_once_so_an_admin_override_sticks():
    """
    The reason `registration_closed_by_system` exists: a flag alone cannot tell
    "nobody has looked yet" from "an admin deliberately reopened this".
    """
    workshop = insert(registration_end_offset=-1)
    _sync_registration_state(workshop)

    database.workshops_collection.update_one(
        {"_id": workshop["_id"]}, {"$set": {"registration_open": True}}
    )
    reopened = database.workshops_collection.find_one({"_id": workshop["_id"]})
    assert _sync_registration_state(reopened)["registration_open"] is True


def test_an_unparseable_registration_end_is_skipped_rather_than_crashing():
    workshop = insert(registration_end="not-a-date")
    assert _sync_registration_state(workshop)["registration_open"] is True


def test_the_returned_document_is_a_copy_not_the_argument():
    workshop = insert(registration_end_offset=-1)
    synced = _sync_registration_state(workshop)
    assert synced is not workshop
    assert workshop["registration_open"] is True, "the caller's dict is untouched"


def test_the_boundary_is_the_deadline_itself(monkeypatch):
    deadline = datetime(2026, 6, 13, 12, 0, 0)
    workshop = insert(registration_end=iso(deadline))

    monkeypatch.setattr(module, "datetime", fake_datetime(deadline))
    assert _sync_registration_state(workshop)["registration_open"] is True, "open at the deadline"

    monkeypatch.setattr(module, "datetime", fake_datetime(deadline + timedelta(seconds=1)))
    assert _sync_registration_state(workshop)["registration_open"] is False


# ---------------------------------------------------------------------------
# _resolve_workshop — three-way lookup
# ---------------------------------------------------------------------------

def test_a_workshop_resolves_by_its_readable_id():
    insert(workshop_id="WKSP111")
    assert _resolve_workshop("WKSP111")["workshop_id"] == "WKSP111"


def test_a_workshop_resolves_by_its_object_id():
    workshop = insert(workshop_id="WKSP111")
    assert _resolve_workshop(str(workshop["_id"]))["workshop_id"] == "WKSP111"


def test_a_workshop_resolves_by_its_slot_id():
    """So a client that can scan against an id can also read the roster for it."""
    insert(workshop_id="WKSP111", slot_id="D1S1")
    assert _resolve_workshop("D1S1")["workshop_id"] == "WKSP111"


def test_an_unknown_id_returns_none_rather_than_raising():
    """Each caller words its own 404."""
    assert _resolve_workshop("NOPE") is None


def test_a_malformed_object_id_returns_none():
    assert _resolve_workshop("zzz-not-hex") is None


def test_a_valid_but_absent_object_id_returns_none():
    assert _resolve_workshop(str(ObjectId())) is None


def test_a_slot_id_shared_by_two_workshops_resolves_to_one_of_them():
    """
    Pinned, not endorsed: `find_one` picks an arbitrary document, so
    `POST /workshops/D1S1/register` is a legal call with an undefined target when
    a slot holds more than one workshop.
    """
    insert(workshop_id="WKSP111", slot_id="D1S1")
    insert(workshop_id="WKSP112", slot_id="D1S1")
    assert _resolve_workshop("D1S1")["workshop_id"] in {"WKSP111", "WKSP112"}


def test_resolution_runs_the_sync():
    insert(workshop_id="WKSP111", registration_end_offset=-1)
    assert _resolve_workshop("WKSP111")["registration_open"] is False


# ---------------------------------------------------------------------------
# _is_super_admin — takes a bare id here, unlike its namesakes elsewhere
# ---------------------------------------------------------------------------

def test_super_admin_is_recognised_by_id(super_admin):
    assert _is_super_admin(super_admin["paradox_id"]) is True


def test_an_ordinary_admin_is_not(plain_staff):
    assert _is_super_admin(plain_staff["paradox_id"]) is False


def test_an_unknown_or_null_id_is_not():
    assert _is_super_admin("NOBODY") is False
    assert _is_super_admin(None) is False


# ---------------------------------------------------------------------------
# _assert_scan_window
# ---------------------------------------------------------------------------

def test_the_three_operation_windows():
    assert _WINDOW_OPEN_MINUTES == {"pre-registered": 30, "on-spot": 15, "changes": 0}
    assert _WINDOW_CLOSE_MINUTES == 30


@pytest.mark.parametrize("operation", ["pre-registered", "on-spot", "changes"])
def test_a_workshop_with_no_start_time_is_unguarded(operation):
    _assert_scan_window({"start_time": None}, operation)
    _assert_scan_window({}, operation)


@pytest.mark.parametrize("operation", ["pre-registered", "on-spot", "changes"])
def test_an_unparseable_start_time_fails_open(operation):
    """Rather than locking out every scanner because of a bad seed value."""
    _assert_scan_window({"start_time": "not-a-date"}, operation)


@pytest.mark.parametrize("operation,opens", [("pre-registered", 30), ("on-spot", 15), ("changes", 0)])
def test_each_operation_opens_at_its_own_offset(monkeypatch, operation, opens):
    start = datetime(2026, 6, 13, 10, 0, 0)
    workshop = {"start_time": iso(start)}

    monkeypatch.setattr(module, "datetime", fake_datetime(start - timedelta(minutes=opens)))
    _assert_scan_window(workshop, operation)

    monkeypatch.setattr(module, "datetime",
                        fake_datetime(start - timedelta(minutes=opens, seconds=1)))
    with pytest.raises(HTTPException) as excinfo:
        _assert_scan_window(workshop, operation)
    assert excinfo.value.status_code == 403
    assert "Scanning window not yet open" in excinfo.value.detail


def test_the_not_yet_open_message_reports_the_wait(monkeypatch):
    start = datetime(2026, 6, 13, 10, 0, 0)
    monkeypatch.setattr(module, "datetime", fake_datetime(start - timedelta(minutes=45)))
    with pytest.raises(HTTPException) as excinfo:
        _assert_scan_window({"start_time": iso(start)}, "pre-registered")
    assert excinfo.value.detail == (
        "Scanning window not yet open. Opens 30 min before start (in ~15 min)."
    )


@pytest.mark.parametrize("operation", ["pre-registered", "on-spot", "changes"])
def test_all_three_windows_share_one_hard_close(monkeypatch, operation):
    start = datetime(2026, 6, 13, 10, 0, 0)
    workshop = {"start_time": iso(start)}

    monkeypatch.setattr(module, "datetime",
                        fake_datetime(start + timedelta(minutes=30, seconds=-1)))
    _assert_scan_window(workshop, operation)

    monkeypatch.setattr(module, "datetime", fake_datetime(start + timedelta(minutes=30)))
    with pytest.raises(HTTPException) as excinfo:
        _assert_scan_window(workshop, operation)
    assert excinfo.value.detail == (
        "Scanning window closed. It closes 30 min after the workshop starts."
    )


def test_an_offset_aware_start_time_is_normalised(monkeypatch):
    """15:30+05:30 is 10:00Z, so the window must be computed in UTC."""
    monkeypatch.setattr(module, "datetime", fake_datetime(datetime(2026, 6, 13, 10, 0, 0)))
    _assert_scan_window({"start_time": "2026-06-13T15:30:00+05:30"}, "changes")


def test_an_unknown_operation_raises_a_key_error(monkeypatch):
    """
    Characterises the 500 behind `POST /workshops/{id}/attendance?scan_type=bogus`:
    the window guard indexes the operation table before the route reaches its own
    "Invalid scan_type" check. See the xfail in test_workshops_attendance.py.
    """
    monkeypatch.setattr(module, "datetime", fake_datetime(datetime(2026, 6, 13, 10, 0, 0)))
    with pytest.raises(KeyError):
        _assert_scan_window({"start_time": "2026-06-13T10:00:00Z"}, "bogus")


# ---------------------------------------------------------------------------
# Team helpers
# ---------------------------------------------------------------------------

def test_a_team_member_is_found_by_id():
    workshop = {"workshop_team": [factories.workshop_team_member("VLWO1111")]}
    assert _workshop_team_member(workshop, "VLWO1111")["user_id"] == "VLWO1111"


def test_a_non_member_and_a_null_id_yield_none():
    workshop = {"workshop_team": [factories.workshop_team_member("VLWO1111")]}
    assert _workshop_team_member(workshop, "OTHER") is None
    assert _workshop_team_member(workshop, None) is None


def test_membership_is_compared_as_strings():
    workshop = {"workshop_team": [{"user_id": 42}]}
    assert _workshop_team_member(workshop, "42") is not None


def test_an_empty_team_yields_none():
    assert _workshop_team_member({}, "VLWO1111") is None


def test_team_details_fall_back_from_designation_to_email(make_staff):
    make_staff(paradox_id="OTWO1111", email="desk@x.com", role="other",
               designation="Workshop Desk", name=None)
    workshop = {"workshop_team": [factories.workshop_team_member("OTWO1111")]}
    detail = _workshop_team_details(workshop)[0]
    assert detail["name"] == "Workshop Desk"
    assert detail["phone"] is None
    assert detail["attendance"] is True


def test_team_details_are_upgraded_from_a_participant_profile(make_staff, make_participant):
    make_staff(paradox_id="DS23F000001", email="desk@x.com", role="other",
               designation="Workshop Desk")
    make_participant(participant_id="DS23F000001",
                     profile={"full_name": "Asha Nair", "phone": "9000000001"})
    detail = _workshop_team_details({
        "workshop_team": [factories.workshop_team_member("DS23F000001")]
    })[0]
    assert detail["name"] == "Asha Nair"
    assert detail["phone"] == "9000000001"


def test_team_details_never_leak_a_hash_or_an_object_id(make_staff):
    make_staff(paradox_id="OTWO1111", email="desk@x.com", role="other")
    details = _workshop_team_details({
        "workshop_team": [factories.workshop_team_member("OTWO1111")]
    })
    assert set(details[0]) == {"user_id", "role", "attendance", "name", "phone"}
    assert isinstance(details[0]["user_id"], str)


def test_an_unknown_team_member_still_produces_a_row():
    detail = _workshop_team_details({
        "workshop_team": [factories.workshop_team_member("GHOST")]
    })[0]
    assert detail["user_id"] == "GHOST"
    assert detail["name"] is None


def test_the_stood_down_flag_is_reported():
    detail = _workshop_team_details({
        "workshop_team": [factories.workshop_team_member("X", attendance=False)]
    })[0]
    assert detail["attendance"] is False


def test_the_roster_projection_excludes_credentials():
    from routers.workshops import _ROSTER_FIELDS

    assert _ROSTER_FIELDS["_id"] == 0
    for secret in ("password_hash", "qr_secrets", "embedding", "photo"):
        assert secret not in _ROSTER_FIELDS


def test_the_public_projection_hides_the_internal_close_bit():
    from routers.workshops import PUBLIC_WORKSHOP_FIELDS

    assert "registration_closed_by_system" not in PUBLIC_WORKSHOP_FIELDS
    assert "workshop_team" not in PUBLIC_WORKSHOP_FIELDS
    assert "created_by" not in PUBLIC_WORKSHOP_FIELDS
