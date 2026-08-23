"""
Shift every event-related date forward by a fixed offset — the fest has been
postponed by 2 months and 25 days, and every date that used to describe when
something happens has to move with it, or the schedule contradicts itself.

What this touches, and why each one is in scope:

  Structured (behaviour-driving) fields, in ``event`` and ``workshops``:
  * ``event.registration.start_time`` / ``end_time`` — the registration window
    ``_registration_open`` actually enforces (``routers/events.py``).
  * ``event.schedule[].start_time`` / ``end_time`` — each round's own window.
  * ``workshops.start_time`` — drives the attendance scan-window guard
    (``routers/workshops.py``). Left untouched where it is already ``None``:
    that means "no window guard", not "no date", and shifting a null is a
    no-op anyway.

  Display copy that duplicates those same dates in prose, in
  ``event.registration`` (see ``frontend/src/features/events/eventExtras.ts``
  for how the app reads these back):
  * ``meta`` — the "Start Date / End Date / Reg. Start / Reg. End" tiles shown
    beside the poster, e.g. ``{"label":"Start Date","value":"2 June"}``.
  * ``round_when`` — the human-written per-round time strings shown in the
    timeline, e.g. ``"10 Jun, 03:30 pm"``, positionally aligned with
    ``schedule``.
  * ``faqs`` — a small number of events spell out a date inside an FAQ answer
    (e.g. "Day 1 (11 Jun) & Day 2 (12 Jun): ..."). The structured fields are
    authoritative for logic, but a stale date left in the FAQ text would keep
    telling every reader the wrong day, so it is corrected too.

  * ``event.description`` — a handful of events fold their date straight into
    the description prose (e.g. "... (11 Jun, 10:00 AM-1:00 PM, Venue: TTJ.)")
    instead of, or in addition to, the ``registration``/``schedule`` fields.
    Checked separately from the rest because it sits outside ``registration``
    entirely; see ``shift_event_descriptions`` below.

  Explicitly left alone:
  * ``registration.allowed_items`` / ``entry_rules`` / ``id_proof`` /
    ``reporting_time`` / ``capacity`` / ``rulebook`` / ``prize_amounts`` — none
    of these carry a date in the live data (checked against every event before
    writing this script); ``reporting_time`` is relative copy ("10 minutes
    before event start"), not a fixed date.
  * ``event.logs[].time`` / ``workshop_logs`` / audit trails / ``created_at`` /
    ``updated_at`` — these are historical records of when something actually
    happened (a participant registering, a scan, a document write). They are
    not "the event's dates"; shifting them would rewrite history rather than
    reschedule the fest.
  * ``workshops.slot_id`` (e.g. ``"2026-06-12-afternoon"``) is intentionally
    NOT rewritten by this script even though it encodes a date: it is a
    stable identifier participants have already booked against
    (``participants.workshops[].slot_id``), matched by exact string equality
    for clash detection (see ``routers/workshops.py``). Renaming it here would
    silently break every existing booking's slot match without also rewriting
    every participant document, which is a separate, much riskier migration.
    Run ``shift_workshop_slot_ids.py`` (a deliberately separate script) if the
    slot ids themselves also need to move — see its module docstring for the
    trade-off.

Dates are shifted with ``dateutil.relativedelta(months=2, days=25)``, not a
fixed ``timedelta``, so "2 months" means calendar months (28-31 days
depending on where it lands) rather than a fixed day count.

Idempotency: **not guaranteed** across re-runs, unlike the other scripts in
this file's family. A date shift has no marker distinguishing "already
shifted" from "always was this date", so running it twice shifts twice. This
is deliberate — a support script for a one-time schedule change, not a
repeatable backfill — which is also why the default is a dry run.

Usage::

    python shift_event_dates.py                # report only
    python shift_event_dates.py --confirm       # actually write

Connection details come from ``database.py``, so this uses the same Mongo
instance (and the same ``TESTING=1`` in-memory fallback) as the API.
"""

import argparse
import json
import re
from datetime import datetime

from dateutil.relativedelta import relativedelta

from database import event_collection, workshops_collection

# The fest's postponement, exactly as stated: 2 months and 25 days forward.
OFFSET = relativedelta(months=2, days=25)

# --------------------------------------------------------------------------
# Structured ISO 8601 datetime strings (registration/schedule/workshop start).
# --------------------------------------------------------------------------


def shift_iso_string(value, offset=OFFSET):
    """
    Shift an ISO 8601 datetime string by ``offset``, preserving its exact
    formatting (trailing ``Z``, seconds, microseconds, or their absence) —
    the stored format varies across documents, and rewriting it uniformly
    would touch fields no one meant to change.

    Blank or unparseable values pass through unchanged rather than raising:
    a handful of rounds store ``end_time: ""`` (a known display-only gap; see
    ``ScheduleRound`` in ``models.py`` — the API validator would reject this on
    write, but it already exists on live data), and a script that crashes on
    them would block the whole migration for events with a valid start_time.
    """
    if not value:
        return value
    text = value.strip()
    if not text:
        return value

    has_z = text.endswith(("Z", "z"))
    core = text[:-1] if has_z else text

    try:
        dt = datetime.fromisoformat(core)
    except ValueError:
        return value

    shifted = dt + offset

    if "." in core:
        out = shifted.strftime("%Y-%m-%dT%H:%M:%S.%f")
    elif re.search(r"T\d{2}:\d{2}:\d{2}", core):
        out = shifted.strftime("%Y-%m-%dT%H:%M:%S")
    else:
        out = shifted.strftime("%Y-%m-%dT%H:%M")

    return out + "Z" if has_z else out


# --------------------------------------------------------------------------
# Display copy: "2 June", "17 May", "10 Jun, 03:30 pm", and the same inside
# FAQ prose. Matched case-sensitively so the month name "May" is never
# confused with the everyday word "may" ("participants may bring a bag").
# --------------------------------------------------------------------------

_MONTH_NUM = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11,
    "December": 12,
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "Jun": 6, "Jul": 7, "Aug": 8,
    "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}
_MONTH_ABBR = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun", 7: "Jul",
    8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}
_MONTH_FULL = {
    1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June",
    7: "July", 8: "August", 9: "September", 10: "October", 11: "November",
    12: "December",
}
# Longest names first so "June" is not cut short as "Jun" + trailing "e".
_MONTH_ALT = "|".join(sorted(_MONTH_NUM, key=len, reverse=True))

# `"13 June"` or `"10 Jun, 03:30 pm"`. The year is never written in this
# display copy — every date on the live catalogue is in the single fest year
# below, which is what anchors the shift.
_DATE_TOKEN_RE = re.compile(
    r"\b(\d{1,2})\s+(" + _MONTH_ALT + r")\b"
    r"(\s*,\s*(\d{1,2}):(\d{2})\s*([ap]m))?"
)

# The one year every display date in the live catalogue is implicitly in.
# Needed because "13 June" carries no year of its own; without an anchor the
# shift cannot know whether it lands in the same year or crosses into the next.
_DISPLAY_YEAR = 2026


def _shift_date_token(match, offset):
    day = int(match.group(1))
    month_name = match.group(2)
    month_num = _MONTH_NUM[month_name]
    is_full_name = len(month_name) > 3
    has_time = match.group(3) is not None

    if has_time:
        hour = int(match.group(4)) % 12
        minute = int(match.group(5))
        if match.group(6) == "pm":
            hour += 12
    else:
        hour = minute = 0

    shifted = datetime(_DISPLAY_YEAR, month_num, day, hour, minute) + offset

    month_str = _MONTH_FULL[shifted.month] if is_full_name else _MONTH_ABBR[shifted.month]
    out = f"{shifted.day} {month_str}"
    if has_time:
        out_hour = shifted.hour % 12 or 12
        out_ampm = "am" if shifted.hour < 12 else "pm"
        out += f", {out_hour:02d}:{shifted.minute:02d} {out_ampm}"
    return out


def shift_display_dates(text, offset=OFFSET):
    """Rewrite every ``"13 June"`` / ``"10 Jun, 03:30 pm"`` token in free text."""
    if not text:
        return text
    return _DATE_TOKEN_RE.sub(lambda m: _shift_date_token(m, offset), text)


# --------------------------------------------------------------------------
# event.registration — structured fields plus the display overlay it carries
# (see eventExtras.ts for the key names this mirrors).
# --------------------------------------------------------------------------

_META_DATE_LABELS = {"Start Date", "End Date", "Reg. Start", "Reg. End"}


def _shift_registration(registration, offset=OFFSET):
    """Return a new ``registration`` dict with every date-bearing key shifted."""
    reg = dict(registration or {})
    changed = False

    for key in ("start_time", "end_time"):
        if reg.get(key):
            new_value = shift_iso_string(reg[key], offset)
            if new_value != reg[key]:
                reg[key] = new_value
                changed = True

    meta_raw = reg.get("meta")
    if meta_raw:
        try:
            meta = json.loads(meta_raw)
        except (TypeError, ValueError):
            meta = None
        if isinstance(meta, list):
            new_meta = []
            meta_changed = False
            for row in meta:
                if (
                    isinstance(row, dict)
                    and row.get("label") in _META_DATE_LABELS
                    and isinstance(row.get("value"), str)
                ):
                    new_value = shift_display_dates(row["value"], offset)
                    if new_value != row["value"]:
                        meta_changed = True
                    new_meta.append({**row, "value": new_value})
                else:
                    new_meta.append(row)
            if meta_changed:
                reg["meta"] = json.dumps(new_meta)
                changed = True

    round_when_raw = reg.get("round_when")
    if round_when_raw:
        try:
            round_when = json.loads(round_when_raw)
        except (TypeError, ValueError):
            round_when = None
        if isinstance(round_when, list):
            new_round_when = [
                shift_display_dates(v, offset) if isinstance(v, str) else v
                for v in round_when
            ]
            if new_round_when != round_when:
                reg["round_when"] = json.dumps(new_round_when)
                changed = True

    faqs_raw = reg.get("faqs")
    if faqs_raw:
        try:
            faqs = json.loads(faqs_raw)
        except (TypeError, ValueError):
            faqs = None
        if isinstance(faqs, list):
            new_faqs = []
            faqs_changed = False
            for row in faqs:
                if isinstance(row, dict) and isinstance(row.get("a"), str):
                    new_answer = shift_display_dates(row["a"], offset)
                    if new_answer != row["a"]:
                        faqs_changed = True
                    new_faqs.append({**row, "a": new_answer})
                else:
                    new_faqs.append(row)
            if faqs_changed:
                reg["faqs"] = json.dumps(new_faqs)
                changed = True

    return reg, changed


def _shift_schedule(schedule, offset=OFFSET):
    """Return a new ``schedule`` list with every round's start/end shifted."""
    new_schedule = []
    changed = False
    for round_doc in schedule or []:
        new_round = dict(round_doc)
        for key in ("start_time", "end_time"):
            if new_round.get(key):
                new_value = shift_iso_string(new_round[key], offset)
                if new_value != new_round[key]:
                    new_round[key] = new_value
                    changed = True
        new_schedule.append(new_round)
    return new_schedule, changed


def shift_event_dates(
    events=event_collection,
    *,
    offset=OFFSET,
    dry_run=True,
    log=print,
):
    """
    Shift every date-bearing field on every event in ``events`` and return a
    tally. Updates all events regardless of category (technical, culturals,
    sports, others) and regardless of whether registration is currently open —
    every event is in scope, not only the active ones.
    """
    tally = {"events_checked": 0, "events_changed": 0, "fields_changed": 0}

    for event in events.find({}):
        tally["events_checked"] += 1
        event_id = event.get("event_id") or str(event.get("_id"))

        new_registration, reg_changed = _shift_registration(event.get("registration"), offset)
        new_schedule, sched_changed = _shift_schedule(event.get("schedule"), offset)

        if not (reg_changed or sched_changed):
            continue

        tally["events_changed"] += 1
        tally["fields_changed"] += int(reg_changed) + int(sched_changed)
        log(
            f"  {event_id} ({event.get('event_type')}): "
            + ", ".join(
                part
                for part in (
                    "registration" if reg_changed else None,
                    "schedule" if sched_changed else None,
                )
                if part
            )
        )

        if not dry_run:
            events.update_one(
                {"_id": event["_id"]},
                {
                    "$set": {
                        "registration": new_registration,
                        "schedule": new_schedule,
                        "updated_at": datetime.utcnow(),
                    }
                },
            )

    return tally


def shift_workshop_dates(
    workshops=workshops_collection,
    *,
    offset=OFFSET,
    dry_run=True,
    log=print,
):
    """
    Shift ``start_time`` on every workshop that has one and return a tally.
    Workshops with ``start_time: None`` are skipped — there is no date to
    shift, and the field's absence already means "no scan-window guard", which
    stays true regardless of the postponement.
    """
    tally = {"workshops_checked": 0, "workshops_changed": 0}

    for workshop in workshops.find({}):
        tally["workshops_checked"] += 1
        start_time = workshop.get("start_time")
        if not start_time:
            continue

        new_start_time = shift_iso_string(start_time, offset)
        if new_start_time == start_time:
            continue

        tally["workshops_changed"] += 1
        workshop_id = workshop.get("workshop_id") or str(workshop["_id"])
        log(f"  {workshop_id}: {start_time} -> {new_start_time}")

        if not dry_run:
            workshops.update_one(
                {"_id": workshop["_id"]},
                {"$set": {"start_time": new_start_time, "updated_at": datetime.utcnow()}},
            )

    return tally


def shift_event_descriptions(
    events=event_collection,
    *,
    offset=OFFSET,
    dry_run=True,
    log=print,
):
    """
    Rewrite any date written directly into ``event.description`` prose (rare —
    most events keep their dates in ``registration``/``schedule`` — but at
    least one folds it into a sentence like "... (11 Jun, 10:00 AM-1:00 PM,
    Venue: TTJ.)"). Kept as its own pass rather than folded into
    ``shift_event_dates`` since it touches a top-level field, not
    ``registration``, and most events have nothing to change here.
    """
    tally = {"events_checked": 0, "events_changed": 0}

    for event in events.find({}):
        tally["events_checked"] += 1
        description = event.get("description")
        if not description:
            continue

        new_description = shift_display_dates(description, offset)
        if new_description == description:
            continue

        tally["events_changed"] += 1
        event_id = event.get("event_id") or str(event.get("_id"))
        log(f"  {event_id}: {description!r} -> {new_description!r}")

        if not dry_run:
            events.update_one(
                {"_id": event["_id"]},
                {"$set": {"description": new_description, "updated_at": datetime.utcnow()}},
            )

    return tally


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually write the shifted dates. Without this, the script only reports.",
    )
    args = parser.parse_args()

    print(
        f"Shifting every event/workshop date forward by {OFFSET.months} month(s) and "
        f"{OFFSET.days} day(s)" + ("" if args.confirm else " [dry run]")
    )

    print("\nEvents:")
    event_tally = shift_event_dates(dry_run=not args.confirm)

    print("\nWorkshops:")
    workshop_tally = shift_workshop_dates(dry_run=not args.confirm)

    print("\nEvent descriptions:")
    description_tally = shift_event_descriptions(dry_run=not args.confirm)

    print()
    print(f"Events checked      : {event_tally['events_checked']}")
    print(f"Events changed      : {event_tally['events_changed']}")
    print(f"Workshops checked   : {workshop_tally['workshops_checked']}")
    print(f"Workshops changed   : {workshop_tally['workshops_changed']}")
    print(f"Descriptions checked: {description_tally['events_checked']}")
    print(f"Descriptions changed: {description_tally['events_changed']}")

    if not args.confirm:
        print(
            "\nNothing was written. Re-run with --confirm to apply the shift to "
            f"{event_tally['events_changed']} event(s), "
            f"{workshop_tally['workshops_changed']} workshop(s), and "
            f"{description_tally['events_changed']} description(s)."
        )
    else:
        print("\nDone.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
