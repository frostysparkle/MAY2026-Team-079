"""
Encrypt the RSA private keys already sitting in ``participants``.

``qr_secrets.private_key`` is what every scanner endpoint uses to unwrap a
participant's QR payload — in other words it *is* the attendee's digital
identity. Registration writes new keys envelope-encrypted (AES-256-GCM under
``QR_MASTER_KEY``, values prefixed ``enc:v1:``; see ``security.py``), but rows
created before that change still hold plaintext PEM, so one DB dump would read
as a keyring for every attendee registered before the fix. This script closes
that window: it finds every participant whose stored private key lacks the
``enc:v1:`` prefix and rewrites just that field, in place.

The master key comes from ``QR_MASTER_KEY`` — the exact key the API process
runs with, loaded through ``database.py`` from ``backend/atlas-credentials.env``
(or the process environment). Running this against an environment whose key
differs from the API's would encrypt rows into unreadability at scan time; if
the key is missing or malformed the script refuses to start rather than guess.

Safe to re-run: encrypted rows are skipped by the same prefix check the read
path uses, so a second pass finds nothing to do. Only ``qr_secrets.private_key``
is ever written — the public half stays plaintext and no other field moves.

Usage::

    python migrate_qr_keys.py --dry-run   # report only, write nothing
    python migrate_qr_keys.py             # encrypt pending rows in place

Connection details come from ``database.py``, so this uses the same Mongo
instance (and the same ``TESTING=1`` in-memory fallback) as the API. Exits
non-zero if any row failed to convert.
"""

import argparse

from database import participants_collection
from security import ENVELOPE_PREFIX, encrypt_private_key


def migrate_qr_keys(
    participants=participants_collection,
    *,
    dry_run: bool = False,
    log=print,
) -> dict:
    """
    Encrypt every plaintext ``qr_secrets.private_key`` and return a tally.

    ``encrypted``  — rows converted (or, under --dry-run, that *would* be).
    ``skipped``    — rows already carrying the enc:v1: prefix (nothing to do).
    ``errors``     — rows that could not be converted and were left untouched.
    """
    tally = {"encrypted": 0, "skipped": 0, "errors": 0}

    # Bulk-ish pass over the whole collection; the prefix filter is applied per
    # row rather than in the query so mongomock-backed collections and real
    # ones behave identically.
    for participant in participants.find({}):
        participant_id = participant.get("participant_id", "<no id>")

        try:
            secrets = participant.get("qr_secrets") or {}
            stored = secrets.get("private_key")

            if stored is None:
                log(f"  {participant_id}: no private_key on record — skipped")
                tally["skipped"] += 1
                continue

            if stored.startswith(ENVELOPE_PREFIX):
                tally["skipped"] += 1
                continue

            # Encrypt first, update second: a failure here leaves the row as
            # it was instead of half-migrated.
            sealed = encrypt_private_key(stored)
        except RuntimeError:
            # Master-key problems (missing/malformed) are environmental, not
            # row-specific — abort instead of reporting the same error N times.
            raise
        except Exception as exc:
            log(f"  {participant_id}: ERROR — {exc}")
            tally["errors"] += 1
            continue

        if not dry_run:
            participants.update_one(
                {"_id": participant["_id"]},
                {"$set": {"qr_secrets.private_key": sealed}},
            )
        tally["encrypted"] += 1

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing to the database",
    )
    args = parser.parse_args()

    try:
        total = participants_collection.count_documents({})
        print(
            f"Checking {total} participant(s) for a plaintext qr_secrets.private_key"
            + (" [dry run]" if args.dry_run else "")
        )
        tally = migrate_qr_keys(dry_run=args.dry_run)
    except RuntimeError:
        # The fail-fast message from security.py already carries generation
        # instructions; let it reach the operator verbatim.
        raise
    except Exception as exc:
        print(f"Migration aborted: {exc}")
        return 1

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    if tally["errors"]:
        print(
            f"\n{tally['errors']} row(s) failed to convert and were left "
            "untouched. Fix the cause above and re-run — completed rows are "
            "skipped on the next pass."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
