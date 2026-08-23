"""
Unit tests for backend/logger.py — actor resolution and the audit row shape.

`actor_identity` has four branches and always returns the same four keys, which
is what lets `/audit-logs` read a trail written by any caller without a join.
"""
from datetime import datetime, timedelta

import pytest

import database
import logger
from logger import actor_identity, email_local_part, log_audit

IDENTITY_KEYS = {"actor_id", "actor_name", "actor_type", "actor_role"}


# ---------------------------------------------------------------------------
# email_local_part
# ---------------------------------------------------------------------------

def test_local_part_of_a_normal_address():
    assert email_local_part("bt413179@ds.study.iitm.ac.in") == "bt413179"


@pytest.mark.parametrize("value", [None, "", "no-at-sign", "   "])
def test_unusable_addresses_yield_none(value):
    assert email_local_part(value) is None


def test_an_address_with_an_empty_local_part_yields_none():
    assert email_local_part("@example.com") is None


def test_local_part_is_stripped():
    assert email_local_part("  spaced  @example.com") == "spaced"


def test_only_the_first_at_sign_splits():
    assert email_local_part("a@b@c.com") == "a"


# ---------------------------------------------------------------------------
# actor_identity — branch 1: None
# ---------------------------------------------------------------------------

def test_no_actor_yields_four_nulls():
    assert actor_identity(None) == {
        "actor_id": None, "actor_name": None, "actor_type": None, "actor_role": None,
    }


# ---------------------------------------------------------------------------
# actor_identity — branch 2: a bare id string
# ---------------------------------------------------------------------------

def test_a_bare_string_is_an_id_with_no_name():
    assert actor_identity("SAWO1111") == {
        "actor_id": "SAWO1111", "actor_name": None, "actor_type": None, "actor_role": None,
    }


# ---------------------------------------------------------------------------
# actor_identity — branch 3: staff
# ---------------------------------------------------------------------------

def test_staff_name_precedence_prefers_the_explicit_name():
    identity = actor_identity({
        "paradox_id": "SAWO1111", "name": "Priya Raman",
        "designation": "Mess Head", "email": "priya@x.com", "role": "super_admin",
    })
    assert identity == {
        "actor_id": "SAWO1111", "actor_name": "Priya Raman",
        "actor_type": "staff", "actor_role": "super_admin",
    }


def test_staff_falls_back_to_designation_then_email_local_part():
    by_designation = actor_identity({
        "paradox_id": "OTME1111", "designation": "Mess Head",
        "email": "bt413179@ds.study.iitm.ac.in", "role": "other",
    })
    assert by_designation["actor_name"] == "Mess Head"

    by_email = actor_identity({
        "paradox_id": "OTME1111", "email": "bt413179@ds.study.iitm.ac.in", "role": "other",
    })
    assert by_email["actor_name"] == "bt413179"


def test_staff_with_nothing_nameable_still_yields_the_id_and_type():
    identity = actor_identity({"paradox_id": "OTME1111", "role": "other"})
    assert identity["actor_id"] == "OTME1111"
    assert identity["actor_name"] is None
    assert identity["actor_type"] == "staff"


def test_a_blank_paradox_id_falls_through_to_the_participant_branch():
    """
    The staff test is truthiness, not key presence — `paradox_id: ""` is treated
    as a participant. Pinned because it decides which id namespace the row is
    filed under.
    """
    identity = actor_identity({
        "paradox_id": "", "participant_id": "DS23F000001",
        "profile": {"full_name": "Asha"},
    })
    assert identity["actor_type"] == "participant"
    assert identity["actor_id"] == "DS23F000001"


# ---------------------------------------------------------------------------
# actor_identity — branch 4: participant
# ---------------------------------------------------------------------------

def test_participant_uses_the_profile_name():
    identity = actor_identity({
        "participant_id": "DS23F000001",
        "email": "23f000001@ds.study.iitm.ac.in",
        "profile": {"full_name": "Asha Nair"},
    })
    assert identity == {
        "actor_id": "DS23F000001", "actor_name": "Asha Nair",
        "actor_type": "participant", "actor_role": "participant",
    }


def test_participant_falls_back_to_the_email_local_part():
    identity = actor_identity({
        "participant_id": "DS23F000001",
        "email": "23f000001@ds.study.iitm.ac.in",
        "profile": {},
    })
    assert identity["actor_name"] == "23f000001"


def test_participant_with_a_null_profile_does_not_crash():
    """A freshly registered account has `profile: {}`; a null one is defended
    against by `or {}`."""
    identity = actor_identity({"participant_id": "DS23F000001", "profile": None})
    assert identity["actor_name"] is None
    assert identity["actor_role"] == "participant"


def test_participant_role_is_always_the_literal_participant():
    identity = actor_identity({"participant_id": "DS23F000001", "role": "super_admin"})
    assert identity["actor_role"] == "participant", "a participant cannot claim a staff role"


@pytest.mark.parametrize("actor", [
    None,
    "BARE-ID",
    {"paradox_id": "SAWO1111"},
    {"participant_id": "DS23F000001"},
])
def test_every_branch_returns_the_same_key_set(actor):
    assert set(actor_identity(actor)) == IDENTITY_KEYS


# ---------------------------------------------------------------------------
# log_audit
# ---------------------------------------------------------------------------

def test_log_audit_writes_one_row_with_the_documented_shape():
    log_audit({"paradox_id": "SAWO1111", "name": "Priya", "role": "super_admin"},
              "CREATE_MESS", "MESS1", {"capacity": 50})

    rows = list(database.system_logs_collection.find({}))
    assert len(rows) == 1
    row = rows[0]
    assert row["action"] == "CREATE_MESS"
    assert row["target_id"] == "MESS1"
    assert row["details"] == {"capacity": 50}
    assert row["actor_id"] == "SAWO1111"
    assert row["actor_name"] == "Priya"
    assert row["actor_type"] == "staff"
    assert row["actor_role"] == "super_admin"


def test_timestamp_is_naive_utc_near_now():
    log_audit("SAWO1111", "PING")
    row = database.system_logs_collection.find_one({})
    assert isinstance(row["timestamp"], datetime)
    assert row["timestamp"].tzinfo is None
    assert abs(datetime.utcnow() - row["timestamp"]) < timedelta(seconds=5)


def test_timestamp_uses_the_module_clock(monkeypatch):
    from testing.helpers import fake_datetime

    frozen = datetime(2026, 6, 13, 8, 0, 0)
    monkeypatch.setattr(logger, "datetime", fake_datetime(frozen))
    log_audit("SAWO1111", "PING")
    assert database.system_logs_collection.find_one({})["timestamp"] == frozen


def test_target_id_and_details_default_to_none_and_empty():
    log_audit("SAWO1111", "ALLOCATE_MESSES")
    row = database.system_logs_collection.find_one({})
    assert row["target_id"] is None
    assert row["details"] == {}


def test_explicit_none_details_becomes_an_empty_dict():
    log_audit("SAWO1111", "PING", "T1", None)
    assert database.system_logs_collection.find_one({})["details"] == {}


def test_each_call_appends_rather_than_replacing():
    log_audit("SAWO1111", "FIRST")
    log_audit("SAWO1111", "SECOND")
    actions = [r["action"] for r in database.system_logs_collection.find({})]
    assert actions == ["FIRST", "SECOND"]


def test_a_none_actor_is_accepted_and_recorded_as_anonymous():
    log_audit(None, "SYSTEM_TASK")
    row = database.system_logs_collection.find_one({})
    assert row["actor_id"] is None
    assert row["actor_type"] is None
