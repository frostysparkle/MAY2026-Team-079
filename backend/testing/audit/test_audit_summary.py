"""
``GET /audit-logs/summary`` — the counting half of the audit trail.

Why this endpoint exists, and therefore what these tests are really pinning down:
``GET /audit-logs`` takes a ``limit``, so the number of rows it returns is a
property of the request, not of the fest. The dashboard was reading that length
and labelling it "Recorded Actions", and deriving "staff active today" from the
actors that happened to appear in the newest sixty rows. Both figures silently
became wrong as soon as the fest produced more history than the cap.

So every assertion below is some version of the same claim: **the summary must not
move when the row limit does.** The fixture deliberately writes more rows than any
limit a caller would use, so anything computed from a page instead of the
collection fails.

Rows are inserted directly rather than driven through the scan endpoints. The scan
paths are covered by ``test_mess.py`` and ``test_events.py``; what is under test
here is the read contract.
"""
import os
import random
import sys
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from database import backend_teams_collection, system_logs_collection
from main import app

client = TestClient(app)

MESS_ID = "MS_SUMMARY_1"

# Rows written per action. Comfortably over the 60-row window the board used for
# "staff active today" and over any page a caller would ask for here.
SCAN_ROWS = 120
ENTRY_ROWS = 40

# The day the fixture's rows are filed under, in UTC — the same form the trail is
# stored in (`datetime.utcnow()`, naive).
DAY = datetime(2026, 6, 10)


def make_staff(role: str) -> str:
    """Insert a staff member and return their bearer token."""
    rand = random.randint(100000, 999999)
    email = f"summary{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"BT{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": "technicals",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    resp = client.post(
        "/auth/admin/login", json={"email": email, "password": "secure_password"}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def trail():
    """
    A trail spanning three days, with more rows than any caller will page.

    Layout, all UTC:
      * day-1 (09 Jun) — 40 ``HOSTEL_ENTRY`` rows by one actor
      * day-0 (10 Jun) — 120 ``MESS_SCAN`` rows by two actors, plus one row at
        exactly midnight and one at 23:59, for the half-open boundary
      * day+1 (11 Jun) — a single ``CREATE_EVENT`` row
    """
    system_logs_collection.delete_many({})
    backend_teams_collection.delete_many({})

    sa_token = make_staff("super_admin")
    head_token = make_staff("event_head")

    rows = []

    for i in range(ENTRY_ROWS):
        rows.append({
            "timestamp": DAY - timedelta(days=1) + timedelta(minutes=i),
            "actor_id": "BT_YESTERDAY",
            "action": "HOSTEL_ENTRY",
            "target_id": "HS_1",
            "details": {"participant_id": f"P{i}"},
        })

    # 120 meal scans across two scanners. Each participant eats one breakfast, so
    # rows, meals and diners are all equal here — later tests break that apart.
    for i in range(SCAN_ROWS):
        rows.append({
            "timestamp": DAY + timedelta(hours=8, seconds=i),
            "actor_id": "BT_SCANNER_A" if i % 2 == 0 else "BT_SCANNER_B",
            "action": "MESS_SCAN",
            "target_id": MESS_ID,
            "details": {"participant_id": f"P{i}", "slot": "breakfast", "day": 1},
        })

    # The two rows that decide the half-open boundary.
    rows.append({
        "timestamp": DAY,
        "actor_id": "BT_MIDNIGHT",
        "action": "MESS_SCAN",
        "target_id": MESS_ID,
        "details": {"participant_id": "P_MIDNIGHT", "slot": "breakfast", "day": 1},
    })
    rows.append({
        "timestamp": DAY + timedelta(hours=23, minutes=59),
        "actor_id": "BT_LATE",
        "action": "MESS_SCAN",
        "target_id": MESS_ID,
        "details": {"participant_id": "P_LATE", "slot": "dinner", "day": 1},
    })

    rows.append({
        "timestamp": DAY + timedelta(days=1, hours=3),
        "actor_id": "BT_TOMORROW",
        "action": "CREATE_EVENT",
        "target_id": "EVT_1",
        "details": {},
    })

    system_logs_collection.insert_many(rows)
    return {
        "sa": {"Authorization": f"Bearer {sa_token}"},
        "head": {"Authorization": f"Bearer {head_token}"},
        "total": len(rows),
    }


def summary(headers, **params):
    resp = client.get("/audit-logs/summary", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── totals ────────────────────────────────────────────────────────────────────

def test_the_total_counts_the_collection_not_a_page(trail):
    """
    The regression this endpoint exists for.

    `GET /audit-logs` would return at most `limit` rows; the total must be the
    same number whatever any limit is set to.
    """
    body = summary(trail["sa"])
    assert body["total"] == trail["total"]

    # And it is genuinely larger than a page of rows, so a length could not have
    # produced it by luck.
    rows = client.get("/audit-logs", params={"limit": 10}, headers=trail["sa"]).json()
    assert len(rows) == 10
    assert body["total"] > len(rows)


def test_per_action_counts_are_exact(trail):
    body = summary(trail["sa"])
    assert body["by_action"]["HOSTEL_ENTRY"] == ENTRY_ROWS
    # 120 fixture scans plus the midnight and late-evening rows.
    assert body["by_action"]["MESS_SCAN"] == SCAN_ROWS + 2
    assert body["by_action"]["CREATE_EVENT"] == 1


def test_distinct_actors_is_the_whole_set_not_the_newest_rows(trail):
    """
    What "staff active today" reads.

    The board used to intersect its staff roster with the actors appearing in the
    newest sixty rows. Here the day's 122 scan rows are shared between two
    scanners that appear only in the older two thirds of them, so a
    newest-N derivation cannot see both.
    """
    body = summary(trail["sa"], since=DAY.isoformat() + "Z",
                   until=(DAY + timedelta(days=1)).isoformat() + "Z")
    assert set(body["actor_ids"]) == {
        "BT_SCANNER_A", "BT_SCANNER_B", "BT_MIDNIGHT", "BT_LATE",
    }
    assert body["distinct_actors"] == 4
    assert "BT_YESTERDAY" not in body["actor_ids"]
    assert "BT_TOMORROW" not in body["actor_ids"]


# ── the window ────────────────────────────────────────────────────────────────

def test_the_window_narrows_to_one_day(trail):
    body = summary(trail["sa"], since=DAY.isoformat() + "Z",
                   until=(DAY + timedelta(days=1)).isoformat() + "Z")
    assert body["total"] == SCAN_ROWS + 2
    assert "HOSTEL_ENTRY" not in body["by_action"]
    assert "CREATE_EVENT" not in body["by_action"]


def test_consecutive_windows_tile_without_double_counting(trail):
    """
    Half-open, so the midnight row belongs to exactly one day.

    An inclusive `until` would count it in both, and a dashboard summing per-day
    figures would report more actions than the fest recorded.
    """
    days = [DAY - timedelta(days=1), DAY, DAY + timedelta(days=1), DAY + timedelta(days=2)]
    tiled = 0
    for start, end in zip(days, days[1:]):
        tiled += summary(
            trail["sa"], since=start.isoformat() + "Z", until=end.isoformat() + "Z"
        )["total"]

    span = summary(
        trail["sa"], since=days[0].isoformat() + "Z", until=days[-1].isoformat() + "Z"
    )["total"]
    assert tiled == span == trail["total"]


def test_the_midnight_row_belongs_to_the_day_it_opens(trail):
    """`since` is inclusive, `until` exclusive."""
    opens = summary(trail["sa"], since=DAY.isoformat() + "Z",
                    until=(DAY + timedelta(seconds=1)).isoformat() + "Z")
    assert opens["actor_ids"] == ["BT_MIDNIGHT"]

    # The previous day's window ends at that same instant and must not include it.
    before = summary(trail["sa"], since=(DAY - timedelta(days=1)).isoformat() + "Z",
                     until=DAY.isoformat() + "Z")
    assert "BT_MIDNIGHT" not in before["actor_ids"]


def test_an_offset_is_honoured_rather_than_read_as_utc(trail):
    """
    The trail is stored naive-UTC, so a bound carrying an offset has to be
    converted before it is compared. Read as if it were already UTC, every figure
    would shift by the caller's offset — enough to file an evening's swipes under
    the wrong day.

    05:30 at +05:30 is midnight UTC, so this must select exactly what the `Z`
    form selects.
    """
    with_offset = summary(
        trail["sa"],
        since="2026-06-10T05:30:00+05:30",
        until="2026-06-11T05:30:00+05:30",
    )
    as_utc = summary(
        trail["sa"], since=DAY.isoformat() + "Z",
        until=(DAY + timedelta(days=1)).isoformat() + "Z",
    )
    assert with_offset["total"] == as_utc["total"]


def test_a_malformed_bound_is_refused_rather_than_ignored(trail):
    """
    Silently dropping an unparseable bound would return the whole trail under a
    label claiming it was one day's worth.
    """
    resp = client.get(
        "/audit-logs/summary", params={"since": "last tuesday"}, headers=trail["sa"]
    )
    assert resp.status_code == 422
    assert "since" in resp.json()["detail"]


# ── meals ─────────────────────────────────────────────────────────────────────

def test_meals_are_counted_per_diner_not_per_scan(trail):
    """
    A card read three times feeds one person once.

    `MESS_SCAN` writes a row per read, so the board's old row count inflated the
    headline at exactly the busy counters where re-scans happen.
    """
    system_logs_collection.delete_many({})
    system_logs_collection.insert_many([
        {"timestamp": DAY + timedelta(hours=8, seconds=s), "actor_id": "BT_A",
         "action": "MESS_SCAN", "target_id": MESS_ID,
         "details": {"participant_id": "P1", "slot": "breakfast", "day": 1}}
        for s in range(3)
    ])

    meals = summary(trail["sa"])["meals"]
    assert meals["scans"] == 3
    assert meals["meals_served"] == 1
    assert meals["duplicate_scans"] == 2
    assert meals["unique_diners"] == 1
    assert meals["by_slot"] == {"breakfast": 1, "lunch": 0, "dinner": 0}


def test_one_diner_across_several_sittings_is_several_meals(trail):
    system_logs_collection.delete_many({})
    system_logs_collection.insert_many([
        {"timestamp": DAY + timedelta(hours=8), "actor_id": "BT_A", "action": "MESS_SCAN",
         "target_id": MESS_ID,
         "details": {"participant_id": "P1", "slot": "breakfast", "day": 1}},
        {"timestamp": DAY + timedelta(hours=13), "actor_id": "BT_A", "action": "MESS_SCAN",
         "target_id": MESS_ID,
         "details": {"participant_id": "P1", "slot": "lunch", "day": 1}},
        {"timestamp": DAY + timedelta(hours=8), "actor_id": "BT_A", "action": "MESS_SCAN",
         "target_id": MESS_ID,
         "details": {"participant_id": "P1", "slot": "breakfast", "day": 2}},
    ])

    meals = summary(trail["sa"])["meals"]
    assert meals["meals_served"] == 3
    assert meals["unique_diners"] == 1
    assert meals["duplicate_scans"] == 0
    assert meals["by_day"] == {"1": 2, "2": 1}


def test_an_unfilable_scan_still_counts_as_a_meal(trail):
    """
    A swipe with no recognisable day or slot still fed somebody.

    The client used to drop these, which made the headline smaller than the trail
    it came from with nothing on screen to explain the gap. They are counted and
    reported separately instead.
    """
    system_logs_collection.delete_many({})
    system_logs_collection.insert_many([
        {"timestamp": DAY + timedelta(hours=8), "actor_id": "BT_A", "action": "MESS_SCAN",
         "target_id": MESS_ID, "details": {"participant_id": "P1", "slot": "brunch", "day": 1}},
        {"timestamp": DAY + timedelta(hours=9), "actor_id": "BT_A", "action": "MESS_SCAN",
         "target_id": MESS_ID, "details": {"participant_id": "P2", "slot": "lunch"}},
        {"timestamp": DAY + timedelta(hours=10), "actor_id": "BT_A", "action": "MESS_SCAN",
         "target_id": MESS_ID, "details": {"participant_id": "P3", "slot": "dinner", "day": 2}},
    ])

    meals = summary(trail["sa"])["meals"]
    assert meals["meals_served"] == 3
    assert meals["unclassified"] == 2
    assert meals["unique_diners"] == 3
    # Only the filable one reaches the grid.
    assert meals["by_slot"] == {"breakfast": 0, "lunch": 0, "dinner": 1}
    assert meals["by_day"] == {"2": 1}


def test_meals_are_absent_when_the_filter_cannot_contain_them(trail):
    """A caller asking about hostel entries must not be handed a meal count."""
    assert summary(trail["sa"], action="HOSTEL_ENTRY")["meals"] is None
    assert summary(trail["sa"], action="MESS_SCAN")["meals"] is not None
    assert summary(trail["sa"])["meals"] is not None


def test_meals_respect_the_window(trail):
    """The meal block is filtered by the same bounds as everything beside it."""
    today = summary(trail["sa"], since=DAY.isoformat() + "Z",
                    until=(DAY + timedelta(days=1)).isoformat() + "Z")
    assert today["meals"]["scans"] == SCAN_ROWS + 2

    yesterday = summary(trail["sa"], since=(DAY - timedelta(days=1)).isoformat() + "Z",
                        until=DAY.isoformat() + "Z")
    assert yesterday["meals"]["scans"] == 0
    assert yesterday["meals"]["meals_served"] == 0


# ── access ────────────────────────────────────────────────────────────────────

def test_only_super_admins_may_read_the_summary(trail):
    """
    Same gate as the trail itself. Counts are less revealing than rows, but
    `actor_ids` names people, and the totals describe the whole fest.
    """
    resp = client.get("/audit-logs/summary", headers=trail["head"])
    assert resp.status_code == 403


def test_the_summary_requires_authentication(trail):
    assert client.get("/audit-logs/summary").status_code in (401, 403)
