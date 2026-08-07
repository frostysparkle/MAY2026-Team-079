import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("atlas-credentials.env")

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/paradox")

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
