"""
Authentication endpoints — registration, participant/staff login, and password
management. Extracted from main.py so all auth-focused routes live in one
file, matching the pattern already used by workshops, mess, events, etc.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timedelta
import re

from models import (
    RegisterRequest, LoginRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest
)
from dependencies import get_current_user
from database import participants_collection, backend_teams_collection
from security import (
    get_password_hash, verify_password, create_access_token,
    generate_rsa_key_pair, ACCESS_TOKEN_EXPIRE_MINUTES
)
from embedding_service import zero_embedding

router = APIRouter(prefix="/auth", tags=["Auth"])


def generate_participant_id(email: str) -> str:
    """Extracts participant ID from IITM email. Ex: 23f3001726@ds.study.iitm.ac.in -> DS23F3001726"""
    match = re.match(r'^([^@]+)@([a-z]+)\.study\.iitm\.ac\.in$', email.lower())
    if match:
        roll_no = match.group(1).upper()
        program = match.group(2).upper()
        return f"{program}{roll_no}"
    return email.split('@')[0].upper()


@router.post("/register")
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

    new_user = {
        "participant_id": participant_id,
        "email": request.email,
        "password_hash": hashed_password,
        "profile": {},
        "mess": {
            "registered": False,
            "mess_id": None,
            # Scan markers keyed the same way as the hall's own `menu`
            # (`day_1`, `day_2`, ... -> `breakfast` | `lunch` | `dinner`).
            # Starts empty rather than pre-seeded: which days/slots exist is
            # entirely up to whichever hall this participant is later
            # allocated to, and that hall's own menu can change at any time.
            # `GET /mess/my_mess` derives the display list by merging this
            # against the allotted hall's current menu.
            "scans": {}
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
        "embedding": {
            "workshop": zero_embedding(),
            "event": zero_embedding()
        },
        "events": [],
        "workshops": [],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    participants_collection.insert_one(new_user)
    return {"message": "Registration successful", "participant_id": participant_id}


@router.post("/login")
def login(request: LoginRequest):
    # Participant-only login
    user = participants_collection.find_one({"email": request.email})

    if not user or not verify_password(request.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    user_id = user.get("participant_id")
    
    participants_collection.update_one(
        {"_id": user["_id"]}, 
        {"$set": {"updated_at": datetime.utcnow()}}
    )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id, "type": "participant"}, expires_delta=access_token_expires
    )
    
    profile = user.get("profile", {})
    return {
        "id": user_id,
        "email": user["email"],
        "access_token": access_token,
        "token_type": "participant",
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


@router.post("/admin/login")
def admin_login(request: LoginRequest):
    # Backend staff-only login (Super Admins, Domain Admins, UHC, Event Heads, Volunteers, Guards, Employees)
    user = backend_teams_collection.find_one({"email": request.email})

    if not user or not verify_password(request.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = user.get("paradox_id")

    backend_teams_collection.update_one(
        {"_id": user["_id"]},
        {"$set": {"updated_at": datetime.utcnow()}}
    )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id, "type": "staff"}, expires_delta=access_token_expires
    )

    return {
        "id": user_id,
        "email": user["email"],
        "access_token": access_token,
        "token_type": "staff",
        "role": user.get("role"),
        "department": user.get("department"),
        "designation": user.get("designation"),
    }


@router.post("/password/forgot")
def forgot_password(request: ForgotPasswordRequest):
    return {
        "message": "If the account exists, a reset link has been sent.",
        "dev_reset_url": "http://localhost:5173/reset-password?token=mock_token_123"
    }


@router.post("/password/reset")
def reset_password(request: ResetPasswordRequest):
    return {"message": "Password reset successfully."}


@router.post("/password/change")
def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    if not verify_password(request.current_password, current_user.get("password_hash")):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    hashed_password = get_password_hash(request.new_password)
    
    is_staff = "paradox_id" in current_user
    user_id_field = "paradox_id" if is_staff else "participant_id"
    collection = backend_teams_collection if is_staff else participants_collection
    
    collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"password_hash": hashed_password, "updated_at": datetime.utcnow()}}
    )
    
    user_id = current_user[user_id_field]
    token_type = "staff" if is_staff else "participant"
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id, "type": token_type}, expires_delta=access_token_expires
    )
    
    return {
        "message": "Password changed successfully.",
        "access_token": access_token
    }
