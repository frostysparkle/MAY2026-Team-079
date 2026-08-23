import logging
import os
import re
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

import log_config

_log = log_config.get_logger("paradox.database")

# Loaded by absolute path, resolved from this file rather than the current working
# directory. The previous relative `load_dotenv("atlas-credentials.env")` only
# found the file when the process happened to start inside `backend/`; anywhere
# else it was silently skipped, which also dropped SECRET_KEY and left the JWT
# signing key on its committed default.
load_dotenv(Path(__file__).resolve().parent / "atlas-credentials.env")

# The database now runs locally. `MONGODB_URI` in atlas-credentials.env points at
# the local mongod; the default below is the same target so a missing env file
# degrades to the correct host instead of a remote one.
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/paradox")

# How long a driver operation waits for a reachable server before giving up.
#
# pymongo's default is 30 seconds, and `MongoClient(...)` connects lazily, so a
# stopped mongod produced no error at startup and then a half-minute hang on
# whichever endpoint first touched a collection — surfacing as an opaque 500 long
# after the client had given up. Five seconds still absorbs a brief blip while
# failing fast enough that the cause is recognisable as "the database is down".
SERVER_SELECTION_TIMEOUT_MS = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "5000"))


def safe_uri(uri: str = MONGODB_URI) -> str:
    """
    The connection target with any credentials stripped, for logging.

    `mongodb://user:pass@host/db` -> `mongodb://***@host/db`. Which host the app
    is pointed at is one of the first things worth knowing when data is
    unexpectedly missing — a stale env file aiming at the wrong database looks
    identical to an empty one — and the password is no part of that.
    """
    try:
        return re.sub(r"://[^/@]*@", "://***@", uri)
    except Exception:  # pragma: no cover - defensive
        return "[unparseable uri]"


if os.getenv("TESTING") == "1":
    import mongomock
    client = mongomock.MongoClient()
    _log.info("Mongo client: in-memory mongomock (TESTING=1)", extra={"backend": "mongomock"})
else:
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=SERVER_SELECTION_TIMEOUT_MS)
    _log.info(
        "Mongo client created for %s",
        safe_uri(),
        extra={
            "backend": "pymongo",
            "uri": safe_uri(),
            "server_selection_timeout_ms": SERVER_SELECTION_TIMEOUT_MS,
        },
    )

# Use 'paradox' as the main database
db = client["paradox"]


def check_connection() -> bool:
    """
    Ping the database and report what answered.

    Called once from the startup hook. It exists because nothing ever verified
    connectivity: the client is lazy, so the app booted cleanly against a dead
    database and only revealed it request by request. Now the very first lines in
    the log say whether the database is reachable, which host answered, and how
    much data is actually in it.

    Deliberately does **not** prevent startup on failure. A health check that
    refuses to boot converts a recoverable outage — a database that comes back a
    minute later — into an application that has to be manually restarted. It logs
    at CRITICAL and returns False instead.
    """
    try:
        info = client.admin.command("ping")
        server_version = None
        try:
            server_version = client.server_info().get("version")
        except Exception:
            # `ping` succeeding is what matters; the version is a nicety.
            pass

        _log.info(
            "Database reachable",
            extra={
                "uri": safe_uri(),
                "database": db.name,
                "server_version": server_version,
                "ping_ok": bool(info.get("ok", 0)),
                "participants": participants_collection.estimated_document_count(),
                "staff": backend_teams_collection.estimated_document_count(),
                "audit_rows": system_logs_collection.estimated_document_count(),
            },
        )
        return True
    except Exception:
        _log.critical(
            "Database unreachable at %s — requests touching Mongo will fail until it returns",
            safe_uri(),
            extra={
                "uri": safe_uri(),
                "database": "paradox",
                "server_selection_timeout_ms": SERVER_SELECTION_TIMEOUT_MS,
                "reason": "mongo_unreachable",
            },
            exc_info=True,
        )
        return False

# Export collections strictly mapping to new database design (database.txt)
mess_collection = db["mess"]
hostel_collection = db["hostel"]
workshops_collection = db["workshops"]
# Slot definitions (D1S1, D2S2, ...) created independently by Super Admins.
# A workshop references one of these by slot_id and denormalizes its
# start_time at creation time; editing/deleting a slot cascades to every
# workshop referencing it. See routers/workshop_slots.py.
workshop_slots_collection = db["workshop_slots"]
event_collection = db["event"]
backend_teams_collection = db["backend_teams"]
participants_collection = db["participants"]
workshop_logs_collection = db["workshop_logs"]
event_logs_collection = db["event_logs"]
system_logs_collection = db["system_logs"]
# Participant-raised queries (Epic 6). The one channel in the API by which a
# participant writes free text that a *different* user — a member of the
# query resolution team — reads back. Every other participant-writable field
# is either readable only by its own author or is load-bearing data a query
# would corrupt, which is why this needed a collection of its own.
queries_collection = db["queries"]
# The query resolution team roster: a flat, category-agnostic list of staff
# who may see and handle every query, managed by Super Admins. Deliberately a
# collection of its own rather than an array embedded in a query or another
# document — a roster of who-can-answer is membership data, the same kind of
# thing `backend_teams_collection` already is, not a property of any one query.
query_team_collection = db["query_team"]
# Participant-reported hostel and mess faults — story 5.4. A collection of its
# own rather than a field on the participant or the facility, because a report
# has to be readable by somebody other than its author and writable by somebody
# other than the facility's owner, and no existing document allows both.
issues_collection = db["issues"]
