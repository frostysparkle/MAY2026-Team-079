"""
Unit tests for the private helpers in backend/routers/mess.py.

`_diet_of` is the one that makes allocation possible at all: a hall's `type` carries
both a cuisine and a diet, while a participant only ever expresses a diet, so the
two are matched on the dietary axis alone.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from routers.mess import (
    MEAL_SLOTS,
    SCAN_WINDOW,
    _assert_mess_scan_window,
    _day_sort_key,
    _diet_of,
    _naive_utc,
)


# ---------------------------------------------------------------------------
# _diet_of
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mess_type,expected", [
    ("north_indian__veg", "veg"),
    ("north_indian__non_veg", "non_veg"),
    ("south_indian__veg", "veg"),
    ("south_indian__non_veg", "non_veg"),
    ("jain", "jain"),
])
def test_every_valid_hall_type_collapses_to_its_diet(mess_type, expected):
    assert _diet_of(mess_type) == expected


def test_a_bare_diet_is_returned_unchanged():
    """Preferences written before combined values existed still place correctly."""
    assert _diet_of("veg") == "veg"
    assert _diet_of("non_veg") == "non_veg"


def test_the_cuisine_is_discarded_so_both_regions_share_a_bucket():
    assert _diet_of("north_indian__veg") == _diet_of("south_indian__veg")


def test_only_the_last_separator_counts():
    assert _diet_of("a__b__c") == "c"


def test_a_blank_type_yields_a_blank_diet():
    """
    Pinned, not endorsed: a hall whose `type` is missing or empty lands in a diet
    bucket no participant's preference can ever name, so it is unreachable by
    allocation and shows up as `""` in the batch summary's `diets_available`.
    """
    assert _diet_of("") == ""


# ---------------------------------------------------------------------------
# _day_sort_key
# ---------------------------------------------------------------------------

def test_days_sort_numerically_not_lexically():
    keys = ["day_10", "day_2", "day_1", "day_9"]
    assert sorted(keys, key=_day_sort_key) == ["day_1", "day_2", "day_9", "day_10"]


@pytest.mark.parametrize("day_key,expected", [("day_1", 1), ("day_10", 10), ("day_100", 100)])
def test_the_number_is_extracted(day_key, expected):
    assert _day_sort_key(day_key) == expected


@pytest.mark.parametrize("day_key", ["day_x", "weird", "", "day_"])
def test_a_malformed_key_sorts_first_rather_than_crashing(day_key):
    assert _day_sort_key(day_key) == 0


# ---------------------------------------------------------------------------
# _naive_utc
# ---------------------------------------------------------------------------

def test_a_naive_datetime_passes_through():
    moment = datetime(2026, 6, 13, 7, 0)
    assert _naive_utc(moment) is moment


def test_an_aware_datetime_is_converted_to_utc_and_stripped():
    aware = datetime(2026, 6, 13, 12, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    result = _naive_utc(aware)
    assert result == datetime(2026, 6, 13, 7, 0)
    assert result.tzinfo is None


# ---------------------------------------------------------------------------
# _assert_mess_scan_window
# ---------------------------------------------------------------------------

def slot(start_offset_minutes, duration_minutes=60):
    start = datetime.utcnow() + timedelta(minutes=start_offset_minutes)
    return {"start_time": start, "end_time": start + timedelta(minutes=duration_minutes)}


def test_the_window_is_fifteen_minutes_either_side():
    assert SCAN_WINDOW == timedelta(minutes=15)
    assert MEAL_SLOTS == ("breakfast", "lunch", "dinner")


def test_a_sitting_in_progress_is_open():
    _assert_mess_scan_window(slot(-10))


def test_the_window_opens_fifteen_minutes_early():
    _assert_mess_scan_window(slot(14))
    with pytest.raises(HTTPException) as excinfo:
        _assert_mess_scan_window(slot(16))
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Scanning window not yet open for this slot"


def test_the_window_closes_fifteen_minutes_late():
    # Ends 14 minutes ago, so still inside the grace period.
    _assert_mess_scan_window(slot(-74, duration_minutes=60))
    with pytest.raises(HTTPException) as excinfo:
        _assert_mess_scan_window(slot(-76, duration_minutes=60))
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Scanning window closed for this slot"


def test_an_offset_aware_slot_is_compared_on_the_same_axis():
    start = datetime.now(timezone.utc) - timedelta(minutes=10)
    _assert_mess_scan_window({"start_time": start, "end_time": start + timedelta(hours=1)})


@pytest.mark.parametrize("slot_doc", [
    {"start_time": "2026-06-13T07:00:00", "end_time": "2026-06-13T09:00:00"},
    {"start_time": None, "end_time": None},
    {},
])
def test_the_guard_disables_itself_for_non_datetime_bounds(slot_doc):
    """
    Pinned, not endorsed: a seeded or hand-edited menu with ISO strings leaves the
    hall accepting scans at any hour. The integrity log below is the only trace.
    """
    _assert_mess_scan_window(slot_doc)


def test_the_disabled_guard_is_reported_as_an_integrity_event(caplog):
    import logging

    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        _assert_mess_scan_window(
            {"start_time": "2026-06-13T07:00:00", "end_time": "2026-06-13T09:00:00"},
            mess_id="MESS1", day=1, slot="breakfast",
        )
    assert any(getattr(r, "reason", None) == "mess_window_guard_disabled"
               for r in caplog.records)


def test_a_refusal_reports_how_long_until_the_window_opens(participant, super_admin):
    import database

    with pytest.raises(HTTPException):
        _assert_mess_scan_window(slot(45), mess_id="MESS1", day=1, slot="lunch",
                                 actor=super_admin)
    row = database.system_logs_collection.find_one({"action": "MESS_SCAN_DENIED"})
    assert row["details"]["reason"] == "window_not_open"
    # 45 minutes out, minus the 15-minute lead, floored to whole minutes — so 29
    # or 30 depending on where in the second the request landed.
    assert row["details"]["opens_in_minutes"] in (29, 30)
    assert row["details"]["scan_domain"] == "mess"


def test_a_closed_window_records_how_long_ago_it_shut(super_admin):
    import database

    with pytest.raises(HTTPException):
        _assert_mess_scan_window(slot(-120, duration_minutes=60), mess_id="MESS1",
                                 day=1, slot="lunch", actor=super_admin)
    row = database.system_logs_collection.find_one({"action": "MESS_SCAN_DENIED"})
    assert row["details"]["reason"] == "window_closed"
    assert row["details"]["closed_minutes_ago"] in (44, 45)
