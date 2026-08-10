import pytest
from fastapi.testclient import TestClient
from main import app
from database import attendees_collection, admins_collection
import random
from datetime import datetime, timedelta
import json
import base64
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding

client = TestClient(app)

def encrypt_qr_payload(public_key_pem: str, attendee_id: str) -> str:
    public_key = serialization.load_pem_public_key(public_key_pem.encode('utf-8'))
    payload = json.dumps({"attendee_id": attendee_id}).encode('utf-8')
    ciphertext = public_key.encrypt(
        payload,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    )
    return base64.b64encode(ciphertext).decode('utf-8')

@pytest.fixture(scope="module")
def admin_user():
    rand_id = random.randint(10000, 99999)
    email = f"admin{rand_id}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    token = login.json()["access_token"]
    
    user = attendees_collection.find_one({"email": email})
    attendee_id = user["attendee_id"]
    public_key = user["qr_secrets"]["public_key"]
    
    # Elevate to super admin
    admins_collection.insert_one({"admin_id": attendee_id, "role": "super_admin", "department": "all"})
    return {"token": token, "attendee_id": attendee_id, "public_key": public_key}

@pytest.fixture(scope="module")
def regular_user():
    rand_id = random.randint(10000, 99999)
    email = f"user{rand_id}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"})
    token = login.json()["access_token"]
    
    user = attendees_collection.find_one({"email": email})
    return {"token": token, "attendee_id": user["attendee_id"], "public_key": user["qr_secrets"]["public_key"]}

def test_api_events_create_admin(admin_user):
    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    payload = {"event_id": "EV_TEST_1", "name": "Hackathon", "department": "technicals", "venue": "CRC", "rounds": 1, "poc_id": "123"}
    resp = client.post("/events", json=payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["message"] == "Event created"

def test_api_events_create_forbidden(regular_user):
    headers = {"Authorization": f"Bearer {regular_user['token']}"}
    payload = {"event_id": "EV_TEST_2", "name": "Bad Event", "department": "technicals", "venue": "CRC", "rounds": 1, "poc_id": "123"}
    resp = client.post("/events", json=payload, headers=headers)
    assert resp.status_code == 403
    assert "Only Super Admins can create events" in resp.json()["detail"]

def test_api_workshop_scanner_on_spot(admin_user, regular_user):
    encrypted_b64 = encrypt_qr_payload(regular_user["public_key"], regular_user["attendee_id"])
    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    payload = {
        "attendee_id": regular_user["attendee_id"],
        "data": encrypted_b64,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
    resp = client.post("/workshops/WKS03/attendance", json=payload, headers=headers)
    assert resp.status_code == 200
    assert "On-spot registration successful" in resp.json()["message"]

def test_api_workshop_scanner_expired_qr(admin_user, regular_user):
    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    past_timestamp = (datetime.utcnow() - timedelta(minutes=2)).isoformat() + "Z"
    payload = {
        "attendee_id": regular_user["attendee_id"],
        "data": "dummy_data",
        "timestamp": past_timestamp
    }
    resp = client.post("/workshops/WKS03/attendance", json=payload, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "QR Code expired"

def test_api_event_registration(regular_user):
    headers = {"Authorization": f"Bearer {regular_user['token']}"}
    resp = client.post("/events/EV_TEST_1/register", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["message"] == "Registered for event"

def test_api_events_list_rbac(admin_user):
    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    resp = client.get("/events", headers=headers)
    assert resp.status_code == 200
    # Admin gets all data including registrations
    assert "registrations" in resp.json()[0]
