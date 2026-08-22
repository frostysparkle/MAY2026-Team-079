from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from database import hostel_collection, participants_collection, backend_teams_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from models import ScanQRRequest
from id_generator import SequentialIDGenerator

generator = SequentialIDGenerator("HSTL")

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
def create_hostel(request: HostelCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    hostel_doc = {
        "hostel_id": generator.next_id(),
        "name": request.name,
        "capacity": request.capacity,
        "gender": request.gender,
        "coordinator": request.coordinator,
        "hostel_team": [],
        "created_at": datetime.utcnow()
    }
    hostel_collection.insert_one(hostel_doc)
    log_audit(current_user, "CREATE_HOSTEL", request.hostel_id, {"capacity": request.capacity})
    return {"message": "Hostel created"}

@router.get("")
def list_hostels(current_user: dict = Depends(get_current_user)):
    return list(hostel_collection.find({}, {"_id": 0}))

@router.post("/{hostel_id}/team")
def assign_hostel_team(hostel_id: str, request: HostelAssignTeamRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    # Both roles a block team can hold scan on assignment, matching
    # `assign_mess_team`. This used to be `role == "other"` only, which meant a
    # member created as a `volunteer` -- the role story 5.2 names -- landed with
    # scanning off and could not log a single check-in until an admin switched
    # them on.
    #
    # Still a whitelist rather than a default-true: `role` is a free string, so an
    # unrecognised value gets no scanning instead of inheriting it by accident.
    # Revoking afterwards is unchanged -- see `toggle_hostel_scan`.
    logging = request.role in ("volunteer", "other")
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
    log_audit(current_user, "ASSIGN_HOSTEL_TEAM", hostel_id, {"team_user_id": request.user_id, "role": request.role})
    return {"message": "Team member assigned"}

@router.put("/{hostel_id}/team/{team_user_id}/toggle_scan")
def toggle_hostel_scan(hostel_id: str, team_user_id: str, logging: bool, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    hostel_collection.update_one(
        {"hostel_id": hostel_id, "hostel_team.user_id": team_user_id},
        {"$set": {"hostel_team.$.logging": logging}}
    )
    return {"message": "Scanning toggled"}

@router.post("/allocate")
def allocate_hostels(current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
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
            
    log_audit(current_user, "ALLOCATE_HOSTELS", None, {"allocated_count": allocated})
    return {"message": f"Allocated {allocated} participants to hostels"}

@router.post("/register")
def register_for_accommodation(current_user: dict = Depends(get_current_participant)):
    """
    Ask for a hostel place during the fest.

    `POST /hostels/allocate` only considers participants whose
    `accommodation.registered` is True, and registration sets that flag False.
    This is what lets a participant opt in, so allocation has anyone to place.
    Declared before `/{hostel_id}/...` routes so the literal path is not
    captured as a hostel id.

    Idempotent: asking twice is not an error, it just stays requested.
    """
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can request accommodation")

    if current_user.get("accommodation", {}).get("hostel_id"):
        raise HTTPException(status_code=400, detail="Accommodation already allotted")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"accommodation.registered": True}}
    )
    log_audit(current_user, "ACCOMMODATION_REGISTER", None)
    return {"message": "Accommodation requested"}


@router.delete("/register")
def cancel_accommodation_request(current_user: dict = Depends(get_current_participant)):
    """
    Withdraw a pending accommodation request.

    Refused once a hostel has been allotted: releasing an allocated bed is an
    organiser decision, not a self-service one.
    """
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can cancel accommodation")

    if current_user.get("accommodation", {}).get("hostel_id"):
        raise HTTPException(status_code=400, detail="Accommodation already allotted")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"accommodation.registered": False}}
    )
    log_audit(current_user, "ACCOMMODATION_CANCEL", None)
    return {"message": "Accommodation request withdrawn"}


@router.get("/my_hostel")
def my_hostel(current_user: dict = Depends(get_current_participant)):
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
        # Whether this participant has asked for accommodation at all. Without
        # it the UI cannot tell "never requested" from "requested, not yet
        # allocated" — two states that need very different things said to them.
        "registered": current_user.get("accommodation", {}).get("registered", False),
        "volunteers": volunteers
    }

@router.post("/{hostel_id}/scan")
def scan_hostel(hostel_id: str, request: ScanQRRequest, action: str, current_user: dict = Depends(get_current_staff)):
    # action: "entry" or "exit"
    user_id = current_user.get("paradox_id")
    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")
    
    team_member = next((m for m in hostel.get("hostel_team", []) if m.get("user_id") == user_id), None)
    
    if not team_member:
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")
        
    if not team_member.get("logging"):
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
    log_audit(current_user, f"HOSTEL_{action.upper()}", hostel_id, {"participant_id": target_user.get("participant_id")})
    return {"message": f"Scan successful, {action} allowed"}

@router.get("/{hostel_id}/statistics")
def hostel_statistics(hostel_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
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
