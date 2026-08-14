"""
Seed the official Paradox hostel catalogue into the ``hostel`` collection.

The inventory is 22 blocks — 16 men's and 6 women's — each with a capacity of
300 and no occupants yet. Nothing else is created: no rooms, no allocations, no
sample participants. Allocation is the job of ``POST /hostels/allocate``, and
occupancy is only ever moved by the application.

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
from datetime import datetime
from pathlib import Path

from database import hostel_collection

DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxHostels.json"
)

# The catalogue facts kept in step with the dataset on every run. `category` is
# the catalogue wording ("men" / "women"); `gender` is the value the rest of the
# backend keys on — `POST /hostels/allocate` matches it against a participant's
# `profile.gender`, which is "male" / "female".
CATALOGUE_FIELDS = ("hostel_id", "name", "category", "gender", "capacity")


def load_catalogue(dataset: Path = DEFAULT_DATASET) -> list[dict]:
    """
    Read the hostel inventory from ``dataset``.

    Only the catalogue fields are carried over; ``coordinator`` and any other
    per-deployment detail in the dataset is left to the application to fill in.
    """
    if not dataset.is_file():
        raise SystemExit(f"Dataset not found: {dataset}")

    records = json.loads(dataset.read_text(encoding="utf-8"))
    catalogue = [{field: record[field] for field in CATALOGUE_FIELDS} for record in records]

    ids = [hostel["hostel_id"] for hostel in catalogue]
    if len(set(ids)) != len(ids):
        raise SystemExit(f"Dataset has duplicate hostel_ids: {dataset}")

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

    Each document is handled in two halves: the catalogue fields (name,
    category, gender, capacity) are corrected if they have drifted, while
    occupancy and creation time are seeded once and then left alone. A block
    that already matches is left completely untouched, so ``updated_at`` only
    moves when something genuinely changed.
    """
    if catalogue is None:
        catalogue = load_catalogue()

    tally = {"created": 0, "updated": 0, "unchanged": 0, "conflicts": 0}

    for hostel in catalogue:
        hostel_id = hostel["hostel_id"]

        # A block already stored under a different id would be a duplicate the
        # upsert can't see. Report it and leave both records untouched.
        clash = collection.find_one({"name": hostel["name"], "hostel_id": {"$ne": hostel_id}})
        if clash:
            tally["conflicts"] += 1
            log(f"  SKIP    {hostel['name']} — already present as {clash.get('hostel_id')!r}")
            continue

        existing = collection.find_one({"hostel_id": hostel_id})

        if existing is not None:
            drift = {f: v for f, v in hostel.items() if existing.get(f) != v}
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
