from fastapi import APIRouter, HTTPException, Depends
from logger import (
    OUTCOME_ALLOWED, OUTCOME_DENIED, OUTCOME_DUPLICATE,
    log_audit, log_denied, log_integrity, log_scan,
)
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from datetime import datetime, timedelta
from bson import ObjectId
import asyncio

import log_config

from models import WorkshopCreateRequest, WorkshopUpdateRequest, WorkshopAssignVolunteerRequest, ScanQRRequest, parse_instant_utc
# Imported on its own line so the line above stays byte-for-byte as it was; used
# only by the workshop-desk routes at the foot of this file.
from typing import List, Optional
from models import WorkshopParticipantUpdateRequest
from database import workshops_collection, workshop_slots_collection, participants_collection, backend_teams_collection, workshop_logs_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from embedding_service import generate_embedding
from id_generator import SequentialIDGenerator

generator = SequentialIDGenerator("WKSP")

router = APIRouter(prefix="/workshops", tags=["Workshops"])

_log = log_config.get_logger("paradox.workshops")


def _require_super_admin_logged(current_user: dict, operation: str, detail: str, target_id=None) -> str:
    """
    The Super Admin gate, with the refusal recorded.

    Each call site keeps its own `detail` string, because the four routes that use
    this all phrase their 403 differently ("Only Super Admins can create
    workshops", "...delete workshops", and so on) and those strings are part of the
    API's existing behaviour.
    """
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            target_id,
            reason="not_super_admin",
            details={"operation": operation, "resource": "workshops", "status": 403},
        )
        raise HTTPException(status_code=403, detail=detail)
    return user_id

@router.post("")
def create_workshop(request: WorkshopCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = _require_super_admin_logged(
        current_user, "create", "Only Super Admins can create workshops"
    )

    # A workshop's time comes from its slot, not from the request: the slot is
    # the thing a Super Admin schedules independently, and start_time is
    # denormalized from it here so the scan-window guard and slot-clash check
    # never have to join back to workshop_slots on every read.
    slot = workshop_slots_collection.find_one({"slot_id": request.slot_id})
    if not slot:
        log_denied(
            current_user, "CREATE_WORKSHOP_DENIED", None,
            reason="slot_not_found",
            details={"slot_id": request.slot_id, "name": request.name},
        )
        raise HTTPException(status_code=404, detail="Workshop slot not found. Create it via POST /workshop-slots first.")

    new_id = generator.next_id()
    if workshops_collection.find_one({"workshop_id": new_id}):
        # Same in-memory counter problem as the hostel ids: the generator restarts
        # from its seed on every process restart and never checks the database, and
        # there is no unique index on `workshop_id`. Two workshops sharing an id
        # would have `_resolve_workshop` return whichever Mongo found first, so
        # registrations and attendance scans could land on the wrong session.
        log_integrity(
            "generated workshop_id already exists — the in-memory counter has wrapped after a restart",
            reason="workshop_id_collision",
            details={"workshop_id": new_id, "generator_prefix": "WKSP"},
            actor=current_user,
            action="ID_COLLISION",
            target_id=new_id,
            audit=True,
        )
    new_workshop = {
        "workshop_id": new_id,
        "slot_id": request.slot_id,
        "name": request.name,
        "description": request.description,
        "embedding": generate_embedding(request.description),
        "venue": request.venue,
        "capacity": request.capacity,
        "registration_count": 0,
        "participant_count": 0,
        "instructions": request.instructions,
        # Denormalized from the slot at creation time; kept in sync by
        # PUT /workshop-slots/{slot_id} (see routers.workshop_slots).
        "start_time": slot.get("start_time"),
        "registration_start": request.registration_start,
        "registration_end": request.registration_end,
        "registration_open": request.registration_open,
        # Internal one-shot memory bit: has the system already auto-closed
        # this workshop once for its current registration_end? Never part of
        # any request model, never serialized in any response. See
        # _sync_registration_state.
        "registration_closed_by_system": False,
        "workshop_team": [],
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    workshops_collection.insert_one(new_workshop)
    log_audit(current_user, "CREATE_WORKSHOP", new_id, {
        "capacity": request.capacity, "slot_id": request.slot_id,
        # `start_time` is denormalised from the slot here and is what every scan
        # window for this workshop is computed from, so the value taken at creation
        # belongs in the row: if the slot is later edited, this is what the window
        # used to be.
        "start_time": new_workshop.get("start_time"),
        "name": request.name,
        "venue": request.venue,
        "registration_open": request.registration_open,
        # A zero vector here means the embeddings provider was unreachable and
        # `generate_embedding` silently substituted one, which degrades
        # recommendations for this workshop with no other visible symptom.
        "embedding_ok": any(new_workshop.get("embedding") or []),
    })
    return {"message": "Workshop created", "workshop_id": new_id}

@router.get("")
def list_workshops(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}) if user_id else None
    # `created_by` holds the creating admin's raw ObjectId, which is not JSON
    # serialisable — leaving it in makes this endpoint 500 as soon as any
    # workshop has been created through POST /workshops. It is an internal
    # reference with no use to a client, so it is projected out rather than
    # converted. Same fix as list_events.
    #
    # `registration_closed_by_system` is likewise excluded: this is an
    # exclusion (blacklist) projection, so anything not explicitly named here
    # leaks through — unlike PUBLIC_WORKSHOP_FIELDS below, which is an
    # allow-list and hides it automatically.
    # `registration_closed_by_system` is fetched here (not excluded) because
    # `_sync_registration_state` needs to see it to tell "still open, not yet
    # synced" apart from "open again because an admin overrode it" — it is
    # stripped from each document below, after syncing, rather than at the
    # query, so the sync itself never runs on a false premise.
    if admin:
        raw = list(workshops_collection.find({}, {"created_by": 0}))
    else:
        raw = list(workshops_collection.find({}, {"created_by": 0, "workshop_team": 0}))

    workshops = []
    for workshop in raw:
        synced = _sync_registration_state(workshop)
        synced.pop("_id", None)
        synced.pop("registration_closed_by_system", None)
        workshops.append(synced)
    return workshops


# Allow-list of the fields that make up the published workshop programme.
# Written as an inclusion projection on purpose: any field added to the
# workshops collection later stays private until it is named here explicitly —
# including the internal `registration_closed_by_system` bit, which is never
# named and therefore never leaks through this projection.
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
    "registration_start": 1,
    "registration_end": 1,
    "registration_open": 1,
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

    Each workshop is passed through the registration-window sync before its
    `registration_open` is read, so a just-lapsed workshop reports closed the
    first time it is listed, not only after something else has resolved it.

    The full document (not just the public fields) is fetched so the sync can
    see `registration_closed_by_system` — the internal field is stripped from
    each result afterward, never returned to the caller.
    """
    raw = list(workshops_collection.find({}))
    result = []
    for workshop in raw:
        synced = _sync_registration_state(workshop)
        result.append({field: synced.get(field) for field in PUBLIC_WORKSHOP_FIELDS if field != "_id"})
    return result


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
        workshop = workshops_collection.find_one({"_id": entry.get("workshop_id")})
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
                "registration_start": None,
                "registration_end": None,
                "registration_open": None,
                "booking_type": entry.get("booking_type"),
                "attended": entry.get("attended", False),
            })
            continue
        workshop = _sync_registration_state(workshop)
        registrations.append({
            "workshop_id": workshop.get("workshop_id"),
            "slot_id": entry.get("slot_id"),
            "name": workshop.get("name"),
            "description": workshop.get("description"),
            "embedding": workshop.get("embedding"),
            "venue": workshop.get("venue"),
            "start_time": workshop.get("start_time"),
            "registration_start": workshop.get("registration_start"),
            "registration_end": workshop.get("registration_end"),
            "registration_open": workshop.get("registration_open"),
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

    existing = workshops_collection.find_one({"workshop_id": workshop_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Workshop not found")

    update_data = {k: v for k, v in request.model_dump().items() if v is not None}

    if "description" in update_data:
        if existing.get("description") != update_data["description"]:
            update_data["embedding"] = generate_embedding(update_data["description"])

    # registration_start/registration_end may arrive independently of one
    # another — merge onto the stored document before re-validating
    # end > start, the same pattern events.py uses for
    # RegistrationWindowUpdate. This also catches the case where only one
    # bound is sent but the merged result would be invalid.
    if "registration_start" in update_data or "registration_end" in update_data:
        merged_start = update_data.get("registration_start", existing.get("registration_start"))
        merged_end = update_data.get("registration_end", existing.get("registration_end"))
        if not merged_start or not merged_end:
            raise HTTPException(status_code=422, detail="registration_start and registration_end are required")
        start_dt = parse_instant_utc(merged_start, "registration_start")
        end_dt = parse_instant_utc(merged_end, "registration_end")
        if end_dt <= start_dt:
            raise HTTPException(status_code=400, detail="registration_end must be after registration_start")

    # Pushing a *new* registration_end re-arms the one-shot auto-close for
    # that new deadline. registration_open itself (if this request also sets
    # it) is written exactly as given below, with no extra side effect on
    # registration_closed_by_system — that is what lets an admin's override
    # survive later reads (see _sync_registration_state).
    if "registration_end" in update_data:
        update_data["registration_closed_by_system"] = False

    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        workshops_collection.update_one({"workshop_id": workshop_id}, {"$set": update_data})
    log_audit(current_user, "UPDATE_WORKSHOP", workshop_id, {k: v for k, v in update_data.items() if k != "embedding"})
    return {"message": "Workshop updated"}

@router.delete("/{workshop_id}")
def delete_workshop(workshop_id: str, current_user: dict = Depends(get_current_staff)):
    _require_super_admin_logged(
        current_user, "delete", "Only Super Admins can delete workshops", workshop_id
    )

    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    removed = 0
    attendees = []
    if workshop:
        ws_doc_id = workshop["_id"]
        # Who loses a booking, captured before the pull. This cascade deletes the
        # workshop entry from every participant who held one, including the
        # `attended: True` marker for people who actually sat in the room — so
        # afterwards there is nothing on the participant to say they were ever
        # there. The `workshop_logs` rows survive; this makes the participant side
        # recoverable too.
        holders = list(participants_collection.find(
            {"workshops.workshop_id": ws_doc_id},
            {"participant_id": 1, "workshops": 1},
        ))
        attendees = [
            p.get("participant_id")
            for p in holders
            if any(
                str(w.get("workshop_id")) == str(ws_doc_id) and w.get("attended")
                for w in p.get("workshops") or []
            )
        ]
        result = participants_collection.update_many(
            {"workshops.workshop_id": ws_doc_id},
            {"$pull": {"workshops": {"workshop_id": ws_doc_id}}}
        )
        removed = result.modified_count
        workshops_collection.delete_one({"workshop_id": workshop_id})
    else:
        # The route answers 200 whether or not the workshop existed, so a delete
        # against a mistyped id is indistinguishable from a real one in the
        # response. The audit row used to be identical in both cases too.
        log_config.warning(
            _log,
            f"delete requested for unknown workshop {workshop_id}",
            {"workshop_id": workshop_id, "reason": "workshop_not_found_on_delete"},
        )

    log_audit(current_user, "DELETE_WORKSHOP", workshop_id, {
        "existed": bool(workshop),
        "name": (workshop or {}).get("name"),
        "slot_id": (workshop or {}).get("slot_id"),
        "registration_count": (workshop or {}).get("registration_count"),
        "participant_count": (workshop or {}).get("participant_count"),
        "bookings_removed": removed,
        "attendance_discarded_for": attendees,
    })
    return {"message": "Workshop deleted"}

@router.post("/{workshop_id}/volunteers")
def assign_workshop_volunteer(workshop_id: str, request: WorkshopAssignVolunteerRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin_logged(
        current_user, "assign_volunteer", "Only Super Admins can assign volunteers", workshop_id
    )

    result = workshops_collection.update_one(
        {"workshop_id": workshop_id},
        {"$push": {"workshop_team": {"role": request.role, "user_id": request.user_id, "attendance": request.attendance}}}
    )

    if result.matched_count == 0:
        # No existence check on the workshop, so a mistyped id pushes nothing and
        # still answers "Volunteer assigned". The volunteer then finds themselves
        # refused with "Not authorized to scan for this workshop".
        log_integrity(
            "volunteer assignment matched no workshop",
            reason="workshop_not_found_on_assign",
            details={"workshop_id": workshop_id, "volunteer_user_id": request.user_id, "role": request.role},
        )

    # Previously unaudited. Who may scan a workshop's door is a privilege
    # decision, and it is now recorded alongside the removals
    # (`REMOVE_WORKSHOP_VOLUNTEER`) that were already being audited.
    log_audit(current_user, "ASSIGN_WORKSHOP_VOLUNTEER", workshop_id, {
        "volunteer_user_id": request.user_id,
        "role": request.role,
        "scanning_enabled": request.attendance,
        "workshop_exists": result.matched_count > 0,
    })
    return {"message": "Volunteer assigned"}

@router.put("/{workshop_id}/volunteers/{user_id}/toggle_scan")
def toggle_volunteer_scan(workshop_id: str, volunteer_user_id: str, attendance: bool, current_user: dict = Depends(get_current_staff)):
    _require_super_admin_logged(
        current_user, "toggle_scan", "Only Super Admins can toggle scanning", workshop_id
    )

    result = workshops_collection.update_one(
        {"workshop_id": workshop_id, "workshop_team.user_id": volunteer_user_id},
        {"$set": {"workshop_team.$.attendance": attendance}}
    )

    if result.matched_count == 0:
        log_integrity(
            "scan toggle matched no workshop volunteer",
            reason="volunteer_not_found_on_toggle",
            details={
                "workshop_id": workshop_id,
                "volunteer_user_id": volunteer_user_id,
                "requested_state": attendance,
            },
        )

    log_audit(current_user, "TOGGLE_WORKSHOP_SCAN", workshop_id, {
        "volunteer_user_id": volunteer_user_id,
        "scanning_enabled": attendance,
        "applied": result.matched_count > 0,
    })
    return {"message": "Volunteer scanning toggled"}

@router.get("/{workshop_id}/logs")
def workshop_logs(workshop_id: str, current_user: dict = Depends(get_current_staff)):
    _require_super_admin_logged(
        current_user, "read_logs", "Only Super Admins can view logs", workshop_id
    )

    workshop = workshops_collection.find_one({"workshop_id": workshop_id})
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    logs = list(workshop_logs_collection.find({"workshop_id": str(workshop["_id"])}, {"_id": 0}))
    log_audit(current_user, "READ_WORKSHOP_LOGS", workshop_id, {"returned": len(logs)})
    return {"logs": logs}

@router.post("/{workshop_id}/register")
def register_for_workshop(workshop_id: str, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can register for workshops")
        
    participant_obj_id = current_user["_id"]
    participant_id = current_user["participant_id"]

    # _resolve_workshop runs the registration-window sync as it looks the
    # workshop up, so registration_open below always reflects whether
    # registration_end has passed — even if nothing has read this workshop
    # since it lapsed.
    workshop = _resolve_workshop(workshop_id)
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    ws_doc_id = workshop["_id"]
    real_ws_id = workshop.get("workshop_id", str(ws_doc_id))
    slot_id = workshop.get("slot_id")

    # registration_open gates registration on its own — an admin's manual
    # override of this flag is exactly what is allowed to reopen registration
    # past registration_end. Capacity is checked independently right after,
    # so an override can never register past a full workshop.
    if not workshop.get("registration_open", False):
        # Whether the system closed it on schedule or an admin closed it by hand is
        # the difference between "you missed the deadline" and "somebody turned this
        # off", and `registration_closed_by_system` is the only thing that
        # distinguishes them.
        log_denied(
            current_user, "WORKSHOP_REGISTER_DENIED", real_ws_id,
            reason="registration_closed",
            details={
                "closed_by_system": bool(workshop.get("registration_closed_by_system")),
                "registration_end": workshop.get("registration_end"),
            },
        )
        raise HTTPException(status_code=400, detail="Registration is closed for this workshop")

    if workshop.get("registration_count", 0) >= workshop.get("capacity", 0):
        log_denied(
            current_user, "WORKSHOP_REGISTER_DENIED", real_ws_id,
            reason="workshop_full",
            details={
                "registration_count": workshop.get("registration_count", 0),
                "capacity": workshop.get("capacity", 0),
            },
        )
        raise HTTPException(status_code=400, detail="Workshop is full")
        
    user_workshops = current_user.get("workshops", [])
    # Only an exact match on this workshop counts as "already registered for
    # this workshop". Comparing slot_id here as well would swallow the slot
    # clash below — every same-slot booking took this branch and reported the
    # wrong reason, leaving the next check unreachable.
    if any(str(w.get("workshop_id")) == str(ws_doc_id) or w.get("slot_id") == real_ws_id for w in user_workshops):
        log_denied(
            current_user, "WORKSHOP_REGISTER_DENIED", real_ws_id,
            reason="already_registered",
            details={"slot_id": slot_id}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Already registered for this workshop")

    if any(w.get("slot_id") == slot_id for w in user_workshops):
        # Names the workshop already held in this slot, which the message does not.
        # A participant told "you are already registered for another workshop in
        # this time slot" has no way to find out which one.
        clash = next((w for w in user_workshops if w.get("slot_id") == slot_id), {})
        log_denied(
            current_user, "WORKSHOP_REGISTER_DENIED", real_ws_id,
            reason="slot_clash",
            details={
                "slot_id": slot_id,
                "clashing_workshop_oid": str(clash.get("workshop_id")),
                "clashing_booking_type": clash.get("booking_type"),
            },
        )
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
        # "Might have just filled up" was a guess presented to the user as a
        # diagnosis. The conditional update above only applies while
        # `registration_count < capacity`, so a lost race is the likely cause — but
        # the same no-op happens if the workshop was deleted mid-request. Reading
        # the counter back distinguishes them instead of guessing, and the message
        # to the client is unchanged.
        current = workshops_collection.find_one(
            {"_id": ws_doc_id}, {"registration_count": 1, "capacity": 1}
        )
        log_denied(
            current_user,
            "WORKSHOP_REGISTER_DENIED",
            real_ws_id,
            reason="capacity_race_lost" if current else "workshop_vanished_mid_request",
            details={
                "expected_capacity": workshop.get("capacity", 0),
                "count_at_read": workshop.get("registration_count", 0),
                "count_now": (current or {}).get("registration_count"),
                "capacity_now": (current or {}).get("capacity"),
            },
        )
        raise HTTPException(status_code=400, detail="Failed to register. Workshop might have just filled up.")
        
    push_result = participants_collection.update_one(
        {"_id": participant_obj_id},
        {"$push": {"workshops": workshop_entry}}
    )
    if push_result.modified_count == 0:
        # The seat has already been charged to `registration_count` by the update
        # above, so a failed push here means a seat is held by nobody — the workshop
        # reads one place fuller than it is, permanently, and the participant is not
        # registered despite a 200.
        log_integrity(
            "workshop seat was counted but the participant's booking was not stored",
            reason="registration_push_not_applied",
            details={
                "participant_id": participant_id,
                "workshop_id": real_ws_id,
                "slot_id": slot_id,
            },
        )

    # This route had no audit row at all — a registration existed only as a
    # `workshop_logs` entry with no actor, so "when did I sign up for this, and did
    # I ever" was unanswerable from the trail a Super Admin can read.
    log_audit(current_user, "WORKSHOP_REGISTER", real_ws_id, {
        "participant_id": participant_id,
        "slot_id": slot_id,
        "booking_type": "pre-registered",
        "registration_count_after": workshop.get("registration_count", 0) + 1,
        "capacity": workshop.get("capacity", 0),
    })
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
    # _resolve_workshop is defined later in this module but is only called at
    # request time, once the whole module (and the function it names) has
    # been loaded — same as every other forward reference to it below.
    workshop = _resolve_workshop(workshop_id)
    if not workshop:
        log_denied(
            current_user, "WORKSHOP_ATTENDANCE_DENIED", workshop_id,
            reason="workshop_not_found",
            details={"scan_type": scan_type, "scan_domain": "workshop"},
        )
        raise HTTPException(status_code=404, detail="Workshop not found")
        
    user_id = current_user.get("participant_id") or current_user.get("paradox_id")
    volunteer = next((v for v in workshop.get("workshop_team", []) if str(v.get("user_id")) == user_id), None)
    
    if not volunteer:
        log_denied(
            current_user, "WORKSHOP_ATTENDANCE_DENIED", workshop.get("workshop_id"),
            reason="not_on_workshop_team",
            details={
                "scan_type": scan_type,
                "team_size": len(workshop.get("workshop_team") or []),
                "scan_domain": "workshop",
            },
        )
        raise HTTPException(status_code=403, detail="Not authorized to scan for this workshop")
        
    if not volunteer.get("attendance", True):
        # The desk-side symptom of `TOGGLE_WORKSHOP_SCAN`, now joinable to it.
        log_denied(
            current_user, "WORKSHOP_ATTENDANCE_DENIED", workshop.get("workshop_id"),
            reason="scanning_disabled_for_volunteer",
            details={"scan_type": scan_type, "volunteer_role": volunteer.get("role"), "scan_domain": "workshop"},
        )
        raise HTTPException(status_code=403, detail="Scanning disabled for this volunteer")

    # Time-window guard: pre-registered opens 30 min before start; on-spot
    # opens 15 min before start.  Both close 30 min after start.
    # Workshops with no start_time stored are unguarded (backward compat).
    _assert_scan_window(workshop, scan_type, actor=current_user)

    target_user, payload = verify_qr(
        request, actor=current_user, domain="workshop", target_id=workshop.get("workshop_id")
    )
    ws_doc_id = workshop["_id"]
    user_workshops = target_user.get("workshops", [])
    
    same_slot_attended = next((w for w in user_workshops if w.get("slot_id") == workshop.get("slot_id") and w.get("attended", False) and str(w.get("workshop_id")) != str(ws_doc_id)), None)
    if same_slot_attended:
         # The other workshop is named. The message says only "another workshop in
         # this slot", which leaves the desk unable to tell the student where they
         # are apparently already sitting.
         log_scan(
             current_user, "workshop", "WORKSHOP_ATTENDANCE_DENIED", OUTCOME_DENIED,
             participant_id=target_user.get("participant_id"),
             target_id=workshop.get("workshop_id"),
             reason="already_present_in_another_workshop_this_slot",
             details={
                 "scan_type": scan_type,
                 "slot_id": workshop.get("slot_id"),
                 "other_workshop_oid": str(same_slot_attended.get("workshop_id")),
                 "other_booking_type": same_slot_attended.get("booking_type"),
             },
         )
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
             # One message covers three different situations, and the desk needs to
             # act differently in each: no booking at all (send them to the on-spot
             # queue), a booking on a different workshop in this slot, or a booking
             # that is already on-spot (so it should be scanned as on-spot). The
             # sub-reason is what makes that distinction after the fact.
             if not existing_ws:
                 sub_reason = "no_booking"
             elif existing_ws.get("booking_type") == "on-spot":
                 sub_reason = "booking_is_on_spot"
             else:
                 sub_reason = "booking_on_other_workshop_in_slot"
             log_scan(
                 current_user, "workshop", "WORKSHOP_ATTENDANCE_DENIED", OUTCOME_DENIED,
                 participant_id=target_user.get("participant_id"),
                 target_id=workshop.get("workshop_id"),
                 reason="not_pre_registered",
                 details={
                     "scan_type": scan_type,
                     "sub_reason": sub_reason,
                     "slot_id": workshop.get("slot_id"),
                     "booking_workshop_oid": str(existing_ws.get("workshop_id")) if existing_ws else None,
                     "booking_type": (existing_ws or {}).get("booking_type"),
                 },
             )
             raise HTTPException(status_code=400, detail="Participant not pre-registered for this workshop")
        if existing_ws.get("attended", False):
            # A re-scan. This returned 200 and wrote nothing anywhere, so it was
            # indistinguishable from no scan at all — and the desk cannot tell
            # whether the first scan was theirs or another volunteer's. Recorded as
            # `duplicate` rather than `denied`: nothing is wrong, it simply already
            # happened.
            log_scan(
                current_user, "workshop", "WORKSHOP_ATTENDANCE_DUPLICATE", OUTCOME_DUPLICATE,
                participant_id=target_user.get("participant_id"),
                target_id=workshop.get("workshop_id"),
                reason="already_marked_present",
                details={"scan_type": scan_type, "slot_id": workshop.get("slot_id")},
            )
            return {"message": "Attendee already marked present"}
            
        attendance_result = participants_collection.update_one(
            {"_id": target_user["_id"], "workshops.workshop_id": ws_doc_id},
            {"$set": {"workshops.$.attended": True}}
        )
        workshops_collection.update_one(
            {"_id": ws_doc_id},
            {"$inc": {"participant_count": 1}}
        )
        workshop_logs_collection.insert_one(log_entry)

        if attendance_result.matched_count == 0:
            # The result was never checked. When this misses — the classic cause is
            # an ObjectId/str mismatch on `workshops.workshop_id` — the endpoint
            # still returns "marked present", still writes the `workshop_logs` row,
            # and still increments `participant_count`, while the participant's own
            # record says they were absent. Three sources of truth, two of them
            # wrong, and no error anywhere.
            log_integrity(
                "attendance was logged and counted but the participant's booking was not updated",
                reason="attendance_write_not_applied",
                details={
                    "participant_id": target_user.get("participant_id"),
                    "workshop_id": workshop.get("workshop_id"),
                    "workshop_oid": str(ws_doc_id),
                    "scan_type": scan_type,
                },
            )

        log_scan(
            current_user, "workshop", "WORKSHOP_ATTENDANCE", OUTCOME_ALLOWED,
            participant_id=target_user.get("participant_id"),
            target_id=workshop.get("workshop_id"),
            details={
                "scan_type": scan_type,
                "slot_id": workshop.get("slot_id"),
                "participant_count_after": workshop.get("participant_count", 0) + 1,
                "capacity": workshop.get("capacity"),
            },
        )
        return {"message": "Pre-registered attendee marked present"}
        
    elif scan_type == "on-spot":
        if existing_ws and existing_ws.get("workshop_id") == ws_doc_id and existing_ws.get("attended", False):
            log_scan(
                current_user, "workshop", "WORKSHOP_ATTENDANCE_DUPLICATE", OUTCOME_DUPLICATE,
                participant_id=target_user.get("participant_id"),
                target_id=workshop.get("workshop_id"),
                reason="already_marked_present",
                details={"scan_type": scan_type, "slot_id": workshop.get("slot_id")},
            )
            return {"message": "Attendee already marked present"}
            
        capacity = workshop.get("capacity", 0)
        max_on_spot = int(capacity * 0.1)
        current_on_spot = workshop_logs_collection.count_documents({"workshop_id": str(ws_doc_id), "scan_type": "on-spot"})
        
        if current_on_spot >= max_on_spot:
            # The cap counts `workshop_logs` rows, which includes rows written by the
            # manual override route — so a desk correction consumes walk-in headroom.
            # The numbers go into the row because "Max on-spot capacity (10%)
            # reached" tells the volunteer nothing about how the limit was computed,
            # and a cap of 0 (any workshop with capacity under 10) looks identical to
            # a genuinely full walk-in queue.
            log_scan(
                current_user, "workshop", "WORKSHOP_ATTENDANCE_DENIED", OUTCOME_DENIED,
                participant_id=target_user.get("participant_id"),
                target_id=workshop.get("workshop_id"),
                reason="on_spot_cap_reached",
                details={
                    "scan_type": scan_type,
                    "on_spot_used": current_on_spot,
                    "on_spot_cap": max_on_spot,
                    "capacity": capacity,
                },
            )
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

             # This is the most surprising side effect in the file and it had no
             # record at all: walking into workshop B while pre-registered for A in
             # the same slot *deletes the A booking*. The participant loses a
             # registration they never cancelled, and until now nothing anywhere said
             # so — A's seat count simply changed and their booking was gone.
             released_other = [
                 str(rid) for rid in released if rid is not None and str(rid) != str(ws_doc_id)
             ]
             if released_other:
                 log_config.warning(
                     _log,
                     f"on-spot scan released {len(released_other)} same-slot booking(s) on other workshop(s)",
                     {
                         "participant_id": target_user.get("participant_id"),
                         "workshop_id": workshop.get("workshop_id"),
                         "slot_id": workshop.get("slot_id"),
                         "released_workshop_oids": released_other,
                         "reason": "same_slot_booking_released",
                     },
                 )

             for released_id in released:
                 if released_id is None:
                     # A booking with no `workshop_id` — malformed data that the
                     # `$pull` above has already deleted. Skipping it silently means
                     # some workshop keeps charging for a seat nobody holds, and
                     # there is no way to work out which one afterwards.
                     log_integrity(
                         "same-slot booking had no workshop_id and its seat could not be released",
                         reason="malformed_booking_skipped",
                         details={
                             "participant_id": target_user.get("participant_id"),
                             "workshop_id": workshop.get("workshop_id"),
                             "slot_id": workshop.get("slot_id"),
                         },
                     )
                     continue
                 # Guarded rather than floored afterwards: `$gt: 0` makes the
                 # decrement a no-op on a counter that is already zero, so data
                 # predating this route cannot be driven negative.
                 release_result = workshops_collection.update_one(
                     {"_id": released_id, "registration_count": {"$gt": 0}},
                     {"$inc": {"registration_count": -1}}
                 )
                 if release_result.modified_count == 0:
                     # The guard did its job, but it means the released booking's seat
                     # was never counted — so that workshop's `registration_count` was
                     # already out of step with the bookings people actually held.
                     log_integrity(
                         "released seat could not be returned: registration_count was already zero",
                         reason="release_decrement_skipped",
                         details={
                             "participant_id": target_user.get("participant_id"),
                             "released_workshop_oid": str(released_id),
                             "slot_id": workshop.get("slot_id"),
                         },
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

        log_scan(
            current_user, "workshop", "WORKSHOP_ATTENDANCE", OUTCOME_ALLOWED,
            participant_id=target_user.get("participant_id"),
            target_id=workshop.get("workshop_id"),
            details={
                "scan_type": scan_type,
                "slot_id": workshop.get("slot_id"),
                "on_spot_used": current_on_spot + 1,
                "on_spot_cap": max_on_spot,
                "displaced_bookings": len([r for r in (released if existing_ws else []) if r is not None]),
                "capacity": capacity,
            },
        )
        return {"message": "On-spot registration successful and marked present"}
    
    # Reached by any `scan_type` that is neither of the two handled above. Logged
    # because it means a client is sending something this API has never supported,
    # and the volunteer sees a bare 400 while working a queue.
    log_denied(
        current_user, "WORKSHOP_ATTENDANCE_DENIED", workshop.get("workshop_id"),
        reason="invalid_scan_type",
        details={"scan_type": scan_type, "scan_domain": "workshop"},
    )
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


# ---------------------------------------------------------------------------
# Registration window: one-shot auto-close, admin-override-sticks.
#
# `registration_open` is a stored, mutable flag rather than something computed
# fresh on every read. Two things follow from that:
#
#   * Nothing flips it automatically on a schedule — there is no scheduler in
#     this codebase — so it is synced lazily, the moment any route resolves
#     the workshop.
#   * A flag alone cannot tell "still True because nobody has looked yet"
#     apart from "True because an admin deliberately reopened it after the
#     deadline" — so `registration_closed_by_system` (an internal-only bit,
#     never in any request/response model) records whether the *system* has
#     already used its one auto-close for the current `registration_end`.
#     An admin's own write to `registration_open` never touches that bit —
#     only pushing a *new* `registration_end` does (see `update_workshop`) —
#     which is what lets an override stick across subsequent reads.
# ---------------------------------------------------------------------------

def _sync_registration_state(workshop: dict) -> dict:
    """
    Auto-closes `registration_open` once, the first time this workshop is
    resolved after its `registration_end` has passed, and returns the
    up-to-date document (persisting the change if one was made).

    A no-op for a workshop that has no registration window at all — older
    documents predating this restructure would otherwise be locked closed by
    a `None` bound; there should be none once this replace lands, but this
    keeps the guard from crashing rather than skipping should one appear.
    """
    if workshop is None:
        return workshop

    end = workshop.get("registration_end")
    if not end:
        return workshop
    if not workshop.get("registration_open"):
        return workshop
    if workshop.get("registration_closed_by_system"):
        return workshop

    try:
        end_dt = parse_instant_utc(end, "registration_end")
    except ValueError:
        # The auto-close is skipped, so `registration_open` stays True past its
        # deadline and this workshop keeps accepting registrations indefinitely.
        # Silent until now, and the symptom — a workshop that will not close — looks
        # like a scheduling mistake rather than a data problem.
        log_integrity(
            "workshop registration auto-close skipped: registration_end will not parse",
            reason="registration_end_unparseable",
            details={
                "workshop_id": workshop.get("workshop_id"),
                "raw_type": type(workshop.get("registration_end")).__name__,
                "registration_open": workshop.get("registration_open"),
            },
        )
        return workshop

    if datetime.utcnow() <= end_dt:
        return workshop

    workshops_collection.update_one(
        {"_id": workshop["_id"]},
        {"$set": {"registration_open": False, "registration_closed_by_system": True, "updated_at": datetime.utcnow()}},
    )
    workshop = dict(workshop)
    workshop["registration_open"] = False
    workshop["registration_closed_by_system"] = True
    return workshop


def _resolve_workshop(workshop_id: str):
    """
    A workshop by its readable id, its slot id, or its raw ObjectId.

    The same three-way lookup `register_for_workshop` and `workshop_attendance`
    already do, so a client that can scan against an id can also read the roster
    for it. Returns None rather than raising, so each caller words its own 404.

    Every call runs the registration-window sync (`_sync_registration_state`)
    before returning, so any route that resolves a workshop through this
    helper sees an up-to-date `registration_open`.
    """
    workshop = workshops_collection.find_one({"$or": [{"workshop_id": workshop_id}, {"slot_id": workshop_id}]})
    if not workshop:
        try:
            workshop = workshops_collection.find_one({"_id": ObjectId(workshop_id)})
        except Exception:
            # The id is not a valid ObjectId either. Becomes a plain 404 at the
            # caller, which is correct, but at DEBUG it is worth seeing that a client
            # is constructing ids this API never issued — a mistyped scan target
            # looks the same to the volunteer as a deleted workshop.
            log_config.debug(
                _log,
                "workshop lookup id is not a known id or a valid ObjectId",
                {"workshop_id": workshop_id, "reason": "invalid_workshop_id"},
            )
            workshop = None
    return _sync_registration_state(workshop)


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


def _assert_scan_window(workshop: dict, operation: str, actor: Optional[dict] = None) -> None:
    """
    Raise 403 if ``now`` is outside the permitted window for ``operation``.

    ``operation`` must be one of ``"pre-registered"``, ``"on-spot"``, or
    ``"changes"``.  Workshops without a ``start_time`` are always permitted.
    """
    raw = workshop.get("start_time")
    if not raw:
        # No start_time stored — window guard disabled for this workshop.
        #
        # Recorded, because a disabled guard is invisible from the outside: the
        # workshop accepts pre-registered scans, walk-ins, and manual attendance
        # corrections at any time on any day, and the only way to notice is to
        # spot attendance appearing outside the session.
        log_integrity(
            "workshop scan window guard disabled: no start_time stored",
            reason="workshop_window_guard_disabled",
            details={
                "workshop_id": workshop.get("workshop_id"),
                "slot_id": workshop.get("slot_id"),
                "operation": operation,
                "cause": "start_time_missing",
                "guard": "open",
            },
        )
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
        #
        # The trade-off is deliberate and stays as it is: refusing every scan
        # because of one bad stored value would shut a whole session's door. But
        # failing open *silently* is what made it dangerous, so the offending value
        # is reported here. The length and type of the raw value are enough to tell
        # a seeded string from a stray integer without guessing.
        log_integrity(
            "workshop scan window guard disabled: start_time will not parse",
            reason="workshop_window_guard_disabled",
            details={
                "workshop_id": workshop.get("workshop_id"),
                "slot_id": workshop.get("slot_id"),
                "operation": operation,
                "cause": "start_time_unparseable",
                "raw_type": type(raw).__name__,
                "raw_length": len(str(raw)),
                "guard": "open",
            },
        )
        return

    now = datetime.utcnow()
    open_delta  = timedelta(minutes=_WINDOW_OPEN_MINUTES[operation])
    close_delta = timedelta(minutes=_WINDOW_CLOSE_MINUTES)

    opens_at  = start - open_delta
    closes_at = start + close_delta

    if now < opens_at:
        opens_in = int((opens_at - now).total_seconds() // 60)
        log_denied(
            actor,
            "WORKSHOP_ATTENDANCE_DENIED",
            workshop.get("workshop_id"),
            reason="window_not_open",
            details={
                "operation": operation,
                "opens_in_minutes": opens_in,
                "opens_at": opens_at,
                "start_time": start,
                "scan_domain": "workshop",
            },
        )
        raise HTTPException(
            status_code=403,
            detail=(
                f"Scanning window not yet open. "
                f"Opens {_WINDOW_OPEN_MINUTES[operation]} min before start "
                f"(in ~{opens_in} min)."
            ),
        )
    if now >= closes_at:
        # A late arrival at the desk, or a volunteer working through a queue that
        # outlasted the window. The minutes-past figure separates the two, and it is
        # the question a participant marked absent will ask about.
        log_denied(
            actor,
            "WORKSHOP_ATTENDANCE_DENIED",
            workshop.get("workshop_id"),
            reason="window_closed",
            details={
                "operation": operation,
                "closed_minutes_ago": int((now - closes_at).total_seconds() // 60),
                "closed_at": closes_at,
                "start_time": start,
                "scan_domain": "workshop",
            },
        )
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
        "registration_start": workshop.get("registration_start"),
        "registration_end": workshop.get("registration_end"),
        "registration_open": workshop.get("registration_open"),
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
        log_denied(
            current_user, "UPDATE_WORKSHOP_PARTICIPANT_DENIED", workshop_id,
            reason="workshop_not_found", details={"participant_id": participant_id},
        )
        raise HTTPException(status_code=404, detail="Workshop not found")

    is_super_admin = _is_super_admin(user_id)
    member = _workshop_team_member(workshop, user_id)
    if not (is_super_admin or member):
        log_denied(
            current_user, "UPDATE_WORKSHOP_PARTICIPANT_DENIED", workshop.get("workshop_id"),
            reason="not_super_admin_or_team", details={"participant_id": participant_id},
        )
        raise HTTPException(status_code=403, detail="Not authorized to update this workshop's participants")
    if not is_super_admin and not member.get("attendance", True):
        log_denied(
            current_user, "UPDATE_WORKSHOP_PARTICIPANT_DENIED", workshop.get("workshop_id"),
            reason="scanning_disabled_for_volunteer",
            details={"participant_id": participant_id, "volunteer_role": member.get("role")},
        )
        raise HTTPException(status_code=403, detail="Scanning disabled for this volunteer")

    # Time-window guard for manual attendance changes: the window opens at
    # start_time (corrections only make sense once the session is running)
    # and closes 30 min after start_time.  Super Admins are also bound — a
    # correction made hours later is indistinguishable from a fabrication, and
    # the audit trail is the right place to escalate those cases.
    # Workshops with no start_time stored are unguarded (backward compat).
    _assert_scan_window(workshop, "changes")

    if request.attended is None and request.booking_type is None:
        log_denied(
            current_user, "UPDATE_WORKSHOP_PARTICIPANT_DENIED", workshop.get("workshop_id"),
            reason="nothing_to_update", details={"participant_id": participant_id}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Nothing to update")
    if request.booking_type is not None and request.booking_type not in ("pre-registered", "on-spot"):
        log_denied(
            current_user, "UPDATE_WORKSHOP_PARTICIPANT_DENIED", workshop.get("workshop_id"),
            reason="invalid_booking_type",
            details={"participant_id": participant_id, "booking_type": request.booking_type},
            audit=False,
        )
        raise HTTPException(status_code=400, detail="booking_type must be 'pre-registered' or 'on-spot'")

    target = participants_collection.find_one({"participant_id": participant_id})
    if not target:
        target = participants_collection.find_one({"email": participant_id})
    if not target:
        log_denied(
            current_user, "UPDATE_WORKSHOP_PARTICIPANT_DENIED", workshop.get("workshop_id"),
            reason="participant_not_found", details={"participant_id": participant_id},
        )
        raise HTTPException(status_code=404, detail="Participant not found")

    ws_doc_id = workshop["_id"]
    entry = next(
        (w for w in target.get("workshops", []) if str(w.get("workshop_id")) == str(ws_doc_id)),
        None,
    )
    if entry is None:
        log_denied(
            current_user, "UPDATE_WORKSHOP_PARTICIPANT_DENIED", workshop.get("workshop_id"),
            reason="participant_not_registered_for_workshop",
            details={
                "participant_id": target.get("participant_id"),
                "bookings_held": len(target.get("workshops") or []),
            },
        )
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
        #
        # A *file* line is still worth writing, though — not a `workshop_logs` row.
        # The desk asked for a correction and got "No change", and knowing that the
        # attempt was made distinguishes "the volunteer never tried" from "the
        # volunteer tried and the record already agreed".
        log_config.info(
            _log,
            "workshop participant update was a no-op",
            {
                "participant_id": target.get("participant_id"),
                "workshop_id": workshop.get("workshop_id"),
                "requested_attended": request.attended,
                "requested_booking_type": request.booking_type,
                "current_attended": was_attended,
                "current_booking_type": entry.get("booking_type"),
                "reason": "no_change",
            },
        )
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
        # The values being changed *from*, so a hand-set attendance can be told
        # apart from a hand-*unset* one. `changes` alone gives the new state; a
        # correction is only interpretable against what it replaced.
        "previous": {"attended": was_attended, "booking_type": entry.get("booking_type")},
        "applied_by": "super_admin" if is_super_admin else "workshop_team",
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
