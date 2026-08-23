"""
Publish the official Paradox hostel catalogue through the Super Admin API.

22 blocks — 16 men's and 6 women's, 300 beds each — created with exactly the
payload the dashboard's "+ New Hostel" form sends, so a seeded block is
indistinguishable from one typed in by hand and stays fully editable afterwards.

The catalogue lives in ``frontend/src/data/paradoxHostels.json``; the rooming
plan that dataset has no field for comes from ``seed_calendar``.

Why this no longer writes to Mongo directly
===========================================

There is now a ``POST /hostels`` route, and it does considerably more than
insert the dataset's fields: it mints the ``hostel_id``, pre-generates the
``rooms`` array, checks the generated id for a collision against the in-memory
counter, and validates that the rooms can actually hold the stated capacity.
Hand-writing the document meant re-implementing all of that, and the old
version of this script had already drifted — it wrote ``category``,
``occupancy`` and ``coordinator``, none of which exist in the current schema,
and omitted ``sharing`` and ``rooms``, without which allocation cannot place
anybody.

What the dataset does not carry
===============================

``sharing`` (beds per room) and ``num_rooms`` have no equivalent in the
dataset, so they come from ``seed_calendar.hostel_rooming``, which varies
sharing across the blocks (2, 3, 4) and sizes ``num_rooms`` so that a block has
exactly enough beds for its capacity and not one more. That precision matters:
``hostels.allocate_hostels`` treats ``min(capacity, sharing * len(rooms))`` as
its ceiling, so a surplus bed would let allocation seat more residents than the
block's own stated capacity.

``category`` ("men" / "women") is dropped — it duplicated ``gender``, which is
the field allocation actually matches against ``profile.gender``. ``coordinator``
is dropped because the schema replaced it with ``hostel_team``, which
``seed_staff.py --assign`` fills.

Re-running
==========

Safe, and matched on ``name``: ``hostel_id`` is assigned by the backend now, so
it is not stable across environments and cannot be the key. A block already on
file is left alone.

Note that hostels have **no update route** — there is no ``PUT /hostels/{id}``.
So a block whose catalogue fields have drifted from the dataset is reported
rather than corrected; fixing one means deleting and recreating it, which
resets every resident's accommodation, and that is an organiser's decision
rather than a seed script's.

Where this sits in the run order
================================

Step 2 of 4. ``seed_staff.py --bootstrap --roster`` must run first — every create
route here is Super Admin only, and the API cannot create its own first Super
Admin::

    python seed_staff.py --bootstrap --roster
    python seed.py            --email <admin>   # <- this script
    python seed_mess.py       --email <admin>
    python seed_events.py     --email <admin>
    python seed_workshops.py  --email <admin>
    python seed_staff.py --assign
    python seed_students.py

Usage::

    python seed.py --email <super-admin-address>
    python seed.py --dry-run        # builds and validates payloads, no server needed

The password comes from ``PARADOX_ADMIN_PASSWORD`` or is prompted for, so it
never lands in your shell history.
"""

from __future__ import annotations

import argparse
import json
import os
from getpass import getpass
from pathlib import Path
from typing import Optional

import httpx

import seed_calendar

DEFAULT_API = "http://localhost:8000"
DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxHostels.json"
)

#: The dataset fields this script reads. Everything else in the file — the
#: dataset's own `hostel_id`, `category`, `coordinator` — is deliberately
#: ignored; see the module docstring.
CATALOGUE_FIELDS = ("name", "gender", "capacity")


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
            f"{email} has role {body.get('role')!r}; only a Super Admin may create hostels."
        )
    return body["access_token"]


def load_catalogue(dataset: Path = DEFAULT_DATASET) -> list[dict]:
    """
    Read the block inventory and turn it into ``POST /hostels`` payloads.

    Ordered by name so the rooming plan a block receives is stable across runs
    — ``seed_calendar.hostel_rooming`` cycles ``sharing`` by position, and an
    unordered read would hand the same block a different room layout each time.
    """
    if not dataset.is_file():
        raise SystemExit(f"Dataset not found: {dataset}")

    records = json.loads(dataset.read_text(encoding="utf-8"))

    names = [record["name"] for record in records]
    if len(set(names)) != len(names):
        raise SystemExit(f"Dataset has duplicate hostel names, which are the match key: {dataset}")

    catalogue = []
    for index, record in enumerate(sorted(records, key=lambda r: r["name"])):
        payload = {field: record[field] for field in CATALOGUE_FIELDS}
        payload.update(seed_calendar.hostel_rooming(record["name"], record["capacity"], index))
        catalogue.append(payload)
    return catalogue


def validate_locally(catalogue: list[dict], log=print) -> int:
    """
    Check every payload against the route's own request model, with no server.

    Imported lazily because pulling in a router drags FastAPI, the database
    module and the logging stack behind it — worth paying for a ``--dry-run``
    that genuinely proves the payloads are acceptable, not worth paying on a
    normal run that is about to have them validated by the API anyway.
    """
    from pydantic import ValidationError

    from routers.hostels import HostelCreateRequest

    failures = 0
    for payload in catalogue:
        try:
            HostelCreateRequest(**payload)
        except ValidationError as exc:
            failures += 1
            log(f"  INVALID {payload.get('name')}: {exc.errors()[0].get('msg')}")
    return failures


def publish_hostels(
    client: httpx.Client,
    catalogue: list[dict],
    *,
    log=print,
) -> dict:
    """
    Create every block in ``catalogue`` through ``POST /hostels``.

    Takes an already-authenticated client so the transport is the caller's
    choice: the CLI passes a real ``httpx.Client`` and a test can pass
    FastAPI's ``TestClient``, both exercising the same path.

    Matching is on ``name`` because ``hostel_id`` is backend-assigned. Drift in
    a block already on file is reported, not corrected — there is no update
    route to correct it with.
    """
    existing_response = client.get("/hostels")
    if existing_response.status_code != 200:
        raise SystemExit(f"Could not list hostels: {_detail(existing_response)}")
    existing = {block["name"]: block for block in existing_response.json()}
    log(f"{len(existing)} block(s) already in the database")

    tally = {"created": 0, "skipped": 0, "drifted": 0, "failed": 0}

    for payload in catalogue:
        name = payload["name"]
        on_file = existing.get(name)

        if on_file is not None:
            drift = sorted(
                field for field, value in payload.items()
                if field != "num_rooms" and on_file.get(field) != value
            )
            tally["skipped"] += 1
            if drift:
                tally["drifted"] += 1
                log(
                    f"  DRIFT   {on_file.get('hostel_id')} - {name}: {', '.join(drift)} "
                    f"differ from the dataset (no update route; delete and recreate to fix)"
                )
            continue

        response = client.post("/hostels", json=payload)
        if response.status_code == 200:
            tally["created"] += 1
            beds = payload["sharing"] * payload["num_rooms"]
            log(
                f"  created {response.json().get('hostel_id')} - {name} "
                f"({payload['gender']}, {payload['num_rooms']} rooms x {payload['sharing']} = {beds} beds)"
            )
        else:
            tally["failed"] += 1
            log(f"  FAILED  {name}: {_detail(response)}")

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed the official hostel catalogue through the API.",
    )
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    parser.add_argument("--email", help="Super Admin email (not needed for --dry-run)")
    parser.add_argument(
        "--dataset", type=Path, default=DEFAULT_DATASET, help="Hostel catalogue JSON"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate every payload locally, without a server or a token",
    )
    args = parser.parse_args()

    catalogue = load_catalogue(args.dataset)
    men = sum(1 for block in catalogue if block["gender"] == "male")
    beds = sum(block["sharing"] * block["num_rooms"] for block in catalogue)
    print(
        f"Seeding {len(catalogue)} hostels "
        f"({men} men's, {len(catalogue) - men} women's, {beds} beds) from {args.dataset}"
        + (" [dry run]" if args.dry_run else "")
    )

    if args.dry_run:
        failures = validate_locally(catalogue)
        for block in catalogue:
            print(
                f"  {block['name']:<16} {block['gender']:<7} capacity={block['capacity']} "
                f"sharing={block['sharing']} num_rooms={block['num_rooms']}"
            )
        print(
            f"\nDone. {len(catalogue)} payload(s) built, {failures} rejected by "
            f"HostelCreateRequest."
        )
        return 1 if failures else 0

    if not args.email:
        raise SystemExit("--email is required unless --dry-run is given")

    password = os.getenv("PARADOX_ADMIN_PASSWORD") or getpass(f"Password for {args.email}: ")

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=60.0) as client:
        token = login(client, args.email, password)
        client.headers["Authorization"] = f"Bearer {token}"
        tally = publish_hostels(client, catalogue)

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
