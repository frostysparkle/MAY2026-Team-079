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

class MessMenuSlot(BaseModel):
    slot: str            # breakfast | lunch | dinner
    start_time: str      # "HH:MM"
    end_time: str
    dishes: List[str] = []

class MessMenuDay(BaseModel):
    day: int             # 1-based fest day
    slots: List[MessMenuSlot] = []

class MessMenuRequest(BaseModel):
    days: List[MessMenuDay] = []
    note: Optional[str] = None

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
    log_audit(current_user, "CREATE_MESS", request.mess_id, {"capacity": request.capacity})
    return {"message": "Mess created"}

@router.get("")
def list_messes(current_user: dict = Depends(get_current_user)):
    return list(mess_collection.find({}, {"_id": 0}))

@router.put("/{mess_id}/menu")
def update_mess_menu(mess_id: str, request: MessMenuRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess: raise HTTPException(status_code=404, detail="Mess not found")

    is_super = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    on_team = any(m.get("user_id") == user_id for m in mess.get("mess_team", []))
    if not (is_super or on_team):
        raise HTTPException(status_code=403, detail="Not authorized to edit this menu")

    menu = {
        "days": [d.model_dump() for d in request.days],
        "note": request.note,
        "updated_at": datetime.utcnow(),
        "updated_by": user_id,
    }
    mess_collection.update_one({"mess_id": mess_id}, {"$set": {"menu": menu}})
    log_audit(current_user, "UPDATE_MESS_MENU", mess_id, {"days": len(request.days)})
    return {"message": "Menu updated"}

@router.post("/{mess_id}/team")
def assign_mess_team(mess_id: str, request: MessAssignTeamRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")
        
    # Both roles a mess team can hold scan on assignment. This used to be
    # `role == "other"` only, which meant a member created as a `volunteer` -- the
    # role the word "volunteer" maps to -- landed with scanning off and needed an
    # admin to switch them on before they could log a single meal.
    #
    # Still a whitelist rather than a default-true: `role` is a free string, so an
    # unrecognised value gets no scanning instead of inheriting it by accident.
    # Revoking afterwards is unchanged -- see `toggle_scan`.
    logging = request.role in ("volunteer", "other")
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
    log_audit(current_user, "ASSIGN_MESS_TEAM", mess_id, {"team_user_id": request.user_id, "role": request.role})
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
        
    # Opting in is what makes somebody allocatable, exactly as
    # `POST /hostels/allocate` treats `accommodation.registered`. Without this
    # filter the route seated anybody who merely lacked a `mess.mess_id` — which
    # is every participant who never asked for a meal plan — and
    # `/participants/statistics` then reported `mess_allotted` above
    # `mess_registered`, a total that cannot happen and that the dashboard
    # pipeline rendered as more people fed than signed up.
    participants = list(participants_collection.find({
        "mess.registered": True,
        "$or": [{"mess.mess_id": None}, {"mess.mess_id": {"$exists": False}}],
    }))
    allocated = 0

    # Seat counts are tracked here rather than re-queried per participant: the
    # old `count_documents` inside the inner loop ran once per candidate per hall,
    # so a fest-sized queue turned one request into thousands of round trips.
    # Seeding from the current occupancy keeps the capacity ceiling honest.
    seated = {
        m["_id"]: participants_collection.count_documents({"mess.mess_id": m["_id"]})
        for m in messes
    }

    for p in participants:
        # `.get(key, default)` does not fire when the key exists holding None, and
        # a profile that never chose a preference stores exactly that. Treating
        # both the missing and the null case as the default is what stops a
        # genuine registrant being skipped silently on every run.
        pref = (p.get("profile") or {}).get("mess_preference") or "veg"
        available_messes = pref_groups.get(pref, [])
        assigned = False
        for chosen_mess in available_messes:
            if seated[chosen_mess["_id"]] < chosen_mess.get("capacity", 0):
                participants_collection.update_one(
                    {"_id": p["_id"]},
                    {"$set": {"mess.mess_id": chosen_mess["_id"]}}
                )
                seated[chosen_mess["_id"]] += 1
                allocated += 1
                assigned = True
                break
            
    log_audit(current_user, "ALLOCATE_MESSES", None, {"allocated_count": allocated})
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
    log_audit(current_user, "MESS_SCAN", mess_id, {"participant_id": target_user.get("participant_id"), "slot": slot, "day": day})
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
