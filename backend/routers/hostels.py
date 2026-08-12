from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
import random

from database import hostel_collection, participants_collection, backend_teams_collection
from dependencies import get_current_user, verify_qr
from models import ScanQRRequest

router = APIRouter(prefix="/hostels", tags=["Hostels"])

class HostelCreateRequest(BaseModel):
    hostel_id: str
    name: str
    capacity: int
    gender: str
    coordinator: dict

class HostelAssignTeamRequest(BaseModel):
    user_id: Optional[str] = None
    role: str  # volunteer | other
    name: Optional[str] = None
    phone: Optional[str] = None

@router.post("")
def create_hostel(request: HostelCreateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    hostel_doc = {
        "hostel_id": request.hostel_id,
        "name": request.name,
        "capacity": request.capacity,
        "gender": request.gender,
        "coordinator": request.coordinator,
        "hostel_team": [],
        "created_at": datetime.utcnow()
    }
    hostel_collection.insert_one(hostel_doc)
    log_audit(user_id, "CREATE_HOSTEL", request.hostel_id, {"capacity": request.capacity})
    return {"message": "Hostel created"}

@router.get("")
def list_hostels(current_user: dict = Depends(get_current_user)):
    return list(hostel_collection.find({}, {"_id": 0}))

@router.post("/{hostel_id}/team")
def assign_hostel_team(hostel_id: str, request: HostelAssignTeamRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
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
    existing = hostel_collection.find_one({"hostel_id": hostel_id, "hostel_team.user_id": request.user_id})
    if existing and request.user_id:
        raise HTTPException(status_code=409, detail="Team member already assigned to this hostel")
    hostel_collection.update_one({"hostel_id": hostel_id}, {"$push": {"hostel_team": team_member}})
    log_audit(user_id, "ASSIGN_HOSTEL_TEAM", hostel_id, {"team_user_id": request.user_id, "role": request.role})
    return {"message": "Team member assigned"}

@router.put("/{hostel_id}/team/{team_user_id}/toggle_scan")
def toggle_hostel_scan(hostel_id: str, team_user_id: str, logging: bool, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    hostel_collection.update_one(
        {"hostel_id": hostel_id, "hostel_team.user_id": team_user_id},
        {"$set": {"hostel_team.$.logging": logging}}
    )
    return {"message": "Scanning toggled"}

@router.post("/allocate")
def allocate_hostels(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    hostels = list(hostel_collection.find())
    gender_groups = {}
    for h in hostels:
        # Normalize gender key to lowercase for consistent matching
        gender_groups.setdefault(h.get("gender", "").lower(), []).append(h)
        
    participants = list(participants_collection.find({
        "accommodation.registered": True,
        "accommodation.hostel_id": None
    }))
    allocated = 0
    
    # Track assigned capacities globally per hostel
    hostel_assignments = {h["hostel_id"]: 0 for h in hostels}
    
    for p in participants:
        # Normalize participant gender to lowercase to match hostel grouping
        gender = p.get("profile", {}).get("gender", "male").lower()
        available_hostels = gender_groups.get(gender, [])
        for h in available_hostels:
            if hostel_assignments[h["hostel_id"]] < h["capacity"]:
                room_num = 100 + hostel_assignments[h["hostel_id"]]
                hostel_assignments[h["hostel_id"]] += 1
                
                participants_collection.update_one(
                    {"_id": p["_id"]},
                    {"$set": {
                        "accommodation.hostel_id": h["hostel_id"],
                        "accommodation.room": str(room_num),
                        "accommodation.logged_in": False,
                        "accommodation.registered": True
                    }}
                )
                allocated += 1
                break
            
    log_audit(user_id, "ALLOCATE_HOSTELS", None, {"allocated_count": allocated})
    return {"message": f"Allocated {allocated} participants to hostels"}

@router.get("/my_hostel")
def my_hostel(current_user: dict = Depends(get_current_user)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants have assigned hostels")
    
    hostel_id = current_user.get("accommodation", {}).get("hostel_id")
    hostel_details = hostel_collection.find_one({"hostel_id": hostel_id}, {"_id": 0}) if hostel_id else None
    
    # Mask some sensitive volunteer details for participants
    volunteers = []
    if hostel_details:
        for t in hostel_details.get("hostel_team", []):
            volunteers.append({
                "name": t.get("name") or t.get("role"),
                "phone": t.get("phone", "N/A")
            })
    
    return {
        "assigned_hostel": hostel_id,
        "room": current_user.get("accommodation", {}).get("room"),
        "logged_in": current_user.get("accommodation", {}).get("logged_in", False),
        "volunteers": volunteers
    }

@router.post("/{hostel_id}/scan")
def scan_hostel(hostel_id: str, request: ScanQRRequest, action: str, current_user: dict = Depends(get_current_user)):
    # action: "entry" or "exit"
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")
    
    is_super_admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    team_member = next((m for m in hostel.get("hostel_team", []) if m.get("user_id") == user_id), None)
    
    if not (is_super_admin or team_member):
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")
        
    if team_member and not team_member.get("logging"):
        raise HTTPException(status_code=403, detail="Scanning disabled for you")
        
    target_user, _ = verify_qr(request)
    
    user_acc = target_user.get("accommodation", {})
    if user_acc.get("hostel_id") != hostel_id:
        raise HTTPException(status_code=400, detail="Participant not allotted to this hostel")
        
    is_logged_in = user_acc.get("logged_in", False)
    
    if action == "entry":
        if is_logged_in:
            raise HTTPException(status_code=400, detail="Participant is already inside")
        new_status = True
    elif action == "exit":
        if not is_logged_in:
            raise HTTPException(status_code=400, detail="Participant is already outside")
        new_status = False
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Must be 'entry' or 'exit'")
        
    participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": {"accommodation.logged_in": new_status}}
    )
    log_audit(user_id, f"HOSTEL_{action.upper()}", hostel_id, {"participant_id": target_user.get("participant_id")})
    return {"message": f"Scan successful, {action} allowed"}

@router.get("/{hostel_id}/statistics")
def hostel_statistics(hostel_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id") or current_user.get("participant_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")
    
    participants = list(participants_collection.find({"accommodation.hostel_id": hostel_id}))
    
    inside_count = sum(1 for p in participants if p.get("accommodation", {}).get("logged_in", False))
    
    allotted = []
    for p in participants:
        prof = p.get("profile", {})
        allotted.append({
            "participant_id": p.get("participant_id"),
            "name": prof.get("full_name"),
            "email": p.get("email"),
            "room": p.get("accommodation", {}).get("room")
        })
        
    return {
        "total_allocated": len(participants),
        "capacity": hostel.get("capacity"),
        "currently_inside": inside_count,
        "allotted_participants": allotted
    }
