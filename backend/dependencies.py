from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from datetime import datetime, timedelta
from database import participants_collection, backend_teams_collection
from security import SECRET_KEY, ALGORITHM, decrypt_qr_data

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Accepts both participant and staff tokens. Use for endpoints accessible by both."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        token_type: str = payload.get("type", "participant")  # "participant" | "staff"
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

    if token_type == "staff":
        user = backend_teams_collection.find_one({"paradox_id": user_id})
    else:
        user = participants_collection.find_one({"participant_id": user_id})

    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def get_current_staff(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Requires a staff token (type='staff'). Rejects participant tokens at auth layer."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        token_type: str = payload.get("type", "participant")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

    if token_type != "staff":
        raise HTTPException(status_code=403, detail="Staff credentials required. Use /auth/admin/login.")

    user = backend_teams_collection.find_one({"paradox_id": user_id})
    if user is None:
        raise HTTPException(status_code=401, detail="Staff member not found")
    return user

def get_current_participant(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Requires a participant token (type='participant'). Rejects staff tokens at auth layer."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        token_type: str = payload.get("type", "participant")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

    if token_type != "participant":
        raise HTTPException(status_code=403, detail="Participant credentials required. Use /auth/login.")

    user = participants_collection.find_one({"participant_id": user_id})
    if user is None:
        raise HTTPException(status_code=401, detail="Participant not found")
    return user

def verify_qr(request):
    target_user = participants_collection.find_one({"participant_id": request.participant_id})
    if not target_user:
        target_user = participants_collection.find_one({"email": request.participant_id})
        
    if not target_user:
        raise HTTPException(status_code=404, detail="Scanned user not found")
        
    private_key = target_user.get("qr_secrets", {}).get("private_key")
    if not private_key:
        raise HTTPException(status_code=400, detail="User missing private key")
        
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
