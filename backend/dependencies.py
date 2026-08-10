from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from datetime import datetime, timedelta
from database import participants_collection, backend_teams_collection
from security import SECRET_KEY, ALGORITHM, decrypt_qr_data

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        participant_id: str = payload.get("sub")
        if participant_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    user = participants_collection.find_one({"participant_id": participant_id})
    if user is None:
        user = backend_teams_collection.find_one({"paradox_id": participant_id})
    
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
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
