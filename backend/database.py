import os
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

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

if os.getenv("TESTING") == "1":
    import mongomock
    client = mongomock.MongoClient()
else:
    client = MongoClient(MONGODB_URI)

# Use 'paradox' as the main database
db = client["paradox"]

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
# participant writes free text that a *different* user — a member of the block,
# hall, or event team it concerns — reads back. Every other participant-writable
# field is either readable only by its own author or is load-bearing data a
# query would corrupt, which is why this needed a collection of its own.
queries_collection = db["queries"]
# Participant-reported hostel and mess faults — story 5.4. A collection of its
# own rather than a field on the participant or the facility, because a report
# has to be readable by somebody other than its author and writable by somebody
# other than the facility's owner, and no existing document allows both.
issues_collection = db["issues"]
