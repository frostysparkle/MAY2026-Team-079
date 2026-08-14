"""
Seed the official Paradox mess catalogue into the ``mess`` collection.

Three halls — Himalaya (North Indian), Vindhya (South Indian), and Nilgiri
(both) — each with a dietary designation and no diners yet. Nothing else is
created: no teams, no allocations. Placing participants is the job of
``POST /mess/allocate``, and ``POST /mess/{id}/team`` staffs a hall.

The catalogue itself lives in ``frontend/src/data/paradoxMess.json``. That same
dataset is what the frontend's mock API seeds, so the Super Admin dashboard shows
the identical halls under the identical ids whether it is running against the
mock layer or this database — the arrangement ``seed.py`` already uses for the
hostel catalogue.

Note that ``cuisines`` and ``preference`` are independent. ``preference`` is the
dietary axis (``veg`` / ``non_veg`` / ``jain``) and is the only field
``POST /mess/allocate`` groups on; ``cuisines`` records which regional menus the
hall cooks and is presentation only.

Re-running is safe. Each hall is matched on its ``mess_id``, so a second run
corrects catalogue fields in place instead of inserting a second copy, and
``mess_team`` / ``created_at`` are written on first insert only — a re-run can
never drop an assigned team or rewrite a hall's original creation time.

Usage::

    python seed_mess.py
    python seed_mess.py --dry-run

Connection details come from ``database.py``, so this uses the same Mongo
instance (and the same ``TESTING=1`` in-memory fallback) as the API.
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

from database import mess_collection

DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxMess.json"
)

# The catalogue facts kept in step with the dataset on every run.
CATALOGUE_FIELDS = ("mess_id", "name", "capacity", "preference", "cuisines")

# Mirrors `MESS_CUISINES` in `frontend/src/config/constants.ts`. Validated here
# because a typo would only ever show up as a badge nobody recognises.
KNOWN_CUISINES = ("north_indian", "south_indian")
# Mirrors `MESS_PREFERENCES`. A hall whose preference is outside this set can
# never be allocated to, since `POST /mess/allocate` matches it exactly against
# a participant's `profile.mess_preference`.
KNOWN_PREFERENCES = ("veg", "non_veg", "jain")


def load_catalogue(dataset: Path = DEFAULT_DATASET) -> list[dict]:
    """Read the mess catalogue from ``dataset``, rejecting unusable records."""
    if not dataset.is_file():
        raise SystemExit(f"Dataset not found: {dataset}")

    records = json.loads(dataset.read_text(encoding="utf-8"))
    catalogue = [{field: record[field] for field in CATALOGUE_FIELDS} for record in records]

    ids = [hall["mess_id"] for hall in catalogue]
    if len(set(ids)) != len(ids):
        raise SystemExit(f"Dataset has duplicate mess_ids: {dataset}")

    for hall in catalogue:
        if hall["preference"] not in KNOWN_PREFERENCES:
            raise SystemExit(
                f"{hall['mess_id']}: preference {hall['preference']!r} is not one of "
                f"{', '.join(KNOWN_PREFERENCES)} — allocation would never match it"
            )
        unknown = [c for c in hall["cuisines"] if c not in KNOWN_CUISINES]
        if unknown:
            raise SystemExit(
                f"{hall['mess_id']}: unknown cuisine(s) {', '.join(unknown)} — "
                f"expected any of {', '.join(KNOWN_CUISINES)}"
            )

    return catalogue


def seed_mess(
    catalogue: list[dict] | None = None,
    collection=mess_collection,
    *,
    dry_run: bool = False,
    log=print,
) -> dict:
    """
    Upsert the catalogue into ``collection`` and return a tally of what changed.

    Each document is handled in two halves: the catalogue fields (name, capacity,
    preference, cuisines) are corrected if they have drifted, while the team and
    creation time are seeded once and then left alone. A hall that already matches
    is left completely untouched, so ``updated_at`` only moves when something
    genuinely changed.
    """
    if catalogue is None:
        catalogue = load_catalogue()

    tally = {"created": 0, "updated": 0, "unchanged": 0, "conflicts": 0}

    for hall in catalogue:
        mess_id = hall["mess_id"]

        # A hall already stored under a different id would be a duplicate the
        # upsert can't see. Report it and leave both records untouched.
        clash = collection.find_one({"name": hall["name"], "mess_id": {"$ne": mess_id}})
        if clash:
            tally["conflicts"] += 1
            log(f"  SKIP    {hall['name']} — already present as {clash.get('mess_id')!r}")
            continue

        existing = collection.find_one({"mess_id": mess_id})

        if existing is not None:
            drift = {f: v for f, v in hall.items() if existing.get(f) != v}
            if not drift:
                tally["unchanged"] += 1
                continue

            tally["updated"] += 1
            log(f"  updated {mess_id} — {hall['name']}: {', '.join(sorted(drift))}")
            if not dry_run:
                collection.update_one(
                    {"mess_id": mess_id},
                    {"$set": {**drift, "updated_at": datetime.utcnow()}},
                )
            continue

        tally["created"] += 1
        log(f"  created {mess_id} — {hall['name']} ({', '.join(hall['cuisines'])})")
        if not dry_run:
            now = datetime.utcnow()
            # An upsert rather than a plain insert: if two runs overlap, Mongo
            # keeps the second one from landing a duplicate.
            collection.update_one(
                {"mess_id": mess_id},
                {
                    "$setOnInsert": {
                        **hall,
                        # A fresh hall: nobody staffing it yet.
                        "mess_team": [],
                        "created_at": now,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the official mess catalogue.")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Mess catalogue JSON")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing to the database",
    )
    args = parser.parse_args()

    catalogue = load_catalogue(args.dataset)
    seats = sum(hall["capacity"] for hall in catalogue)
    print(
        f"Seeding {len(catalogue)} mess halls ({seats} seats) from {args.dataset}"
        + (" [dry run]" if args.dry_run else "")
    )

    tally = seed_mess(catalogue, dry_run=args.dry_run)

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    return 1 if tally["conflicts"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
