#!/usr/bin/env python3
"""Repair legacy seed data so allocation can actually place people.

Run inside the backend container (or anywhere with pymongo and MONGODB_URI)::

    python scripts/repair_allocations.py            # dry run: report only
    python scripts/repair_allocations.py --apply    # write the fixes

Three problems this fixes, all found live:

1. Hostel blocks seeded before the ``rooms``/``sharing`` schema existed have
   no rooms, so the allocator's ceiling — ``min(capacity, sharing * rooms)`` —
   is 0 for every block and nobody can ever be placed. Rooms are generated to
   match the current create route exactly (``id_generator.generate_room_numbers``,
   sharing cycled 2/3/4 per ``seed_calendar.hostel_rooming``), and every
   participant already holding a ``accommodation.room`` in that block is
   mirrored into the rooms' ``occupants`` arrays so occupancy stays honest.

2. Participants who paid a facility fee but were never opted in — the payment
   page used to call only ``POST /hostels/register``, never the mess one — have
   ``registered`` set to True, which is exactly what ``POST /{mess,hostels}/allocate``
   filter on. Idempotent, matching the register routes: already-allotted
   participants are left alone.

3. Mess halls with no ``type`` are unmatchable by allocation (it buckets on the
   dietary half of ``type``). Reported only: fixing these goes through the
   supported API path, ``python seed_mess.py --update``, which also pushes a
   menu the halls otherwise lack entirely.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import seed_calendar  # noqa: E402
from database import participants_collection, hostel_collection, mess_collection  # noqa: E402
from id_generator import generate_room_numbers  # noqa: E402


def fix_hostel_rooms(apply: bool) -> int:
    blocks = list(hostel_collection.find({}))
    fixed = 0
    for index, h in enumerate(blocks):
        if h.get("rooms") and h.get("sharing"):
            continue
        # Same rooming the create route would have written: sharing cycles
        # 2/3/4 by position, rooms sized to cover capacity exactly.
        sharing = seed_calendar.hostel_rooming(h.get("name", ""), h.get("capacity", 0), index)["sharing"]
        num_rooms = -(-h.get("capacity", 0) // sharing)
        rooms = [{"room_number": rn, "occupants": []} for rn in generate_room_numbers(num_rooms)]

        # Mirror everyone the legacy seed already placed in this block, so the
        # occupancy the allocator reads matches the participants' own records.
        by_room: dict[str, list[str]] = {}
        for p in participants_collection.find(
            {"accommodation.hostel_id": h["hostel_id"]}, {"participant_id": 1, "accommodation.room": 1}
        ):
            room = (p.get("accommodation") or {}).get("room")
            if room:
                by_room.setdefault(str(room), []).append(p["participant_id"])
        for room in rooms:
            room["occupants"] = by_room.get(room["room_number"], [])

        print(f"  hostel {h['hostel_id']}: +{num_rooms} rooms (sharing {sharing}), "
              f"{sum(len(r['occupants']) for r in rooms)} existing occupants mirrored")
        if apply:
            hostel_collection.update_one(
                {"_id": h["_id"]}, {"$set": {"rooms": rooms, "sharing": sharing}}
            )
        fixed += 1
    return fixed


def fix_paid_not_registered(apply: bool) -> int:
    fixed = 0
    for facility in ("mess", "accommodation"):
        query = {
            f"{facility}.payment": {"$exists": True, "$ne": None},
            f"{facility}.registered": {"$ne": True},
            # Same guard the register routes enforce: never touch an allotment.
            f"{facility}.{'mess_id' if facility == 'mess' else 'hostel_id'}": None,
        }
        docs = list(participants_collection.find(query, {"participant_id": 1}))
        if docs:
            ids = [d["participant_id"] for d in docs]
            print(f"  {facility}: opting in {len(docs)} paid participant(s): {', '.join(ids)}")
            if apply:
                participants_collection.update_many(
                    {"_id": {"$in": [d["_id"] for d in docs]}},
                    {"$set": {f"{facility}.registered": True}},
                )
            fixed += len(docs)
    return fixed


def report_bad_mess_types() -> int:
    bad = list(mess_collection.find({"$or": [{"type": None}, {"type": {"$exists": False}}]}))
    for m in bad:
        print(f"  mess {m['mess_id']}: no type — run `python seed_mess.py --update` to fix (also pushes a menu)")
    return len(bad)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the fixes (default: report only)")
    args = parser.parse_args()

    print("Hostels without rooms/sharing:")
    n = fix_hostel_rooms(args.apply)
    print("Paid but never opted in:")
    n += fix_paid_not_registered(args.apply)
    print("Mess halls with no type (reported only):")
    n += report_bad_mess_types()

    print(f"\n{'APPLIED' if args.apply else 'DRY RUN'} — {n} fix(es) "
          f"{'written' if args.apply else 'pending (re-run with --apply)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
