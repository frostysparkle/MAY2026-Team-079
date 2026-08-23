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
dietary axis (``veg`` / ``non_veg`` / ``jain``); ``cuisines`` records which
regional menus the hall cooks. Neither is what the backend actually stores or
allocates on though: ``POST /mess/allocate`` (`routers/mess.py`) groups halls
on a hall's ``type`` field alone, a single value out of the closed
``models.MESS_PREFERENCE_TYPES`` vocabulary (``"{cuisine}__{diet}"``, or bare
``"jain"``). This script derives that ``type`` from each catalogue entry's
``preference`` + ``cuisines`` and seeds it alongside them, so the two
presentation fields keep displaying as before while allocation — which never
reads ``preference``/``cuisines`` — has the field it actually looks at.

Re-running is safe. Each hall is matched on its ``mess_id``, so a second run
corrects catalogue fields (name, capacity, preference, cuisines, type) in
place instead of inserting a second copy, and ``mess_team`` / ``created_at``
are written on first insert only — a re-run can never drop an assigned team or
rewrite a hall's original creation time.

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
from models import MESS_PREFERENCE_TYPES as KNOWN_TYPES

DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxMess.json"
)

# The catalogue facts kept in step with the dataset on every run. `type` is
# derived (see `_type_of` below), not read straight off the dataset record —
# the dataset only carries `preference` + `cuisines`.
CATALOGUE_FIELDS = ("mess_id", "name", "capacity", "preference", "cuisines")

# Mirrors `MESS_CUISINES` in `frontend/src/config/constants.ts`. Validated here
# because a typo would only ever show up as a badge nobody recognises.
KNOWN_CUISINES = ("north_indian", "south_indian")
# Mirrors `MESS_PREFERENCES`. A hall whose preference is outside this set can
# never be allocated to, since `POST /mess/allocate` matches it exactly against
# a participant's `profile.mess_preference`.
KNOWN_PREFERENCES = ("veg", "non_veg", "jain")


def _type_of(hall: dict) -> str:
    """
    The single `type` value `POST /mess/allocate` actually groups halls on
    (`models.MESS_PREFERENCE_TYPES`), derived from this catalogue's
    independent `preference` + `cuisines` pair.

    `jain` carries no regional axis — a hall serving it is `type="jain"`
    regardless of which cuisines it also cooks. Every other preference needs
    exactly one cuisine to combine with, since `type` has no way to name two
    regional menus for one diet; a hall wanting both would need two separate
    `type`s (i.e. two hall records), which is a catalogue decision, not one
    this script can make up on its own.
    """
    preference = hall["preference"]
    if preference == "jain":
        return "jain"

    cuisines = hall["cuisines"]
    if len(cuisines) != 1:
        raise SystemExit(
            f"{hall['mess_id']}: preference {preference!r} needs exactly one cuisine to "
            f"combine into a `type`, got {cuisines!r} — split this into separate hall "
            "records, one per cuisine"
        )
    return f"{cuisines[0]}__{preference}"


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

        # `type` is what `POST /mess/allocate` actually reads. Computed and
        # validated here rather than left implicit, so a catalogue entry that
        # cannot be expressed as a single closed-vocabulary `type` fails the
        # seed run instead of silently producing a hall allocation can never
        # match.
        hall["type"] = _type_of(hall)
        if hall["type"] not in KNOWN_TYPES:
            raise SystemExit(
                f"{hall['mess_id']}: derived type {hall['type']!r} is not one of "
                f"{', '.join(sorted(KNOWN_TYPES))} — allocation would never match it"
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
    preference, cuisines, type) are corrected if they have drifted, while the team
    and creation time are seeded once and then left alone. A hall that already
    matches is left completely untouched, so ``updated_at`` only moves when
    something genuinely changed.
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
