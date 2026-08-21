"""
Give existing ``backend_teams`` records a ``name``.

Staff accounts had no name field until the audit trail needed one, so every
account created before it exists without one. The trail still reads for those
actors — ``GET /audit-logs`` falls back to the account's ``designation`` and then
to the local part of its email — but "Mess Head" and "bt413179" are what a
fallback looks like, not a person's name. This fills in the real one where the
database already knows it.

Two sources, in order of trustworthiness:

1. ``admin_id``, the ObjectId link to the participant document that
   ``POST /backend_teams`` sets when a staff member is also a registered
   participant. That is a deliberate link, so it is preferred.
2. A participant registered under the same email. The link is what
   ``POST /backend_teams`` derives from the email in the first place, so this
   recovers the same answer for accounts created before it started storing it.

An account with neither is **left alone**. Writing its ``designation`` into
``name`` would turn a fallback into what looks like a recorded fact, and the read
path already handles that case honestly. Those accounts are reported so somebody
can set the names by hand — ``PUT /backend_teams/{paradox_id}`` now accepts
``name``.

Only ever writes ``name``, and only to accounts that have none: an account whose
name was set explicitly is never overwritten, so re-running is safe and does
nothing the second time.

Usage::

    python backfill_staff_names.py --dry-run
    python backfill_staff_names.py

Connection details come from ``database.py``, so this uses the same Mongo instance
(and the same ``TESTING=1`` in-memory fallback) as the API.
"""

import argparse
from datetime import datetime

from database import backend_teams_collection, participants_collection


def email_local_part(email: str | None) -> str | None:
    """``bt413179@ds.study.iitm.ac.in`` -> ``bt413179``."""
    if not email or "@" not in email:
        return None
    return email.split("@", 1)[0].strip() or None


def _needs_a_name(staff: dict) -> bool:
    """True when the account has no usable name. Blank strings count as none."""
    return not (staff.get("name") or "").strip()


def _name_from_link(staff: dict, participants=participants_collection) -> str | None:
    """The name on the participant document ``admin_id`` points at."""
    admin_id = staff.get("admin_id")
    if not admin_id:
        return None
    linked = participants.find_one({"_id": admin_id}, {"profile.full_name": 1})
    return ((linked or {}).get("profile") or {}).get("full_name") or None


def _name_from_email(staff: dict, participants=participants_collection) -> str | None:
    """The name on a participant registered under the same email."""
    email = staff.get("email")
    if not email:
        return None
    match = participants.find_one({"email": email}, {"profile.full_name": 1})
    return ((match or {}).get("profile") or {}).get("full_name") or None


def backfill_staff_names(
    staff_collection=backend_teams_collection,
    participants=participants_collection,
    *,
    dry_run: bool = False,
    log=print,
) -> dict:
    """
    Fill in missing staff names and return a tally of what changed.

    ``no_source`` is the number left for a human: the database holds no name for
    them, and inventing one from a designation would misrepresent a fallback as a
    fact.
    """
    tally = {"from_link": 0, "from_email": 0, "already_named": 0, "no_source": 0}

    for staff in staff_collection.find({}):
        paradox_id = staff.get("paradox_id") or "<no paradox_id>"

        if not _needs_a_name(staff):
            tally["already_named"] += 1
            continue

        name = _name_from_link(staff, participants)
        source = "link"
        if not name:
            name = _name_from_email(staff, participants)
            source = "email"

        if not name:
            tally["no_source"] += 1
            # Say what the trail will show instead, so the report is actionable.
            fallback = staff.get("designation") or email_local_part(staff.get("email")) or "its id"
            log(f"  {paradox_id}: no name on record — the trail will show {fallback!r}")
            continue

        tally["from_link" if source == "link" else "from_email"] += 1
        log(f"  {paradox_id}: {name!r} (from {source})")

        if not dry_run:
            staff_collection.update_one(
                {"_id": staff["_id"]},
                {"$set": {"name": name, "updated_at": datetime.utcnow()}},
            )

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing to the database",
    )
    args = parser.parse_args()

    total = backend_teams_collection.count_documents({})
    print(
        f"Checking {total} staff account(s) for a missing name"
        + (" [dry run]" if args.dry_run else "")
    )

    tally = backfill_staff_names(dry_run=args.dry_run)

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    if tally["no_source"]:
        print(
            f"\n{tally['no_source']} account(s) still have no name. Set one with "
            "PUT /backend_teams/{paradox_id}, or leave them — the audit trail falls "
            "back to the designation, then the email, and never shows a blank."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
