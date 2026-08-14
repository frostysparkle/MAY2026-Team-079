from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
import random

from models import EventCreateRequest, EventUpdateRequest, EventRegistrationInput, ScanQRRequest
from database import event_collection, participants_collection, backend_teams_collection, event_logs_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr

router = APIRouter(prefix="/events", tags=["Events"])

@router.post("")
def create_event(request: EventCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin and current_user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only Super Admins can create events")
        
    schedule_data = []
    for r_idx, rnd in enumerate(request.schedule):
        schedule_data.append({
            "round_id": rnd.round_id or f"RND{r_idx + 1}",
            "name": rnd.name,
            "description": rnd.description,
            "start_time": rnd.start_time,
            "end_time": rnd.end_time
        })

    new_event = {
        "event_id": request.event_id,
        "event_type": request.event_type,
        "name": request.name,
        "description": request.description,
        "poster": request.poster,
        "team": request.team.model_dump(),
        "open": True,
        "prize_money": [pm.model_dump() for pm in request.prize_money],
        "registration": request.registration,
        "schedule": schedule_data,
        "registration_fields": [rf.model_dump() for rf in request.registration_fields],
        "event_team": [],
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "logs": []
    }
    event_collection.insert_one(new_event)
    log_audit(user_id, "CREATE_EVENT", request.event_id)
    return {"message": "Event created"}

@router.get("")
def list_events(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id})
    events = list(event_collection.find({}, {"_id": 0}))
    return events

@router.put("/{event_id}")
def update_event(event_id: str, request: EventUpdateRequest, current_user: dict = Depends(get_current_staff)):
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    user_id = current_user.get("paradox_id")
    is_super_admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}) or current_user.get("role") == "super_admin"
    if not is_super_admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can edit this event")
        
    update_data = {k: v for k, v in request.dict().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        event_collection.update_one({"event_id": event_id}, {"$set": update_data})
    log_audit(user_id, "UPDATE_EVENT", event_id, {"fields_updated": list(update_data.keys())})
    return {"message": "Event updated successfully"}

@router.delete("/{event_id}")
def delete_event(event_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    is_super_admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}) or current_user.get("role") == "super_admin"
    if not is_super_admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can delete events")
    
    event = event_collection.find_one({"event_id": event_id})
    if event:
        participants_collection.update_many(
            {"events.event_id": event["_id"]},
            {"$pull": {"events": {"event_id": event["_id"]}}}
        )
        event_collection.delete_one({"event_id": event_id})
    log_audit(user_id, "DELETE_EVENT", event_id)
    return {"message": "Event deleted"}


from pydantic import BaseModel
class EventTeamAssignRequest(BaseModel):
    user_id: str
    role: str # event_head | event_member | volunteer

@router.post("/{event_id}/team")
def assign_event_team(event_id: str, request: EventTeamAssignRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    is_super_admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}) or current_user.get("role") == "super_admin"
    if not is_super_admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can assign event teams")
        
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    event_collection.update_one(
        {"event_id": event_id},
        {"$push": {"event_team": {"role": request.role, "user_id": request.user_id}}}
    )
    log_audit(user_id, "ASSIGN_EVENT_TEAM", event_id, {"assigned_user": request.user_id, "role": request.role})
    return {"message": "Team member assigned"}

@router.post("/{event_id}/register")
def register_for_event(event_id: str, reg_input: Optional[EventRegistrationInput] = None, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can register for events")
        
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    if not event.get("open", True):
        raise HTTPException(status_code=400, detail="Registration is closed for this event")
    
    user_events = current_user.get("events", [])
    if any(str(ev.get("event_id")) == str(event["_id"]) for ev in user_events):
        raise HTTPException(status_code=409, detail="User is already registered for this event.")

    # Block event team members from registering as participants for their own event.
    # backend_teams.admin_id is an ObjectId reference to the participant's _id document.
    backend_member = backend_teams_collection.find_one({"admin_id": current_user["_id"]})
    if backend_member:
        paradox_id = backend_member.get("paradox_id")
        is_event_team_member = any(
            str(member.get("user_id")) == paradox_id
            for member in event.get("event_team", [])
        )
        if is_event_team_member:
            raise HTTPException(
                status_code=403,
                detail="Event team members cannot register as participants for their own event."
            )


    registration_entry = {
        "team_id": reg_input.team_name if reg_input and reg_input.team_name else None,
        "event_id": event["_id"],
        "team_role": "leader" if (reg_input and reg_input.team_name) else "member",
        "registration_data": reg_input.registration_data if reg_input else {}
    }

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$push": {"events": registration_entry}}
    )
    event_collection.update_one(
        {"_id": event["_id"]},
        {"$push": {"logs": {"action": "registration", "participant_id": current_user["participant_id"], "time": datetime.utcnow()}}}
    )
    log_audit(current_user["participant_id"], "EVENT_REGISTER", event_id)
    return {"message": "Registered for event successfully."}

@router.put("/{event_id}/register")
def edit_event_registration(event_id: str, reg_input: EventRegistrationInput, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can edit event registrations")
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    if not event.get("open", True):
        raise HTTPException(status_code=400, detail="Registration is closed")

    participants_collection.update_one(
        {"_id": current_user["_id"], "events.event_id": event["_id"]},
        {"$set": {"events.$.registration_data": reg_input.registration_data}}
    )
    return {"message": "Registration updated"}

@router.delete("/{event_id}/register")
def deregister_event(event_id: str, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can deregister")
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    if not event.get("open", True):
        raise HTTPException(status_code=400, detail="Registration is closed")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$pull": {"events": {"event_id": event["_id"]}}}
    )
    log_audit(current_user["participant_id"], "EVENT_DEREGISTER", event_id)
    return {"message": "Deregistered successfully"}

@router.get("/my_registrations")
def my_registrations(current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        return []
    events = current_user.get("events", [])
    for ev in events:
        if "event_id" in ev and not isinstance(ev["event_id"], str):
            ev["event_id"] = str(ev["event_id"])
    return events

@router.get("/{event_id}/participation")
def view_participation(event_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    admin_doc = backend_teams_collection.find_one({"paradox_id": user_id})
    is_super_admin = admin_doc and admin_doc.get("role") == "super_admin"
    is_event_team = any(str(member.get("user_id")) == user_id for member in event.get("event_team", []))
    
    is_uhc = admin_doc and admin_doc.get("department") == "uhc"
    is_dept_admin = admin_doc and admin_doc.get("department") == event.get("event_type")

    if not (is_super_admin or is_event_team or is_uhc or is_dept_admin):
        raise HTTPException(status_code=403, detail="Not authorized to view participation details")

    participants = list(participants_collection.find({"events.event_id": event["_id"]}))
    
    result = []
    for p in participants:
        ev_reg = next((ev for ev in p.get("events", []) if str(ev["event_id"]) == str(event["_id"])), None)
        prof = p.get("profile", {})
        
        # UHC filtering logic
        if is_uhc and not is_super_admin and not is_event_team:
            email = admin_doc.get("email", "")
            admin_house = email.split("-")[0].lower() if "-" in email else None
            if prof.get("house", "").lower() != admin_house:
                continue

        result.append({
            "participant_id": p.get("participant_id"),
            "name": prof.get("full_name"),
            "email": p.get("email"),
            "phone": prof.get("phone"),
            "house": prof.get("house"),
            "team_id": ev_reg.get("team_id") if ev_reg else None,
            "team_role": ev_reg.get("team_role") if ev_reg else None
        })


    # Fetch event team details
    event_team_details = []
    for member in event.get("event_team", []):
        admin_id = member.get("user_id")
        # Could be in backend_teams or participants (if they are a student volunteer)
        # Pull profile details
        admin = backend_teams_collection.find_one({"paradox_id": admin_id})
        member_name = "Unknown"
        member_phone = "Unknown"
        if admin:
            member_name = admin.get("designation", "Admin")
        
        # Try to find participant if they have a student profile
        p_doc = participants_collection.find_one({"participant_id": admin_id})
            
        if p_doc:
            prof = p_doc.get("profile", {})
            member_name = prof.get("full_name", member_name)
            member_phone = prof.get("phone", member_phone)
            
        event_team_details.append({
            "user_id": str(admin_id),
            "role": member.get("role"),
            "name": member_name,
            "phone": member_phone
        })


    response_data = {
        "count": len(result), 
        "participants": result,
        "event_team": event_team_details
    }
    
    if not is_uhc:
        day_str = datetime.utcnow().strftime("%Y-%m-%d")
        total_scans_today = event_logs_collection.count_documents({
            "event_id": str(event["_id"]),
            "day": day_str
        })
        response_data["total_daily_scans"] = total_scans_today

    return response_data

@router.post("/{event_id}/allocate_teams")
def allocate_teams(event_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    is_event_head = any(str(member.get("user_id")) == user_id and member.get("role") == "event_head" for member in event.get("event_team", []))
    
    if not is_event_head:
        raise HTTPException(status_code=403, detail="Only Event Heads are authorized to allocate teams")
        
    team_rules = event.get("team", {})
    min_size = team_rules.get("min", 1)
    max_size = team_rules.get("max", 1)
    
    if max_size <= 1:
        return {"message": "Not a team event"}
        
    participants = list(participants_collection.find({"events.event_id": event["_id"]}))
    solo_players = []
    
    for p in participants:
        ev_reg = next((ev for ev in p.get("events", []) if str(ev["event_id"]) == str(event["_id"])), None)
        if ev_reg and not ev_reg.get("team_id"):
            solo_players.append(p)
            
    random.shuffle(solo_players)
    teams_created = 0
    
    if team_rules.get("house", False):
        # Group by house
        house_groups = {}
        for sp in solo_players:
            house = sp.get("profile", {}).get("house", "Unknown")
            house_groups.setdefault(house, []).append(sp)
            
        for house, players in house_groups.items():
            for i in range(0, len(players), max_size):
                team_chunk = players[i:i+max_size]
                if len(team_chunk) >= min_size:
                    team_id = f"TE_HO_{datetime.utcnow().strftime('%M%S%f')}_{teams_created}"
                    for p in team_chunk:
                        participants_collection.update_one(
                            {"_id": p["_id"], "events.event_id": event["_id"]},
                            {"$set": {"events.$.team_id": team_id}}
                        )
                    teams_created += 1
    else:
        # Mixed random
        for i in range(0, len(solo_players), max_size):
            team_chunk = solo_players[i:i+max_size]
            if len(team_chunk) >= min_size:
                team_id = f"TE_MX_{datetime.utcnow().strftime('%M%S%f')}_{teams_created}"
                for p in team_chunk:
                    participants_collection.update_one(
                        {"_id": p["_id"], "events.event_id": event["_id"]},
                        {"$set": {"events.$.team_id": team_id}}
                    )
                teams_created += 1
                
    log_audit(user_id, "ALLOCATE_EVENT_TEAMS", event_id, {"teams_created": teams_created})
    return {"message": f"Allocated {teams_created} teams"}

@router.post("/{event_id}/scan")
def scan_event_participant(event_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    is_team_member = any(str(member.get("user_id")) == user_id for member in event.get("event_team", []))
    
    if not is_team_member:
        raise HTTPException(status_code=403, detail="Not authorized to scan for this event")
        
    target_user, _ = verify_qr(request)
    
    is_participating = any(str(ev.get("event_id")) == str(event["_id"]) for ev in target_user.get("events", []))
    
    # Log successful scan
    if is_participating:
        now = datetime.utcnow()
        # Create a unique key for today to ensure we only log unique scans per participant per day per event per scanner
        day_str = now.strftime("%Y-%m-%d")
        log_filter = {
            "event_id": str(event["_id"]),
            "participant_id": target_user.get("participant_id"),
            "scanned_by": user_id,
            "day": day_str
        }
        if not event_logs_collection.find_one(log_filter):
            log_entry = {**log_filter, "timestamp": now}
            event_logs_collection.insert_one(log_entry)
            
    return {
        "name": target_user.get("profile", {}).get("full_name"),
        "email": target_user.get("email"),
        "is_participating": is_participating
    }

@router.get("/{event_id}/my_daily_scans")
def my_daily_scans(event_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    is_team_member = any(str(member.get("user_id")) == user_id for member in event.get("event_team", []))
    
    if not is_team_member:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    day_str = datetime.utcnow().strftime("%Y-%m-%d")
    count = event_logs_collection.count_documents({
        "event_id": str(event["_id"]),
        "scanned_by": user_id,
        "day": day_str
    })
    
    return {"daily_unique_scans": count}

class TeamUpdateInput(BaseModel):
    team_id: Optional[str] = None
    team_role: Optional[str] = None

@router.put("/{event_id}/participant_teams/{participant_id}")
def update_participant_team(event_id: str, participant_id: str, payload: TeamUpdateInput, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    
    is_event_head = any(str(member.get("user_id")) == user_id and member.get("role") == "event_head" for member in event.get("event_team", []))
    
    if not is_event_head:
        raise HTTPException(status_code=403, detail="Only Event Heads are authorized to modify participant teams")
        
    participant = participants_collection.find_one({"participant_id": participant_id, "events.event_id": event["_id"]})
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not registered for this event")
        
    participants_collection.update_one(
        {"participant_id": participant_id, "events.event_id": event["_id"]},
        {"$set": {"events.$.team_id": payload.team_id, "events.$.team_role": payload.team_role}}
    )
    return {"message": "Participant team updated"}
