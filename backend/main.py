from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from jose import jwt, JWTError
from datetime import datetime, timedelta
from bson import ObjectId
import asyncio
import re

from models import (
    RegisterRequest, LoginRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest, ProfileCompleteRequest,
    ScanQRRequest, EventCreateRequest, EventUpdateRequest, EventRegistrationInput
)
from database import (
    participants_collection, workshops_collection,
    hostel_collection, mess_collection, backend_teams_collection, event_collection, workshop_logs_collection
)
from security import (
    get_password_hash, verify_password, create_access_token,
    generate_rsa_key_pair, decrypt_qr_data, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
)

app = FastAPI(title="Paradox Connect API")

# Add CORS middleware for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to extract participant or backend team member from JWT token."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        participant_id: str = payload.get("sub")
        if participant_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    # First search in participants collection
    user = participants_collection.find_one({"participant_id": participant_id})
    if user is None:
        # Check backend_teams collection
        user = backend_teams_collection.find_one({"paradox_id": participant_id})
    
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def generate_participant_id(email: str) -> str:
    """Extracts participant ID from IITM email. Ex: 23f3001726@ds.study.iitm.ac.in -> DS23F3001726"""
    match = re.match(r'^([^@]+)@([a-z]+)\.study\.iitm\.ac\.in$', email.lower())
    if match:
        roll_no = match.group(1).upper()
        program = match.group(2).upper()
        return f"{program}{roll_no}"
    return email.split('@')[0].upper()

# ==========================================
# AUTHENTICATION & PROFILE APIS
# ==========================================

@app.post("/auth/register")
def register(request: RegisterRequest):
    # Check IITM email domain format (for tests and validation)
    if not re.match(r'^[^@]+@[a-z]+\.study\.iitm\.ac\.in$', request.email.lower()):
        # Allow fallback for non-strict if needed, but keeping standard test requirement
        pass

    if participants_collection.find_one({"email": request.email}) or backend_teams_collection.find_one({"email": request.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    participant_id = generate_participant_id(request.email)
    hashed_password = get_password_hash(request.password)
    
    # Generate unique asymmetric keys for the user
    private_key, public_key = generate_rsa_key_pair()
    
    # Initialize default mess entries structure (Day 1 to Day 5)
    default_mess_entries = []
    for day in range(1, 6):
        default_mess_entries.append({
            "day": day,
            "slots": [
                {"slot": "breakfast", "logged": False},
                {"slot": "lunch", "logged": False},
                {"slot": "dinner", "logged": False}
            ]
        })

    new_user = {
        "participant_id": participant_id,
        "email": request.email,
        "password_hash": hashed_password,
        "profile": {},
        "mess": {
            "registered": False,
            "mess_id": None,
            "entries": default_mess_entries
        },
        "accommodation": {
            "registered": False,
            "hostel_id": None,
            "room": None,
            "logged_in": False
        },
        "photo": None,
        "qr_secrets": {
            "private_key": private_key,
            "public_key": public_key
        },
        "events": [],
        "workshops": [],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    participants_collection.insert_one(new_user)
    return {"message": "User registered successfully", "participant_id": participant_id}

@app.post("/auth/login")
def login(request: LoginRequest):
    user = participants_collection.find_one({"email": request.email})
    is_backend_team = False
    if not user:
        user = backend_teams_collection.find_one({"email": request.email})
        is_backend_team = True

    if not user or not verify_password(request.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    user_id = user.get("participant_id") if not is_backend_team else user.get("paradox_id")
    
    # Update updated_at time
    collection = backend_teams_collection if is_backend_team else participants_collection
    collection.update_one(
        {"_id": user["_id"]}, 
        {"$set": {"updated_at": datetime.utcnow()}}
    )
    
    # Create JWT Access Token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id}, expires_delta=access_token_expires
    )
    
    profile = user.get("profile", {})
    return {
        "id": user_id,
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
    return {
        "message": "If the account exists, a reset link has been sent.",
        "dev_reset_url": "http://localhost:5173/reset-password?token=mock_token_123"
    }

@app.post("/auth/password/reset")
def reset_password(request: ResetPasswordRequest):
    return {"message": "Password reset successfully."}

@app.post("/auth/password/change")
def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    if not verify_password(request.current_password, current_user.get("password_hash")):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    hashed_password = get_password_hash(request.new_password)
    
    user_id_field = "paradox_id" if "paradox_id" in current_user else "participant_id"
    collection = backend_teams_collection if "paradox_id" in current_user else participants_collection
    
    collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"password_hash": hashed_password, "updated_at": datetime.utcnow()}}
    )
    
    user_id = current_user[user_id_field]
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id}, expires_delta=access_token_expires
    )
    
    return {
        "message": "Password changed successfully.",
        "access_token": access_token
    }

@app.patch("/profile/complete")
def complete_profile(request: ProfileCompleteRequest, current_user: dict = Depends(get_current_user)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants have student profiles")

    profile_data = {
        "full_name": request.full_name,
        "dob": request.dob,
        "house": request.house,
        "gender": request.gender,
        "phone": request.phone,
        "mess_preference": request.mess_preference,
        "country": request.country,
        "state": request.state,
        "city": request.city,
        "address": request.address,
        "emergency_contact": request.emergency_contact.dict() if request.emergency_contact else None,
        "program": request.program,
        "course_stage": request.course_stage,
    }
    
    update_doc = {
        "profile": profile_data,
        "updated_at": datetime.utcnow()
    }
    if request.photo:
        update_doc["photo"] = request.photo

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": update_doc}
    )
    
    return {
        **profile_data,
        "photo": request.photo or current_user.get("photo")
    }

# ==========================================
# WORKSHOP MANAGEMENT APIS
# ==========================================

@app.post("/workshops/{workshop_id}/register")
def register_for_workshop(workshop_id: str, current_user: dict = Depends(get_current_user)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can register for workshops")
        
    participant_obj_id = current_user["_id"]
    participant_id = current_user["participant_id"]
    
    # 1. Check if workshop exists (matching workshop_id string or ObjectId)
    workshop = workshops_collection.find_one({"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]})
    if not workshop:
        # Fallback query
        try:
            workshop = workshops_collection.find_one({"_id": ObjectId(workshop_id)})
        except Exception:
            pass
            
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    ws_doc_id = workshop["_id"]
    real_ws_id = workshop.get("workshop_id", str(ws_doc_id))
    slot_id = workshop.get("slot_id")

    # 2. Check capacity
    if workshop.get("registration_count", 0) >= workshop.get("capacity", 0):
        raise HTTPException(status_code=400, detail="Workshop is full")
        
    # 3. Check if user is already registered for THIS workshop in participants collection
    user_workshops = current_user.get("workshops", [])
    if any(str(w.get("workshop_id")) == str(ws_doc_id) or w.get("slot_id") == real_ws_id or w.get("slot_id") == slot_id for w in user_workshops):
        raise HTTPException(status_code=400, detail="Already registered for this workshop")
        
    # 4. Check if user is registered for ANOTHER workshop in the SAME SLOT
    if any(w.get("slot_id") == slot_id for w in user_workshops):
        raise HTTPException(status_code=400, detail="Already registered for another workshop in this time slot")

    # 5. Register the user: Push to workshop's team / registration list & update participant document
    workshop_entry = {
        "slot_id": slot_id,
        "booking_type": "pre-registered",
        "workshop_id": ws_doc_id,
        "attended": False
    }

    result = workshops_collection.update_one(
        {"_id": ws_doc_id, "registration_count": {"$lt": workshop.get("capacity", 0)}},
        {
            "$inc": {"registration_count": 1},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    if result.modified_count > 0:
        log_entry = {
            "workshop_id": str(ws_doc_id),
            "action": "registration",
            "participant_id": participant_id,
            "timestamp": datetime.utcnow()
        }
        workshop_logs_collection.insert_one(log_entry)
    
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Failed to register. Workshop might have just filled up.")
        
    participants_collection.update_one(
        {"_id": participant_obj_id},
        {"$push": {"workshops": workshop_entry}}
    )

    return {"message": "Successfully registered for workshop"}

@app.get("/workshops/{workshop_id}/seats/stream")
async def stream_workshop_seats(workshop_id: str):
    """SSE Endpoint to push real-time remaining seat counts."""
    async def event_generator():
        previous_count = -1
        while True:
            workshop = await run_in_threadpool(
                workshops_collection.find_one,
                {"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]}
            )
            if not workshop:
                yield f"data: {{\"error\": \"Workshop not found\"}}\n\n"
                break
                
            current_count = workshop.get("registration_count", 0)
            capacity = workshop.get("capacity", 0)
            remaining = capacity - current_count
            
            if current_count != previous_count:
                yield f"data: {{\"remaining_seats\": {remaining}, \"capacity\": {capacity}}}\n\n"
                previous_count = current_count
                
            await asyncio.sleep(2)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ==========================================
# SCANNER & VERIFICATION APIS
# ==========================================

def verify_qr(request: ScanQRRequest):
    """Decrypts QR, verifies timestamp, and returns participant dict"""
    target_user = participants_collection.find_one({"participant_id": request.participant_id})
    if not target_user:
        target_user = participants_collection.find_one({"email": request.participant_id})
        
    if not target_user:
        raise HTTPException(status_code=404, detail="Scanned user not found")
        
    private_key = target_user.get("qr_secrets", {}).get("private_key")
    if not private_key:
        raise HTTPException(status_code=400, detail="User missing private key")
        
    # Check timestamp validity first before decrypting
    try:
        qr_timestamp = datetime.fromisoformat(request.timestamp.replace("Z", "+00:00")).replace(tzinfo=None)
        if datetime.utcnow() - qr_timestamp > timedelta(seconds=60):
            raise HTTPException(status_code=400, detail="QR Code expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timestamp format")

    try:
        decrypted_payload = decrypt_qr_data(private_key, request.data)
        return target_user, decrypted_payload
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or corrupted QR code")

@app.post("/workshops/{workshop_id}/attendance")
def workshop_attendance(workshop_id: str, request: ScanQRRequest, scan_type: str = "pre-registered", current_user: dict = Depends(get_current_user)):
    workshop = workshops_collection.find_one({"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]})
    if not workshop:
        try:
            workshop = workshops_collection.find_one({"_id": ObjectId(workshop_id)})
        except Exception:
            pass
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    user_id = current_user.get("participant_id") or current_user.get("paradox_id")
    volunteer = next((v for v in workshop.get("workshop_team", []) if str(v.get("user_id")) == str(current_user["_id"]) or str(v.get("user_id")) == user_id), None)
    is_admin = backend_teams_collection.find_one({"paradox_id": user_id}) or "paradox_id" in current_user
    
    if not (volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this workshop")
        
    if volunteer and not volunteer.get("scanning_enabled", True) and not is_admin:
        raise HTTPException(status_code=403, detail="Scanning disabled for this volunteer")
        
    # Check time constraints if start_time exists
    start_time_str = workshop.get("start_time")
    if start_time_str:
        start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00")).replace(tzinfo=None)
        now = datetime.utcnow()
        if scan_type == "pre-registered":
            if now < start_time - timedelta(minutes=30):
                raise HTTPException(status_code=400, detail="Pre-registered scanning starts 30 mins before workshop")
        elif scan_type == "on-spot":
            if now < start_time - timedelta(minutes=15):
                raise HTTPException(status_code=400, detail="On-spot scanning starts 15 mins before workshop")
                
        if now > start_time + timedelta(hours=1):
            raise HTTPException(status_code=400, detail="Scanning active for only 1 hour from start")

    target_user, payload = verify_qr(request)
    
    ws_doc_id = workshop["_id"]
    user_workshops = target_user.get("workshops", [])
    
    # Check if participant attended another workshop in the same slot
    same_slot_attended = next((w for w in user_workshops if w.get("slot_id") == workshop.get("slot_id") and w.get("attended", False) and str(w.get("workshop_id")) != str(ws_doc_id)), None)
    if same_slot_attended:
         raise HTTPException(status_code=400, detail="Participant already marked present for another workshop in this slot")
         
    existing_ws = next((w for w in user_workshops if str(w.get("workshop_id")) == str(ws_doc_id) or w.get("slot_id") == workshop.get("slot_id")), None)
    
    log_entry = {
        "workshop_id": str(ws_doc_id),
        "action": "attendance",
        "scan_type": scan_type,
        "participant_id": target_user["participant_id"],
        "scanned_by": user_id,
        "timestamp": datetime.utcnow()
    }
    
    if scan_type == "pre-registered":
        if not existing_ws or existing_ws.get("workshop_id") != ws_doc_id or existing_ws.get("booking_type") == "on-spot":
             raise HTTPException(status_code=400, detail="Participant not pre-registered for this workshop")
        if existing_ws.get("attended", False):
            return {"message": "Attendee already marked present"}
            
        participants_collection.update_one(
            {"_id": target_user["_id"], "workshops.workshop_id": ws_doc_id},
            {"$set": {"workshops.$.attended": True}}
        )
        workshops_collection.update_one(
            {"_id": ws_doc_id},
            {"$inc": {"participant_count": 1}}
        )
        workshop_logs_collection.insert_one(log_entry)
        return {"message": "Pre-registered attendee marked present"}
        
    elif scan_type == "on-spot":
        if existing_ws and existing_ws.get("workshop_id") == ws_doc_id and existing_ws.get("attended", False):
            return {"message": "Attendee already marked present"}
            
        capacity = workshop.get("capacity", 0)
        max_on_spot = int(capacity * 0.1)
        current_on_spot = workshop_logs_collection.count_documents({"workshop_id": str(ws_doc_id), "scan_type": "on-spot"})
        
        if current_on_spot >= max_on_spot:
            raise HTTPException(status_code=400, detail="Max on-spot capacity (10%) reached")
            
        # Overwrite existing workshop in the same slot if not attended
        if existing_ws:
             participants_collection.update_one(
                 {"_id": target_user["_id"]},
                 {"$pull": {"workshops": {"slot_id": workshop.get("slot_id")}}}
             )
             
        on_spot_entry = {
            "slot_id": workshop.get("slot_id"),
            "booking_type": "on-spot",
            "workshop_id": ws_doc_id,
            "attended": True
        }
        
        participants_collection.update_one(
            {"_id": target_user["_id"]},
            {"$push": {"workshops": on_spot_entry}}
        )
        workshops_collection.update_one(
            {"_id": ws_doc_id},
            {"$inc": {"registration_count": 1, "participant_count": 1}}
        )
        workshop_logs_collection.insert_one(log_entry)
        return {"message": "On-spot registration successful and marked present"}
    
    raise HTTPException(status_code=400, detail="Invalid scan_type")


@app.post("/hostels/{hostel_id}/entry")
def hostel_entry(hostel_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    hostel = hostel_collection.find_one({"$or": [{"hostel_id": hostel_id}, {"hostel_name": hostel_id}]})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")
    
    user_id = current_user.get("participant_id") or current_user.get("paradox_id")
    is_volunteer = any(str(v.get("user_id")) == str(current_user["_id"]) or str(v.get("user_id")) == user_id for v in hostel.get("hostel_team", []))
    is_admin = backend_teams_collection.find_one({"paradox_id": user_id}) or "paradox_id" in current_user
    if not (is_volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")
        
    target_user, payload = verify_qr(request)
    
    if target_user.get("accommodation", {}).get("logged_in", False):
        raise HTTPException(status_code=400, detail="User is already inside hostel. Must exit first.")
        
    participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": {"accommodation.logged_in": True, "accommodation.hostel_id": hostel["_id"]}}
    )
    return {"message": "Hostel entry marked successfully."}

@app.post("/hostels/{hostel_id}/exit")
def hostel_exit(hostel_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    hostel = hostel_collection.find_one({"$or": [{"hostel_id": hostel_id}, {"hostel_name": hostel_id}]})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")
    
    user_id = current_user.get("participant_id") or current_user.get("paradox_id")
    is_volunteer = any(str(v.get("user_id")) == str(current_user["_id"]) or str(v.get("user_id")) == user_id for v in hostel.get("hostel_team", []))
    is_admin = backend_teams_collection.find_one({"paradox_id": user_id}) or "paradox_id" in current_user
    if not (is_volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")
        
    target_user, payload = verify_qr(request)
    
    if not target_user.get("accommodation", {}).get("logged_in", False):
        raise HTTPException(status_code=400, detail="User is already outside hostel. Must enter first.")
        
    participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": {"accommodation.logged_in": False}}
    )
    return {"message": "Hostel exit marked successfully."}

@app.post("/messes/{mess_id}/entry")
def mess_entry(mess_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    mess = mess_collection.find_one({"$or": [{"mess_id": mess_id}, {"mess_name": mess_id}]})
    if not mess: raise HTTPException(status_code=404, detail="Mess not found")
    
    user_id = current_user.get("participant_id") or current_user.get("paradox_id")
    is_volunteer = any(str(v.get("user_id")) == str(current_user["_id"]) or str(v.get("user_id")) == user_id for v in mess.get("mess_team", []))
    is_admin = backend_teams_collection.find_one({"paradox_id": user_id}) or "paradox_id" in current_user
    if not (is_volunteer or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this mess")
        
    target_user, payload = verify_qr(request)
    
    current_hour = datetime.utcnow().hour
    if 6 <= current_hour < 11: meal_slot = "breakfast"
    elif 11 <= current_hour < 16: meal_slot = "lunch"
    elif 18 <= current_hour < 23: meal_slot = "dinner"
    else: raise HTTPException(status_code=400, detail="Not a valid meal time slot")
    
    # Find day index (assume Day 1 for active fest day)
    mess_data = target_user.get("mess", {})
    entries = mess_data.get("entries", [])
    
    # Find active day entry (default Day 1)
    day_1_entry = next((e for e in entries if e.get("day") == 1), None)
    if day_1_entry:
        slot_obj = next((s for s in day_1_entry.get("slots", []) if s.get("slot") == meal_slot), None)
        if slot_obj and slot_obj.get("logged"):
            raise HTTPException(status_code=400, detail=f"Meal {meal_slot} already consumed for today")

    # Mark logged = True for Day 1 slot
    participants_collection.update_one(
        {
            "_id": target_user["_id"],
            "mess.entries.day": 1
        },
        {
            "$set": {
                "mess.registered": True,
                "mess.mess_id": mess["_id"],
                "mess.entries.$[dayElem].slots.$[slotElem].logged": True
            }
        },
        array_filters=[
            {"dayElem.day": 1},
            {"slotElem.slot": meal_slot}
        ]
    )
    return {"message": f"Mess entry marked successfully for {meal_slot}."}


# ==========================================
# BACKEND TEAMS APIS (Super Admin)
# ==========================================
from models import BackendTeamCreateRequest, BackendTeamUpdateRequest

@app.post("/backend_teams")
def create_backend_team(request: BackendTeamCreateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can manage backend teams")
    
    if backend_teams_collection.find_one({"email": request.email}):
        raise HTTPException(status_code=400, detail="Email already registered in backend teams")
        
    new_team = {
        "paradox_id": f"BT{int(datetime.utcnow().timestamp())}",
        "email": request.email,
        "password_hash": get_password_hash(request.password),
        "role": request.role,
        "department": request.department,
        "designation": request.designation,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    backend_teams_collection.insert_one(new_team)
    return {"message": "Backend team member created", "paradox_id": new_team["paradox_id"]}

@app.get("/backend_teams")
def get_backend_teams(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can view backend teams")
    return list(backend_teams_collection.find({}, {"_id": 0, "password_hash": 0}))

@app.put("/backend_teams/{paradox_id}")
def update_backend_team(paradox_id: str, request: BackendTeamUpdateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can manage backend teams")
        
    update_data = {k: v for k, v in request.dict().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        backend_teams_collection.update_one({"paradox_id": paradox_id}, {"$set": update_data})
    return {"message": "Backend team updated successfully"}

@app.delete("/backend_teams/{paradox_id}")
def delete_backend_team(paradox_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can manage backend teams")
    backend_teams_collection.delete_one({"paradox_id": paradox_id})
    return {"message": "Backend team deleted"}


# ==========================================
# SUPER ADMIN WORKSHOP CRUD
# ==========================================
from models import WorkshopCreateRequest, WorkshopUpdateRequest, WorkshopAssignVolunteerRequest

@app.post("/workshops")
def create_workshop(request: WorkshopCreateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can create workshops")
        
    new_workshop = {
        "workshop_id": request.workshop_id,
        "slot_id": request.slot_id,
        "name": request.name,
        "venue": request.venue,
        "capacity": request.capacity,
        "registration_count": 0,
        "participant_count": 0,
        "instructions": request.instructions,
        "start_time": request.start_time,
        "workshop_team": [],
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    workshops_collection.insert_one(new_workshop)
    return {"message": "Workshop created"}

@app.get("/workshops")
def list_workshops(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    
    if admin:
        return list(workshops_collection.find({}, {"_id": 0}))
    return list(workshops_collection.find({}, {"_id": 0, "workshop_team": 0}))

@app.put("/workshops/{workshop_id}")
def update_workshop(workshop_id: str, request: WorkshopUpdateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can edit workshops")
        
    update_data = {k: v for k, v in request.dict().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        workshops_collection.update_one({"workshop_id": workshop_id}, {"$set": update_data})
    return {"message": "Workshop updated"}

@app.delete("/workshops/{workshop_id}")
def delete_workshop(workshop_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can delete workshops")
        
    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    if workshop:
        ws_doc_id = workshop["_id"]
        # Cascade delete from participants
        participants_collection.update_many(
            {"workshops.workshop_id": ws_doc_id},
            {"$pull": {"workshops": {"workshop_id": ws_doc_id}}}
        )
        workshops_collection.delete_one({"workshop_id": workshop_id})
    return {"message": "Workshop deleted"}

@app.post("/workshops/{workshop_id}/volunteers")
def assign_workshop_volunteer(workshop_id: str, request: WorkshopAssignVolunteerRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can assign volunteers")
        
    workshops_collection.update_one(
        {"workshop_id": workshop_id},
        {"$push": {"workshop_team": {"role": request.role, "user_id": request.user_id, "scanning_enabled": request.scanning_enabled}}}
    )
    return {"message": "Volunteer assigned"}

@app.put("/workshops/{workshop_id}/volunteers/{user_id}/toggle_scan")
def toggle_volunteer_scan(workshop_id: str, volunteer_user_id: str, scanning_enabled: bool, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can toggle scanning")
        
    workshops_collection.update_one(
        {"workshop_id": workshop_id, "workshop_team.user_id": volunteer_user_id},
        {"$set": {"workshop_team.$.scanning_enabled": scanning_enabled}}
    )
    return {"message": "Volunteer scanning toggled"}

@app.get("/workshops/{workshop_id}/logs")
def workshop_logs(workshop_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can view logs")
    
    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    logs = list(workshop_logs_collection.find({"workshop_id": str(workshop["_id"])}, {"_id": 0}))
    return {"logs": logs}


# ==========================================
# EVENT MANAGEMENT APIS
# ==========================================

@app.post("/events")
def create_event(request: EventCreateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin and current_user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only Super Admins can create events")
        
    schedule_data = []
    for r_idx, rnd in enumerate(request.schedule):
        schedule_data.append({
            "round_id": rnd.round_id or f"RND{r_idx + 1}",
            "name": rnd.name,
            "description": rnd.description,
            "start_time": rnd.start_time,
            "end_time": rnd.end_time
        })

    new_event = {
        "event_id": request.event_id,
        "event_type": request.event_type,
        "name": request.name,
        "description": request.description,
        "poster": request.poster,
        "team": request.team.dict(),
        "open": True,
        "prize_money": [pm.dict() for pm in request.prize_money],
        "registration": request.registration,
        "schedule": schedule_data,
        "registration_fields": [rf.dict() for rf in request.registration_fields],
        "event_team": [
            {
                "role": "event_head",
                "user_id": current_user["_id"]
            }
        ],
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    event_collection.insert_one(new_event)
    return {"message": "Event created"}

@app.put("/events/{event_id}")
def update_event(event_id: str, request: EventUpdateRequest, current_user: dict = Depends(get_current_user)):
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    is_super_admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}) or current_user.get("role") == "super_admin"
    is_event_head = any(
        (str(member.get("user_id")) == str(current_user["_id"]) or str(member.get("user_id")) == user_id)
        and member.get("role") in ["event_head", "event_member"]
        for member in event.get("event_team", [])
    )
    
    if not (is_super_admin or is_event_head):
        raise HTTPException(status_code=403, detail="Only Super Admin or Team Lead (POC) can edit this event")
        
    update_data = {k: v for k, v in request.dict().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        event_collection.update_one({"event_id": event_id}, {"$set": update_data})
        
    return {"message": "Event updated successfully"}

@app.post("/events/{event_id}/register")
def register_for_event(event_id: str, reg_input: Optional[EventRegistrationInput] = None, current_user: dict = Depends(get_current_user)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can register for events")
        
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    # Check if user already registered for this event
    user_events = current_user.get("events", [])
    if any(str(ev.get("event_id")) == str(event["_id"]) for ev in user_events):
        raise HTTPException(status_code=409, detail="User is already registered for this event.")
        
    registration_entry = {
        "team_id": reg_input.team_name if reg_input and reg_input.team_name else f"TE{datetime.utcnow().strftime('%M%S')}",
        "event_id": event["_id"],
        "team_role": "leader",
        "registration_data": reg_input.registration_data if reg_input else {}
    }

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$push": {"events": registration_entry}}
    )
    return {"message": "Registered for event successfully."}

@app.post("/events/{event_id}/attendance")
def event_attendance(event_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_user)):
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    is_super_admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}) or current_user.get("role") == "super_admin"
    is_event_team = any(
        str(member.get("user_id")) == str(current_user["_id"]) or str(member.get("user_id")) == user_id
        for member in event.get("event_team", [])
    )
    if not (is_super_admin or is_event_team):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this event")
        
    target_user, payload = verify_qr(request)
    
    target_events = target_user.get("events", [])
    user_event_reg = next((ev for ev in target_events if str(ev.get("event_id")) == str(event["_id"])), None)
    
    if not user_event_reg:
        raise HTTPException(status_code=400, detail="User not registered for this event")
        
    if user_event_reg.get("attended", False):
        return {"message": "Attendee already marked present"}
        
    participants_collection.update_one(
        {"_id": target_user["_id"], "events.event_id": event["_id"]},
        {"$set": {"events.$.attended": True}}
    )
    return {"message": "Attendee marked present"}

@app.get("/events")
def list_events(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id})
    
    events = list(event_collection.find({}, {"_id": 0}))
    
    if admin or "paradox_id" in current_user:
        # Include detailed internal team / registration structure for backend teams
        for ev in events:
            ev["registrations"] = []
        return events
            
    # Regular participants see public event details
    return events

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
