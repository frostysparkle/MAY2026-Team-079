import pytest
from fastapi.testclient import TestClient
from main import app
import random

client = TestClient(app)

@pytest.fixture(scope="module")
def user_data():
    rand_id = random.randint(1000000, 9999999)
    email = f"23f{rand_id}@ds.study.iitm.ac.in"
    password = "secure_password"
    return {"email": email, "password": password}

def test_api_auth_register_success(user_data):
    response = client.post("/auth/register", json={"email": user_data["email"], "password": user_data["password"]})
    assert response.status_code == 200
    assert response.json()["message"] == "Registration successful"

def test_api_auth_register_invalid_email():
    response = client.post("/auth/register", json={"email": "bad_email@gmail.com", "password": "pass"})
    assert response.status_code == 400
    assert "Must be an @*.study.iitm.ac.in email" in response.json()["detail"]

def test_api_auth_login_success(user_data):
    response = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    assert response.status_code == 200
    assert "access_token" in response.json()

def test_api_profile_complete(user_data):
    # Login first
    login_resp = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    token = login_resp.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "full_name": "Test User",
        "dob": "2000-01-01",
        "house": "Godavari House",
        "gender": "male",
        "phone": "9999999999",
        "country": "India",
        "state": "TN",
        "city": "Chennai",
        "program": "DS",
        "course_stage": "diploma",
        "address": "123 IITM",
        "photo": "base64..."
    }
    response = client.patch("/profile/complete", headers=headers, json=payload)
    assert response.status_code == 200
    assert response.json()["house"] == "Godavari House"

def test_api_workshop_register(user_data):
    login_resp = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    token = login_resp.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/workshops/WKS02/register", headers=headers)
    assert response.status_code == 200
    assert response.json()["message"] == "Successfully registered for workshop"
    
def test_api_workshop_register_duplicate(user_data):
    login_resp = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    token = login_resp.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/workshops/WKS02/register", headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Already registered for this workshop"
