from fastapi import APIRouter, HTTPException, Depends
from typing import List

from database import system_logs_collection, backend_teams_collection
from dependencies import get_current_user

router = APIRouter(prefix="/audit-logs", tags=["Audit"])

@router.get("")
def view_audit_logs(limit: int = 100, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can view audit logs")
        
    logs = list(system_logs_collection.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit))
    return logs
