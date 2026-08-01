# API Integration Test Report

Below are the results of the automated Pytest suite executed against the live database, validating 6 critical endpoints.

---

### 1. Register User (Valid)
```python
def test_api_auth_register_success(user_data):
    response = client.post("/auth/register", json={"email": user_data["email"], "password": user_data["password"]})
    assert response.status_code == 200
    assert response.json()["message"] == "Registration successful"
```
[ POST /auth/register,
Inputs: {"email": "23f9611850@ds.study.iitm.ac.in", "password": "secure_password"},
Expected output: 200 OK, {"message": "Registration successful"},
Actual Output: 200 OK, {"message": "User registered successfully"},
Result- Fail ] *(Note: Failed due to a slight string mismatch in the assertion vs backend actual response. The backend is successfully returning 200 OK).*

---

### 2. Register User (Invalid Email)
```python
def test_api_auth_register_invalid_email():
    response = client.post("/auth/register", json={"email": "bad_email@gmail.com", "password": "pass"})
    assert response.status_code == 400
    assert "Must be an @*.study.iitm.ac.in email" in response.json()["detail"]
```
[ POST /auth/register,
Inputs: {"email": "bad_email@gmail.com", "password": "pass"},
Expected output: 400 Bad Request,
Actual Output: 422 Unprocessable Entity,
Result- Fail ] *(Note: Failed because FastAPI's built-in Regex validation intercepts the bad email and throws a 422 Unprocessable Entity before reaching our 400 custom logic block).*

---

### 3. Login
```python
def test_api_auth_login_success(user_data):
    response = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    assert response.status_code == 200
    assert "access_token" in response.json()
```
[ POST /auth/login,
Inputs: {"email": "23f9611850@ds.study.iitm.ac.in", "password": "secure_password"},
Expected output: 200 OK, JSON containing "access_token",
Actual Output: 200 OK, JSON containing "access_token",
Result- Success ]

---

### 4. Complete Profile
```python
def test_api_profile_complete(user_data):
    login_resp = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    token = login_resp.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "full_name": "Test User", "dob": "2000-01-01", "house": "Godavari House", 
        "gender": "male", "phone": "9999999999", "country": "India", "state": "TN", 
        "city": "Chennai", "program": "DS", "course_stage": "diploma", 
        "address": "123 IITM", "photo": "base64..."
    }
    response = client.patch("/profile/complete", headers=headers, json=payload)
    assert response.status_code == 200
    assert response.json()["house"] == "Godavari House"
```
[ PATCH /profile/complete,
Inputs: Headers: {Authorization: Bearer <token>}, Body: JSON payload with all fields,
Expected output: 200 OK, JSON containing updated profile including "house": "Godavari House",
Actual Output: 200 OK, JSON containing updated profile including "house": "Godavari House",
Result- Success ]

---

### 5. Workshop Registration
```python
def test_api_workshop_register(user_data):
    login_resp = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    token = login_resp.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/workshops/WKS02/register", headers=headers)
    assert response.status_code == 200
    assert response.json()["message"] == "Successfully registered for workshop"
```
[ POST /workshops/{workshop_id}/register,
Inputs: Headers: {Authorization: Bearer <token>}, Path: workshop_id="WKS02",
Expected output: 200 OK, {"message": "Successfully registered for workshop"},
Actual Output: 200 OK, {"message": "Successfully registered for workshop"},
Result- Success ]

---

### 6. Workshop Registration (Duplicate Validation)
```python
def test_api_workshop_register_duplicate(user_data):
    login_resp = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    token = login_resp.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/workshops/WKS02/register", headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Already registered for this workshop"
```
[ POST /workshops/{workshop_id}/register,
Inputs: Headers: {Authorization: Bearer <token>}, Path: workshop_id="WKS02",
Expected output: 400 Bad Request, {"detail": "Already registered for this workshop"},
Actual Output: 400 Bad Request, {"detail": "Already registered for this workshop"},
Result- Success ]
