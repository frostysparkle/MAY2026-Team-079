"""
Publish the official Paradox mess catalogue, and each hall's menu, through the
Super Admin API.

Three halls — Himalaya, Vindhya and Nilgiri — created with exactly the payload
the dashboard's mess form sends, then given a four-day menu so they can actually
be used. The catalogue lives in ``frontend/src/data/paradoxMess.json``; the
menu, which that dataset has no field for, comes from ``seed_calendar``.

What changed in the schema
=========================

The retired ``preference`` (``veg`` | ``non_veg`` | ``jain``) and ``cuisines``
(a list of ``north_indian`` | ``south_indian``) pair has collapsed into a single
closed ``type`` drawn from ``models.MESS_PREFERENCE_TYPES``::

    north_indian__veg   north_indian__non_veg
    south_indian__veg   south_indian__non_veg   jain

That set is the *same object* a participant's ``profile.mess_preference`` is
validated against, so a hall's type and a diner's preference can no longer be
two lists that merely happen to agree. ``POST /mess/allocate`` reads only the
dietary half of it (``mess._diet_of``), which is why three halls still cover all
five preference values a profile may hold.

This script used to validate against its own local copies of the old
vocabularies and write the document straight to Mongo. It now sends
``{mess_id, name, capacity, type}`` to ``POST /mess`` and imports the closed set
from ``models``, so the seed cannot disagree with the route about what is valid.

Why the menu is not optional
============================

A hall with an empty ``menu`` cannot be used at all. ``POST /mess/{id}/scan``
refuses any day/slot absent from it, and ``GET /mess/my_mess`` derives its
entire display list by merging a diner's scan markers onto it — so an unmenued
hall shows a participant nothing and lets a volunteer scan nobody. Seeding the
menu is therefore part of creating the hall, not a separate nicety.

``seed_calendar`` places one sitting (``day_1`` lunch) across *this minute*, so
the ±15-minute scan window is open right now; ``day_1`` breakfast is
deliberately in the past and dinner in the future, giving all three window
states something to test against.

Re-running
==========

Safe, and matched on ``mess_id`` — unlike hostels and events, a hall's id is
client-supplied, so it is stable and can be the key. An existing hall is
skipped unless ``--update`` is given, which pushes catalogue changes through
``PUT /mess/{id}``. The menu is re-pushed on every run: it is a full
replacement by design, and its times are anchored to now, so a hall seeded
yesterday would otherwise keep yesterday's sittings.

Where this sits in the run order
================================

Step 3 of 4, after ``seed_staff.py --bootstrap --roster`` (which creates the
Super Admin every route here requires) and alongside the other catalogue seeds.
``seed_students.py`` depends on the menu this script pushes: a seeded meal scan
has to name a day and slot the hall actually serves.

Usage::

    python seed_mess.py --email <super-admin-address>
    python seed_mess.py --email <super-admin-address> --update
    python seed_mess.py --email <super-admin-address> --skip-menu
    python seed_mess.py --dry-run     # builds and validates payloads, no server needed

The password comes from ``PARADOX_ADMIN_PASSWORD`` or is prompted for.
"""

from __future__ import annotations

import argparse
import json
import os
from getpass import getpass
from pathlib import Path

import httpx

import seed_calendar
from models import MESS_PREFERENCE_TYPES

DEFAULT_API = "http://localhost:8000"
DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxMess.json"
)

#: The fields `POST /mess` accepts. `preference` and `cuisines` are read from the
#: dataset only to derive `type`, and are never sent.
CREATE_FIELDS = ("mess_id", "name", "capacity", "type")
#: `MessUpdateRequest` has no `mess_id` — a hall's id is its identity, not a
#: field to be patched.
UPDATE_FIELDS = ("name", "capacity", "type")


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
            f"{email} has role {body.get('role')!r}; only a Super Admin may create mess halls."
        )
    return body["access_token"]


def load_catalogue(dataset: Path = DEFAULT_DATASET) -> list[dict]:
    """
    Read the hall catalogue and turn it into ``POST /mess`` payloads.

    The dataset's retired ``preference`` / ``cuisines`` pair is collapsed into
    the single ``type`` the schema now takes, via
    ``seed_calendar.mess_type`` — which consults an explicit per-hall table
    first and only falls back to combining the two old fields.
    """
    if not dataset.is_file():
        raise SystemExit(f"Dataset not found: {dataset}")

    records = json.loads(dataset.read_text(encoding="utf-8"))

    ids = [record["mess_id"] for record in records]
    if len(set(ids)) != len(ids):
        raise SystemExit(f"Dataset has duplicate mess_ids: {dataset}")

    catalogue = []
    for record in sorted(records, key=lambda r: r["mess_id"]):
        hall_type = seed_calendar.mess_type(
            record["mess_id"],
            record.get("preference"),
            record.get("cuisines"),
        )
        # Belt and braces: `mess_type` already checks a derived value, but a
        # value taken straight from its table has not been through the closed
        # set, and a hall whose type is outside it can never be allocated to.
        if hall_type not in MESS_PREFERENCE_TYPES:
            raise SystemExit(
                f"{record['mess_id']}: type {hall_type!r} is not one of "
                f"{sorted(MESS_PREFERENCE_TYPES)} — allocation would never match it"
            )
        catalogue.append(
            {
                "mess_id": record["mess_id"],
                "name": record["name"],
                "capacity": record["capacity"],
                "type": hall_type,
            }
        )
    return catalogue


def validate_locally(catalogue: list[dict], log=print) -> int:
    """
    Check every payload against the route's own request model, with no server.

    Imported lazily for the same reason ``seed.py`` does it: pulling in a router
    drags FastAPI and the database module behind it, which a normal run has no
    need to pay for.
    """
    from pydantic import ValidationError

    from routers.mess import MessCreateRequest, MessMenuRequest

    failures = 0
    for payload in catalogue:
        try:
            MessCreateRequest(**payload)
        except ValidationError as exc:
            failures += 1
            log(f"  INVALID {payload.get('mess_id')}: {exc.errors()[0].get('msg')}")

    try:
        MessMenuRequest(menu=seed_calendar.mess_menu())
    except ValidationError as exc:
        failures += 1
        log(f"  INVALID menu: {exc.errors()[0].get('msg')}")

    return failures


def publish_messes(
    client: httpx.Client,
    catalogue: list[dict],
    *,
    update: bool = False,
    skip_menu: bool = False,
    log=print,
) -> dict:
    """
    Create (or update) every hall, then push its menu.

    Takes an already-authenticated client so the transport is the caller's
    choice — the CLI passes a real ``httpx.Client``, a test can pass FastAPI's
    ``TestClient``.
    """
    existing_response = client.get("/mess")
    if existing_response.status_code != 200:
        raise SystemExit(f"Could not list mess halls: {_detail(existing_response)}")
    existing = {hall["mess_id"] for hall in existing_response.json()}
    log(f"{len(existing)} hall(s) already in the database")

    tally = {"created": 0, "updated": 0, "skipped": 0, "menus": 0, "failed": 0}
    menu = seed_calendar.mess_menu()

    for payload in catalogue:
        mess_id = payload["mess_id"]

        if mess_id in existing:
            if update:
                body = {k: v for k, v in payload.items() if k in UPDATE_FIELDS}
                response = client.put(f"/mess/{mess_id}", json=body)
                if response.status_code == 200:
                    tally["updated"] += 1
                    log(f"  updated {mess_id} - {payload['name']}")
                else:
                    tally["failed"] += 1
                    log(f"  FAILED  {mess_id}: {_detail(response)}")
            else:
                tally["skipped"] += 1
        else:
            body = {k: v for k, v in payload.items() if k in CREATE_FIELDS}
            response = client.post("/mess", json=body)
            if response.status_code == 200:
                tally["created"] += 1
                log(f"  created {mess_id} - {payload['name']} ({payload['type']}, {payload['capacity']} seats)")
            elif response.status_code == 409:
                # Created by something else between the listing and now.
                tally["skipped"] += 1
            else:
                tally["failed"] += 1
                log(f"  FAILED  {mess_id}: {_detail(response)}")
                continue

        if skip_menu:
            continue

        # Pushed on every run, not only on creation: the menu is a full
        # replacement by design, and its sittings are anchored to the current
        # time, so a hall seeded on an earlier day needs them moved forward or
        # nothing can be scanned against it.
        response = client.put(f"/mess/{mess_id}/menu", json={"menu": menu})
        if response.status_code == 200:
            tally["menus"] += 1
            log(f"  menu    {mess_id} - {len(menu)} day(s)")
        else:
            tally["failed"] += 1
            log(f"  FAILED  {mess_id} menu: {_detail(response)}")

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed the official mess catalogue and menus through the API.",
    )
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    parser.add_argument("--email", help="Super Admin email (not needed for --dry-run)")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Mess catalogue JSON")
    parser.add_argument(
        "--update",
        action="store_true",
        help="Push catalogue changes to halls that already exist, instead of skipping them",
    )
    parser.add_argument(
        "--skip-menu",
        action="store_true",
        help="Create the halls but leave their menus alone (they cannot be scanned without one)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate every payload locally, without a server or a token",
    )
    args = parser.parse_args()

    catalogue = load_catalogue(args.dataset)
    seats = sum(hall["capacity"] for hall in catalogue)
    day_key, slot = seed_calendar.live_mess_sitting()
    print(
        f"Seeding {len(catalogue)} mess halls ({seats} seats) from {args.dataset}"
        + (" [dry run]" if args.dry_run else "")
    )
    print(f"Menu: {seed_calendar.FEST_DAYS} days; {day_key}/{slot} is open for scanning right now")

    if args.dry_run:
        failures = validate_locally(catalogue)
        for hall in catalogue:
            print(f"  {hall['mess_id']}  {hall['name']:<10} {hall['type']:<22} {hall['capacity']} seats")
        print(f"\nDone. {len(catalogue)} payload(s) built, {failures} rejected.")
        return 1 if failures else 0

    if not args.email:
        raise SystemExit("--email is required unless --dry-run is given")

    password = os.getenv("PARADOX_ADMIN_PASSWORD") or getpass(f"Password for {args.email}: ")

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=60.0) as client:
        token = login(client, args.email, password)
        client.headers["Authorization"] = f"Bearer {token}"
        tally = publish_messes(
            client, catalogue, update=args.update, skip_menu=args.skip_menu
        )

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
