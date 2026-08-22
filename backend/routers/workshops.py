from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from datetime import datetime, timedelta
from bson import ObjectId
import asyncio

from models import WorkshopCreateRequest, WorkshopUpdateRequest, WorkshopAssignVolunteerRequest, ScanQRRequest
# Imported on its own line so the line above stays byte-for-byte as it was; used
# only by the workshop-desk routes at the foot of this file.
from typing import List, Optional
from models import WorkshopParticipantUpdateRequest
from database import workshops_collection, participants_collection, backend_teams_collection, workshop_logs_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from embedding_service import generate_embedding
from id_generator import SequentialIDGenerator

generator = SequentialIDGenerator("WKSP")

router = APIRouter(prefix="/workshops", tags=["Workshops"])

@router.post("")
def create_workshop(request: WorkshopCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can create workshops")
        
    new_workshop = {
        "workshop_id": generator.next_id(),
        "slot_id": request.slot_id,
        "name": request.name,
        "description": request.description,
        "embedding": generate_embedding(request.description),
        "venue": request.venue,
        "capacity": request.capacity,
        "registration_count": 0,
        "participant_count": 0,
        "instructions": request.instructions,
        # ISO 8601 UTC string supplied by the caller, or None when omitted.
        # None disables the time-window guard on attendance and change routes,
        # so existing workshops created before this field was added keep working.
        "start_time": request.start_time,
        "workshop_team": [],
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    workshops_collection.insert_one(new_workshop)
    log_audit(current_user, "CREATE_WORKSHOP", request.workshop_id, {"capacity": request.capacity})
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
    # Exposed so the frontend and any unauthenticated visitor can display when
    # the workshop runs and so the time-window a volunteer will face is not a
    # surprise.
    "start_time": 1,
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
            {"_id": 0, "workshop_id": 1, "name": 1, "description": 1, "embedding": 1, "venue": 1, "capacity": 1, "instructions": 1, "start_time": 1},
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
                "start_time": None,
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
            "start_time": workshop.get("start_time"),
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
    log_audit(current_user, "UPDATE_WORKSHOP", workshop_id)
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
    log_audit(current_user, "DELETE_WORKSHOP", workshop_id)
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

    # Time-window guard: pre-registered opens 30 min before start; on-spot
    # opens 15 min before start.  Both close 30 min after start.
    # Workshops with no start_time stored are unguarded (backward compat).
    _assert_scan_window(workshop, scan_type)

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
             # Which bookings this pull is about to destroy, before it destroys
             # them. The pull matches on `slot_id`, so what it removes is not
             # necessarily a booking on *this* workshop — a participant walking
             # into workshop B while pre-registered for A in the same slot has
             # their A booking deleted here.
             #
             # Every one of those seats has already been charged to some
             # workshop's `registration_count`, and nothing used to give them
             # back. Two ways that drifted:
             #
             #   * released from another workshop: A kept charging for a seat
             #     nobody holds, so A read fuller than it was, forever;
             #   * released from this workshop: the pre-registration was deleted
             #     and then re-added as an on-spot booking, while the increment
             #     below charged a second seat for the same person — one human,
             #     two seats.
             #
             # Releasing them first makes the increment below correct in both
             # cases, and leaves the same-workshop case a net zero.
             released = [
                 booking.get("workshop_id")
                 for booking in user_workshops
                 if booking.get("slot_id") == workshop.get("slot_id")
             ]

             participants_collection.update_one(
                 {"_id": target_user["_id"]},
                 {"$pull": {"workshops": {"slot_id": workshop.get("slot_id")}}}
             )

             for released_id in released:
                 if released_id is None:
                     continue
                 # Guarded rather than floored afterwards: `$gt: 0` makes the
                 # decrement a no-op on a counter that is already zero, so data
                 # predating this route cannot be driven negative.
                 workshops_collection.update_one(
                     {"_id": released_id, "registration_count": {"$gt": 0}},
                     {"$inc": {"registration_count": -1}}
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


# ==========================================================================
# WORKSHOP DESK — roster, corrections, and team removal
#
# Everything below is additive: no route, guard, response shape, or error string
# above this line changes. The three routes exist because the workshop desk the
# volunteers actually staff could not be built from what came before:
#
#   * `GET /workshops` returns counts but no identities.
#   * `GET /workshops/{id}/logs` returns identities but is Super Admin-only, so
#     the volunteer who *created* those rows could not read them back.
#   * Nothing returned a registrant's academic level, so "interest by level" had
#     to be approximated from the roll number.
#   * Nothing corrected a mis-scan, and nothing stood a volunteer down except
#     switching their scanning off and leaving them on the team forever.
#
# The helpers are new too, rather than a refactor of the routes above — those are
# left exactly as they were.
# ==========================================================================


def _resolve_workshop(workshop_id: str):
    """
    A workshop by its readable id, its slot id, or its raw ObjectId.

    The same three-way lookup `register_for_workshop` and `workshop_attendance`
    already do, so a client that can scan against an id can also read the roster
    for it. Returns None rather than raising, so each caller words its own 404.
    """
    workshop = workshops_collection.find_one({"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]})
    if workshop:
        return workshop
    try:
        return workshops_collection.find_one({"_id": ObjectId(workshop_id)})
    except Exception:
        return None


def _is_super_admin(user_id) -> bool:
    return bool(backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}))


# ---------------------------------------------------------------------------
# Workshop time-window enforcement
#
# All three windows share the same hard close: 30 minutes after start_time.
# Before that point, different operations have different open times:
#
#   pre-registered scan   start_time − 30 min  (volunteers arrive before doors open)
#   on-spot scan          start_time − 15 min  (walk-in queue forms later)
#   manual changes        start_time            (corrections only make sense once
#                                               the session is actually running)
#
# Workshops created without a start_time (i.e. the field is None) bypass this
# check entirely, preserving full backward compatibility.
# ---------------------------------------------------------------------------

# How many minutes before start scanning / changes are permitted.
_WINDOW_OPEN_MINUTES = {
    "pre-registered": 30,
    "on-spot":        15,
    "changes":        0,   # must be >= start_time
}

# All windows close this many minutes after start.
_WINDOW_CLOSE_MINUTES = 30


def _assert_scan_window(workshop: dict, operation: str) -> None:
    """
    Raise 403 if ``now`` is outside the permitted window for ``operation``.

    ``operation`` must be one of ``"pre-registered"``, ``"on-spot"``, or
    ``"changes"``.  Workshops without a ``start_time`` are always permitted.
    """
    raw = workshop.get("start_time")
    if not raw:
        # No start_time stored — window guard disabled for this workshop.
        return

    try:
        # Accept both naive ("2026-06-12T10:00:00") and offset-aware strings.
        start = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        # Normalise to naive UTC for comparison against datetime.utcnow().
        if start.tzinfo is not None:
            from datetime import timezone as _tz
            start = start.astimezone(_tz.utc).replace(tzinfo=None)
    except ValueError:
        # Unparseable start_time — fail open to avoid locking out all scanners
        # due to a bad seed value.
        return

    now = datetime.utcnow()
    open_delta  = timedelta(minutes=_WINDOW_OPEN_MINUTES[operation])
    close_delta = timedelta(minutes=_WINDOW_CLOSE_MINUTES)

    opens_at  = start - open_delta
    closes_at = start + close_delta

    if now < opens_at:
        opens_in = int((opens_at - now).total_seconds() // 60)
        raise HTTPException(
            status_code=403,
            detail=(
                f"Scanning window not yet open. "
                f"Opens {_WINDOW_OPEN_MINUTES[operation]} min before start "
                f"(in ~{opens_in} min)."
            ),
        )
    if now >= closes_at:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Scanning window closed. "
                f"It closes {_WINDOW_CLOSE_MINUTES} min after the workshop starts."
            ),
        )


def _workshop_team_member(workshop: dict, user_id) -> Optional[dict]:
    """This user's entry on `workshop_team`, or None if they are not on it."""
    if user_id is None:
        return None
    return next(
        (member for member in workshop.get("workshop_team", []) if str(member.get("user_id")) == str(user_id)),
        None,
    )


def _workshop_team_details(workshop: dict) -> List[dict]:
    """
    The team, with a readable name attached where one exists.

    Same resolution order as `view_participation` in events: a staff account's
    designation, upgraded to a real name and phone when that person also has a
    participant document. Never returns a password hash or an ObjectId.
    """
    details = []
    for member in workshop.get("workshop_team", []):
        member_id = member.get("user_id")
        staff = backend_teams_collection.find_one({"paradox_id": member_id})
        name = staff.get("designation") or staff.get("email") if staff else None
        phone = None

        person = participants_collection.find_one({"participant_id": member_id})
        if person:
            profile = person.get("profile") or {}
            name = profile.get("full_name") or name
            phone = profile.get("phone")

        details.append({
            "user_id": str(member_id) if member_id is not None else None,
            "role": member.get("role"),
            "attendance": member.get("attendance", True),
            "name": name,
            "phone": phone,
        })
    return details


# Only the fields the desk renders. An inclusion projection on purpose: a field
# added to `participants` later stays private until it is named here. Password
# hashes, QR keypairs, and embeddings are never in the document this route holds.
_ROSTER_FIELDS = {
    "_id": 0,
    "participant_id": 1,
    "email": 1,
    "workshops": 1,
    "profile.full_name": 1,
    "profile.phone": 1,
    "profile.house": 1,
    "profile.gender": 1,
    "profile.program": 1,
    "profile.course_stage": 1,
    "profile.academic_level": 1,
    "profile.academic_level_number": 1,
    "profile.degree": 1,
    "profile.entry_year": 1,
}


@router.get("/{workshop_id}/participation")
def workshop_participation(workshop_id: str, current_user: dict = Depends(get_current_staff)):
    """
    Who booked this workshop, who turned up, and what level they are at.

    The counterpart of `GET /events/{event_id}/participation`, and gated the same
    way: a Super Admin, **or** a member of this workshop's own `workshop_team`.
    Any other staff account gets 403 — being staff somewhere is not being staff
    here. Participants have no route to this at all; the fullness figures they may
    read are the counts already on `GET /workshops`.

    A team member is authorised whether or not their `attendance` flag is on: that
    flag gates *scanning*, and a volunteer stood down from the door still needs to
    read the room's own roster.

    `course_stage` and `academic_level` are the reason this returns more than the
    log ever could. They are the participant's real academic standing, written by
    `PATCH /profile/complete` and by the student dataset, and they are what makes
    an "interest by level" breakdown a count rather than an inference from a roll
    number. Everything here is a projection of fields that already exist — no
    field is computed, stored, or derived.
    """
    user_id = current_user.get("paradox_id")
    workshop = _resolve_workshop(workshop_id)
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")

    is_super_admin = _is_super_admin(user_id)
    member = _workshop_team_member(workshop, user_id)
    if not (is_super_admin or member):
        raise HTTPException(status_code=403, detail="Not authorized to view this workshop's participation")

    ws_doc_id = workshop["_id"]
    participants = list(participants_collection.find({"workshops.workshop_id": ws_doc_id}, _ROSTER_FIELDS))

    rows = []
    attended_count = 0
    on_spot_count = 0
    for person in participants:
        entry = next(
            (w for w in person.get("workshops", []) if str(w.get("workshop_id")) == str(ws_doc_id)),
            None,
        )
        if entry is None:
            # Only reachable if the array matched on a different workshop; skip
            # rather than emit a row whose booking fields would be guesses.
            continue

        profile = person.get("profile") or {}
        attended = bool(entry.get("attended", False))
        booking_type = entry.get("booking_type")
        if attended:
            attended_count += 1
        if booking_type == "on-spot":
            on_spot_count += 1

        rows.append({
            "participant_id": person.get("participant_id"),
            "name": profile.get("full_name"),
            "email": person.get("email"),
            "phone": profile.get("phone"),
            "house": profile.get("house"),
            "gender": profile.get("gender"),
            "program": profile.get("program"),
            # The three-value field the app reports on, and the four-level academic
            # standing beside it. Both may be None for an account that has not
            # completed its profile — the client shows that as "unknown" rather
            # than dropping the person from the chart.
            "course_stage": profile.get("course_stage"),
            "academic_level": profile.get("academic_level"),
            "academic_level_number": profile.get("academic_level_number"),
            "degree": profile.get("degree"),
            "entry_year": profile.get("entry_year"),
            "booking_type": booking_type,
            "attended": attended,
            "slot_id": entry.get("slot_id"),
        })

    rows.sort(key=lambda row: (row.get("participant_id") or ""))

    return {
        "workshop_id": workshop.get("workshop_id"),
        "name": workshop.get("name"),
        "venue": workshop.get("venue"),
        "slot_id": workshop.get("slot_id"),
        "start_time": workshop.get("start_time"),
        "capacity": workshop.get("capacity", 0),
        # The workshop's own counters, returned alongside the roster so a client
        # never has to choose which to trust: `count` is what this response
        # actually lists, `registration_count` is what the workshop has been
        # charging seats against.
        "registration_count": workshop.get("registration_count", 0),
        "participant_count": workshop.get("participant_count", 0),
        "count": len(rows),
        "attended_count": attended_count,
        "absent_count": len(rows) - attended_count,
        "on_spot_count": on_spot_count,
        "workshop_team": _workshop_team_details(workshop),
        "participants": rows,
    }


@router.patch("/{workshop_id}/participants/{participant_id}")
def update_workshop_participant(
    workshop_id: str,
    participant_id: str,
    request: WorkshopParticipantUpdateRequest,
    current_user: dict = Depends(get_current_staff),
):
    """
    Correct one participant's record for this workshop — attendance, or how the
    seat was taken.

    Why this exists: attendance could only ever be set by a successful RSA-OAEP
    scan, so a flat battery, a cracked screen, or a QR that expired in the queue
    left a student who was visibly in the room marked absent, with no way back.
    This is the authorised correction, and it is deliberately narrow.

    Authorisation is stricter than the roster above: a Super Admin, or a team
    member **whose `attendance` flag is on**. Writing attendance is the same
    privilege as scanning it, so somebody stood down from the door cannot set by
    hand what they are not allowed to scan.

    Bookkeeping:
      * `participant_count` follows the change, and only on a real transition, so
        repeating the same correction cannot inflate the count.
      * `registration_count` is left alone. The seat was already counted when the
        booking was made; flipping `booking_type` re-labels that seat, it does not
        take another one.

    Every call writes a `workshop_logs` row and an audit entry naming the actor —
    a hand-set attendance is exactly the kind of record that must not be
    indistinguishable from a scan.
    """
    user_id = current_user.get("paradox_id")
    workshop = _resolve_workshop(workshop_id)
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")

    is_super_admin = _is_super_admin(user_id)
    member = _workshop_team_member(workshop, user_id)
    if not (is_super_admin or member):
        raise HTTPException(status_code=403, detail="Not authorized to update this workshop's participants")
    if not is_super_admin and not member.get("attendance", True):
        raise HTTPException(status_code=403, detail="Scanning disabled for this volunteer")

    # Time-window guard for manual attendance changes: the window opens at
    # start_time (corrections only make sense once the session is running)
    # and closes 30 min after start_time.  Super Admins are also bound — a
    # correction made hours later is indistinguishable from a fabrication, and
    # the audit trail is the right place to escalate those cases.
    # Workshops with no start_time stored are unguarded (backward compat).
    _assert_scan_window(workshop, "changes")

    if request.attended is None and request.booking_type is None:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if request.booking_type is not None and request.booking_type not in ("pre-registered", "on-spot"):
        raise HTTPException(status_code=400, detail="booking_type must be 'pre-registered' or 'on-spot'")

    target = participants_collection.find_one({"participant_id": participant_id})
    if not target:
        target = participants_collection.find_one({"email": participant_id})
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found")

    ws_doc_id = workshop["_id"]
    entry = next(
        (w for w in target.get("workshops", []) if str(w.get("workshop_id")) == str(ws_doc_id)),
        None,
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Participant is not registered for this workshop")

    was_attended = bool(entry.get("attended", False))
    update_fields = {}
    changed = {}

    if request.attended is not None and request.attended != was_attended:
        update_fields["workshops.$.attended"] = request.attended
        changed["attended"] = request.attended
    if request.booking_type is not None and request.booking_type != entry.get("booking_type"):
        update_fields["workshops.$.booking_type"] = request.booking_type
        changed["booking_type"] = request.booking_type

    if not update_fields:
        # Idempotent: the record already says what was asked for, so nothing is
        # written and no log row is invented for a change that did not happen.
        return {"message": "No change", "participant_id": target.get("participant_id")}

    participants_collection.update_one(
        {"_id": target["_id"], "workshops.workshop_id": ws_doc_id},
        {"$set": update_fields},
    )

    if "attended" in changed:
        delta = 1 if changed["attended"] else -1
        if delta > 0:
            workshops_collection.update_one({"_id": ws_doc_id}, {"$inc": {"participant_count": 1}})
        else:
            # Floored, so a count that is already 0 cannot be driven negative by a
            # correction to data that predates this route.
            current = workshops_collection.find_one({"_id": ws_doc_id}, {"participant_count": 1})
            if (current or {}).get("participant_count", 0) > 0:
                workshops_collection.update_one({"_id": ws_doc_id}, {"$inc": {"participant_count": -1}})

    workshop_logs_collection.insert_one({
        "workshop_id": str(ws_doc_id),
        "action": "attendance_override",
        "scan_type": changed.get("booking_type", entry.get("booking_type")),
        "participant_id": target.get("participant_id"),
        "scanned_by": user_id,
        "changes": changed,
        "timestamp": datetime.utcnow(),
    })
    log_audit(current_user, "UPDATE_WORKSHOP_PARTICIPANT", workshop.get("workshop_id"), {
        "participant_id": target.get("participant_id"),
        "changes": changed,
    })

    return {
        "message": "Participant record updated",
        "participant_id": target.get("participant_id"),
        "changes": changed,
    }


@router.delete("/{workshop_id}/volunteers/{user_id}")
def remove_workshop_volunteer(
    workshop_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_staff),
):
    """
    Take somebody off this workshop's team.

    The missing half of `POST /workshops/{id}/volunteers`: until now a volunteer
    assigned by mistake, or one who has finished for the fest, could only have
    their scanning switched off and stayed on the team's roster forever.

    Super Admin only, matching assignment — who staffs a workshop is an
    organiser's decision, and a volunteer removing a colleague is not.

    Removal is by `workshop_team.user_id` and touches nothing else: the scans that
    person already made stay in `workshop_logs`, with their id on them, because an
    attendance record must not disappear when a shift ends.
    """
    actor_id = current_user.get("paradox_id")
    if not _is_super_admin(actor_id):
        raise HTTPException(status_code=403, detail="Only Super Admins can remove volunteers")

    workshop = _resolve_workshop(workshop_id)
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")

    if not _workshop_team_member(workshop, user_id):
        raise HTTPException(status_code=404, detail="That member is not on this workshop's team")

    workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {
            "$pull": {"workshop_team": {"user_id": user_id}},
            "$set": {"updated_at": datetime.utcnow()},
        },
    )
    log_audit(current_user, "REMOVE_WORKSHOP_VOLUNTEER", workshop.get("workshop_id"), {"user_id": user_id})

    return {"message": "Volunteer removed"}
