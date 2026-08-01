from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from jose import jwt, JWTError
from datetime import datetime, timedelta
import asyncio
import re

from models import (
    RegisterRequest, LoginRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest, ProfileCompleteRequest,
    ScanQRRequest, EventCreateRequest, EventUpdateRequest
)
from database import (
    attendees_collection, workshops_collection, slots_collection,
    hostels_collection, messes_collection, admins_collection, events_collection
)
from security import (
    get_password_hash, verify_password, create_access_token,
    generate_rsa_key_pair, decrypt_qr_data, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
)

app = FastAPI(title="Paradox Connect API")

# Add CORS middleware for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to actual frontend domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to extract user from JWT token."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        attendee_id: str = payload.get("sub")
        if attendee_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    user = attendees_collection.find_one({"attendee_id": attendee_id})
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def generate_attendee_id(email: str) -> str:
    """Extracts attendee ID from IITM email. Ex: 23f3001726@ds.study.iitm.ac.in -> DS23F3001726"""
    match = re.match(r'^([^@]+)@([a-z]+)\.study\.iitm\.ac\.in$', email.lower())
    if match:
        roll_no = match.group(1).upper()
        program = match.group(2).upper()
        return f"{program}{roll_no}"
    # Fallback for non-IITM testing emails
    return email.split('@')[0].upper()

@app.post("/auth/register")
def register(request: RegisterRequest):
    if attendees_collection.find_one({"email": request.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    attendee_id = generate_attendee_id(request.email)
    hashed_password = get_password_hash(request.password)
    
    # Generate unique asymmetric keys for the user
    private_key, public_key = generate_rsa_key_pair()
    
    new_user = {
        "attendee_id": attendee_id,
        "email": request.email,
        "password_hash": hashed_password,
        "profile": {},
        "access": {
            "registered": True,
            "hostel_paid": False,
            "mess_paid": False
        },
        "hostel_accommodation": {},
        "photo": None,
        "qr_secrets": {
            "private_key": private_key,
            "public_key": public_key
        },
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "last_login_at": None
    }
    
    attendees_collection.insert_one(new_user)
    return {"message": "User registered successfully"}

@app.post("/auth/login")
def login(request: LoginRequest):
    user = attendees_collection.find_one({"email": request.email})
    if not user or not verify_password(request.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Update last login time
    attendees_collection.update_one(
        {"_id": user["_id"]}, 
        {"$set": {"last_login_at": datetime.utcnow()}}
    )
    
    # Create JWT Access Token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["attendee_id"]}, expires_delta=access_token_expires
    )
    
    profile = user.get("profile", {})
    return {
        "id": user["attendee_id"],
        "email": user["email"],
        "access_token": access_token,
        "full_name": profile.get("full_name"),
        "dob": profile.get("dob"),
        "house": profile.get("house"),
        "gender": profile.get("gender"),
        "phone": profile.get("phone"),
        "country": profile.get("country"),
        "state": profile.get("state"),
        "city": profile.get("city"),
        "address": profile.get("address"),
        "program": profile.get("program"),
        "course_stage": profile.get("course_stage"),
        "photo": user.get("photo"),
        "public_key": user.get("qr_secrets", {}).get("public_key")
    }

@app.post("/auth/password/forgot")
def forgot_password(request: ForgotPasswordRequest):
    # Mocking email sending for reset link
    return {
        "message": "If the account exists, a reset link has been sent.",
        "dev_reset_url": "http://localhost:5173/reset-password?token=mock_token_123"
    }

@app.post("/auth/password/reset")
def reset_password(request: ResetPasswordRequest):
    # In a real scenario, decode and verify the reset token to find the user
    hashed_password = get_password_hash(request.new_password)
    return {"message": "Password reset successfully."}

@app.post("/auth/password/change")
def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    if not verify_password(request.current_password, current_user.get("password_hash")):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    hashed_password = get_password_hash(request.new_password)
    attendees_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"password_hash": hashed_password, "updated_at": datetime.utcnow()}}
    )
    
    # Issue a new access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": current_user["attendee_id"]}, expires_delta=access_token_expires
    )
    
    return {
        "message": "Password changed successfully.",
        "access_token": access_token
    }

@app.patch("/profile/complete")
def complete_profile(request: ProfileCompleteRequest, current_user: dict = Depends(get_current_user)):
    profile_data = {
        "full_name": request.full_name,
        "dob": request.dob,
        "house": request.house,
        "gender": request.gender,
        "phone": request.phone,
        "country": request.country,
        "state": request.state,
        "city": request.city,
        "program": request.program,
        "course_stage": request.course_stage,
        "address": request.address,
    }
    
    attendees_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {
            "profile": profile_data,
            "photo": request.photo,
            "updated_at": datetime.utcnow()
        }}
    )
    
    return {
        **profile_data,
        "photo_data_url": request.photo
    }

# ==========================================
# WORKSHOP REGISTRATION & SSE (SPRINT A)
# ==========================================

@app.post("/workshops/{workshop_id}/register")
def register_for_workshop(workshop_id: str, current_user: dict = Depends(get_current_user)):
    attendee_id = current_user["attendee_id"]
    
    # 1. Check if workshop exists
    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    # 2. Check capacity
    if workshop.get("registration_count", 0) >= workshop.get("capacity", 0):
        raise HTTPException(status_code=400, detail="Workshop is full")
        
    # 3. Check if user is already registered for THIS workshop
    if any(reg.get("attendee_id") == attendee_id for reg in workshop.get("registrations", [])):
        raise HTTPException(status_code=400, detail="Already registered for this workshop")
        
    # 4. Check if user is registered for ANOTHER workshop in the SAME SLOT
    slot_id = workshop.get("slot_id")
    other_workshops_in_slot = workshops_collection.find({"slot_id": slot_id, "workshop_id": {"$ne": workshop_id}})
    for other_ws in other_workshops_in_slot:
        if any(reg.get("attendee_id") == attendee_id for reg in other_ws.get("registrations", [])):
            raise HTTPException(status_code=400, detail="Already registered for another workshop in this time slot")

    # 5. Register the user
    new_registration = {
        "attendee_id": attendee_id,
        "status": "registered",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    result = workshops_collection.update_one(
        {"workshop_id": workshop_id, "registration_count": {"$lt": workshop.get("capacity", 0)}}, # Double check capacity atomically
        {
            "$push": {"registrations": new_registration},
            "$inc": {"registration_count": 1}
        }
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Failed to register. Workshop might have just filled up.")
        
    return {"message": "Successfully registered for workshop"}


@app.get("/workshops/{workshop_id}/seats/stream")
async def stream_workshop_seats(workshop_id: str):
    """SSE Endpoint to push real-time remaining seat counts."""
    async def event_generator():
        previous_count = -1
        while True:
            workshop = await run_in_threadpool(workshops_collection.find_one, {"workshop_id": workshop_id})
            if not workshop:
                yield f"data: {{\"error\": \"Workshop not found\"}}\n\n"
                break
                
            current_count = workshop.get("registration_count", 0)
            capacity = workshop.get("capacity", 0)
            remaining = capacity - current_count
            
            if current_count != previous_count:
                # Send SSE data payload
                yield f"data: {{\"remaining_seats\": {remaining}, \"capacity\": {capacity}}}\n\n"
                previous_count = current_count
                
            # Wait 2 seconds before polling again
            await asyncio.sleep(2)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ==========================================
# SCANNER & DECRYPTION ENGINE (SPRINT B)
# ==========================================

def verify_qr(request: ScanQRRequest):
    """Decrypts QR, verifies timestamp, and returns attendee dict"""
    target_user = attendees_collection.find_one({"attendee_id": request.attendee_id})
    if not target_user:
        raise HTTPException(status_code=404, detail="Scanned user not found")
        
    private_key = target_user.get("qr_secrets", {}).get("private_key")
    if not private_key:
        raise HTTPException(status_code=400, detail="User missing private key")
        
    try:
        qr_timestamp = datetime.fromisoformat(request.timestamp.replace("Z", "+00:00")).replace(tzinfo=None)
        if datetime.utcnow() - qr_timestamp > timedelta(seconds=60):
            raise HTTPException(status_code=400, detail="QR Code expired")
            
        decrypted_payload = decrypt_qr_data(private_key, request.data)
        return target_user, decrypted_payload
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid or corrupted QR code")

@app.post("/workshops/{workshop_id}/attendance")
def workshop_attendance(workshop_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    # RBAC: Check if current_user is a workshop volunteer or admin
    is_volunteer = any(v.get("user_id") == current_user["attendee_id"] for v in workshop.get("workshop_team", []))
    is_admin = admins_collection.find_one({"admin_id": current_user["attendee_id"]})
    if not (is_volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this workshop")
        
    target_user, payload = verify_qr(request)
    
    registrations = workshop.get("registrations", [])
    registered = next((r for r in registrations if r["attendee_id"] == target_user["attendee_id"]), None)
    
    if registered:
        # Pre-registered attendee
        if registered.get("status") == "attended":
            return {"message": "Attendee already marked present"}
            
        workshops_collection.update_one(
            {"workshop_id": workshop_id, "registrations.attendee_id": target_user["attendee_id"]},
            {"$set": {"registrations.$.status": "attended"}, "$inc": {"attendee_count": 1}}
        )
        return {"message": "Pre-registered attendee marked present"}
    else:
        # On-spot registration
        if workshop.get("registration_count", 0) >= workshop.get("capacity", 0):
            raise HTTPException(status_code=400, detail="Workshop is full, cannot on-spot register")
            
        workshops_collection.update_one(
            {"workshop_id": workshop_id},
            {
                "$push": {"on_spot_registrations": {"attendee_id": target_user["attendee_id"], "created_at": datetime.utcnow()}},
                "$inc": {"registration_count": 1, "attendee_count": 1}
            }
        )
        return {"message": "On-spot registration successful and marked present"}

@app.post("/hostels/{hostel_id}/entry")
def hostel_entry(hostel_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    hostel = hostels_collection.find_one({"hostel_id": hostel_id})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")
    
    # RBAC
    is_volunteer = any(v.get("user_id") == current_user["attendee_id"] for v in hostel.get("hostel_team", []))
    is_admin = admins_collection.find_one({"admin_id": current_user["attendee_id"]})
    if not (is_volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")
        
    target_user, payload = verify_qr(request)
    
    if target_user.get("is_inside_hostel", False):
        raise HTTPException(status_code=400, detail="User is already inside. Must exit first.")
        
    attendees_collection.update_one(
        {"attendee_id": target_user["attendee_id"]},
        {"$set": {"is_inside_hostel": True}}
    )
    return {"message": f"Hostel entry marked for {target_user['attendee_id']}"}

@app.post("/hostels/{hostel_id}/exit")
def hostel_exit(hostel_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    hostel = hostels_collection.find_one({"hostel_id": hostel_id})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")
    
    is_volunteer = any(v.get("user_id") == current_user["attendee_id"] for v in hostel.get("hostel_team", []))
    is_admin = admins_collection.find_one({"admin_id": current_user["attendee_id"]})
    if not (is_volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")
        
    target_user, payload = verify_qr(request)
    
    if not target_user.get("is_inside_hostel", False):
        raise HTTPException(status_code=400, detail="User is already outside. Must enter first.")
        
    attendees_collection.update_one(
        {"attendee_id": target_user["attendee_id"]},
        {"$set": {"is_inside_hostel": False}}
    )
    return {"message": f"Hostel exit marked for {target_user['attendee_id']}"}

@app.post("/messes/{mess_id}/entry")
def mess_entry(mess_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    mess = messes_collection.find_one({"mess_id": mess_id})
    if not mess: raise HTTPException(status_code=404, detail="Mess not found")
    
    is_volunteer = any(v.get("user_id") == current_user["attendee_id"] for v in mess.get("mess_team", []))
    is_admin = admins_collection.find_one({"admin_id": current_user["attendee_id"]})
    if not (is_volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this mess")
        
    target_user, payload = verify_qr(request)
    
    current_hour = datetime.utcnow().hour
    if 6 <= current_hour < 11: meal = "Breakfast"
    elif 11 <= current_hour < 16: meal = "Lunch"
    elif 18 <= current_hour < 23: meal = "Dinner"
    else: raise HTTPException(status_code=400, detail="Not a valid meal time")
    
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    meal_key = f"{today_str}_{meal}"
    
    if meal_key in target_user.get("mess_history", []):
        raise HTTPException(status_code=400, detail=f"Already marked for {meal} today")
        
    attendees_collection.update_one(
        {"attendee_id": target_user["attendee_id"]},
        {"$push": {"mess_history": meal_key}}
    )
    return {"message": f"{meal} marked for {target_user['attendee_id']}"}

# ==========================================
# EVENT MANAGEMENT & ADMIN RBAC (SPRINT C)
# ==========================================

@app.post("/events")
def create_event(request: EventCreateRequest, current_user: dict = Depends(get_current_user)):
    # Only super_admin can create events
    admin = admins_collection.find_one({"admin_id": current_user["attendee_id"], "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can create events")
        
    events_collection.insert_one({
        "event_id": request.event_id,
        "name": request.name,
        "department": request.department,
        "venue": request.venue,
        "rounds": request.rounds,
        "poc_id": request.poc_id,
        "registrations": [],
        "created_at": datetime.utcnow()
    })
    return {"message": "Event created"}

@app.put("/events/{event_id}")
def update_event(event_id: str, request: EventUpdateRequest, current_user: dict = Depends(get_current_user)):
    event = events_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    # Only super_admin or the assigned POC (Team Lead) can edit
    is_super_admin = admins_collection.find_one({"admin_id": current_user["attendee_id"], "role": "super_admin"})
    is_poc = (event.get("poc_id") == current_user["attendee_id"])
    
    if not (is_super_admin or is_poc):
        raise HTTPException(status_code=403, detail="Only Super Admin or Team Lead (POC) can edit this event")
        
    update_data = {k: v for k, v in request.dict().items() if v is not None}
    if update_data:
        events_collection.update_one({"event_id": event_id}, {"$set": update_data})
        
    return {"message": "Event updated successfully"}

@app.post("/events/{event_id}/register")
def register_for_event(event_id: str, current_user: dict = Depends(get_current_user)):
    event = events_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    if current_user["attendee_id"] in event.get("registrations", []):
        raise HTTPException(status_code=400, detail="Already registered for this event")
        
    events_collection.update_one(
        {"event_id": event_id},
        {"$push": {"registrations": current_user["attendee_id"]}}
    )
    return {"message": "Registered for event"}

@app.post("/events/{event_id}/attendance")
def event_attendance(event_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    event = events_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    is_super_admin = admins_collection.find_one({"admin_id": current_user["attendee_id"], "role": "super_admin"})
    is_poc = (event.get("poc_id") == current_user["attendee_id"])
    if not (is_super_admin or is_poc):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this event")
        
    target_user, payload = verify_qr(request)
    
    if target_user["attendee_id"] not in event.get("registrations", []):
        raise HTTPException(status_code=400, detail="User not registered for this event")
        
    if target_user["attendee_id"] in event.get("attendance", []):
        return {"message": "Attendee already marked present"}
        
    events_collection.update_one(
        {"event_id": event_id},
        {"$push": {"attendance": target_user["attendee_id"]}}
    )
    return {"message": "Attendee marked present"}

@app.get("/events")
def list_events(current_user: dict = Depends(get_current_user)):
    admin = admins_collection.find_one({"admin_id": current_user["attendee_id"]})
    
    if admin:
        if admin["role"] == "super_admin":
            return list(events_collection.find({}, {"_id": 0}))
        elif admin["department"] == "uhc":
            # UHC sees all events, but typically would filter registrants by house.
            # Returning all events for now.
            return list(events_collection.find({}, {"_id": 0}))
        else:
            # Department admins (technicals, sports, culturals)
            return list(events_collection.find({"department": admin["department"]}, {"_id": 0}))
            
    # Regular users see all events but maybe without admin sensitive data
    return list(events_collection.find({}, {"_id": 0, "registrations": 0}))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
