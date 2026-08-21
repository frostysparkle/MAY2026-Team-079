import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("atlas-credentials.env")

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
