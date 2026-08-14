from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
import random

from database import mess_collection, participants_collection, backend_teams_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from models import ScanQRRequest

router = APIRouter(prefix="/mess", tags=["Mess"])

class MessCreateRequest(BaseModel):
    mess_id: str
    name: str
    capacity: int
    preference: str  # veg, non_veg, jain, etc.
    # Regional menus the hall serves: north_indian | south_indian. A separate
    # axis from `preference`, and a list because a hall can serve both. Optional
    # so callers written against the earlier shape keep working; allocation does
    # not read it, so it never affects who is placed where.
    cuisines: List[str] = []

class MessAssignTeamRequest(BaseModel):
    user_id: Optional[str] = None
    role: str  # volunteer | other
    name: Optional[str] = None # For staff without admin_id
    phone: Optional[str] = None

class MessSlotRequest(BaseModel):
    slot: str # breakfast, lunch, dinner
    start_time: str
    end_time: str

@router.post("")
def create_mess(request: MessCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    mess_doc = {
        "mess_id": request.mess_id,
        "name": request.name,
        "capacity": request.capacity,
        "preference": request.preference,
        "cuisines": request.cuisines,
        "mess_team": [],
        "created_at": datetime.utcnow()
    }
    mess_collection.insert_one(mess_doc)
    log_audit(user_id, "CREATE_MESS", request.mess_id, {"capacity": request.capacity})
    return {"message": "Mess created"}

@router.get("")
def list_messes(current_user: dict = Depends(get_current_user)):
    return list(mess_collection.find({}, {"_id": 0}))

@router.post("/{mess_id}/team")
def assign_mess_team(mess_id: str, request: MessAssignTeamRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    logging = True if request.role == "other" else False
    team_member = {
        "user_id": request.user_id,
        "role": request.role,
        "name": request.name,
        "phone": request.phone,
        "logging": logging
    }
    existing = mess_collection.find_one({"mess_id": mess_id, "mess_team.user_id": request.user_id})
    if existing and request.user_id:
        raise HTTPException(status_code=409, detail="Team member already assigned to this mess")
    mess_collection.update_one({"mess_id": mess_id}, {"$push": {"mess_team": team_member}})
    log_audit(user_id, "ASSIGN_MESS_TEAM", mess_id, {"team_user_id": request.user_id, "role": request.role})
    return {"message": "Team member assigned"}

@router.put("/{mess_id}/team/{team_user_id}/toggle_scan")
def toggle_mess_scan(mess_id: str, team_user_id: str, logging: bool, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    mess_collection.update_one(
        {"mess_id": mess_id, "mess_team.user_id": team_user_id},
        {"$set": {"mess_team.$.logging": logging}}
    )
    return {"message": "Scanning toggled"}

@router.post("/allocate")
def allocate_messes(current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    messes = list(mess_collection.find())
    pref_groups = {}
    for m in messes:
        pref_groups.setdefault(m.get("preference"), []).append(m)
        
    # Only allocate those who have mess.mess_id as None or missing
    participants = list(participants_collection.find({"$or": [{"mess.mess_id": None}, {"mess.mess_id": {"$exists": False}}]}))
    allocated = 0
    
    for p in participants:
        pref = p.get("profile", {}).get("mess_preference", "veg")
        available_messes = pref_groups.get(pref, [])
        assigned = False
        for chosen_mess in available_messes:
            current_count = participants_collection.count_documents({"mess.mess_id": chosen_mess["_id"]})
            if current_count < chosen_mess.get("capacity", 0):
                participants_collection.update_one(
                    {"_id": p["_id"]},
                    {"$set": {"mess.mess_id": chosen_mess["_id"]}}
                )
                allocated += 1
                assigned = True
                break
            
    log_audit(user_id, "ALLOCATE_MESSES", None, {"allocated_count": allocated})
    return {"message": f"Allocated {allocated} participants to messes"}

@router.get("/my_mess")
def my_mess(current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants have assigned messes")
    
    mess_oid = current_user.get("mess", {}).get("mess_id")
    mess_details = mess_collection.find_one({"_id": mess_oid}, {"_id": 0}) if mess_oid else None
    
    return {
        "allotted_mess": mess_details.get("mess_id") if mess_details else None,
        "mess_details": mess_details,
        "slots": current_user.get("mess", {}).get("entries", [])
    }

@router.post("/{mess_id}/scan")
def scan_mess(mess_id: str, request: ScanQRRequest, slot: str, day: int, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess: raise HTTPException(status_code=404, detail="Mess not found")
    
    team_member = next((m for m in mess.get("mess_team", []) if m.get("user_id") == user_id), None)
    
    if not team_member:
        raise HTTPException(status_code=403, detail="Not authorized to scan for this mess")
        
    if not team_member.get("logging"):
        raise HTTPException(status_code=403, detail="Scanning disabled for you")
        
    target_user, _ = verify_qr(request)
    
    user_mess = target_user.get("mess", {})
    if user_mess.get("mess_id") != mess["_id"]:
        raise HTTPException(status_code=400, detail="Participant not allotted to this mess")
        
    entries = user_mess.get("entries", [])
    
    # Check if logged in for this day/slot
    day_entry = next((e for e in entries if e.get("day") == day), None)
    if not day_entry:
        raise HTTPException(status_code=400, detail="Day entry not found")
        
    slot_entry = next((s for s in day_entry.get("slots", []) if s.get("slot") == slot), None)
    if not slot_entry:
        raise HTTPException(status_code=400, detail="Slot not found")
        
    if slot_entry.get("logged"):
        raise HTTPException(status_code=400, detail=f"Already logged in for {slot} on day {day}")
        
    slot_entry["logged"] = True
    
    # Mark as logged (rewrite the entire entries array for mongomock compatibility)
    participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": {"mess.entries": entries}}
    )
    log_audit(user_id, "MESS_SCAN", mess_id, {"participant_id": target_user.get("participant_id"), "slot": slot, "day": day})
    return {"message": "Scan successful, entry allowed"}

@router.get("/{mess_id}/statistics")
def mess_statistics(mess_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess: raise HTTPException(status_code=404, detail="Mess not found")
    
    participants = list(participants_collection.find({"mess.mess_id": mess["_id"]}))
    
    allotted = []
    for p in participants:
        prof = p.get("profile", {})
        allotted.append({
            "participant_id": p.get("participant_id"),
            "name": prof.get("full_name"),
            "email": p.get("email"),
            "phone": prof.get("phone")
        })
        
    return {
        "total_allocated": len(participants),
        "capacity": mess.get("capacity"),
        "allotted_participants": allotted
    }
