"""
Unit tests for the refusal-trail half of backend/logger.py: `log_denied`,
`log_scan`, `log_batch`, and `log_integrity`.

The naming rule these enforce is load-bearing rather than cosmetic:
`routers/audit.py` counts meals from rows whose `action == "MESS_SCAN"` and
de-duplicates on `details.participant_id` / `day` / `slot`. A refusal filed under
the same action string would be counted as a meal served. So the tests below pin
both halves — that a success keeps its historical action and detail keys, and that
a refusal gets a distinct `_DENIED` string.
"""
import logging

import pytest

import database
import logger
from logger import (
    OUTCOME_ALLOWED,
    OUTCOME_DENIED,
    OUTCOME_DUPLICATE,
    OUTCOME_ERROR,
    log_audit,
    log_batch,
    log_denied,
    log_integrity,
    log_scan,
)

STAFF = {"paradox_id": "SAWO1111", "name": "Priya", "role": "super_admin"}
AUDIT_KEYS = {
    "timestamp", "actor_id", "actor_name", "actor_type", "actor_role",
    "action", "target_id", "details",
}


def rows(action=None):
    query = {"action": action} if action else {}
    return list(database.system_logs_collection.find(query, {"_id": 0}))


# ---------------------------------------------------------------------------
# The row shape every helper shares
# ---------------------------------------------------------------------------

def test_the_audit_row_has_exactly_eight_keys():
    log_audit(STAFF, "CREATE_MESS", "MESS1", {"capacity": 50})
    assert set(rows()[0]) == AUDIT_KEYS


def test_a_failed_insert_does_not_fail_the_caller(monkeypatch, caplog):
    """
    `log_audit` runs *after* the work it describes is already written, so an
    unreachable Mongo used to turn a completed scan into a 500 and make the
    client retry an operation that had succeeded.
    """
    class Exploding:
        def insert_one(self, _doc):
            raise RuntimeError("mongo is down")

    monkeypatch.setattr(logger, "system_logs_collection", Exploding())
    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        log_audit(STAFF, "MESS_SCAN", "MESS1")
    assert any(getattr(r, "audit_write_failed", False) for r in caplog.records)


def test_the_file_line_is_redacted_while_the_row_is_not(caplog):
    """
    The database row keeps the raw details — it is the durable record — while the
    mirrored file line goes through `redact`.
    """
    with caplog.at_level(logging.INFO, logger="paradox.audit"):
        log_audit(STAFF, "UPDATE_STAFF", "ADTE2222", {"password_hash": "$2b$12$secret"})

    assert rows()[0]["details"]["password_hash"] == "$2b$12$secret"
    emitted = [r for r in caplog.records if r.getMessage() == "audit UPDATE_STAFF"]
    assert emitted and emitted[-1].details["password_hash"] == "[redacted]"


def test_the_caller_details_dict_is_not_mutated():
    supplied = {"capacity": 50}
    log_audit(STAFF, "CREATE_MESS", "MESS1", supplied)
    assert supplied == {"capacity": 50}, "request_id leaked back into the caller's dict"


# ---------------------------------------------------------------------------
# log_denied
# ---------------------------------------------------------------------------

def test_a_refusal_records_its_reason_and_outcome():
    log_denied(STAFF, "MESS_SCAN_DENIED", "MESS1", reason="not_on_mess_team",
               details={"slot": "lunch", "day": 2})
    row = rows("MESS_SCAN_DENIED")[0]
    assert row["details"]["reason"] == "not_on_mess_team"
    assert row["details"]["outcome"] == OUTCOME_DENIED
    assert row["details"]["slot"] == "lunch"
    assert row["target_id"] == "MESS1"


def test_the_action_string_is_passed_through_verbatim():
    """Derived suffixes would let a call site file a refusal under a success
    string the dashboard counts."""
    log_denied(STAFF, "CREATE_MESS_DENIED")
    assert [r["action"] for r in rows()] == ["CREATE_MESS_DENIED"]


def test_none_valued_details_are_dropped():
    log_denied(STAFF, "X_DENIED", None, reason=None, details={"a": 1, "b": None})
    assert rows()[0]["details"] == {"a": 1, "outcome": OUTCOME_DENIED}


def test_falsy_but_meaningful_details_are_kept():
    log_denied(STAFF, "X_DENIED", None, reason="r",
               details={"applied": False, "count": 0, "note": ""})
    details = rows()[0]["details"]
    assert details["applied"] is False and details["count"] == 0 and details["note"] == ""


def test_a_caller_detail_overrides_the_default_outcome():
    log_denied(STAFF, "X_DENIED", None, reason="r", details={"outcome": "custom"})
    assert rows()[0]["details"]["outcome"] == "custom"


def test_audit_false_writes_no_row_at_all(caplog):
    """For refusals too frequent to keep forever — a malformed token is noise in
    the trail and signal in the file log."""
    with caplog.at_level(logging.WARNING, logger="paradox.audit"):
        log_denied(STAFF, "AUTH_REFUSED", None, reason="bad_token", audit=False)
    assert rows() == []
    assert any(r.getMessage() == "denied AUTH_REFUSED" for r in caplog.records)


def test_the_unaudited_line_is_warning_by_default_and_overridable(caplog):
    with caplog.at_level(logging.DEBUG, logger="paradox.audit"):
        log_denied(STAFF, "A_DENIED", audit=False)
        log_denied(STAFF, "B_DENIED", audit=False, level=logging.ERROR)
    levels = {r.getMessage(): r.levelno for r in caplog.records}
    assert levels["denied A_DENIED"] == logging.WARNING
    assert levels["denied B_DENIED"] == logging.ERROR


def test_an_unaudited_refusal_still_redacts_its_details(caplog):
    with caplog.at_level(logging.WARNING, logger="paradox.audit"):
        log_denied(STAFF, "A_DENIED", audit=False, details={"token": "abc123"})
    assert not any("abc123" in str(r.__dict__) for r in caplog.records)


def test_a_bare_string_actor_is_accepted():
    """`dependencies._missing_user` has only an id to work with."""
    log_denied("DS23F000001", "AUTH_REFUSED", "DS23F000001", reason="account_not_found")
    row = rows()[0]
    assert row["actor_id"] == "DS23F000001"
    assert row["actor_type"] is None


# ---------------------------------------------------------------------------
# log_scan
# ---------------------------------------------------------------------------

def test_an_allowed_scan_keeps_its_historical_details_plus_the_new_keys():
    log_scan(STAFF, "mess", "MESS_SCAN", OUTCOME_ALLOWED,
             participant_id="DS23F000001", target_id="MESS1",
             details={"slot": "lunch", "day": 2, "written_slots": ["lunch"]})
    row = rows("MESS_SCAN")[0]
    # The three keys the meal summary de-duplicates on, unchanged.
    assert row["details"]["participant_id"] == "DS23F000001"
    assert row["details"]["slot"] == "lunch"
    assert row["details"]["day"] == 2
    # Additive only.
    assert row["details"]["scan_domain"] == "mess"
    assert row["details"]["outcome"] == OUTCOME_ALLOWED


def test_the_domain_is_a_field_and_never_folded_into_the_action():
    for domain in ("mess", "hostel", "workshop", "event"):
        log_scan(STAFF, domain, "SCAN", OUTCOME_ALLOWED, participant_id="P")
    assert {r["action"] for r in rows()} == {"SCAN"}
    assert {r["details"]["scan_domain"] for r in rows()} == {"mess", "hostel", "workshop", "event"}


def test_a_denied_scan_emits_a_second_line_above_info(caplog):
    """`log_audit` already wrote INFO; a refusal also belongs in errors.log."""
    with caplog.at_level(logging.DEBUG, logger="paradox.audit"):
        log_scan(STAFF, "hostel", "HOSTEL_SCAN_DENIED", OUTCOME_DENIED,
                 participant_id="P", reason="already_inside")
    messages = [r.getMessage() for r in caplog.records]
    assert "audit HOSTEL_SCAN_DENIED" in messages
    assert "scan denied: HOSTEL_SCAN_DENIED" in messages


def test_an_allowed_scan_emits_only_the_audit_line(caplog):
    with caplog.at_level(logging.DEBUG, logger="paradox.audit"):
        log_scan(STAFF, "mess", "MESS_SCAN", OUTCOME_ALLOWED, participant_id="P")
    assert [r.getMessage() for r in caplog.records].count("scan allowed: MESS_SCAN") == 0


@pytest.mark.parametrize("outcome,expected", [
    (OUTCOME_ALLOWED, logging.INFO),
    (OUTCOME_DUPLICATE, logging.INFO),
    (OUTCOME_DENIED, logging.WARNING),
    (OUTCOME_ERROR, logging.ERROR),
])
def test_each_outcome_maps_to_its_level(caplog, outcome, expected):
    with caplog.at_level(logging.DEBUG, logger="paradox.audit"):
        log_scan(STAFF, "mess", "SCAN", outcome, participant_id="P", audit=False)
    assert caplog.records[-1].levelno == expected


def test_an_unknown_outcome_is_accepted_at_info(caplog):
    with caplog.at_level(logging.DEBUG, logger="paradox.audit"):
        log_scan(STAFF, "mess", "SCAN", "sideways", participant_id="P", audit=False)
    assert caplog.records[-1].levelno == logging.INFO


def test_the_four_outcome_constants():
    assert (OUTCOME_ALLOWED, OUTCOME_DENIED, OUTCOME_DUPLICATE, OUTCOME_ERROR) == (
        "allowed", "denied", "duplicate", "error",
    )


def test_scan_audit_false_writes_no_row():
    log_scan(STAFF, "mess", "SCAN", OUTCOME_DENIED, participant_id="P", audit=False)
    assert rows() == []


def test_a_null_participant_id_is_dropped_rather_than_stored():
    log_scan(STAFF, "mess", "SCAN", OUTCOME_DENIED, participant_id=None, reason="r")
    assert "participant_id" not in rows()[0]["details"]


# ---------------------------------------------------------------------------
# log_batch
# ---------------------------------------------------------------------------

def test_a_batch_row_carries_the_summary_and_a_null_target():
    log_batch(STAFF, "ALLOCATE_MESSES", None, {
        "allocated_count": 7, "candidates": 30, "skipped_count": 23,
        "skipped_by_reason": {"no_hall_for_diet": 23},
    })
    row = rows("ALLOCATE_MESSES")[0]
    assert row["target_id"] is None
    assert row["details"]["allocated_count"] == 7
    assert row["details"]["skipped_by_reason"] == {"no_hall_for_diet": 23}


def test_a_batch_keeps_null_valued_summary_fields():
    """Unlike `log_denied`/`log_scan`, `log_batch` passes the summary through
    `log_audit` directly, so nothing is stripped."""
    log_batch(STAFF, "ALLOCATE_HOSTELS", None, {"allocated_count": 0, "note": None})
    assert rows()[0]["details"]["note"] is None


def test_a_batch_always_audits_even_with_no_summary():
    log_batch(STAFF, "ALLOCATE_MESSES")
    assert rows()[0]["details"] == {}


def test_a_batch_emits_a_marked_file_line(caplog):
    with caplog.at_level(logging.INFO, logger="paradox.audit"):
        log_batch(STAFF, "ALLOCATE_MESSES", None, {"allocated_count": 1})
    assert any(getattr(r, "batch", False) for r in caplog.records)


# ---------------------------------------------------------------------------
# log_integrity
# ---------------------------------------------------------------------------

def test_an_integrity_event_is_error_level_and_file_only_by_default(caplog):
    """A refusal is the system working; this is the system carrying on when it
    should not be able to. The request succeeding is what makes it hard to find."""
    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        log_integrity("guard skipped", reason="mess_window_guard_disabled",
                      details={"mess_id": "MESS1"})
    assert rows() == []
    record = caplog.records[-1]
    assert record.levelno == logging.ERROR
    assert record.reason == "mess_window_guard_disabled"
    assert record.integrity is True


def test_an_integrity_event_can_be_promoted_to_the_durable_trail():
    log_integrity("id collision", reason="hostel_id_collision",
                  details={"hostel_id": "HSTL111"}, actor=STAFF,
                  action="ID_COLLISION", target_id="HSTL111", audit=True)
    row = rows("ID_COLLISION")[0]
    assert row["details"]["reason"] == "hostel_id_collision"
    assert row["details"]["hostel_id"] == "HSTL111"
    assert row["target_id"] == "HSTL111"


def test_promotion_requires_both_the_flag_and_an_action():
    log_integrity("m", reason="r", audit=True)
    log_integrity("m", reason="r", action="SOMETHING")
    assert rows() == []


def test_integrity_details_are_redacted_in_the_file_line(caplog):
    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        log_integrity("m", reason="r", details={"private_key": "-----BEGIN"})
    assert not any("BEGIN" in str(r.__dict__) for r in caplog.records)


def test_integrity_never_raises_on_an_awkward_payload():
    log_integrity("m", reason="r", details={"module": "x", "args": (1,), "self": None})


# ---------------------------------------------------------------------------
# The naming rule that protects the meal figures
# ---------------------------------------------------------------------------

def test_a_refusal_is_not_counted_as_a_meal_served():
    """
    The concrete reason refusals get their own action strings: `_meal_summary`
    counts `MESS_SCAN` rows. One allowed scan and three refusals must read as one
    meal.
    """
    from routers.audit import _meal_summary

    log_scan(STAFF, "mess", "MESS_SCAN", OUTCOME_ALLOWED, participant_id="DS23F000001",
             target_id="MESS1", details={"slot": "lunch", "day": 1})
    for reason in ("not_on_mess_team", "already_scanned", "window_closed"):
        log_scan(STAFF, "mess", "MESS_SCAN_DENIED", OUTCOME_DENIED,
                 participant_id="DS23F000001", target_id="MESS1",
                 reason=reason, details={"slot": "lunch", "day": 1})

    summary = _meal_summary({"action": "MESS_SCAN"})
    assert summary["scans"] == 1
    assert summary["meals_served"] == 1
    assert summary["by_slot"]["lunch"] == 1
