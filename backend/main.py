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

from routers import workshops, events, mess, hostels, audit
from dependencies import get_current_user, verify_qr
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
    # Enforce IITM email domain
    if not re.match(r'^[^@]+@[a-z]+\.study\.iitm\.ac\.in$', request.email.lower()):
        raise HTTPException(status_code=400, detail="Must be an @*.study.iitm.ac.in email")

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
    return {"message": "Registration successful", "participant_id": participant_id}

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



# ==========================================
# SCANNER & VERIFICATION APIS
# ==========================================






# NOTE: Hostel entry/exit and mess entry are handled by the cleaner
# router-based endpoints: POST /hostels/{hostel_id}/scan?action=entry|exit
# and POST /mess/{mess_id}/scan?slot=...&day=... defined in routers/hostels.py and routers/mess.py


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
        
    # Look up the participant document that corresponds to this email (the admin_id link per schema)
    participant_doc = participants_collection.find_one({"email": request.email}, {"_id": 1})
    admin_id_ref = participant_doc["_id"] if participant_doc else None

    new_team = {
        "paradox_id": f"BT{int(datetime.utcnow().timestamp())}",
        "email": request.email,
        "password_hash": get_password_hash(request.password),
        "role": request.role,
        "department": request.department,
        "designation": request.designation,
        "admin_id": admin_id_ref,  # ObjectId reference to participant document | None
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
app.include_router(workshops.router)
app.include_router(events.router)
app.include_router(mess.router)
app.include_router(hostels.router)
app.include_router(audit.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
