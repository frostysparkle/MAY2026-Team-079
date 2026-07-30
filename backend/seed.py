import os
import random
from datetime import datetime, timedelta
from pymongo import MongoClient
from faker import Faker
from dotenv import load_dotenv

# Load credentials
load_dotenv("atlas-credentials.env")
MONGODB_URI = os.getenv("MONGODB_URI")
client = MongoClient(MONGODB_URI)
db = client["paradox"]

fake = Faker('en_IN') # Indian locale for names

def seed_database():
    print("Clearing existing data...")
    db.attendees.delete_many({})
    db.hostels.delete_many({})
    db.messes.delete_many({})
    db.slots.delete_many({})
    db.workshops.delete_many({})
    db.admins.delete_many({})
    db.events.delete_many({})

    # 1. Seed Hostels
    print("Seeding Hostels...")
    hostels = [
        {"hostel_id": "HS01", "hostel_name": "Alakananda", "gender": "male", "coordinator": fake.name(), "hostel_team": []},
        {"hostel_id": "HS02", "hostel_name": "Sharavati", "gender": "female", "coordinator": fake.name(), "hostel_team": []}
    ]
    db.hostels.insert_many(hostels)
    
    # 2. Seed Messes
    print("Seeding Messes...")
    messes = [
        {"mess_id": "MS01", "mess_name": "Himalaya", "caterer": "Firstman", "type": "South Indian", "mess_team": []},
        {"mess_id": "MS02", "mess_name": "Vindhya", "caterer": "RR", "type": "North Indian", "mess_team": []}
    ]
    db.messes.insert_many(messes)
    
    # 3. Seed Slots
    print("Seeding Slots...")
    slots = [
        {"slot_id": "Day1_Morning", "event_date": datetime(2026, 5, 29, 9, 0), "start_time": "09:00", "end_time": "12:00"},
        {"slot_id": "Day1_Afternoon", "event_date": datetime(2026, 5, 29, 14, 0), "start_time": "14:00", "end_time": "17:00"}
    ]
    db.slots.insert_many(slots)
    
    # 4. Seed Workshops
    print("Seeding Workshops...")
    workshops = [
        {
            "workshop_id": "WKS01", "slot_id": "Day1_Morning", "name": "Applications of GenAI",
            "venue": "CRC 203", "capacity": 100, "registration_count": 0, "attendee_count": 0,
            "instructions": "Bring your laptops.", "registrations": [], "on_spot_registrations": [], "workshop_team": []
        },
        {
            "workshop_id": "WKS02", "slot_id": "Day1_Morning", "name": "Robotics & IoT",
            "venue": "CRC 204", "capacity": 50, "registration_count": 0, "attendee_count": 0,
            "instructions": "Hardware kits provided.", "registrations": [], "on_spot_registrations": [], "workshop_team": []
        },
        {
            "workshop_id": "WKS03", "slot_id": "Day1_Afternoon", "name": "System Design at Scale",
            "venue": "ICSR Hall", "capacity": 200, "registration_count": 0, "attendee_count": 0,
            "instructions": "Open to all.", "registrations": [], "on_spot_registrations": [], "workshop_team": []
        }
    ]
    db.workshops.insert_many(workshops)
    
    # 5. Seed Attendees
    print("Seeding Attendees...")
    attendees = []
    houses = ["Wayanad House", "Godavari House", "Cauvery House", "Narmada House"]
    programs = ["DS", "ES", "AE", "MS"]
    
    for i in range(20):
        program = random.choice(programs)
        attendee_id = f"{program}23F{random.randint(100000, 999999)}"
        attendees.append({
            "attendee_id": attendee_id,
            "email": f"{attendee_id.lower()}@{program.lower()}.study.iitm.ac.in",
            "password_hash": "dummy_hash",  # Just fake data
            "profile": {
                "full_name": fake.name(),
                "dob": fake.date_of_birth(minimum_age=18, maximum_age=25).isoformat(),
                "house": random.choice(houses),
                "gender": random.choice(["male", "female"]),
                "phone": fake.phone_number(),
                "program": program,
                "course_stage": random.choice(["foundational", "diploma", "degree"]),
                "country": "India",
                "state": fake.state(),
                "city": fake.city(),
                "address": fake.address()
            },
            "access": {"registered": True, "hostel_paid": True, "mess_paid": True},
            "hostel_accommodation": {},
            "qr_secrets": {"private_key": "fake_private", "public_key": "fake_public"},
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        })
    db.attendees.insert_many(attendees)
    
    # 6. Seed Admins
    print("Seeding Admins...")
    admins = [
        {"role": "super_admin", "department": "all", "designation": "Fest Coordinator", "created_at": datetime.utcnow()},
        {"role": "admin", "department": "technicals", "designation": "Technical Head", "created_at": datetime.utcnow()},
        {"role": "admin", "department": "uhc", "designation": "UHC Head", "created_at": datetime.utcnow()}
    ]
    # Link admins to attendees
    for idx, admin in enumerate(admins):
        admin["admin_id"] = attendees[idx]["attendee_id"]
    db.admins.insert_many(admins)
    
    print("Database seeding completed successfully for Paradox '26!")

if __name__ == "__main__":
    seed_database()
