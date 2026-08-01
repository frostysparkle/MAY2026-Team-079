# Domain API Integration Test Report

Below are the results of the automated Pytest suite executed against the live database, validating the 6 most important, domain-specific endpoints (Scanners, Event Management, and RBAC).

---

### 1. Create Event (Super Admin)
```python
def test_api_events_create_admin(admin_user):
    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    payload = {"event_id": "EV_TEST_1", "name": "Hackathon", "department": "technicals", "venue": "CRC", "rounds": 1, "poc_id": "123"}
    resp = client.post("/events", json=payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["message"] == "Event created"
```
**[ POST /events,**
**Inputs:** `Headers: {Authorization: Bearer <super_admin_token>}, Body: JSON Payload`,
**Expected output:** `200 OK, {"message": "Event created"}`,
**Actual Output:** `200 OK, {"message": "Event created"}`,
**Result- Success ]**

---

### 2. Create Event (Forbidden for Normal User)
```python
def test_api_events_create_forbidden(regular_user):
    headers = {"Authorization": f"Bearer {regular_user['token']}"}
    payload = {"event_id": "EV_TEST_2", "name": "Bad Event", "department": "technicals", "venue": "CRC", "rounds": 1, "poc_id": "123"}
    resp = client.post("/events", json=payload, headers=headers)
    assert resp.status_code == 403
    assert "Only Super Admins can create events" in resp.json()["detail"]
```
**[ POST /events,**
**Inputs:** `Headers: {Authorization: Bearer <regular_user_token>}, Body: JSON Payload`,
**Expected output:** `403 Forbidden, {"detail": "Only Super Admins can create events"}`,
**Actual Output:** `403 Forbidden, {"detail": "Only Super Admins can create events"}`,
**Result- Success ]**

---

### 3. Scanner: Mark Attendance & On-Spot Register
```python
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
```
**[ POST /workshops/{workshop_id}/attendance,**
**Inputs:** `Headers: {Authorization: Bearer <admin_token>}, Body: {"attendee_id": "...", "data": "<encrypted_blob>", "timestamp": "<recent_iso>"}`,
**Expected output:** `200 OK, {"message": "On-spot registration successful..."}`,
**Actual Output:** `200 OK, {"message": "On-spot registration successful and marked present"}`,
**Result- Success ]**

---

### 4. Scanner: Expired QR (Replay Attack Prevention)
```python
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
```
**[ POST /workshops/{workshop_id}/attendance,**
**Inputs:** `Headers: {Authorization: Bearer <admin_token>}, Body: {"attendee_id": "...", "data": "dummy", "timestamp": "<2_minutes_old_iso>"}`,
**Expected output:** `400 Bad Request, {"detail": "QR Code expired"}`,
**Actual Output:** `400 Bad Request, {"detail": "Invalid or corrupted QR code"}`,
**Result- Fail ]** *(Note: Failed because our backend attempts to decrypt the RSA data blob before verifying the timestamp. Since "dummy_data" fails RSA decryption, the global exception handler catches it and returns "Invalid or corrupted QR code" instead of "QR Code expired".)*

---

### 5. Event Registration
```python
def test_api_event_registration(regular_user):
    headers = {"Authorization": f"Bearer {regular_user['token']}"}
    resp = client.post("/events/EV_TEST_1/register", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["message"] == "Registered for event"
```
**[ POST /events/{event_id}/register,**
**Inputs:** `Headers: {Authorization: Bearer <regular_token>}, Path: event_id="EV_TEST_1"`,
**Expected output:** `200 OK, {"message": "Registered for event"}`,
**Actual Output:** `200 OK, {"message": "Registered for event"}`,
**Result- Success ]**

---

### 6. Event Fetching (Admin Filtering)
```python
def test_api_events_list_rbac(admin_user):
    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    resp = client.get("/events", headers=headers)
    assert resp.status_code == 200
    assert "registrations" in resp.json()[0]
```
**[ GET /events,**
**Inputs:** `Headers: {Authorization: Bearer <super_admin_token>}`,
**Expected output:** `200 OK, JSON array containing all events WITH the sensitive "registrations" array attached`,
**Actual Output:** `200 OK, JSON array containing all events WITH the sensitive "registrations" array attached`,
**Result- Success ]**
