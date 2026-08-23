"""
Publish the Paradox workshop programme through the Super Admin API — slots
first, then the workshops scheduled against them.

Every workshop is sent to ``POST /workshops`` with exactly the payload the
dashboard's "+ New workshop" form sends, so a seeded workshop is
indistinguishable from one typed in by hand and remains fully editable
afterwards.

The programme lives in ``frontend/src/data/paradoxWorkshops.json``: 57 sessions,
whose titles, descriptions, speakers, pre-requisites and venues come from the
workshop flyers in ``frontend/public/images/workshops/`` and the Paradox
check-in emails. Nothing is invented.

Slots must exist first
======================

A workshop's time is no longer its own. ``POST /workshops`` looks its
``slot_id`` up in the ``workshop_slots`` collection and **404s if the slot does
not exist**, then denormalizes that slot's ``start_time`` onto the workshop.
So this script creates all seven slots through ``POST /workshop-slots`` before
it creates a single workshop — which is also why ``start_time`` is absent from
every payload below, and why it is absent from the update payload too: it only
ever changes via a cascaded ``PUT /workshop-slots/{slot_id}``.

Slot ids are a closed pattern
=============================

``slot_id`` must match ``^D<day>S<shift>$`` — the guarantee the
slot-clash check in ``register_for_workshop`` relies on, since "same slot means
same time block" has to be true of the id itself. The dataset's ids are dates
plus a shift word (``2026-06-12-afternoon``), so they are mapped through
``seed_calendar.legacy_slot_id``: the date's distance from the dataset's own
first fest day becomes the day number, and morning/afternoon become shifts 1
and 2. The seven the dataset actually uses map to ``D1S2``, ``D2S1``, ``D2S2``,
``D3S1``, ``D3S2``, ``D4S1``, ``D4S2`` — there is no ``2026-06-10-morning``
workshop, so no ``D1S1``.

Dates are anchored to today
===========================

``seed_calendar`` derives the slot times and the registration window from
``utcnow()``, so a freshly seeded workshop is genuinely open for registration,
and one slot (``seed_calendar.LIVE_SLOT_ID``) deliberately straddles this
minute so the attendance scan window is open right now — it opens 30 minutes
before ``start_time`` for a pre-registered scan, 15 for an on-spot scan, and
closes 30 minutes after.

A past ``registration_end`` would be worse than merely inconvenient here:
``_sync_registration_state`` auto-closes a lapsed workshop the first time
anything reads it, so a hardcoded 2026 calendar would leave every seeded
workshop closed before it was ever used.

Re-running
==========

Safe. Slots already present are skipped, and workshops are matched on ``name``
— ``workshop_id`` is assigned by the backend (``SequentialIDGenerator``), so it
is not stable across environments and was never sent. All 57 names are unique.
Workshops that already exist are skipped unless ``--update`` is given.

Where this sits in the run order
================================

A catalogue seed, after ``seed_staff.py --bootstrap --roster`` (which creates the
Super Admin both routes here require). ``seed_staff.py --assign`` then puts a
scan-enabled volunteer on each workshop. Within this script the order is fixed
and handled for you: slots first, then workshops.

Usage::

    python seed_workshops.py --email <super-admin-address>
    python seed_workshops.py --email <super-admin-address> --update
    python seed_workshops.py --dry-run   # builds and validates payloads, no server needed

The password is read from ``PARADOX_ADMIN_PASSWORD`` or prompted for.
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
DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxWorkshops.json"
)

#: `WorkshopUpdateRequest` accepts neither `slot_id` (a workshop's slot is fixed
#: at creation because participants' bookings reference it) nor `start_time`
#: (derived from the slot, and only ever changed by cascading a slot edit).
UPDATE_OMITS = ("slot_id",)


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
            f"{email} has role {body.get('role')!r}; only a Super Admin may create workshops."
        )
    return body["access_token"]


def to_create_payload(record: dict) -> dict:
    """
    One dataset entry as a ``WorkshopCreateRequest`` body.

    The dataset's ``workshop_id`` is dropped (backend-minted) and its date-based
    ``slot_id`` is mapped onto the stored pattern. ``start_time`` is not sent at
    all — it comes from the slot.
    """
    return {
        "slot_id": seed_calendar.legacy_slot_id(record["slot_id"]),
        "name": record["name"],
        "description": record["description"],
        "venue": record["venue"],
        "capacity": record["capacity"],
        "instructions": record["instructions"],
        **seed_calendar.workshop_registration_window(),
    }


def to_update_payload(record: dict) -> dict:
    """The same body, minus the fields ``WorkshopUpdateRequest`` does not accept."""
    return {k: v for k, v in to_create_payload(record).items() if k not in UPDATE_OMITS}


def load_programme(dataset: Path = DEFAULT_DATASET) -> list[dict]:
    """Read the workshop programme, ordered by the field it is matched on."""
    if not dataset.is_file():
        raise SystemExit(f"Dataset not found: {dataset}")

    records = json.loads(dataset.read_text(encoding="utf-8"))
    names = [record["name"] for record in records]
    if len(set(names)) != len(names):
        raise SystemExit(f"Dataset has duplicate workshop names, which are the match key: {dataset}")
    return sorted(records, key=lambda r: r["name"])


def validate_locally(records: list[dict], log=print) -> int:
    """
    Check every slot and workshop payload against the real request models,
    with no server.

    Also asserts that every slot a workshop names is one this script will have
    created — a mapped id with no slot behind it is the failure that turns into
    a 404 from ``POST /workshops`` halfway through a live run.
    """
    from pydantic import ValidationError

    from models import WorkshopCreateRequest, WorkshopSlotCreateRequest

    failures = 0

    for slot_id, bounds in seed_calendar.SLOT_TIMES.items():
        try:
            WorkshopSlotCreateRequest(slot_id=slot_id, **bounds)
        except ValidationError as exc:
            failures += 1
            log(f"  INVALID slot {slot_id}: {exc.errors()[0].get('msg')}")

    for record in records:
        payload = to_create_payload(record)
        if payload["slot_id"] not in seed_calendar.SLOT_TIMES:
            failures += 1
            log(
                f"  INVALID {record['name']}: slot {payload['slot_id']} "
                f"(from {record['slot_id']}) is not one this script creates"
            )
            continue
        try:
            WorkshopCreateRequest(**payload)
        except ValidationError as exc:
            failures += 1
            error = exc.errors()[0]
            log(f"  INVALID {record['name']}: {'.'.join(str(p) for p in error.get('loc', ()))} {error.get('msg')}")

    return failures


def publish_slots(client: httpx.Client, *, log=print) -> dict:
    """
    Create every time slot the programme needs.

    Must run before any workshop is created. A duplicate is a 400 from the
    route, which is counted as already-present rather than as a failure so a
    re-run is clean.
    """
    tally = {"created": 0, "skipped": 0, "failed": 0}

    existing_response = client.get("/workshop-slots")
    if existing_response.status_code != 200:
        raise SystemExit(f"Could not list workshop slots: {_detail(existing_response)}")
    existing = {slot["slot_id"] for slot in existing_response.json()}
    log(f"{len(existing)} slot(s) already in the database")

    for slot_id in sorted(seed_calendar.SLOT_TIMES):
        if slot_id in existing:
            tally["skipped"] += 1
            continue

        body = {"slot_id": slot_id, **seed_calendar.SLOT_TIMES[slot_id]}
        response = client.post("/workshop-slots", json=body)
        if response.status_code == 200:
            tally["created"] += 1
            live = "  <- live, scannable now" if slot_id == seed_calendar.LIVE_SLOT_ID else ""
            log(f"  created slot {slot_id}  {body['start_time']} .. {body['end_time']}{live}")
        elif response.status_code == 400 and "already exists" in _detail(response):
            tally["skipped"] += 1
        else:
            tally["failed"] += 1
            log(f"  FAILED  slot {slot_id}: {_detail(response)}")

    return tally


def publish_workshops(
    client: httpx.Client,
    workshops: list[dict],
    *,
    update: bool = False,
    log=print,
) -> dict:
    """
    Create (or update) every workshop through the workshops API.

    Takes an already-authenticated client so the transport is the caller's
    choice: the CLI passes a real ``httpx.Client``, a test can pass FastAPI's
    ``TestClient``, and both exercise the same code path.
    """
    existing_response = client.get("/workshops")
    if existing_response.status_code != 200:
        raise SystemExit(f"Could not list workshops: {_detail(existing_response)}")
    existing_by_name = {w["name"]: w["workshop_id"] for w in existing_response.json()}
    log(f"{len(existing_by_name)} workshop(s) already in the database")

    tally = {"created": 0, "updated": 0, "skipped": 0, "failed": 0}

    for record in workshops:
        name = record["name"]

        if name in existing_by_name:
            workshop_id = existing_by_name[name]
            if not update:
                tally["skipped"] += 1
                continue
            response = client.put(f"/workshops/{workshop_id}", json=to_update_payload(record))
            if response.status_code == 200:
                tally["updated"] += 1
                log(f"  updated {workshop_id} - {name}")
            else:
                tally["failed"] += 1
                log(f"  FAILED  {workshop_id}: {_detail(response)}")
            continue

        payload = to_create_payload(record)
        response = client.post("/workshops", json=payload)
        if response.status_code == 200:
            tally["created"] += 1
            log(f"  created {response.json().get('workshop_id')} [{payload['slot_id']}] - {name}")
        else:
            tally["failed"] += 1
            log(f"  FAILED  {name}: {_detail(response)}")

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed the official workshop programme, and its slots, through the API.",
    )
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    parser.add_argument("--email", help="Super Admin email (not needed for --dry-run)")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Workshop dataset JSON")
    parser.add_argument(
        "--update",
        action="store_true",
        help="Overwrite workshops that already exist, instead of skipping them",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate every payload locally, without a server or a token",
    )
    args = parser.parse_args()

    workshops = load_programme(args.dataset)
    window = seed_calendar.workshop_registration_window()
    print(f"Loaded {len(workshops)} workshops from {args.dataset}" + (" [dry run]" if args.dry_run else ""))
    print(
        f"Registration window: {window['registration_start']} .. "
        f"{window['registration_end']} (open now)"
    )
    print(
        f"Slots: {len(seed_calendar.SLOT_TIMES)} "
        f"({', '.join(sorted(seed_calendar.SLOT_TIMES))}); "
        f"{seed_calendar.LIVE_SLOT_ID} is scannable right now"
    )

    if args.dry_run:
        failures = validate_locally(workshops)
        by_slot: dict[str, int] = {}
        for record in workshops:
            slot = seed_calendar.legacy_slot_id(record["slot_id"])
            by_slot[slot] = by_slot.get(slot, 0) + 1
        for slot in sorted(by_slot):
            print(f"  {slot}  {by_slot[slot]} workshop(s)")
        print(
            f"\nDone. {len(seed_calendar.SLOT_TIMES)} slot(s) and {len(workshops)} "
            f"workshop payload(s) built, {failures} rejected."
        )
        return 1 if failures else 0

    if not args.email:
        raise SystemExit("--email is required unless --dry-run is given")

    password = os.getenv("PARADOX_ADMIN_PASSWORD") or getpass(f"Password for {args.email}: ")

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=60.0) as client:
        token = login(client, args.email, password)
        client.headers["Authorization"] = f"Bearer {token}"

        print("\nSlots")
        slot_tally = publish_slots(client)
        if slot_tally["failed"]:
            print("  refusing to create workshops while a slot is missing")
            return 1

        print("\nWorkshops")
        tally = publish_workshops(client, workshops, update=args.update)

    print(
        "\nDone. slots("
        + " ".join(f"{k}={v}" for k, v in slot_tally.items())
        + ") workshops("
        + " ".join(f"{k}={v}" for k, v in tally.items())
        + ")"
    )
    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
