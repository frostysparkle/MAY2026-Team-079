import pytest
from fastapi.testclient import TestClient
from datetime import datetime
import random
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app
from database import participants_collection, backend_teams_collection, mess_collection, hostel_collection
import security

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_data():
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
    
    sa_login = client.post("/auth/login", json={"email": a_email, "password": "secure_password"})
    sa_token = sa_login.json()["access_token"]

    return {
        "p_token": p_token,
        "p_id": p_id,
        "sa_token": sa_token,
        "sa_id": sa_id
    }

def test_mess_allocation(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    
    mess_payload = {
        "mess_id": f"MESS_{random.randint(100, 999)}",
        "name": "North Mess",
        "capacity": 500,
        "preference": "veg"
    }
    client.post("/mess", json=mess_payload, headers=sa_headers)
    
    resp = client.post("/mess/allocate", headers=sa_headers)
    assert resp.status_code == 200

    p_headers = {"Authorization": f"Bearer {setup_data['p_token']}"}
    resp = client.get("/mess/my_mess", headers=p_headers)
    assert resp.status_code == 200

def test_hostel_allocation(setup_data):
    sa_headers = {"Authorization": f"Bearer {setup_data['sa_token']}"}
    
    hostel_payload = {
        "hostel_id": f"HSTL_{random.randint(100, 999)}",
        "name": "Mahanadi",
        "capacity": 500,
        "gender": "Male"
    }
    client.post("/hostels", json=hostel_payload, headers=sa_headers)
    
    resp = client.post("/hostels/allocate", headers=sa_headers)
    assert resp.status_code == 200

    p_headers = {"Authorization": f"Bearer {setup_data['p_token']}"}
    resp = client.get("/hostels/my_hostel", headers=p_headers)
    assert resp.status_code == 200
