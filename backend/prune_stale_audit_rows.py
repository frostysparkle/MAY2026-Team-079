"""
Remove audit entries that refer to entities which no longer exist.

The trail accumulates rows from probe scripts and manual API testing — a mess hall
created, staffed, and dropped again in the space of one script run. Those rows can
never be made readable: the hall they name is gone, the accounts that acted are
gone, and no name was ever recorded for either. They are the rows that read as
`BT413179sa assigned BT413179v1 as volunteer to MESS_PROBE2_413179`.

The rule is deliberately narrow. A row is only a candidate when its ``target_id``
matches **no** live event, workshop, mess hall, hostel block, or person. That
excludes the far larger group this must not touch: rows whose *actor* is gone but
whose target still exists. Those are real provenance — the record of who created
the workshops and events now in the catalogue — and deleting them would destroy
the only account of where that data came from.

Rows with no ``target_id`` at all (``ALLOCATE_MESSES`` and friends) are never
candidates, since there is nothing to check them against.

Nothing is deleted without ``--confirm``. The default is a report.

Usage::

    python prune_stale_audit_rows.py                 # report only
    python prune_stale_audit_rows.py --confirm       # actually delete

Connection details come from ``database.py``, so this uses the same Mongo instance
(and the same ``TESTING=1`` in-memory fallback) as the API.
"""

import argparse
from collections import Counter

from database import (
    backend_teams_collection,
    event_collection,
    hostel_collection,
    mess_collection,
    participants_collection,
    system_logs_collection,
    workshops_collection,
)


def live_target_ids(
    *,
    events=event_collection,
    workshops=workshops_collection,
    messes=mess_collection,
    hostels=hostel_collection,
    staff=backend_teams_collection,
    participants=participants_collection,
) -> set:
    """
    Every id a ``target_id`` could legitimately point at.

    People are included because ``UPDATE_PARTICIPANT`` targets a participant rather
    than a venue, and a staff id can appear the same way. Leaving them out would
    make those rows look stale when they are not.
    """
    return (
        set(events.distinct("event_id"))
        | set(workshops.distinct("workshop_id"))
        | set(messes.distinct("mess_id"))
        | set(hostels.distinct("hostel_id"))
        | set(staff.distinct("paradox_id"))
        | set(participants.distinct("participant_id"))
    )


def find_stale(logs_collection=system_logs_collection, live: set | None = None) -> list:
    """The rows whose target no longer exists. Read-only."""
    if live is None:
        live = live_target_ids()

    return [
        log
        for log in logs_collection.find({})
        if log.get("target_id") and log["target_id"] not in live
    ]


def prune_stale_audit_rows(
    logs_collection=system_logs_collection,
    live: set | None = None,
    *,
    confirm: bool = False,
    log=print,
) -> dict:
    """
    Report — and with ``confirm``, delete — rows whose target is gone.

    Returns a tally. ``kept_dead_actor`` is called out because it is the number this
    script is careful *not* to touch: rows a reader may also find hard to read, but
    which document something that still exists.
    """
    if live is None:
        live = live_target_ids()

    stale = find_stale(logs_collection, live)
    total = logs_collection.count_documents({})

    dead_actor_live_target = sum(
        1
        for entry in logs_collection.find({})
        if entry.get("target_id")
        and entry["target_id"] in live
        and entry.get("actor_id") not in live
    )

    if stale:
        log("Rows whose target no longer exists:")
        for target, count in Counter(entry["target_id"] for entry in stale).most_common():
            actions = sorted({e["action"] for e in stale if e["target_id"] == target})
            log(f"  {target:<28} {count:>3} row(s)  {', '.join(actions)}")

    deleted = 0
    if confirm and stale:
        result = logs_collection.delete_many({"_id": {"$in": [e["_id"] for e in stale]}})
        deleted = result.deleted_count

    return {
        "total": total,
        "stale": len(stale),
        "deleted": deleted,
        "kept_dead_actor": dead_actor_live_target,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually delete the rows. Without this, the script only reports.",
    )
    args = parser.parse_args()

    tally = prune_stale_audit_rows(confirm=args.confirm)

    print()
    print(f"Trail size                          : {tally['total']}")
    print(f"Rows whose target no longer exists  : {tally['stale']}")
    print(f"Rows kept whose actor is gone       : {tally['kept_dead_actor']}  (real provenance)")

    if not args.confirm:
        print()
        print(
            f"Nothing was deleted. Re-run with --confirm to remove the {tally['stale']} stale row(s)."
        )
    else:
        print(f"Deleted                             : {tally['deleted']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
