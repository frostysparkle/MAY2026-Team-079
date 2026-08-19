import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
import random
import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from database import participants_collection, backend_teams_collection, workshops_collection, workshop_logs_collection
import security

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_data():
    workshops_collection.delete_many({})
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    # Setup test users and data
    rand_id = random.randint(100000, 999999)
    p_email = f"23f{rand_id}@ds.study.iitm.ac.in"
    password = "secure_password"
    
    # 1. Register a participant
    client.post("/auth/register", json={"email": p_email, "password": password})
    login_resp = client.post("/auth/login", json={"email": p_email, "password": password})
    p_token = login_resp.json()["access_token"]
    p_id = login_resp.json()["id"]
    p_pubkey = login_resp.json()["public_key"]

    # 2. Register Super Admin
    admin_rand = random.randint(100000, 999999)
    a_email = f"sa{admin_rand}@ds.study.iitm.ac.in"
    sa_id = f"SA{admin_rand}"
    
    # Clean up just in case
    backend_teams_collection.delete_one({"email": a_email})
    
    sa_pw_hash = security.get_password_hash("secure_password")
    backend_teams_collection.insert_one({
        "paradox_id": sa_id,
        "email": a_email,
        "password_hash": sa_pw_hash,
        "role": "super_admin",
        "department": "technicals",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    })
    
    sa_login = client.post("/auth/admin/login", json={"email": a_email, "password": "secure_password"})
    sa_token = sa_login.json()["access_token"]

    # 3. Create a Workshop
    ws_id = f"WKS_TEST_{random.randint(1000, 9999)}"
    now = datetime.utcnow()
    
    ws_payload = {
        "workshop_id": ws_id,
        "slot_id": f"SLOT_{random.randint(1000, 9999)}",
        "name": "Test Workshop",
        "description": "A test workshop.",
        "venue": "Test Venue",
        "capacity": 100,
        "instructions": "Bring laptop"
    }
    
    client.post("/workshops", json=ws_payload, headers={"Authorization": f"Bearer {sa_token}"})
    
    # Find generated doc
    ws_doc = workshops_collection.find_one({"workshop_id": ws_id})
    ws_doc_id = str(ws_doc["_id"])

    # 4. Assign Volunteer (Super Admin themselves)
    resp = client.post(f"/workshops/{ws_id}/volunteers", json={"user_id": sa_id, "role": "workshop_volunteer", "attendance": True}, headers={"Authorization": f"Bearer {sa_token}"})

    return {
        "p_token": p_token,
        "p_id": p_id,
        "p_email": p_email,
        "p_pubkey": p_pubkey,
        "sa_token": sa_token,
        "sa_id": sa_id,
        "ws_id": ws_id,
        "ws_doc_id": ws_doc_id,
        "slot_id": ws_payload["slot_id"]
    }

def test_workshop_pre_registration(setup_data):
    # Register for the workshop
    p_headers = {"Authorization": f"Bearer {setup_data['p_token']}"}
    resp = client.post(f"/workshops/{setup_data['ws_id']}/register", headers=p_headers)
    assert resp.status_code == 200
    assert resp.json()["message"] == "Successfully registered for workshop"
    
    # Check if log was created in workshop_logs
    logs = list(workshop_logs_collection.find({"workshop_id": setup_data['ws_doc_id'], "action": "registration"}))
    assert len(logs) > 0

def test_workshop_logs_retrieval(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    resp = client.get(f"/workshops/{setup_data['ws_id']}/logs", headers=sa_headers)
    assert resp.status_code == 200
    assert "logs" in resp.json()
    assert len(resp.json()["logs"]) > 0

def test_workshop_attendance_pre_registered(setup_data):
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
    
    # Attempt scan (The workshop starts in 10 mins, so pre-registered scanning is open (30 mins before))
    qr_payload = {
        "participant_id": setup_data['p_id'],
        "data": encrypted_b64,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
    
    resp = client.post(f"/workshops/{setup_data['ws_id']}/attendance?scan_type=pre-registered", json=qr_payload, headers=sa_headers)
    assert resp.status_code == 200
    assert "Pre-registered attendee marked present" in resp.json()["message"]

    # Verify attendance log was created
    logs = list(workshop_logs_collection.find({"workshop_id": setup_data['ws_doc_id'], "action": "attendance", "scan_type": "pre-registered"}))
    assert len(logs) > 0
