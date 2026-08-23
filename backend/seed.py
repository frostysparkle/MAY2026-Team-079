"""
Seed the official Paradox hostel catalogue into the ``hostel`` collection.

The inventory is 22 blocks — 16 men's and 6 women's — each with a capacity of
300 and no occupants yet. `POST /hostels/allocate` (`routers/hostels.py`)
seats participants into pre-generated rooms, at up to `sharing` occupants per
room — the same `sharing` + `rooms` shape `POST /hostels` builds via
`generate_room_numbers` when a block is created through the API. This script
builds that shape for the catalogue too, so a seeded block is exactly as
allocatable as one created by hand; no allocations or sample participants are
created here, and occupancy is only ever moved by the application.

The catalogue itself lives in ``frontend/src/data/paradoxHostels.json``. That
same dataset is what the frontend's mock API seeds, so the Super Admin dashboard
shows the identical 22 blocks under the identical ids whether it is running
against the mock layer or this database — the arrangement ``seed_events.py``
already uses for the event catalogue.

Re-running is safe. Each block is matched on its ``hostel_id``, so a second run
corrects catalogue fields in place instead of inserting a second copy, and
``occupancy`` / ``created_at`` are written on first insert only — a re-run can
never bump occupancy or rewrite a block's original creation time.

Usage::

    python seed.py
    python seed.py --dry-run

Connection details come from ``database.py``, so this uses the same Mongo
instance (and the same ``TESTING=1`` in-memory fallback) as the API.
"""

import argparse
import json
import math
from datetime import datetime
from pathlib import Path

from database import hostel_collection
from id_generator import generate_room_numbers

DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxHostels.json"
)

# The catalogue facts kept in step with the dataset on every run. `category` is
# the catalogue wording ("men" / "women"); `gender` is the value the rest of the
# backend keys on — `POST /hostels/allocate` matches it against a participant's
# `profile.gender`, which is "male" / "female". `sharing` and `rooms` are not
# read off the dataset — the dataset carries no room layout — they are derived
# below (see `_rooms_for`) so allocation has the same `sharing` + pre-generated
# `rooms` shape `POST /hostels` builds for a block created through the API.
CATALOGUE_FIELDS = ("hostel_id", "name", "category", "gender", "capacity")

# Occupants per room for every seeded block. `POST /hostels/allocate` seats
# people into rooms at up to this many per room; this is a seed-time choice
# (the dataset itself has no room layout), not something read from anywhere
# else, so it is named here rather than left as a bare literal.
ROOM_SHARING = 3


def _rooms_for(capacity: int, sharing: int = ROOM_SHARING) -> list[dict]:
    """
    Enough rooms, at ``sharing`` occupants each, to cover ``capacity`` — the
    same shape `create_hostel` (`routers/hostels.py`) builds from
    `generate_room_numbers`, reused here rather than re-implemented so the
    room-numbering scheme (start at "101", sequential) can never drift between
    a hostel created through the API and one seeded by this script.
    """
    num_rooms = math.ceil(capacity / sharing)
    return [{"room_number": rn, "occupants": []} for rn in generate_room_numbers(num_rooms)]


def load_catalogue(dataset: Path = DEFAULT_DATASET) -> list[dict]:
    """
    Read the hostel inventory from ``dataset``.

    The catalogue fields are carried over as-is; ``sharing`` and ``rooms`` are
    derived from each block's ``capacity`` (see ``_rooms_for``), since the
    dataset itself has no room layout. ``coordinator`` and any other
    per-deployment detail in the dataset is left to the application to fill in.
    """
    if not dataset.is_file():
        raise SystemExit(f"Dataset not found: {dataset}")

    records = json.loads(dataset.read_text(encoding="utf-8"))
    catalogue = [{field: record[field] for field in CATALOGUE_FIELDS} for record in records]

    ids = [hostel["hostel_id"] for hostel in catalogue]
    if len(set(ids)) != len(ids):
        raise SystemExit(f"Dataset has duplicate hostel_ids: {dataset}")

    for hostel in catalogue:
        # `POST /hostels/allocate` computes a block's bed ceiling as
        # `sharing * len(rooms)`, capped by `capacity`
        # (`min(capacity, sharing * len(rooms))`) — without `rooms`/`sharing`
        # that ceiling is 0 and the block can never receive anyone, which is
        # exactly the defect this seed fix closes.
        hostel["sharing"] = ROOM_SHARING
        hostel["rooms"] = _rooms_for(hostel["capacity"], ROOM_SHARING)

    return catalogue


def seed_hostels(
    catalogue: list[dict] | None = None,
    collection=hostel_collection,
    *,
    dry_run: bool = False,
    log=print,
) -> dict:
    """
    Upsert the catalogue into ``collection`` and return a tally of what changed.

    Each document is handled in three parts. The catalogue fields (name,
    category, gender, capacity) are corrected if they have drifted; occupancy
    and creation time are seeded once and then left alone; and ``sharing`` /
    ``rooms`` are *backfilled* only when a block has neither yet — never
    diffed against the freshly-generated catalogue value the way the other
    catalogue fields are. `POST /hostels/allocate` writes real participants
    into ``rooms[i].occupants``, so treating a freshly regenerated (empty)
    ``rooms`` array as "drift" on every run would silently wipe out every
    room assignment the moment this script is re-run after an allocation. A
    block that already has rooms keeps exactly the ones it has; only a block
    seeded before this fix existed (or created some other way without them)
    gets them filled in. A block that already matches everything is left
    completely untouched, so ``updated_at`` only moves when something
    genuinely changed.
    """
    if catalogue is None:
        catalogue = load_catalogue()

    tally = {"created": 0, "updated": 0, "unchanged": 0, "conflicts": 0}

    for hostel in catalogue:
        hostel_id = hostel["hostel_id"]
        catalogue_fields = {f: hostel[f] for f in CATALOGUE_FIELDS}
        room_fields = {f: hostel[f] for f in ("sharing", "rooms")}

        # A block already stored under a different id would be a duplicate the
        # upsert can't see. Report it and leave both records untouched.
        clash = collection.find_one({"name": hostel["name"], "hostel_id": {"$ne": hostel_id}})
        if clash:
            tally["conflicts"] += 1
            log(f"  SKIP    {hostel['name']} — already present as {clash.get('hostel_id')!r}")
            continue

        existing = collection.find_one({"hostel_id": hostel_id})

        if existing is not None:
            drift = {f: v for f, v in catalogue_fields.items() if existing.get(f) != v}

            # Backfill only what is missing — a block with no `rooms` yet (every
            # block seeded before this fix, or one written some other way without
            # them) has nothing for `POST /hostels/allocate` to seat anyone into,
            # and gets the catalogue's derived layout. A block that already has
            # rooms, even an empty list on a 0-room block, is left exactly as it
            # is: it may already hold real occupants this script must not touch.
            if not existing.get("rooms"):
                drift.update(room_fields)

            if not drift:
                tally["unchanged"] += 1
                continue

            tally["updated"] += 1
            log(f"  updated {hostel_id} — {hostel['name']}: {', '.join(sorted(drift))}")
            if not dry_run:
                collection.update_one(
                    {"hostel_id": hostel_id},
                    {"$set": {**drift, "updated_at": datetime.utcnow()}},
                )
            continue

        tally["created"] += 1
        log(f"  created {hostel_id} — {hostel['name']} ({hostel['category']})")
        if not dry_run:
            now = datetime.utcnow()
            # An upsert rather than a plain insert: if two runs overlap, Mongo
            # keeps the second one from landing a duplicate.
            collection.update_one(
                {"hostel_id": hostel_id},
                {
                    "$setOnInsert": {
                        **hostel,
                        # A fresh block: nobody in it, no team yet.
                        "occupancy": 0,
                        "coordinator": {},
                        "hostel_team": [],
                        "created_at": now,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the official hostel catalogue.")
    parser.add_argument(
        "--dataset", type=Path, default=DEFAULT_DATASET, help="Hostel catalogue JSON"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing to the database",
    )
    args = parser.parse_args()

    catalogue = load_catalogue(args.dataset)
    men = sum(1 for h in catalogue if h["category"] == "men")
    print(
        f"Seeding {len(catalogue)} hostels "
        f"({men} men's, {len(catalogue) - men} women's) from {args.dataset}"
        + (" [dry run]" if args.dry_run else "")
    )

    tally = seed_hostels(catalogue, dry_run=args.dry_run)

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    return 1 if tally["conflicts"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
