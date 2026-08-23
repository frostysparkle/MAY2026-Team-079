"""
The scheduling and rooming data the frontend catalogues do not carry.

``frontend/src/data/*.json`` holds the fest's *content* — event names,
descriptions, posters, prize money, workshop blurbs, hostel blocks, mess halls
— but none of the fields the current backend requires to accept that content:

* ``events``  need ``registration.start_time`` / ``end_time`` and a real
  ``start_time`` / ``end_time`` on every schedule round. The dataset carries
  those dates only as prose inside ``registration.meta`` and
  ``registration.round_when`` ("Reg. End: 31 May", "12 Jun, 08:00 am"), which
  no schema reads.
* ``workshops`` need ``registration_start`` / ``registration_end``, and a
  ``slot_id`` matching ``^D\\d+S\\d+$``. The dataset's slot ids are dates
  ("2026-06-12-afternoon").
* ``hostels`` need ``sharing`` and ``num_rooms``. The dataset has neither.
* ``mess`` halls need one closed ``type``. The dataset still has the retired
  ``preference`` + ``cuisines`` pair.

Everything here is derived from ``utcnow()`` at import, not from a fixed 2026
calendar
=========================================================================

This is the point of the module. A hardcoded June 2026 fest is in the past for
most of the year, and a seeded database whose registration windows have all
closed is useless for testing: ``GET /events`` reports
``registration.is_open: false`` for every event, ``POST /events/{id}/register``
answers 400, ``_sync_registration_state`` auto-closes every workshop the first
time it is listed, and no mess or workshop scan can ever fall inside its
window.

So the fest is anchored to *today*:

* Fest day 1 is today (UTC); the fest runs ``FEST_DAYS`` days.
* Every registration window opened ``REGISTRATION_OPEN_DAYS_AGO`` days ago and
  closes ``REGISTRATION_CLOSE_DAYS_AHEAD`` days from now, so every event and
  workshop is genuinely open right now.
* One mess sitting (``day_1`` lunch) and one workshop slot (``LIVE_SLOT_ID``)
  straddle *this minute*, so the ±15-minute mess scan window and the
  workshop scan window are both open without waiting or patching a clock.

Each seed script computes this independently at its own import, so a run order
spread over several minutes stays coherent — the windows are days wide.

Nothing here reads the database or the network, and it imports only ``models``,
so it is safe to use from a ``--dry-run`` with no Mongo and no server running.
"""

from __future__ import annotations

import math
import zlib
from datetime import date, datetime, timedelta
from typing import Iterable, Sequence

from models import MESS_PREFERENCE_TYPES, SLOT_ID_PATTERN, parse_instant_utc

# =============================================================================
# Anchor
# =============================================================================

#: The instant every window below is measured from. Truncated to the second so a
#: seeded timestamp reads cleanly and round-trips through ISO 8601 unchanged.
NOW: datetime = datetime.utcnow().replace(microsecond=0)

#: Fest day 1 == today (UTC). `fest_day(n)` turns a 1-based day number into a date.
FEST_DAY_1: date = NOW.date()

#: How many days the fest runs. Four, matching the span the workshop dataset
#: covers (10–13 June in its own calendar).
FEST_DAYS: int = 4

# How wide every registration window is, either side of now. Deliberately far
# wider than any test session: the point is that nothing closes underneath a
# tester mid-run, and that `_sync_registration_state` never auto-closes a
# seeded workshop.
REGISTRATION_OPEN_DAYS_AGO: int = 10
REGISTRATION_CLOSE_DAYS_AHEAD: int = 10


def fest_day(day_number: int) -> date:
    """Fest day ``n`` (1-based) as a date. Day 1 is today."""
    return FEST_DAY_1 + timedelta(days=day_number - 1)


def at(day_number: int, hour: int, minute: int = 0) -> datetime:
    """A naive-UTC instant at ``hour:minute`` on fest day ``day_number``."""
    day = fest_day(day_number)
    return datetime(day.year, day.month, day.day, hour, minute)


def iso(moment: datetime) -> str:
    """
    ``datetime`` -> the ISO 8601 form every string timestamp field in the
    backend stores, with the explicit ``Z`` that ``parse_instant_utc`` accepts.

    All these instants are already naive UTC, so the suffix is a statement of
    which zone they are in rather than a conversion.
    """
    return moment.replace(microsecond=0).isoformat() + "Z"


# =============================================================================
# Registration windows — open right now, for events and workshops alike
# =============================================================================

REGISTRATION_OPENS: datetime = NOW - timedelta(days=REGISTRATION_OPEN_DAYS_AGO)
REGISTRATION_CLOSES: datetime = NOW + timedelta(days=REGISTRATION_CLOSE_DAYS_AHEAD)


def event_registration_window(allowed: bool = True) -> dict:
    """
    The ``registration`` object for ``EventCreateRequest``.

    ``allowed`` is the Super Admin kill-switch, and the effective state a
    response reports is ``allowed AND now in [start_time, end_time]``
    (``events._registration_open``). Both are true by default here, so a
    seeded event reads as open.
    """
    return {
        "start_time": iso(REGISTRATION_OPENS),
        "end_time": iso(REGISTRATION_CLOSES),
        "allowed": allowed,
    }


def workshop_registration_window() -> dict:
    """
    The ``registration_start`` / ``registration_end`` / ``registration_open``
    trio for ``WorkshopCreateRequest``.

    Unlike an event's, a workshop's open state is *stored*, and
    ``workshops._sync_registration_state`` flips it to False the first time the
    workshop is read after ``registration_end`` has passed. An end date in the
    future is what stops a freshly seeded workshop closing itself the moment
    something lists it.
    """
    return {
        "registration_start": iso(REGISTRATION_OPENS),
        "registration_end": iso(REGISTRATION_CLOSES),
        "registration_open": True,
    }


# =============================================================================
# Event schedule rounds
# =============================================================================
#
# The dataset gives each event a `schedule` array with names, descriptions and
# venues, but `start_time` and `end_time` are empty strings — and `ScheduleRound`
# requires both to be parseable with `end > start`. Rather than a hand-written
# table of 53 event names, round times are *derived* deterministically:
#
#   round i of an event starts at NOW + FIRST_ROUND_LEAD + i * ROUND_SPACING,
#   nudged by a per-event offset taken from a CRC of the event's name.
#
# Deterministic and reproducible (CRC-32, not `hash()`, which is salted per
# process for strings), monotonic within an event, and spread across the fest as
# the round count grows. The per-event nudge is what stops all 53 events
# starting on the same minute.
#
# `EVENT_ROUND_OVERRIDES` is the escape hatch for an event whose real times
# matter to a demo: name -> list of (start, end) datetimes, used positionally.

#: How soon after "now" the first round of any event runs.
FIRST_ROUND_LEAD = timedelta(hours=2)
#: The gap between consecutive rounds of the same event.
ROUND_SPACING = timedelta(hours=18)
#: How long a round lasts.
ROUND_DURATION = timedelta(hours=2)
#: The widest per-event nudge applied to the whole schedule.
ROUND_JITTER_MINUTES = 90

EVENT_ROUND_OVERRIDES: dict[str, Sequence[tuple[datetime, datetime]]] = {}


def _name_offset(name: str, span_minutes: int) -> timedelta:
    """
    A stable per-name offset in ``[0, span_minutes)``.

    CRC-32 rather than ``hash()``: string hashing is salted per interpreter
    run, so ``hash()`` would give one event different round times on every
    invocation and make two seed runs disagree.
    """
    if span_minutes <= 0:
        return timedelta()
    digest = zlib.crc32(name.encode("utf-8"))
    return timedelta(minutes=digest % span_minutes)


def event_round_times(event_name: str, round_count: int) -> list[tuple[datetime, datetime]]:
    """
    ``round_count`` ``(start, end)`` pairs for one event, in order.

    Always returns exactly ``round_count`` pairs so a caller can zip them
    straight onto the dataset's ``schedule`` array.
    """
    if round_count <= 0:
        return []

    override = EVENT_ROUND_OVERRIDES.get(event_name)
    if override and len(override) >= round_count:
        return [(start, end) for start, end in list(override)[:round_count]]

    nudge = _name_offset(event_name, ROUND_JITTER_MINUTES)
    rounds: list[tuple[datetime, datetime]] = []
    for index in range(round_count):
        start = NOW + FIRST_ROUND_LEAD + nudge + index * ROUND_SPACING
        rounds.append((start.replace(microsecond=0), (start + ROUND_DURATION).replace(microsecond=0)))
    return rounds


# =============================================================================
# Workshop slots
# =============================================================================
#
# A slot id is a closed pattern (`D<day>S<shift>`) the workshop-registration
# slot-clash check relies on. The dataset's ids are dates plus a shift word, so
# they are mapped positionally: day index from the date's distance from the
# dataset's own first fest day, shift 1 = morning, shift 2 = afternoon.
#
# Only the seven slots the dataset actually uses are seeded — there is no
# `2026-06-10-morning` workshop, so no `D1S1`. Seeding a slot no workshop
# references would just be a row nothing reads.

#: The dataset's own fest calendar, used only to derive a day *index*. Nothing
#: from this date survives into the database; `SLOT_TIMES` re-anchors every slot
#: onto the current fest days below.
_DATASET_FEST_DAY_1 = date(2026, 6, 10)

_SHIFT_NUMBERS = {"morning": 1, "afternoon": 2, "evening": 3}

#: Legacy dataset slot id -> current `D<day>S<shift>` id.
LEGACY_SLOT_IDS: dict[str, str] = {
    "2026-06-10-afternoon": "D1S2",
    "2026-06-11-morning": "D2S1",
    "2026-06-11-afternoon": "D2S2",
    "2026-06-12-morning": "D3S1",
    "2026-06-12-afternoon": "D3S2",
    "2026-06-13-morning": "D4S1",
    "2026-06-13-afternoon": "D4S2",
}

#: When each shift starts, and how long a slot runs.
SHIFT_START_HOUR = {1: 9, 2: 14, 3: 18}
SLOT_DURATION = timedelta(minutes=120)

#: The one slot deliberately placed across *this minute*, so a workshop in it can
#: be scanned immediately. `workshops._assert_scan_window` opens 30 minutes
#: before `start_time` for a pre-registered scan, 15 for an on-spot scan, and
#: closes 30 minutes after start — so a start a few minutes in the past leaves
#: all three operations open.
LIVE_SLOT_ID = "D1S2"
LIVE_SLOT_STARTED_MINUTES_AGO = 5


def legacy_slot_id(dataset_slot_id: str) -> str:
    """
    Map a dataset slot id onto the current pattern.

    Falls back to deriving the day/shift from the string itself, so a slot
    added to the dataset later still maps without an edit here.
    """
    mapped = LEGACY_SLOT_IDS.get(dataset_slot_id)
    if mapped:
        return mapped

    try:
        raw_date, shift_word = dataset_slot_id.rsplit("-", 1)
        parsed = date.fromisoformat(raw_date)
        day_number = (parsed - _DATASET_FEST_DAY_1).days + 1
        shift = _SHIFT_NUMBERS[shift_word.lower()]
    except (ValueError, KeyError) as exc:
        raise SystemExit(
            f"Cannot map workshop slot_id {dataset_slot_id!r} onto the "
            f"D<day>S<shift> pattern; add it to seed_calendar.LEGACY_SLOT_IDS"
        ) from exc
    if day_number < 1:
        raise SystemExit(f"slot_id {dataset_slot_id!r} predates the dataset's first fest day")
    return f"D{day_number}S{shift}"


def _slot_bounds(slot_id: str) -> tuple[datetime, datetime]:
    """``(start, end)`` for one ``D<day>S<shift>`` slot, anchored to today."""
    if slot_id == LIVE_SLOT_ID:
        start = NOW - timedelta(minutes=LIVE_SLOT_STARTED_MINUTES_AGO)
        return start, start + SLOT_DURATION

    day_number = int(slot_id[1:slot_id.index("S")])
    shift = int(slot_id[slot_id.index("S") + 1:])
    start = at(day_number, SHIFT_START_HOUR.get(shift, 9))
    return start, start + SLOT_DURATION


#: Every slot the workshop dataset needs, as `slot_id -> {start_time, end_time}`
#: ISO strings ready for `POST /workshop-slots`.
SLOT_TIMES: dict[str, dict[str, str]] = {
    slot_id: {"start_time": iso(start), "end_time": iso(end)}
    for slot_id, (start, end) in (
        (sid, _slot_bounds(sid)) for sid in sorted(set(LEGACY_SLOT_IDS.values()))
    )
}


# =============================================================================
# Hostel rooming
# =============================================================================
#
# `POST /hostels` needs `sharing` (occupants per room) and `num_rooms`, and
# validates `num_rooms * sharing >= capacity`. Allocation then treats
# `min(capacity, sharing * len(rooms))` as the real ceiling
# (`hostels.allocate_hostels`), so the two are kept equal here: every block has
# exactly enough beds for its stated capacity and not one more.
#
# Sharing is varied across the blocks rather than fixed, so an allocation demo
# shows two-, three- and four-bed rooms filling at different rates.

SHARING_CYCLE: tuple[int, ...] = (2, 3, 4)

#: Per-block overrides, by block name. Anything absent falls back to the cycle.
HOSTEL_SHARING_OVERRIDES: dict[str, int] = {}


def hostel_rooming(block_name: str, capacity: int, index: int = 0) -> dict:
    """
    ``{"sharing": n, "num_rooms": m}`` for one block.

    ``num_rooms`` is the ceiling of ``capacity / sharing``, which satisfies the
    create-request validator and — because any surplus bed would raise the
    allocator's ceiling above the stated capacity — is deliberately the
    smallest number that does.
    """
    sharing = HOSTEL_SHARING_OVERRIDES.get(block_name) or SHARING_CYCLE[index % len(SHARING_CYCLE)]
    return {"sharing": sharing, "num_rooms": math.ceil(capacity / sharing)}


def hostel_beds(rooming: dict, capacity: int) -> int:
    """The allocator's real ceiling for a block: ``min(capacity, sharing * rooms)``."""
    return min(capacity, rooming["sharing"] * rooming["num_rooms"])


# =============================================================================
# Mess halls
# =============================================================================
#
# The retired `preference` (veg | non_veg | jain) and `cuisines`
# (north_indian | south_indian list) pair collapsed into one closed `type` from
# `models.MESS_PREFERENCE_TYPES`. Allocation reads only the dietary half of it
# (`mess._diet_of`), so the three halls between them still cover all five
# preference values a participant's profile may hold.

#: Dataset `mess_id` -> current `type`.
MESS_TYPES: dict[str, str] = {
    "MS01": "north_indian__veg",
    "MS02": "south_indian__non_veg",
    "MS03": "jain",
}


def mess_type(mess_id: str, preference: str | None = None, cuisines: Iterable[str] | None = None) -> str:
    """
    The hall's ``type``.

    Uses the table above, falling back to combining the dataset's retired
    ``preference`` and first ``cuisines`` entry so a hall added later still
    maps without an edit here.
    """
    mapped = MESS_TYPES.get(mess_id)
    if mapped:
        return mapped

    diet = (preference or "").strip().lower()
    if diet == "jain":
        return "jain"
    cuisine_list = [c for c in (cuisines or []) if c]
    if not cuisine_list or not diet:
        raise SystemExit(
            f"Cannot derive a mess type for {mess_id!r}; add it to seed_calendar.MESS_TYPES"
        )
    derived = f"{cuisine_list[0]}__{diet}"
    if derived not in MESS_PREFERENCE_TYPES:
        raise SystemExit(
            f"Derived mess type {derived!r} for {mess_id!r} is not one of "
            f"{sorted(MESS_PREFERENCE_TYPES)}; add it to seed_calendar.MESS_TYPES"
        )
    return derived


# =============================================================================
# Mess menu
# =============================================================================
#
# A hall with no menu cannot be scanned at all: `scan_mess` refuses any slot
# absent from `menu`, and `GET /mess/my_mess` derives its whole display list
# from it. So the menu is part of seeding the hall, not an optional extra.
#
# Day 1 is deliberately arranged around *now* — a sitting that has finished, one
# that is running, and one still to come — so the ±15-minute scan window can be
# exercised in all three states without waiting.

MEAL_SLOTS: tuple[str, ...] = ("breakfast", "lunch", "dinner")

#: Normal sitting times for days 2 onward, as (hour, minute, duration_minutes).
STANDARD_SITTINGS: dict[str, tuple[int, int, int]] = {
    "breakfast": (7, 30, 120),
    "lunch": (12, 30, 120),
    "dinner": (19, 30, 120),
}

#: How long the live day-1 lunch sitting has been running, and how long it lasts.
LIVE_SITTING_STARTED_MINUTES_AGO = 15
LIVE_SITTING_DURATION_MINUTES = 60

MENU_TEXT: dict[str, str] = {
    "breakfast": "Idli, sambar, coconut chutney, boiled eggs, tea and coffee",
    "lunch": "Rice, dal tadka, mixed vegetable curry, curd, salad and payasam",
    "dinner": "Chapati, paneer butter masala, jeera rice, rasam and fruit",
}


def _day_one_sittings() -> dict[str, tuple[datetime, datetime]]:
    """Day 1: breakfast has finished, lunch is running now, dinner is still ahead."""
    live_start = NOW - timedelta(minutes=LIVE_SITTING_STARTED_MINUTES_AGO)
    return {
        # Closed well outside its ±15 minute window, so a scan against it is
        # refused — the negative case, seeded on purpose.
        "breakfast": (NOW - timedelta(hours=3), NOW - timedelta(hours=2)),
        # Open right now.
        "lunch": (live_start, live_start + timedelta(minutes=LIVE_SITTING_DURATION_MINUTES)),
        # Not yet open.
        "dinner": (NOW + timedelta(hours=5), NOW + timedelta(hours=7)),
    }


def mess_menu(days: int = FEST_DAYS) -> dict:
    """
    The ``menu`` payload for ``PUT /mess/{mess_id}/menu``.

    Keyed exactly as it is stored — ``day_1``, ``day_2``, ... each holding
    ``breakfast`` / ``lunch`` / ``dinner``. Times are ISO strings here because
    this goes over HTTP and ``MessMealSlot`` parses them into the real
    ``datetime`` objects the scan-window guard needs; a direct-to-Mongo writer
    must use ``mess_menu_datetimes()`` instead.
    """
    return {
        day_key: {
            slot: {"start_time": iso(start), "end_time": iso(end), "menu": MENU_TEXT[slot]}
            for slot, (start, end) in sittings.items()
        }
        for day_key, sittings in _menu_bounds(days).items()
    }


def mess_menu_datetimes(days: int = FEST_DAYS) -> dict:
    """
    The same menu with real ``datetime`` objects, for a writer that inserts
    into Mongo directly rather than going through the API.

    ``mess._assert_mess_scan_window`` silently disables itself for a sitting
    whose bounds are not datetimes, so an ISO string written straight to the
    collection would leave the hall scannable at any hour — see
    ``testing/factories.meal_slot``, which makes the same point.
    """
    return {
        day_key: {
            slot: {"start_time": start, "end_time": end, "menu": MENU_TEXT[slot]}
            for slot, (start, end) in sittings.items()
        }
        for day_key, sittings in _menu_bounds(days).items()
    }


def _menu_bounds(days: int) -> dict[str, dict[str, tuple[datetime, datetime]]]:
    menu: dict[str, dict[str, tuple[datetime, datetime]]] = {"day_1": _day_one_sittings()}
    for day_number in range(2, days + 1):
        sittings: dict[str, tuple[datetime, datetime]] = {}
        for slot, (hour, minute, duration) in STANDARD_SITTINGS.items():
            start = at(day_number, hour, minute)
            sittings[slot] = (start, start + timedelta(minutes=duration))
        menu[f"day_{day_number}"] = sittings
    return menu


def live_mess_sitting() -> tuple[str, str]:
    """
    The ``(day_key, slot)`` whose window is open right now.

    Returned rather than hardcoded at the call site so a seeded scan and the
    sitting it is filed against cannot drift apart.
    """
    return "day_1", "lunch"


# =============================================================================
# Self-validation
# =============================================================================


def validate() -> None:
    """
    Check every value this module hands out, at import.

    A bad timestamp here would otherwise surface as a 422 from whichever route
    a seed script happened to call first, several files away from the typo. The
    checks are the same ones the backend applies: every string instant parses
    through ``parse_instant_utc``, every window has ``end > start``, every slot
    id matches the stored pattern, every mess type is in the closed set, and
    every block's bed count equals its stated capacity.
    """
    import re

    def _window(label: str, start_text: str, end_text: str) -> None:
        start = parse_instant_utc(start_text, f"{label}.start_time")
        end = parse_instant_utc(end_text, f"{label}.end_time")
        if end <= start:
            raise SystemExit(f"seed_calendar: {label} end_time must be after start_time")

    registration = event_registration_window()
    _window("event registration", registration["start_time"], registration["end_time"])
    if not (
        parse_instant_utc(registration["start_time"], "start") <= NOW
        <= parse_instant_utc(registration["end_time"], "end")
    ):
        raise SystemExit("seed_calendar: the event registration window does not contain now")

    workshop_window = workshop_registration_window()
    _window(
        "workshop registration",
        workshop_window["registration_start"],
        workshop_window["registration_end"],
    )

    slot_pattern = re.compile(SLOT_ID_PATTERN)
    for slot_id, bounds in SLOT_TIMES.items():
        if not slot_pattern.match(slot_id):
            raise SystemExit(f"seed_calendar: slot id {slot_id!r} does not match {SLOT_ID_PATTERN}")
        _window(f"slot {slot_id}", bounds["start_time"], bounds["end_time"])

    if LIVE_SLOT_ID not in SLOT_TIMES:
        raise SystemExit(f"seed_calendar: LIVE_SLOT_ID {LIVE_SLOT_ID!r} is not among the seeded slots")

    for legacy, mapped in LEGACY_SLOT_IDS.items():
        if mapped not in SLOT_TIMES:
            raise SystemExit(f"seed_calendar: {legacy!r} maps to {mapped!r}, which has no times")

    # Rounds must be parseable and ordered for the widest schedule the dataset has.
    for start, end in event_round_times("validation probe", 6):
        _window("event round", iso(start), iso(end))

    for mess_id, hall_type in MESS_TYPES.items():
        if hall_type not in MESS_PREFERENCE_TYPES:
            raise SystemExit(
                f"seed_calendar: mess type {hall_type!r} for {mess_id!r} is not one of "
                f"{sorted(MESS_PREFERENCE_TYPES)}"
            )

    for index, capacity in enumerate((300, 300, 300)):
        rooming = hostel_rooming(f"probe {index}", capacity, index)
        if rooming["num_rooms"] * rooming["sharing"] < capacity:
            raise SystemExit("seed_calendar: hostel rooming does not cover capacity")
        if hostel_beds(rooming, capacity) != capacity:
            raise SystemExit("seed_calendar: hostel bed count disagrees with capacity")

    day_key, slot = live_mess_sitting()
    sitting = _menu_bounds(FEST_DAYS)[day_key][slot]
    if not (sitting[0] <= NOW <= sitting[1]):
        raise SystemExit("seed_calendar: the live mess sitting does not contain now")


validate()


# =============================================================================
# CLI
# =============================================================================


def describe() -> str:
    """A human-readable dump of every table, for ``--self-check``."""
    lines = [
        f"anchored at   {iso(NOW)} (utcnow)",
        f"fest days     {fest_day(1)} .. {fest_day(FEST_DAYS)}  ({FEST_DAYS} days)",
        "",
        "registration window (events and workshops)",
        f"  opens  {iso(REGISTRATION_OPENS)}  ({REGISTRATION_OPEN_DAYS_AGO} days ago)",
        f"  closes {iso(REGISTRATION_CLOSES)}  (in {REGISTRATION_CLOSE_DAYS_AHEAD} days)",
        "  -> every seeded event and workshop is open right now",
        "",
        f"workshop slots ({len(SLOT_TIMES)})",
    ]
    for slot_id in sorted(SLOT_TIMES):
        bounds = SLOT_TIMES[slot_id]
        marker = "  <- live, scannable now" if slot_id == LIVE_SLOT_ID else ""
        lines.append(f"  {slot_id}  {bounds['start_time']} .. {bounds['end_time']}{marker}")

    lines += ["", "legacy slot id mapping"]
    for legacy in sorted(LEGACY_SLOT_IDS):
        lines.append(f"  {legacy}  ->  {LEGACY_SLOT_IDS[legacy]}")

    lines += ["", "mess halls"]
    for mess_id in sorted(MESS_TYPES):
        lines.append(f"  {mess_id}  type={MESS_TYPES[mess_id]}")

    day_key, slot = live_mess_sitting()
    bounds = _menu_bounds(FEST_DAYS)[day_key][slot]
    lines += [
        "",
        f"mess menu     {FEST_DAYS} days x {len(MEAL_SLOTS)} sittings",
        f"  live sitting {day_key}/{slot}  {iso(bounds[0])} .. {iso(bounds[1])}  <- scannable now",
        "",
        "hostel rooming (sharing cycles across blocks; beds == capacity)",
    ]
    for index, sharing in enumerate(SHARING_CYCLE):
        rooming = hostel_rooming(f"example {index}", 300, index)
        lines.append(
            f"  sharing={rooming['sharing']}  num_rooms={rooming['num_rooms']}  "
            f"beds={hostel_beds(rooming, 300)}"
        )

    probe = event_round_times("Last1Standing", 5)
    lines += ["", "event rounds (derived, example: Last1Standing x5)"]
    for index, (start, end) in enumerate(probe, start=1):
        lines.append(f"  round {index}  {iso(start)} .. {iso(end)}")

    return "\n".join(lines)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Inspect and validate the seed calendar.")
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Validate only, without printing the tables",
    )
    args = parser.parse_args()

    # Validation already ran at import; calling it again costs nothing and makes
    # the intent of this entry point obvious.
    validate()
    if not args.quiet:
        print(describe())
    print("\nseed_calendar: all tables valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
