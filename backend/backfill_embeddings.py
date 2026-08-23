"""
Give existing ``event`` and ``workshops`` documents a real embedding.

Both collections have had an ``embedding`` field since 2026-08-19 (see
``routers/events.py::create_event`` and ``routers/workshops.py::create_workshop``),
generated from each record's ``description`` at creation/update time. Everything
created or updated through those routes since then already has one. What this
backfill is for:

* Records seeded before the embedding feature existed (``seed_events.py``,
  ``seed_workshops.py``, or a direct DB insert) — these have no ``embedding``
  key at all.
* Records carried over by the Atlas -> local database migration
  (``backend/.backups/migration-20260821/``) — a raw document copy, which does
  not go through ``create_event``/``create_workshop`` and so never calls
  ``generate_embedding``.
* Any record whose ``embedding`` is present but is a placeholder zero vector
  (``embedding_service.zero_embedding()``) rather than a real one — the result
  of a description being embedded while the embeddings provider was
  unreachable or misconfigured (see ``embedding_service.generate_embedding``'s
  fail-safe fallback).

A record is left alone if it already carries a real (non-zero, correctly
sized) embedding: re-running this script is safe and does nothing to records
already fixed, whether by this script or by a normal edit through the API.

Only ever writes ``embedding``. Nothing else on the document — name,
description, capacity, schedule, registration state — is read for any purpose
other than picking the text to embed, and nothing else is written.

Usage::

    python backfill_embeddings.py --dry-run
    python backfill_embeddings.py

Connection details come from ``database.py``, so this uses the same Mongo
instance (and the same ``TESTING=1`` in-memory fallback) as the API. The
embeddings provider comes from ``embedding_service.generate_embedding``, so it
is configured the same way the API is (``EMBEDDINGS_API_KEY`` /
``EMBEDDINGS_BASE_URL`` / ``EMBEDDINGS_MODEL`` in ``atlas-credentials.env``).
"""

import argparse
import time

from database import event_collection, workshops_collection
from embedding_service import EMBEDDING_DIMENSIONS, generate_embedding


def _needs_embedding(doc: dict) -> bool:
    """
    True when ``doc["embedding"]`` is missing, the wrong shape, or a
    placeholder zero vector rather than a real one.
    """
    emb = doc.get("embedding")
    if not isinstance(emb, list) or len(emb) != EMBEDDING_DIMENSIONS:
        return True
    return all(x == 0.0 for x in emb)


def _backfill_collection(
    collection,
    *,
    id_field: str,
    label: str,
    dry_run: bool,
    log,
    delay_seconds: float,
    text_fields: tuple[str, ...] = ("description",),
) -> dict:
    """
    Regenerate ``embedding`` for every document in ``collection`` that needs
    one. Text to embed comes from the first non-blank field in
    ``text_fields``, tried in order — e.g. workshop documents from before the
    ``description`` field existed carry only ``instructions``, which is
    passed as a fallback source rather than left unembeddable. Returns a
    tally of what happened.
    """
    tally = {"updated": 0, "already_had_one": 0, "no_description": 0, "failed": 0}

    for doc in collection.find({}):
        record_id = doc.get(id_field) or str(doc.get("_id"))
        name = doc.get("name") or "<no name>"

        if not _needs_embedding(doc):
            tally["already_had_one"] += 1
            continue

        description = ""
        source_field = None
        for field in text_fields:
            candidate = (doc.get(field) or "").strip()
            if candidate:
                description = candidate
                source_field = field
                break

        if not description:
            tally["no_description"] += 1
            log(f"  {label} {record_id} ({name!r}): no {'/'.join(text_fields)} to embed — skipped")
            continue

        log(f"  {label} {record_id} ({name!r}): would regenerate embedding from {source_field}"
            if dry_run else
            f"  {label} {record_id} ({name!r}): regenerating embedding from {source_field}...")

        if dry_run:
            tally["updated"] += 1
            continue

        vector = generate_embedding(description)
        if all(x == 0.0 for x in vector):
            # generate_embedding() fails safe rather than raising, so a
            # provider outage looks identical to a real all-zero result. Report
            # it as a failure here rather than silently writing the same
            # placeholder this backfill exists to replace.
            tally["failed"] += 1
            log(f"    -> embeddings provider returned a zero vector; left unchanged")
            continue

        collection.update_one({"_id": doc["_id"]}, {"$set": {"embedding": vector}})
        tally["updated"] += 1

        if delay_seconds:
            time.sleep(delay_seconds)

    return tally


def backfill_embeddings(
    *,
    dry_run: bool = False,
    log=print,
    delay_seconds: float = 0.0,
) -> dict:
    """Backfill both collections and return a tally keyed by collection name."""
    results = {}

    log("Events:")
    results["events"] = _backfill_collection(
        event_collection,
        id_field="event_id",
        label="event",
        dry_run=dry_run,
        log=log,
        delay_seconds=delay_seconds,
    )

    log("\nWorkshops:")
    results["workshops"] = _backfill_collection(
        workshops_collection,
        id_field="workshop_id",
        label="workshop",
        dry_run=dry_run,
        log=log,
        delay_seconds=delay_seconds,
        # Workshop documents seeded/migrated before the `description` field
        # existed carry only `instructions` — real prose about the session,
        # just under a different key. Falls back to it rather than leaving
        # these 58 records permanently unembeddable.
        text_fields=("description", "instructions"),
    )

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without calling the embeddings provider or writing to the database",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.0,
        help="Seconds to sleep between embedding calls (helps stay under a rate limit)",
    )
    args = parser.parse_args()

    ev_total = event_collection.count_documents({})
    ws_total = workshops_collection.count_documents({})
    print(
        f"Checking {ev_total} event(s) and {ws_total} workshop(s) for a missing/invalid embedding"
        + (" [dry run]" if args.dry_run else "")
    )
    print()

    results = backfill_embeddings(dry_run=args.dry_run, delay_seconds=args.delay)

    print("\nDone.")
    for collection_name, tally in results.items():
        print(f"  {collection_name}: " + " ".join(f"{k}={v}" for k, v in tally.items()))

    total_failed = sum(t["failed"] for t in results.values())
    if total_failed:
        print(
            f"\n{total_failed} record(s) could not be embedded (the provider returned a zero "
            "vector — check EMBEDDINGS_API_KEY/EMBEDDINGS_BASE_URL and re-run; already-fixed "
            "records are skipped on a re-run)."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
