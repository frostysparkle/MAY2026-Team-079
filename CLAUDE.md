# Paradox Connect — Project Instructions

> **Note on provenance:** this file was reconstructed after the fact. The
> original was lost in an Aug 19 history rewrite and never existed in the
> surviving git history, yet `README.md` links here from its Contributing and
> Documentation sections. What follows records only what is observable in the
> README and the repository — nothing has been invented.

## Backend Freeze

> **🔒 The backend is frozen.** No changes may be made to anything under
> `backend/` — routes, schemas, auth, QR crypto, or the published API contract.
> Frontend code adapts to the backend, never the reverse. If a change appears to
> require touching `backend/`, stop and raise it with the team, including the
> exact file, line, and proposed diff, before any edit is made.

## Working Agreements

Conventions observed in this team's commits and code:

- **One concern per commit; no squash.** History reads as a series of focused,
  reviewable steps rather than periodic mega-commits.
- **Conventional-commit style messages** — `feat(scope):`, `fix(scope):`,
  `docs:`, `test:`, `chore:` — with a body that explains *why*, not just what.
- **Backend tests run against the in-memory seam:** set `TESTING=1` and
  `backend/database.py` swaps MongoDB for `mongomock.MongoClient()`, so tests
  need no running database.
- **Seed scripts are idempotent.** Re-running any of `backend/seed*.py` or
  `scripts/seed_demo_participants.py` is safe: existing catalogue entries are
  matched by id (upserted or skipped), never duplicated.
