"""
Workshop slots — the D1S1, D2S2, ... time blocks workshops are scheduled
against.

Created and edited independently of any workshop by a Super Admin. A workshop
references a slot by `slot_id` and denormalizes that slot's `start_time` onto
its own document at creation time (see `routers.workshops.create_workshop`),
so the slot-clash check in `register_for_workshop` and the scan-window guard
in `_assert_scan_window` never have to join back to this collection on every
read.

Because the time is denormalized rather than looked up live, this file is
also where that denormalization is kept honest:

  * `PUT /workshop-slots/{slot_id}` pushes an edited `start_time` onto every
    workshop currently referencing that slot — otherwise an edited slot and
    the workshops "in" it would silently disagree about when they run.
  * `DELETE /workshop-slots/{slot_id}` removes every workshop referencing it
    (and their participants' bookings), rather than leaving orphaned
    workshops pointed at a slot that no longer exists.

Document shape:

    { slot_id, start_time, end_time, created_by, created_at, updated_at }
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime

from logger import log_audit
from models import WorkshopSlotCreateRequest, WorkshopSlotUpdateRequest, parse_instant_utc
from database import workshop_slots_collection, workshops_collection, participants_collection, backend_teams_collection
from dependencies import get_current_staff

router = APIRouter(prefix="/workshop-slots", tags=["Workshop Slots"])


def _is_super_admin(current_user: dict) -> bool:
    user_id = current_user.get("paradox_id")
    return bool(backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}))


def _require_super_admin(current_user: dict) -> None:
    if not _is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admins can perform this action")


@router.post("")
def create_workshop_slot(request: WorkshopSlotCreateRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user)

    if workshop_slots_collection.find_one({"slot_id": request.slot_id}):
        raise HTTPException(status_code=400, detail="A slot with this slot_id already exists")

    new_slot = {
        "slot_id": request.slot_id,
        "start_time": request.start_time,
        "end_time": request.end_time,
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    workshop_slots_collection.insert_one(new_slot)
    log_audit(current_user, "CREATE_WORKSHOP_SLOT", request.slot_id)
    return {"message": "Workshop slot created"}


@router.get("")
def list_workshop_slots():
    """
    The slot catalogue — no token required. Unlike a workshop, a slot carries
    no participant, staff, or bookkeeping data; it is calendar metadata that a
    create-workshop form needs to read before a user has signed in.
    """
    return list(workshop_slots_collection.find({}, {"_id": 0, "created_by": 0}))


@router.put("/{slot_id}")
def update_workshop_slot(slot_id: str, request: WorkshopSlotUpdateRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user)

    slot = workshop_slots_collection.find_one({"slot_id": slot_id})
    if not slot:
        raise HTTPException(status_code=404, detail="Workshop slot not found")

    update_data = {k: v for k, v in request.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Nothing to update")

    # Merge onto the stored document before validating end > start, the same
    # pattern events.py uses for RegistrationWindowUpdate: a request that only
    # changes one bound must still be checked against the other bound as it
    # already stands, not treated as trivially valid on its own.
    new_start = update_data.get("start_time", slot.get("start_time"))
    new_end = update_data.get("end_time", slot.get("end_time"))
    start_dt = parse_instant_utc(new_start, "start_time")
    end_dt = parse_instant_utc(new_end, "end_time")
    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    update_data["updated_at"] = datetime.utcnow()
    workshop_slots_collection.update_one({"slot_id": slot_id}, {"$set": update_data})

    # Cascade: every workshop referencing this slot must agree with it about
    # when it runs. Only start_time is denormalized onto a workshop (that is
    # what the scan-window guard and slot-clash check read), so only it is
    # pushed here, and only when this request actually changed it.
    affected = 0
    if "start_time" in update_data:
        result = workshops_collection.update_many(
            {"slot_id": slot_id},
            {"$set": {"start_time": update_data["start_time"], "updated_at": datetime.utcnow()}},
        )
        affected = result.modified_count

    log_audit(current_user, "UPDATE_WORKSHOP_SLOT", slot_id, {"workshops_updated": affected})
    return {"message": "Workshop slot updated", "workshops_updated": affected}


@router.delete("/{slot_id}")
def delete_workshop_slot(slot_id: str, current_user: dict = Depends(get_current_staff)):
    """
    Deletes the slot, and every workshop scheduled against it — a Super
    Admin decision, not a soft-orphan: a workshop with no slot has no time and
    no way to be scheduled again, so it is removed rather than left dangling.

    Participants' bookings for each removed workshop are pulled the same way
    `delete_workshop` already does for a single workshop, so no participant is
    left holding a reference to a workshop that no longer exists.
    """
    _require_super_admin(current_user)

    slot = workshop_slots_collection.find_one({"slot_id": slot_id})
    if not slot:
        raise HTTPException(status_code=404, detail="Workshop slot not found")

    affected_workshops = list(workshops_collection.find({"slot_id": slot_id}))
    for workshop in affected_workshops:
        ws_doc_id = workshop["_id"]
        participants_collection.update_many(
            {"workshops.workshop_id": ws_doc_id},
            {"$pull": {"workshops": {"workshop_id": ws_doc_id}}},
        )
        workshops_collection.delete_one({"_id": ws_doc_id})
        log_audit(current_user, "DELETE_WORKSHOP", workshop.get("workshop_id"), {"reason": "slot_deleted", "slot_id": slot_id})

    workshop_slots_collection.delete_one({"slot_id": slot_id})
    log_audit(current_user, "DELETE_WORKSHOP_SLOT", slot_id, {"workshops_deleted": len(affected_workshops)})

    return {"message": "Workshop slot deleted", "workshops_deleted": len(affected_workshops)}
