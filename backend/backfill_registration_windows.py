"""
Give every event a structured ``registration.start_time`` / ``end_time``.

``_registration_open`` (``routers/events.py``) is the only thing that decides
whether an event reads as open or closed, and it looks at exactly one place:
``registration.start_time`` and ``registration.end_time``. If either is
missing, the event reads as closed — unconditionally, regardless of what the
brochure page shows.

52 of this fest's 55 events were created with the display-only "Reg. Start" /
"Reg. End" tiles filled in (the ``meta`` list read by
``frontend/src/features/events/eventExtras.ts`` and shown as tiles beside the
poster) but no structured ``registration.start_time`` / ``end_time`` ever
written. That is why the Admin and Student dashboards show every one of them
as "Registration Closed" — not a bug in the fest-postponement date shift, a
gap in the original data that the shift simply left exactly as it found it.

This fills in the missing structured window from whichever source is
available, in order:

1. ``registration.meta``'s "Reg. Start" / "Reg. End" tiles — the display copy
   an organiser already wrote, parsed as day 00:00:00 through day 23:59:59
   (a whole-day window, since the tile carries no time of day).
2. If ``meta`` has no registration tiles: the event's own earliest and latest
   ``schedule[]`` round times, so registration is at least open through the
   event's own run.
3. If the schedule is also empty: ``meta``'s "Start Date" / "End Date" tiles
   (the event's own dates, not a separately published registration window —
   the closest thing to one that exists). This is the last resort for an
   event with no rounds and no dedicated registration tiles at all, e.g.
   ``deeptech-venture-building``, a single-session panel discussion.
4. If none of the above is available — no date anywhere on the event — it is
   skipped and reported, not guessed at.

Events that already carry a structured ``registration.start_time`` AND
``end_time`` are left untouched; this only fills a gap, never overwrites an
admin-set window.

Idempotent: re-running finds nothing left to do, since every event this
successfully touches now has both fields set and is excluded on the next
pass.

Usage::

    python backfill_registration_windows.py                # report only
    python backfill_registration_windows.py --confirm       # actually write

Connection details come from ``database.py``, so this uses the same Mongo
instance (and the same ``TESTING=1`` in-memory fallback) as the API.
"""

import argparse
import json
import re
from datetime import datetime, time

from database import event_collection

_MONTH_NUM = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11,
    "December": 12,
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "Jun": 6, "Jul": 7, "Aug": 8,
    "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}
_MONTH_ALT = "|".join(sorted(_MONTH_NUM, key=len, reverse=True))
# `"13 June"` / `"25 Aug"` — a bare day-and-month, exactly what the "Reg.
# Start" / "Reg. End" / "Start Date" / "End Date" tiles hold. No year in the
# text; every one of them is implicitly the single fest year below.
_DATE_ONLY_RE = re.compile(r"^(\d{1,2})\s+(" + _MONTH_ALT + r")$")

# The one year the display copy is implicitly in — matches the anchor used by
# `shift_event_dates.py`'s display-copy shift, so a date parsed here and a
# date shifted there agree on what year it lands in.
_DISPLAY_YEAR = 2026


def parse_display_date(value):
    """``"25 Aug"`` -> ``datetime(2026, 8, 25)``, or ``None`` if unparseable."""
    if not isinstance(value, str):
        return None
    match = _DATE_ONLY_RE.match(value.strip())
    if not match:
        return None
    day = int(match.group(1))
    month = _MONTH_NUM[match.group(2)]
    try:
        return datetime(_DISPLAY_YEAR, month, day)
    except ValueError:
        return None


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _read_meta(registration):
    """``registration.meta`` as ``{label: value}``, or ``{}`` on anything malformed."""
    raw = (registration or {}).get("meta")
    if not raw:
        return {}
    try:
        rows = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if not isinstance(rows, list):
        return {}
    return {
        row.get("label"): row.get("value")
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("value"), str)
    }


def _window_from_meta(meta, *, start_label, end_label):
    """``(start, end)`` datetimes from a pair of meta tiles, or ``None``."""
    start_text, end_text = meta.get(start_label), meta.get(end_label)
    if not start_text or not end_text:
        return None
    start = parse_display_date(start_text)
    end = parse_display_date(end_text)
    if not start or not end:
        return None
    return start, end


def _window_from_schedule(schedule):
    """``(start, end)`` spanning every parseable round time, or ``None`` for an empty schedule."""
    instants = []
    for round_doc in schedule or []:
        for key in ("start_time", "end_time"):
            raw = round_doc.get(key)
            if not raw:
                continue
            try:
                instants.append(datetime.fromisoformat(raw.rstrip("Zz")))
            except ValueError:
                continue
    if not instants:
        return None
    return min(instants), max(instants)


def derive_registration_window(event):
    """
    The ``(start, end)`` datetimes to backfill for one event, and which source
    supplied them (for the report). Returns ``(None, None, reason)`` when no
    source is usable at all.
    """
    registration = event.get("registration") or {}
    meta = _read_meta(registration)

    from_reg_meta = _window_from_meta(meta, start_label="Reg. Start", end_label="Reg. End")
    if from_reg_meta:
        start, end = from_reg_meta
        return start, end, "meta"

    from_schedule = _window_from_schedule(event.get("schedule"))
    if from_schedule:
        start, end = from_schedule
        return start, end, "schedule"

    from_event_dates = _window_from_meta(meta, start_label="Start Date", end_label="End Date")
    if from_event_dates:
        start, end = from_event_dates
        return start, end, "event dates"

    return None, None, "no Reg. Start/End, no schedule, and no Start/End Date in meta"


def backfill_registration_windows(
    events=event_collection,
    *,
    dry_run=True,
    log=print,
):
    """
    Fill in ``registration.start_time`` / ``end_time`` wherever both are
    missing, and return a tally. Never overwrites an event that already has
    both fields set.
    """
    tally = {
        "checked": 0,
        "already_set": 0,
        "filled_from_meta": 0,
        "filled_from_schedule": 0,
        "filled_from_event_dates": 0,
        "skipped_no_source": 0,
    }

    for event in events.find({}):
        tally["checked"] += 1
        event_id = event.get("event_id") or str(event["_id"])
        registration = event.get("registration") or {}

        if registration.get("start_time") and registration.get("end_time"):
            tally["already_set"] += 1
            continue

        start, end, source = derive_registration_window(event)
        if not start or not end:
            tally["skipped_no_source"] += 1
            log(f"  {event_id} ({event.get('name')}): SKIPPED — {source}")
            continue

        # A whole-day registration window: 00:00:00 on the start day through
        # 23:59:59 on the end day. The display tiles carry no time of day, so
        # there is no finer-grained value to derive one from.
        start_dt = datetime.combine(start.date(), time.min)
        end_dt = datetime.combine(end.date(), time(23, 59, 59))

        if source == "meta":
            tally["filled_from_meta"] += 1
        elif source == "schedule":
            tally["filled_from_schedule"] += 1
        else:
            tally["filled_from_event_dates"] += 1

        log(f"  {event_id} ({event.get('name')}): {_iso(start_dt)} -> {_iso(end_dt)}  [from {source}]")

        if not dry_run:
            new_registration = dict(registration)
            new_registration["start_time"] = _iso(start_dt)
            new_registration["end_time"] = _iso(end_dt)
            events.update_one(
                {"_id": event["_id"]},
                {
                    "$set": {
                        "registration": new_registration,
                        "updated_at": datetime.utcnow(),
                    }
                },
            )

    return tally


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually write the backfilled windows. Without this, the script only reports.",
    )
    args = parser.parse_args()

    print("Backfilling registration.start_time/end_time" + ("" if args.confirm else " [dry run]"))
    print()

    tally = backfill_registration_windows(dry_run=not args.confirm)

    print()
    print(f"Events checked           : {tally['checked']}")
    print(f"Already had a window     : {tally['already_set']}")
    print(f"Filled from meta         : {tally['filled_from_meta']}")
    print(f"Filled from schedule     : {tally['filled_from_schedule']}")
    print(f"Filled from event dates  : {tally['filled_from_event_dates']}")
    print(f"Skipped, no source found : {tally['skipped_no_source']}")

    filled = (
        tally["filled_from_meta"]
        + tally["filled_from_schedule"]
        + tally["filled_from_event_dates"]
    )
    if not args.confirm:
        print(f"\nNothing was written. Re-run with --confirm to fill {filled} event(s).")
    else:
        print("\nDone.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
