"""
Report duplicate identities, and — with ``--confirm`` — enforce them with unique indexes.

Three fields are identity in this application, and none of them had a unique index:

* ``participants.email`` — the address a person signs in with.
* ``participants.participant_id`` — derived from that address by
  ``routers.auth.generate_participant_id``, and the key every roster, audit row, QR
  payload, and workshop booking joins on.
* ``backend_teams.paradox_id`` — the staff equivalent, joined on by every duty roster
  and every scan record.

Without an index, nothing at the database level stopped two documents sharing one of
them. ``POST /auth/register`` now normalises and compares addresses case-insensitively,
which closes the route that produced duplicates, but application-level checks are
racy by construction: two simultaneous registrations can both pass the "is this taken"
read before either writes. An index is the only thing that makes the guarantee real.

The ids are generated from in-memory counters that restart from a hardcoded seed on
every process restart and never consult the database (see ``id_generator``), so a
restarted process re-issues ids it has already handed out. ``create_hostel`` and
``create_workshop`` detect that and log it; an index on ``paradox_id`` turns the staff
case from a silent duplicate into a refused write.

**This script is a report by default and changes nothing.** The report is read-only:
it counts documents and groups them. Only ``--confirm`` creates indexes, and index
creation *fails* if duplicates already exist — which is exactly why the report comes
first.

Deliberately not wired into application startup. Index creation is data-dependent and
can fail, so it does not belong in the boot path: against a local mongod that would be
an annoyance, but against a remote cluster it would be an outage on a data condition,
and a large collection takes time to build. Run it when you choose.

Usage::

    python enforce_identity_indexes.py              # report only, changes nothing
    python enforce_identity_indexes.py --confirm    # create the indexes

Deployment note. This is safe to run more than once: ``create_index`` is idempotent
when the specification matches, and the summary distinguishes what it created from
what already existed. The same invocation therefore serves both the local development
database and a MongoDB Atlas cluster at deploy time — run the report first in either
case, since duplicates in one environment say nothing about the other. Connection
details come from ``database.py``, so this targets whatever ``MONGODB_URI`` points at
(and honours the same ``TESTING=1`` in-memory fallback as the API).
"""

import argparse
from collections import Counter

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError, OperationFailure

from database import backend_teams_collection, participants_collection

# (collection, field, index name). One entry per field that is identity.
IDENTITY_FIELDS = [
    (participants_collection, "email", "uniq_participants_email"),
    (participants_collection, "participant_id", "uniq_participants_participant_id"),
    (backend_teams_collection, "paradox_id", "uniq_backend_teams_paradox_id"),
]


def find_duplicates(collection, field: str) -> dict:
    """
    Values of ``field`` held by more than one document, and how many hold each.

    Read-only. Compared case-insensitively for ``email``, because that is the identity
    rule the application now applies: ``A@x`` and ``a@x`` are one person, so two
    documents holding them are duplicates even though a naive index on the raw string
    would accept both.
    """
    counts: Counter = Counter()
    for document in collection.find({}, {field: 1, "_id": 0}):
        value = document.get(field)
        if value is None:
            continue
        counts[value.lower() if field == "email" and isinstance(value, str) else value] += 1
    return {value: count for value, count in counts.items() if count > 1}


def missing_field_count(collection, field: str) -> int:
    """
    Documents with no usable value for this field at all.

    Worth reporting separately: a unique index permits at most **one** document
    missing an indexed field, so several such documents block the index for a reason
    that has nothing to do with duplicate identities.

    One query, not two: an equality match against ``None`` already covers both an
    explicit null and an absent key, so testing ``$exists`` as well would count the
    absent ones twice.
    """
    return collection.count_documents({field: None})


def survey(fields=IDENTITY_FIELDS) -> list:
    """The read-only half: what is in the way, per field."""
    findings = []
    for collection, field, index_name in fields:
        duplicates = find_duplicates(collection, field)
        findings.append(
            {
                "collection": collection.name,
                "field": field,
                "index": index_name,
                "documents": collection.count_documents({}),
                "duplicates": duplicates,
                "affected_documents": sum(duplicates.values()),
                "missing": missing_field_count(collection, field),
            }
        )
    return findings


def create_indexes(fields=IDENTITY_FIELDS, log=print) -> list:
    """
    Create each unique index, reporting what happened per field.

    Each is attempted independently: one field blocked by duplicates must not stop the
    others being enforced. A collation-free ascending index on the stored value —
    ``routers.auth`` normalises addresses on write, so the stored form is already
    canonical for anything registered through the API.
    """
    results = []
    for collection, field, index_name in fields:
        existing = index_name in collection.index_information()
        try:
            collection.create_index([(field, ASCENDING)], name=index_name, unique=True)
            results.append({"index": index_name, "status": "existed" if existing else "created"})
        except (DuplicateKeyError, OperationFailure) as exc:
            # The expected failure when duplicates are present. Reported rather than
            # raised, so the remaining fields are still attempted.
            results.append({"index": index_name, "status": "blocked", "error": str(exc)})
            log(f"  {index_name}: BLOCKED — {exc}")
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually create the indexes. Without this, the script only reports.",
    )
    args = parser.parse_args()

    findings = survey()

    print()
    for finding in findings:
        print(f"{finding['collection']}.{finding['field']}")
        print(f"  documents            : {finding['documents']}")
        print(f"  duplicate values     : {len(finding['duplicates'])}")
        print(f"  documents affected   : {finding['affected_documents']}")
        print(f"  missing this field   : {finding['missing']}")
        for value, count in sorted(finding["duplicates"].items(), key=lambda item: -item[1]):
            print(f"    {value!r} held by {count} documents")
        print()

    blocked = [f for f in findings if f["duplicates"] or f["missing"] > 1]

    if not args.confirm:
        if blocked:
            print("These fields cannot be indexed until the duplicates above are resolved.")
            print("In a development database the cheapest fix is usually to reseed.")
        else:
            print("No duplicates found. Re-run with --confirm to create the unique indexes.")
        print()
        print("Nothing was changed.")
        return 0

    print("Creating unique indexes:")
    for result in create_indexes():
        print(f"  {result['index']:<40} {result['status']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
