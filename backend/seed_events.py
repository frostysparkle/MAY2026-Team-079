"""
Publish the Paradox event catalogue through the Super Admin events API.

Every event is sent to ``POST /events`` with exactly the payload the dashboard's
"+ New Event" form sends — same endpoint, same schema, same Super Admin
permission check — so the events created here are indistinguishable from ones
typed in by hand, and remain fully editable in the dashboard afterwards.

The catalogue lives in ``frontend/src/data/paradoxEvents.json``. That one
dataset is also what the frontend's mock API seeds, so the mock and the real
database hold the same programme.

Translating the dataset onto the current schema
==============================================

The dataset is still written for the pre-restructure event shape, and is not
modified here — it is frontend content. Three things are translated on the way
out, which is what the "schema migration in progress" note on this file used to
be waiting for:

``team.house`` -> ``team.house_vs_house_event``
    A rename only; the value is carried across unchanged.

``registration``
    The dataset's ``registration`` object holds ``rulebook``, ``faqs``,
    ``meta``, ``prize_amounts`` and ``round_when`` — presentation copy, none of
    which exists in the schema. The schema instead requires
    ``{start_time, end_time, allowed}``, and the dataset's real dates live only
    as prose inside ``meta`` ("Reg. End: 31 May"). So the window comes from
    ``seed_calendar`` and the dataset's object is dropped wholesale.

    **This content is lost on the way through.** ``rulebook`` and ``faqs`` in
    particular have nowhere to go in the current event document. If they need to
    survive, the event schema needs a field for them; that is a backend change,
    not something this script can work around.

``schedule[].start_time`` / ``end_time``
    Present in the dataset but empty strings, which ``ScheduleRound`` rejects —
    it requires both to parse and ``end > start``. Filled from
    ``seed_calendar.event_round_times``, which lays an event's rounds out across
    the fest deterministically from its name. ``round_id`` is dropped: the
    backend mints it.

Dates are anchored to today
===========================

``seed_calendar`` derives every window from ``utcnow()``, so a freshly seeded
event is genuinely open: ``GET /events`` reports
``registration.is_open: true`` and ``POST /events/{id}/register`` accepts. A
hardcoded June 2026 calendar would leave every event closed for most of the
year, which is useless for testing.

Re-running
==========

Safe, and matched on ``name``. ``event_id`` is assigned by the backend
(``id_generator.EventIDGenerator``), so it is not stable across environments and
was never sent — ``name`` is the one field in each dataset entry that is both
required and stable across reruns, and all 53 are unique.

Where this sits in the run order
================================

A catalogue seed, after ``seed_staff.py --bootstrap --roster`` (which creates the
Super Admin ``POST /events`` requires). ``seed_staff.py --assign`` then puts an
Event Head and a volunteer on each event created here, and
``seed_students.py`` needs those teams: an attendance scan is attributed to a
real member of the event's own ``event_team``, so without ``--assign`` no scans
are seeded.

Usage::

    python seed_events.py --email <super-admin-address>
    python seed_events.py --email <super-admin-address> --update
    python seed_events.py --dry-run   # builds and validates payloads, no server needed

The password is read from ``PARADOX_ADMIN_PASSWORD`` or prompted for, so it never
lands in your shell history. Events that already exist are skipped unless
``--update`` is given.
"""

from __future__ import annotations

import argparse
import json
import os
from getpass import getpass
from pathlib import Path

import httpx

import seed_calendar

DEFAULT_API = "http://localhost:8000"
DEFAULT_DATASET = Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxEvents.json"

#: `EventUpdateRequest` has no `event_type`: an event's category is fixed at
#: creation because `event_id`'s own prefix is derived from it.
UPDATE_OMITS = ("event_type",)


def _detail(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def login(client: httpx.Client, email: str, password: str) -> str:
    """Sign in as staff and return the bearer token."""
    response = client.post("/auth/admin/login", json={"email": email, "password": password})
    if response.status_code != 200:
        raise SystemExit(f"Login failed ({response.status_code}): {_detail(response)}")

    body = response.json()
    if body.get("role") != "super_admin":
        raise SystemExit(
            f"{email} has role {body.get('role')!r}; only a Super Admin may create events."
        )
    return body["access_token"]


def _team_rule(record: dict) -> dict:
    """
    The dataset's ``team`` object, renamed onto ``TeamRule``.

    ``house`` became ``house_vs_house_event``. Everything else is carried over
    as-is, with the model's own defaults for anything the dataset omits.
    """
    team = record.get("team") or {}
    return {
        "min": team.get("min", 1),
        "max": team.get("max", 1),
        "house_vs_house_event": bool(team.get("house", False)),
        "allow_single_registration": team.get("allow_single_registration", True),
    }


def _schedule(record: dict) -> list[dict]:
    """
    The dataset's rounds, with real times and no client-supplied ``round_id``.

    The dataset carries a round's name, description and venue but leaves both
    timestamps as empty strings; ``seed_calendar`` supplies a start and end per
    round, positionally.
    """
    rounds = record.get("schedule") or []
    times = seed_calendar.event_round_times(record["name"], len(rounds))
    schedule = []
    for rnd, (start, end) in zip(rounds, times):
        schedule.append(
            {
                # `round_id` is deliberately absent — `create_event` mints one per
                # round via `EventIDGenerator.next_round_id`, and a client value
                # would be overwritten anyway.
                "name": rnd["name"],
                "description": rnd.get("description") or "",
                "start_time": seed_calendar.iso(start),
                "end_time": seed_calendar.iso(end),
                "venue": rnd.get("venue"),
            }
        )
    return schedule


def to_create_payload(record: dict) -> dict:
    """One dataset entry as an ``EventCreateRequest`` body."""
    return {
        "event_type": record["event_type"],
        "name": record["name"],
        "description": record["description"],
        "poster": record.get("poster") or "",
        "team": _team_rule(record),
        "prize_money": record.get("prize_money") or [],
        # The dataset's own `registration` object is presentation copy and is
        # dropped; see the module docstring.
        "registration": seed_calendar.event_registration_window(),
        "schedule": _schedule(record),
        "registration_fields": record.get("registration_fields") or [],
    }


def to_update_payload(record: dict) -> dict:
    """The same body, minus the fields ``EventUpdateRequest`` does not accept."""
    return {k: v for k, v in to_create_payload(record).items() if k not in UPDATE_OMITS}


def load_catalogue(dataset: Path = DEFAULT_DATASET) -> list[dict]:
    """Read the event catalogue, ordered by the field it is matched on."""
    if not dataset.is_file():
        raise SystemExit(f"Dataset not found: {dataset}")

    records = json.loads(dataset.read_text(encoding="utf-8"))
    names = [record["name"] for record in records]
    if len(set(names)) != len(names):
        raise SystemExit(f"Dataset has duplicate event names, which are the match key: {dataset}")
    return sorted(records, key=lambda r: r["name"])


def validate_locally(records: list[dict], log=print) -> int:
    """
    Check every built payload against ``EventCreateRequest``, with no server.

    This is what makes ``--dry-run`` worth running: the create model validates
    the registration window, every round's ``end > start``, the team rule's
    ``min <= max`` and the closed ``event_type`` set, so a translation mistake
    surfaces here rather than as a 422 halfway through a live run.
    """
    from pydantic import ValidationError

    from models import EventCreateRequest

    failures = 0
    for record in records:
        try:
            EventCreateRequest(**to_create_payload(record))
        except ValidationError as exc:
            failures += 1
            error = exc.errors()[0]
            log(f"  INVALID {record.get('name')}: {'.'.join(str(p) for p in error.get('loc', ()))} {error.get('msg')}")
    return failures


def publish_events(
    client: httpx.Client,
    events: list[dict],
    *,
    update: bool = False,
    log=print,
) -> dict:
    """
    Create (or update) every event in ``events`` through the events API.

    Takes an already-authenticated client so the transport is the caller's
    choice: the CLI passes a real ``httpx.Client``, a test can pass FastAPI's
    ``TestClient``, and both exercise the same code path.

    Returns a tally of what happened.
    """
    existing_response = client.get("/events")
    if existing_response.status_code != 200:
        raise SystemExit(f"Could not list events: {_detail(existing_response)}")
    existing_by_name = {e["name"]: e["event_id"] for e in existing_response.json()}
    log(f"{len(existing_by_name)} event(s) already in the database")

    tally = {"created": 0, "updated": 0, "skipped": 0, "failed": 0}

    for record in events:
        name = record["name"]

        if name in existing_by_name:
            event_id = existing_by_name[name]
            if not update:
                tally["skipped"] += 1
                continue
            response = client.put(f"/events/{event_id}", json=to_update_payload(record))
            if response.status_code == 200:
                tally["updated"] += 1
                log(f"  updated {event_id} - {name}")
            else:
                tally["failed"] += 1
                log(f"  FAILED  {event_id}: {_detail(response)}")
            continue

        response = client.post("/events", json=to_create_payload(record))
        if response.status_code == 200:
            tally["created"] += 1
            log(f"  created {response.json().get('event_id')} - {name}")
        else:
            tally["failed"] += 1
            log(f"  FAILED  {name}: {_detail(response)}")

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed the official event catalogue through the API.",
    )
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    parser.add_argument("--email", help="Super Admin email (not needed for --dry-run)")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Event dataset JSON")
    parser.add_argument(
        "--update",
        action="store_true",
        help="Overwrite events that already exist, instead of skipping them",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate every payload locally, without a server or a token",
    )
    args = parser.parse_args()

    events = load_catalogue(args.dataset)
    window = seed_calendar.event_registration_window()
    print(f"Loaded {len(events)} events from {args.dataset}" + (" [dry run]" if args.dry_run else ""))
    print(f"Registration window: {window['start_time']} .. {window['end_time']} (open now)")

    if args.dry_run:
        failures = validate_locally(events)
        rounds = sum(len(e.get("schedule") or []) for e in events)
        print(f"\nDone. {len(events)} payload(s) built covering {rounds} round(s), {failures} rejected.")
        return 1 if failures else 0

    if not args.email:
        raise SystemExit("--email is required unless --dry-run is given")

    password = os.getenv("PARADOX_ADMIN_PASSWORD") or getpass(f"Password for {args.email}: ")

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=60.0) as client:
        token = login(client, args.email, password)
        client.headers["Authorization"] = f"Bearer {token}"
        tally = publish_events(client, events, update=args.update)

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
