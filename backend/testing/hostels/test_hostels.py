import pytest
from fastapi.testclient import TestClient
from datetime import datetime
import random
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from main import app
from database import participants_collection, backend_teams_collection, hostel_collection
import security

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_data():
    hostel_collection.delete_many({})
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    rand_id = random.randint(100000, 999999)
    p_email = f"23f{rand_id}@ds.study.iitm.ac.in"
    password = "secure_password"
    
    # Register and get participant token
    client.post("/auth/register", json={"email": p_email, "password": password})
    login_resp = client.post("/auth/login", json={"email": p_email, "password": password})
    p_token = login_resp.json()["access_token"]
    p_id = login_resp.json()["id"]
    p_pubkey = login_resp.json()["public_key"]

    # Assign a gender
    client.patch("/profile/complete", json={
        "full_name": "Test User", "dob": "2000-01-01", "house": "Ganga",
        "gender": "Male", "phone": "1234567890", "mess_preference": "veg",
        "country": "India", "state": "TN", "city": "Chennai", "address": "IITM",
        "program": "BS", "course_stage": "Diploma"
    }, headers={"Authorization": f"Bearer {p_token}"})
    participants_collection.update_one({"participant_id": p_id}, {"$set": {"accommodation.registered": True}})


    # Register super admin
    admin_rand = random.randint(100000, 999999)
    a_email = f"sa{admin_rand}@ds.study.iitm.ac.in"
    sa_id = f"SA{admin_rand}"
    
    backend_teams_collection.insert_one({
        "paradox_id": sa_id,
        "email": a_email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "technicals",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    })
    
    sa_login = client.post("/auth/login", json={"email": a_email, "password": "secure_password"})
    sa_token = sa_login.json()["access_token"]
    
    hostel_id = f"HSTL_TEST_{random.randint(1000, 9999)}"

    return {
        "p_token": p_token,
        "p_id": p_id,
        "p_pubkey": p_pubkey,
        "sa_token": sa_token,
        "sa_id": sa_id,
        "hostel_id": hostel_id
    }

def test_hostel_crud_and_allocation(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    p_headers = {"Authorization": f"Bearer {setup_data['p_token']}"}
    
    # 1. Create Hostel
    hostel_payload = {
        "hostel_id": setup_data["hostel_id"],
        "name": "Brahmaputra",
        "capacity": 10,
        "gender": "Male",
        "coordinator": {"user_id": setup_data["sa_id"], "name": "Admin Coordinator"}
    }
    resp = client.post("/hostels", json=hostel_payload, headers=sa_headers)
    assert resp.status_code == 200
    
    # 2. Assign team member
    team_payload = {"user_id": setup_data["sa_id"], "role": "other"} 
    resp = client.post(f"/hostels/{setup_data['hostel_id']}/team", json=team_payload, headers=sa_headers)
    assert resp.status_code == 200
    
    # 3. Allocate Hostels
    resp = client.post("/hostels/allocate", headers=sa_headers)
    assert resp.status_code == 200
    
    # 4. Verify participant allotted correct hostel and room starts at 100
    resp = client.get("/hostels/my_hostel", headers=p_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["assigned_hostel"] == setup_data["hostel_id"]
    assert int(data["room"]) >= 100

def test_hostel_scanning(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    
    import base64
    import json
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    
    public_key = serialization.load_pem_public_key(setup_data['p_pubkey'].encode('utf-8'))
    payload_str = json.dumps({"participant_id": setup_data['p_id']}).encode('utf-8')
    ciphertext = public_key.encrypt(
        payload_str,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
    )
    encrypted_b64 = base64.b64encode(ciphertext).decode('utf-8')
    
    qr_payload = {
        "participant_id": setup_data['p_id'],
        "data": encrypted_b64,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
    
    # 1. Scan Entry (Currently logged_in=False from allocation)
    resp = client.post(f"/hostels/{setup_data['hostel_id']}/scan?action=entry", json=qr_payload, headers=sa_headers)
    assert resp.status_code == 200
    
    # 2. Re-scan Entry should fail
    resp2 = client.post(f"/hostels/{setup_data['hostel_id']}/scan?action=entry", json=qr_payload, headers=sa_headers)
    assert resp2.status_code == 400
    assert "already inside" in resp2.json()["detail"]
    
    # 3. Scan Exit
    resp3 = client.post(f"/hostels/{setup_data['hostel_id']}/scan?action=exit", json=qr_payload, headers=sa_headers)
    assert resp3.status_code == 200

def test_hostel_statistics(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    
    resp = client.get(f"/hostels/{setup_data['hostel_id']}/statistics", headers=sa_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_allocated"] > 0
    assert data["currently_inside"] == 0 # We just exited
    assert data["capacity"] == 10
