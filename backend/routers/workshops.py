from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from datetime import datetime, timedelta
from bson import ObjectId
import asyncio

from models import WorkshopCreateRequest, WorkshopUpdateRequest, WorkshopAssignVolunteerRequest, ScanQRRequest
from database import workshops_collection, participants_collection, backend_teams_collection, workshop_logs_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from embedding_service import generate_embedding

router = APIRouter(prefix="/workshops", tags=["Workshops"])

@router.post("")
def create_workshop(request: WorkshopCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can create workshops")
        
    new_workshop = {
        "workshop_id": request.workshop_id,
        "slot_id": request.slot_id,
        "name": request.name,
        "description": request.description,
        "embedding": generate_embedding(request.description),
        "venue": request.venue,
        "capacity": request.capacity,
        "registration_count": 0,
        "participant_count": 0,
        "instructions": request.instructions,
        "workshop_team": [],
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    workshops_collection.insert_one(new_workshop)
    log_audit(user_id, "CREATE_WORKSHOP", request.workshop_id, {"capacity": request.capacity})
    return {"message": "Workshop created"}

@router.get("")
def list_workshops(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}) if user_id else None
    # `created_by` holds the creating admin's raw ObjectId, which is not JSON
    # serialisable — leaving it in makes this endpoint 500 as soon as any
    # workshop has been created through POST /workshops. It is an internal
    # reference with no use to a client, so it is projected out rather than
    # converted. Same fix as list_events.
    if admin:
        return list(workshops_collection.find({}, {"_id": 0, "created_by": 0}))
    return list(workshops_collection.find({}, {"_id": 0, "created_by": 0, "workshop_team": 0}))


# Allow-list of the fields that make up the published workshop programme.
# Written as an inclusion projection on purpose: any field added to the
# workshops collection later stays private until it is named here explicitly.
PUBLIC_WORKSHOP_FIELDS = {
    "_id": 0,
    "workshop_id": 1,
    "slot_id": 1,
    "name": 1,
    "description": 1,
    "embedding": 1,
    "venue": 1,
    "capacity": 1,
    "registration_count": 1,
    "instructions": 1,
}


@router.get("/public")
def list_public_workshops():
    """
    The workshop programme, readable without signing in.

    Deliberately unauthenticated: this is the pre-login workshops catalogue the
    landing page and /workshops render, and it must work for a visitor with no
    account. Only the published fields above are returned — never
    `workshop_team` (which carries staff identities) or internal bookkeeping.

    Mirrors GET /events/public. Declared before any `/{workshop_id}` route so
    the literal path is not captured as a workshop id.
    """
    return list(workshops_collection.find({}, PUBLIC_WORKSHOP_FIELDS))


@router.get("/my_registrations")
def my_workshop_registrations(current_user: dict = Depends(get_current_participant)):
    """
    This participant's own workshop bookings.

    Mirrors GET /events/my_registrations, and exists for the same reason: the
    booking is stored on the participant document, so without this there is no
    way to read back what you booked — the register response says only that it
    worked. Declared before any `/{workshop_id}` route so the literal path is
    not captured as a workshop id.

    `workshops[].workshop_id` holds the workshop's raw ObjectId, so each entry
    is resolved to the public workshop id and name the UI actually shows.
    """
    if "participant_id" not in current_user:
        return []

    registrations = []
    for entry in current_user.get("workshops", []):
        workshop = workshops_collection.find_one(
            {"_id": entry.get("workshop_id")},
            {"_id": 0, "workshop_id": 1, "name": 1, "description": 1, "embedding": 1, "venue": 1, "capacity": 1, "instructions": 1},
        )
        if not workshop:
            # A workshop deleted after booking leaves an entry with nothing to
            # show; the slot is still reported so the clash rule stays visible.
            registrations.append({
                "workshop_id": None,
                "slot_id": entry.get("slot_id"),
                "name": None,
                "description": None,
                "embedding": None,
                "venue": None,
                "booking_type": entry.get("booking_type"),
                "attended": entry.get("attended", False),
            })
            continue
        registrations.append({
            "workshop_id": workshop.get("workshop_id"),
            "slot_id": entry.get("slot_id"),
            "name": workshop.get("name"),
            "description": workshop.get("description"),
            "embedding": workshop.get("embedding"),
            "venue": workshop.get("venue"),
            "booking_type": entry.get("booking_type"),
            "attended": entry.get("attended", False),
        })
    return registrations


@router.put("/{workshop_id}")
def update_workshop(workshop_id: str, request: WorkshopUpdateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can edit workshops")
        
    update_data = {k: v for k, v in request.dict().items() if v is not None}
    if "description" in update_data:
        existing = workshops_collection.find_one({"workshop_id": workshop_id}, {"description": 1})
        if not existing or existing.get("description") != update_data["description"]:
            update_data["embedding"] = generate_embedding(update_data["description"])
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        workshops_collection.update_one({"workshop_id": workshop_id}, {"$set": update_data})
    log_audit(user_id, "UPDATE_WORKSHOP", workshop_id)
    return {"message": "Workshop updated"}

@router.delete("/{workshop_id}")
def delete_workshop(workshop_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can delete workshops")
        
    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    if workshop:
        ws_doc_id = workshop["_id"]
        participants_collection.update_many(
            {"workshops.workshop_id": ws_doc_id},
            {"$pull": {"workshops": {"workshop_id": ws_doc_id}}}
        )
        workshops_collection.delete_one({"workshop_id": workshop_id})
    log_audit(user_id, "DELETE_WORKSHOP", workshop_id)
    return {"message": "Workshop deleted"}

@router.post("/{workshop_id}/volunteers")
def assign_workshop_volunteer(workshop_id: str, request: WorkshopAssignVolunteerRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can assign volunteers")
        
    workshops_collection.update_one(
        {"workshop_id": workshop_id},
        {"$push": {"workshop_team": {"role": request.role, "user_id": request.user_id, "attendance": request.attendance}}}
    )
    return {"message": "Volunteer assigned"}

@router.put("/{workshop_id}/volunteers/{user_id}/toggle_scan")
def toggle_volunteer_scan(workshop_id: str, volunteer_user_id: str, attendance: bool, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can toggle scanning")
        
    workshops_collection.update_one(
        {"workshop_id": workshop_id, "workshop_team.user_id": volunteer_user_id},
        {"$set": {"workshop_team.$.attendance": attendance}}
    )
    return {"message": "Volunteer scanning toggled"}

@router.get("/{workshop_id}/logs")
def workshop_logs(workshop_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can view logs")
    
    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    logs = list(workshop_logs_collection.find({"workshop_id": str(workshop["_id"])}, {"_id": 0}))
    return {"logs": logs}

@router.post("/{workshop_id}/register")
def register_for_workshop(workshop_id: str, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can register for workshops")
        
    participant_obj_id = current_user["_id"]
    participant_id = current_user["participant_id"]
    
    workshop = workshops_collection.find_one({"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]})
    if not workshop:
        try:
            workshop = workshops_collection.find_one({"_id": ObjectId(workshop_id)})
        except Exception:
            pass
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    ws_doc_id = workshop["_id"]
    real_ws_id = workshop.get("workshop_id", str(ws_doc_id))
    slot_id = workshop.get("slot_id")

    if workshop.get("registration_count", 0) >= workshop.get("capacity", 0):
        raise HTTPException(status_code=400, detail="Workshop is full")
        
    user_workshops = current_user.get("workshops", [])
    # Only an exact match on this workshop counts as "already registered for
    # this workshop". Comparing slot_id here as well would swallow the slot
    # clash below — every same-slot booking took this branch and reported the
    # wrong reason, leaving the next check unreachable.
    if any(str(w.get("workshop_id")) == str(ws_doc_id) or w.get("slot_id") == real_ws_id for w in user_workshops):
        raise HTTPException(status_code=400, detail="Already registered for this workshop")

    if any(w.get("slot_id") == slot_id for w in user_workshops):
        raise HTTPException(status_code=400, detail="Already registered for another workshop in this time slot")

    workshop_entry = {
        "slot_id": slot_id,
        "booking_type": "pre-registered",
        "workshop_id": ws_doc_id,
        "attended": False
    }

    result = workshops_collection.update_one(
        {"_id": ws_doc_id, "registration_count": {"$lt": workshop.get("capacity", 0)}},
        {
            "$inc": {"registration_count": 1},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    if result.modified_count > 0:
        log_entry = {
            "workshop_id": str(ws_doc_id),
            "action": "registration",
            "participant_id": participant_id,
            "timestamp": datetime.utcnow()
        }
        workshop_logs_collection.insert_one(log_entry)
    else:
        raise HTTPException(status_code=400, detail="Failed to register. Workshop might have just filled up.")
        
    participants_collection.update_one(
        {"_id": participant_obj_id},
        {"$push": {"workshops": workshop_entry}}
    )
    return {"message": "Successfully registered for workshop"}

@router.get("/{workshop_id}/seats/stream")
async def stream_workshop_seats(workshop_id: str):
    async def event_generator():
        previous_count = -1
        while True:
            workshop = await run_in_threadpool(
                workshops_collection.find_one,
                {"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]}
            )
            if not workshop:
                yield f"data: {{\"error\": \"Workshop not found\"}}\n\n"
                break

            current_count = workshop.get("registration_count", 0)
            capacity = workshop.get("capacity", 0)
            remaining = capacity - current_count

            if current_count != previous_count:
                yield f"data: {{\"remaining_seats\": {remaining}, \"capacity\": {capacity}}}\n\n"
                previous_count = current_count
                
            await asyncio.sleep(2)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/{workshop_id}/attendance")
def workshop_attendance(workshop_id: str, request: ScanQRRequest, scan_type: str = "pre-registered", current_user: dict = Depends(get_current_staff)):
    workshop = workshops_collection.find_one({"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]})
    if not workshop:
        try:
            workshop = workshops_collection.find_one({"_id": ObjectId(workshop_id)})
        except Exception:
            pass
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    user_id = current_user.get("participant_id") or current_user.get("paradox_id")
    volunteer = next((v for v in workshop.get("workshop_team", []) if str(v.get("user_id")) == user_id), None)
    
    if not volunteer:
        raise HTTPException(status_code=403, detail="Not authorized to scan for this workshop")
        
    if not volunteer.get("attendance", True):
        raise HTTPException(status_code=403, detail="Scanning disabled for this volunteer")
        

    target_user, payload = verify_qr(request)
    ws_doc_id = workshop["_id"]
    user_workshops = target_user.get("workshops", [])
    
    same_slot_attended = next((w for w in user_workshops if w.get("slot_id") == workshop.get("slot_id") and w.get("attended", False) and str(w.get("workshop_id")) != str(ws_doc_id)), None)
    if same_slot_attended:
         raise HTTPException(status_code=400, detail="Participant already marked present for another workshop in this slot")
         
    existing_ws = next((w for w in user_workshops if str(w.get("workshop_id")) == str(ws_doc_id) or w.get("slot_id") == workshop.get("slot_id")), None)
    
    log_entry = {
        "workshop_id": str(ws_doc_id),
        "action": "attendance",
        "scan_type": scan_type,
        "participant_id": target_user["participant_id"],
        "scanned_by": user_id,
        "timestamp": datetime.utcnow()
    }
    
    if scan_type == "pre-registered":
        if not existing_ws or existing_ws.get("workshop_id") != ws_doc_id or existing_ws.get("booking_type") == "on-spot":
             raise HTTPException(status_code=400, detail="Participant not pre-registered for this workshop")
        if existing_ws.get("attended", False):
            return {"message": "Attendee already marked present"}
            
        participants_collection.update_one(
            {"_id": target_user["_id"], "workshops.workshop_id": ws_doc_id},
            {"$set": {"workshops.$.attended": True}}
        )
        workshops_collection.update_one(
            {"_id": ws_doc_id},
            {"$inc": {"participant_count": 1}}
        )
        workshop_logs_collection.insert_one(log_entry)
        return {"message": "Pre-registered attendee marked present"}
        
    elif scan_type == "on-spot":
        if existing_ws and existing_ws.get("workshop_id") == ws_doc_id and existing_ws.get("attended", False):
            return {"message": "Attendee already marked present"}
            
        capacity = workshop.get("capacity", 0)
        max_on_spot = int(capacity * 0.1)
        current_on_spot = workshop_logs_collection.count_documents({"workshop_id": str(ws_doc_id), "scan_type": "on-spot"})
        
        if current_on_spot >= max_on_spot:
            raise HTTPException(status_code=400, detail="Max on-spot capacity (10%) reached")
            
        if existing_ws:
             participants_collection.update_one(
                 {"_id": target_user["_id"]},
                 {"$pull": {"workshops": {"slot_id": workshop.get("slot_id")}}}
             )
             
        on_spot_entry = {
            "slot_id": workshop.get("slot_id"),
            "booking_type": "on-spot",
            "workshop_id": ws_doc_id,
            "attended": True
        }
        
        participants_collection.update_one(
            {"_id": target_user["_id"]},
            {"$push": {"workshops": on_spot_entry}}
        )
        workshops_collection.update_one(
            {"_id": ws_doc_id},
            {"$inc": {"registration_count": 1, "participant_count": 1}}
        )
        workshop_logs_collection.insert_one(log_entry)
        return {"message": "On-spot registration successful and marked present"}
    
    raise HTTPException(status_code=400, detail="Invalid scan_type")
