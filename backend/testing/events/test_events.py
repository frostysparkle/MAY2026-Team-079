import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
import random
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from main import app
from database import participants_collection, backend_teams_collection, event_collection
import security

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_data():
    event_collection.delete_many({})
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    rand_id = random.randint(100000, 999999)
    p_email = f"23f{rand_id}@ds.study.iitm.ac.in"
    password = "secure_password"
    
    client.post("/auth/register", json={"email": p_email, "password": password})
    login_resp = client.post("/auth/login", json={"email": p_email, "password": password})
    p_token = login_resp.json()["access_token"]
    p_id = login_resp.json()["id"]

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
    
    sa_login = client.post("/auth/admin/login", json={"email": a_email, "password": "secure_password"})
    sa_token = sa_login.json()["access_token"]

    now = datetime.utcnow()
    ev_payload = {
        "event_type": "technical",
        "name": "Hackathon",
        "description": "24 hours hackathon",
        "team": {"min": 2, "max": 4, "house_vs_house_event": False, "allow_single_registration": True},
        "registration": {
            "start_time": (now - timedelta(hours=1)).isoformat() + "Z",
            "end_time": (now + timedelta(days=30)).isoformat() + "Z",
            "allowed": True,
        },
    }

    ev_id = client.post(
        "/events", json=ev_payload, headers={"Authorization": f"Bearer {sa_token}"}
    ).json()["event_id"]

    # Being a Super Admin is not by itself authority over an event: allocating
    # teams needs an event_head, and scanning needs any event_team member. The
    # admin is put on this event's team so those tests exercise the endpoints
    # rather than stopping at the permission check.
    client.post(
        f"/events/{ev_id}/team",
        json={"user_id": sa_id, "role": "event_head"},
        headers={"Authorization": f"Bearer {sa_token}"},
    )

    return {
        "p_token": p_token,
        "p_id": p_id,
        "sa_token": sa_token,
        "ev_id": ev_id
    }

def test_event_registration(setup_data):
    p_headers = {"Authorization": f"Bearer {setup_data['p_token']}"}
    
    resp = client.post(f"/events/{setup_data['ev_id']}/register", headers=p_headers, json={"registration_data": {"github": "test"}})
    assert resp.status_code == 200
    assert resp.json()["message"] == "Registered for event successfully."
    
    resp_get = client.get(f"/events/my_registrations", headers=p_headers)
    assert resp_get.status_code == 200
    assert len(resp_get.json()) > 0
    assert resp_get.json()[0]["team_role"] == "member"

def test_event_team_assignment(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}

    # `user_id` must reference an existing backend_teams member (Task 4:
    # one-person-one-event enforcement needs a real staff record to check).
    backend_teams_collection.insert_one({
        "paradox_id": "VO123",
        "email": f"vo123_{random.randint(1000,9999)}@ds.study.iitm.ac.in",
        "password_hash": security.get_password_hash("secure_password"),
        "role": "volunteer",
        "department": "technicals",
        "designation": "Volunteer",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })

    resp = client.post(f"/events/{setup_data['ev_id']}/team", headers=sa_headers, json={"user_id": "VO123", "role": "member"})
    assert resp.status_code == 200

def test_event_participation_view(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    
    resp = client.get(f"/events/{setup_data['ev_id']}/participation", headers=sa_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] > 0
    assert len(data["event_team"]) >= 0

def test_event_allocate_teams(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    
    resp = client.post(f"/events/{setup_data['ev_id']}/allocate_teams", headers=sa_headers)
    assert resp.status_code == 200
    assert "Allocated" in resp.json()["message"]

def test_uhc_stats_exclusion(setup_data):
    # Register an UpperHouseCouncil admin
    uhc_email = f"uhc{random.randint(1000, 9999)}@ds.study.iitm.ac.in"
    uhc_id = f"UHC{random.randint(1000, 9999)}"
    
    backend_teams_collection.insert_one({
        "paradox_id": uhc_id,
        "email": uhc_email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "admin",
        "department": "uhc",
        "designation": "UHC Member",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    })
    
    uhc_login = client.post("/auth/admin/login", json={"email": uhc_email, "password": "secure_password"})
    uhc_token = uhc_login.json()["access_token"]
    
    uhc_headers = {"Authorization": f"Bearer {uhc_token}"}
    resp = client.get(f"/events/{setup_data['ev_id']}/participation", headers=uhc_headers)
    
    assert resp.status_code == 200
    data = resp.json()
    assert "total_daily_scans" not in data  # UHC should not see this

def test_daily_unique_scans_and_qr(setup_data):
    # Use Super Admin token for scanning
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    
    # 1. Fetch Participant Profile to get pubkey
    p_doc = participants_collection.find_one({"participant_id": setup_data['p_id']})
    p_pubkey = p_doc.get("qr_secrets", {}).get("public_key")
    
    # Generate QR Payload
    import base64
    import json
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    
    public_key = serialization.load_pem_public_key(p_pubkey.encode('utf-8'))
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
    
    # Scan endpoint
    resp = client.post(f"/events/{setup_data['ev_id']}/scan", json=qr_payload, headers=sa_headers)
    assert resp.status_code == 200
    assert resp.json()["is_participating"] == True
    
    # Re-scan to test unique counting
    resp2 = client.post(f"/events/{setup_data['ev_id']}/scan", json=qr_payload, headers=sa_headers)
    assert resp2.status_code == 200
    
    # Check daily scan count logic for volunteer
    scan_resp = client.get(f"/events/{setup_data['ev_id']}/my_daily_scans", headers=sa_headers)
    assert scan_resp.status_code == 200
    assert scan_resp.json()["daily_unique_scans"] == 1  # Even after 2 scans, it should be 1
    
    # Check participation stats for Super Admin (should include total_daily_scans)
    part_resp = client.get(f"/events/{setup_data['ev_id']}/participation", headers=sa_headers)
    assert part_resp.status_code == 200
    assert "total_daily_scans" in part_resp.json()
    assert part_resp.json()["total_daily_scans"] == 1

