from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt, JWTError
from datetime import datetime, timedelta
import re

from models import (
    RegisterRequest, LoginRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest, ProfileCompleteRequest
)
from database import attendees_collection
from security import (
    get_password_hash, verify_password, create_access_token,
    generate_rsa_key_pair, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
