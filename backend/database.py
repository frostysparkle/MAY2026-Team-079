import os
from pymongo import MongoClient
from dotenv import load_dotenv

# Load the specific credentials file provided by the user
load_dotenv("atlas-credentials.env")

MONGODB_URI = os.getenv("MONGODB_URI")
if not MONGODB_URI:
    raise ValueError("MONGODB_URI is not set in atlas-credentials.env")

# Connect to MongoDB Atlas
client = MongoClient(MONGODB_URI)

# Use 'paradox' as the main database
db = client["paradox"]

# Export collections
attendees_collection = db["attendees"]
hostels_collection = db["hostels"]
messes_collection = db["messes"]
workshops_collection = db["workshops"]
slots_collection = db["slots"]
admins_collection = db["admins"]
