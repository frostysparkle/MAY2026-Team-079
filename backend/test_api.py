import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
import random
import os
from dotenv import load_dotenv

# Ensure env file loaded
load_dotenv("atlas-credentials.env")

from main import app
from database import participants_collection, backend_teams_collection, event_collection, mess_collection, hostel_collection, workshops_collection
import security

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_test_users():
    from database import participants_collection, backend_teams_collection, event_collection, mess_collection, hostel_collection, workshops_collection
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    event_collection.delete_many({})
    mess_collection.delete_many({})
    hostel_collection.delete_many({})
    workshops_collection.delete_many({})
    rand_id = random.randint(100000, 999999)
    p_email = f"23f{rand_id}@ds.study.iitm.ac.in"
    password = "secure_password"
    
    # Register participant
    client.post("/auth/register", json={"email": p_email, "password": password})
    login_resp = client.post("/auth/login", json={"email": p_email, "password": password})
    p_token = login_resp.json()["access_token"]
    p_id = login_resp.json()["id"]
    p_pubkey = login_resp.json()["public_key"]

    # Super Admin in backend_teams
    admin_rand = random.randint(100000, 999999)
    a_email = f"sa{admin_rand}@ds.study.iitm.ac.in"
    sa_id = f"SA{admin_rand}"
    backend_teams_collection.insert_one({
        "paradox_id": sa_id,
        "email": a_email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "technicals",
        "created_at": datetime.utcnow()
    })
    sa_login = client.post("/auth/login", json={"email": a_email, "password": "secure_password"})
    
    # Setup test hostel & mess
    hostel_collection.update_one({"hostel_id": "H01"}, {"$set": {"name": "Alakhnanda", "capacity": 100, "gender": "male", "hostel_team": [{"user_id": sa_id}]}}, upsert=True)
    mess_collection.update_one({"mess_id": "M01"}, {"$set": {"name": "Himalaya", "capacity": 100, "preference": "veg", "caterer": "Firstman", "mess_team": [{"user_id": sa_id}]}}, upsert=True)
    workshops_collection.update_one({"slot_id": "12A"}, {"$set": {"name": "AI Workshop", "capacity": 100, "registration_count": 0, "workshop_team": [{"user_id": sa_id}]}}, upsert=True)

    return {
        "p_token": p_token,
        "p_id": p_id,
        "p_email": p_email,
        "p_pubkey": p_pubkey,
        "sa_token": sa_login.json()["access_token"],
        "sa_id": sa_id
    }

def test_register_and_login(setup_test_users):
    assert setup_test_users["p_token"] is not None
    assert setup_test_users["p_id"].startswith("DS23F")

def test_profile_completion(setup_test_users):
    headers = {"Authorization": f"Bearer {setup_test_users['p_token']}"}
    payload = {
        "full_name": "Test Participant",
        "dob": "2002-04-21",
        "house": "Wayanad House",
        "gender": "male",
        "phone": "+919999999999",
        "mess_preference": "Jain",
        "country": "India",
        "state": "Karnataka",
        "city": "Bangalore",
        "address": "53/7, Koramangala",
        "emergency_contact": {
            "name": "Father Name",
            "relation": "father",
            "phone": "+919488888888"
        },
        "program": "DS",
        "course_stage": "degree",
        "photo": "data:image/png;base64,mock"
    }
    response = client.patch("/profile/complete", headers=headers, json=payload)
    assert response.status_code == 200
    assert response.json()["house"] == "Wayanad House"

def test_create_and_register_event(setup_test_users):
    # Create event as super admin
    sa_headers = {"Authorization": f"Bearer {setup_test_users['sa_token']}"}
    event_payload = {
        "event_id": "EVT_TEST_01",
        "event_type": "technical",
        "name": "Hackathon 2026",
        "description": "24hr Hackathon",
        "poster": "base64...",
        "team": {"min": 1, "max": 4, "house": False, "allow_single_registration": True},
        "prize_money": [{"position": "1st", "amount": 5000}],
        "registration": {"start_time": "2026-08-12T00:00:00Z", "end_time": "2026-08-20T00:00:00Z"},
        "schedule": [{"name": "Round 1", "start_time": "2026-08-12T00:00:00Z", "end_time": "2026-08-12T05:00:00Z"}],
        "registration_fields": [{"field_id": "github", "label": "GitHub", "type": "url", "required": True}]
    }
    create_resp = client.post("/events", headers=sa_headers, json=event_payload)
    assert create_resp.status_code == 200

    # Register as participant
    p_headers = {"Authorization": f"Bearer {setup_test_users['p_token']}"}
    reg_resp = client.post("/events/EVT_TEST_01/register", headers=p_headers, json={"registration_data": {"github": "https://github.com/test"}})
    assert reg_resp.status_code == 200

def test_workshop_registration(setup_test_users):
    p_headers = {"Authorization": f"Bearer {setup_test_users['p_token']}"}
    resp = client.post("/workshops/12A/register", headers=p_headers)
    assert resp.status_code == 200
