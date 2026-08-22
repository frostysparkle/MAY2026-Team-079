import re
from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

from database import mess_collection, participants_collection, backend_teams_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from models import ScanQRRequest

router = APIRouter(prefix="/mess", tags=["Mess"])

# ---------------------------------------------------------------------------
# Mess type — the single field replacing the old, independent `preference`
# (veg | non_veg | jain) and `cuisines` (north_indian | south_indian list).
#
# Combined as "{cuisine}__{diet}" for every hall that serves a specific
# regional menu, plus a standalone "jain" for a hall that serves neither
# regional variant. This is the *complete* set of values a hall's `type` may
# take — there is no larger axis to extend it against, so it is validated as a
# closed set rather than as two independently-checked parts.
# ---------------------------------------------------------------------------
CUISINES = ("north_indian", "south_indian")
DIETS = ("veg", "non_veg")

MESS_TYPES = {f"{cuisine}__{diet}" for cuisine in CUISINES for diet in DIETS} | {"jain"}

# The only meals a day's menu may name. A day is free to serve any subset of
# these (e.g. a travel day with breakfast only) — the key is what makes a slot
# optional, not a flag next to it.
MEAL_SLOTS = ("breakfast", "lunch", "dinner")

_DAY_KEY_RE = re.compile(r"^day_[1-9]\d*$")

# How long before a slot's start / after its end a QR scan is still accepted.
SCAN_WINDOW = timedelta(minutes=15)


def _diet_of(mess_type: str) -> str:
    """
    The dietary axis of a combined `type`, e.g. ``"north_indian__veg"`` ->
    ``"veg"``, ``"jain"`` -> ``"jain"``.

    `POST /mess/allocate` still only has a participant's dietary preference to
    go on (`profile.mess_preference`), never a cuisine preference, so this is
    what lets allocation keep matching on diet alone after `type` started also
    carrying the regional menu.
    """
    if mess_type == "jain":
        return "jain"
    return mess_type.rsplit("__", 1)[-1]


def _day_sort_key(day_key: str) -> int:
    """`"day_1"`, `"day_2"`, ... `"day_10"` sorted numerically, not lexically."""
    try:
        return int(day_key.split("_", 1)[1])
    except (IndexError, ValueError):
        return 0


def _naive_utc(value: datetime) -> datetime:
    """Normalise a possibly tz-aware datetime to naive UTC, for comparison
    against `datetime.utcnow()` (what every scan-window check in this codebase
    compares against)."""
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class MessCreateRequest(BaseModel):
    mess_id: str
    name: str
    capacity: int = Field(..., gt=0)
    type: str

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v):
        if v not in MESS_TYPES:
            raise ValueError(f"type must be one of {sorted(MESS_TYPES)}")
        return v


class MessUpdateRequest(BaseModel):
    """Every field optional: a caller updates only what it names."""
    name: Optional[str] = None
    capacity: Optional[int] = Field(None, gt=0)
    type: Optional[str] = None

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v):
        if v is not None and v not in MESS_TYPES:
            raise ValueError(f"type must be one of {sorted(MESS_TYPES)}")
        return v


class MessAssignTeamRequest(BaseModel):
    user_id: Optional[str] = None
    role: str  # volunteer | other
    name: Optional[str] = None # For staff without admin_id
    phone: Optional[str] = None


class MessMealSlot(BaseModel):
    """One meal sitting on one day: when it runs, and what it serves."""
    start_time: datetime
    end_time: datetime
    menu: str = Field(..., min_length=1)

    @field_validator("menu")
    @classmethod
    def _menu_not_blank(cls, v):
        if not v.strip():
            raise ValueError("menu must not be blank")
        return v

    @model_validator(mode="after")
    def _end_after_start(self):
        if _naive_utc(self.end_time) <= _naive_utc(self.start_time):
            raise ValueError("end_time must be after start_time")
        return self


class MessMenuRequest(BaseModel):
    """
    A full replacement for a hall's `menu`.

    Keyed exactly as it is stored: `day_1`, `day_2`, ... each holding whichever
    of `breakfast` / `lunch` / `dinner` that day actually serves. A day need
    not carry all three — this is what lets an admin give a travel day
    breakfast only, and how many days there are is entirely up to them.

    A full replacement rather than a per-day patch: it keeps one write path
    for "add a day", "drop a slot", or "move a sitting", instead of three.
    """
    menu: Dict[str, Dict[str, MessMealSlot]] = {}

    @field_validator("menu")
    @classmethod
    def _valid_menu(cls, v):
        for day_key, slots in v.items():
            if not _DAY_KEY_RE.match(day_key):
                raise ValueError(f"invalid day key {day_key!r}; expected 'day_<n>' (n >= 1)")
            for slot_name in slots:
                if slot_name not in MEAL_SLOTS:
                    raise ValueError(
                        f"invalid slot {slot_name!r} in {day_key!r}; expected one of {MEAL_SLOTS}"
                    )
        return v


# ---------------------------------------------------------------------------
# Create / Read / Update / Delete
# ---------------------------------------------------------------------------

@router.post("")
def create_mess(request: MessCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    if mess_collection.find_one({"mess_id": request.mess_id}):
        raise HTTPException(status_code=409, detail="A mess with this mess_id already exists")

    mess_doc = {
        "mess_id": request.mess_id,
        "name": request.name,
        "capacity": request.capacity,
        "type": request.type,
        "menu": {},
        "mess_team": [],
        "created_at": datetime.utcnow()
    }
    mess_collection.insert_one(mess_doc)
    log_audit(current_user, "CREATE_MESS", request.mess_id, {"capacity": request.capacity, "type": request.type})
    return {"message": "Mess created"}

@router.get("")
def list_messes(current_user: dict = Depends(get_current_user)):
    return list(mess_collection.find({}, {"_id": 0}))

@router.put("/{mess_id}")
def update_mess(mess_id: str, request: MessUpdateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    if not mess_collection.find_one({"mess_id": mess_id}):
        raise HTTPException(status_code=404, detail="Mess not found")

    update_data = {k: v for k, v in request.model_dump(exclude_unset=True).items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Nothing to update")

    update_data["updated_at"] = datetime.utcnow()
    mess_collection.update_one({"mess_id": mess_id}, {"$set": update_data})
    log_audit(current_user, "UPDATE_MESS", mess_id, update_data)
    return {"message": "Mess updated"}

@router.delete("/{mess_id}")
def delete_mess(mess_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess:
        raise HTTPException(status_code=404, detail="Mess not found")

    # Nobody is left holding a seat in a hall that no longer exists: every
    # participant seated here is released back to unallocated, with their scan
    # history cleared alongside it since it names slots on a menu that is gone.
    participants_collection.update_many(
        {"mess.mess_id": mess["_id"]},
        {"$set": {"mess.mess_id": None, "mess.scans": {}}}
    )
    mess_collection.delete_one({"mess_id": mess_id})
    log_audit(current_user, "DELETE_MESS", mess_id)
    return {"message": "Mess deleted"}

@router.put("/{mess_id}/menu")
def update_mess_menu(mess_id: str, request: MessMenuRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess: raise HTTPException(status_code=404, detail="Mess not found")

    is_super = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    on_team = any(m.get("user_id") == user_id for m in mess.get("mess_team", []))
    if not (is_super or on_team):
        raise HTTPException(status_code=403, detail="Not authorized to edit this menu")

    menu_dict = {
        day_key: {slot_name: slot.model_dump() for slot_name, slot in slots.items()}
        for day_key, slots in request.menu.items()
    }
    mess_collection.update_one(
        {"mess_id": mess_id},
        {"$set": {"menu": menu_dict, "updated_at": datetime.utcnow(), "updated_by": user_id}}
    )
    log_audit(current_user, "UPDATE_MESS_MENU", mess_id, {"days": len(menu_dict)})
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
        pref_groups.setdefault(_diet_of(m.get("type", "")), []).append(m)
        
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

    mess = current_user.get("mess") or {}
    mess_oid = mess.get("mess_id")
    mess_details = mess_collection.find_one({"_id": mess_oid}, {"_id": 0}) if mess_oid else None

    scans = mess.get("scans") or {}
    # The participant's own scan markers, merged onto the hall's *current*
    # menu — a day or slot the admin has since removed does not linger in the
    # response, and one just added shows up unscanned rather than missing.
    slots = []
    if mess_details:
        menu = mess_details.get("menu") or {}
        for day_key in sorted(menu.keys(), key=_day_sort_key):
            day_menu = menu[day_key]
            for slot_name in MEAL_SLOTS:
                slot_doc = day_menu.get(slot_name)
                if not slot_doc:
                    continue
                scanned_entry = (scans.get(day_key) or {}).get(slot_name) or {}
                slots.append({
                    "day": day_key,
                    "slot": slot_name,
                    "start_time": slot_doc.get("start_time"),
                    "end_time": slot_doc.get("end_time"),
                    "menu": slot_doc.get("menu"),
                    "scanned": bool(scanned_entry.get("scanned")),
                    "scanned_at": scanned_entry.get("scanned_at"),
                })

    return {
        "allotted_mess": mess_details.get("mess_id") if mess_details else None,
        "mess_details": mess_details,
        "slots": slots
    }

def _assert_mess_scan_window(slot_doc: dict) -> None:
    """
    Raise 403 if `now` is outside this slot's scan window.

    The window opens 15 minutes before `start_time` and closes 15 minutes
    after `end_time`. Both bounds are normalised to naive UTC before the
    comparison, matching how every other timestamp in this codebase is stored
    and compared (`datetime.utcnow()`).
    """
    start = slot_doc.get("start_time")
    end = slot_doc.get("end_time")
    if not isinstance(start, datetime) or not isinstance(end, datetime):
        # Defensive only: MessMealSlot always writes both as real datetimes.
        return

    now = datetime.utcnow()
    opens_at = _naive_utc(start) - SCAN_WINDOW
    closes_at = _naive_utc(end) + SCAN_WINDOW

    if now < opens_at:
        raise HTTPException(status_code=403, detail="Scanning window not yet open for this slot")
    if now > closes_at:
        raise HTTPException(status_code=403, detail="Scanning window closed for this slot")

@router.post("/{mess_id}/scan")
def scan_mess(mess_id: str, request: ScanQRRequest, slot: str, day: int, current_user: dict = Depends(get_current_staff)):
    if slot not in MEAL_SLOTS:
        raise HTTPException(status_code=400, detail=f"slot must be one of {MEAL_SLOTS}")
    if day < 1:
        raise HTTPException(status_code=400, detail="day must be a positive integer")

    user_id = current_user.get("paradox_id")
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess: raise HTTPException(status_code=404, detail="Mess not found")
    
    team_member = next((m for m in mess.get("mess_team", []) if m.get("user_id") == user_id), None)
    
    if not team_member:
        raise HTTPException(status_code=403, detail="Not authorized to scan for this mess")
        
    if not team_member.get("logging"):
        raise HTTPException(status_code=403, detail="Scanning disabled for you")

    day_key = f"day_{day}"
    slot_doc = (mess.get("menu") or {}).get(day_key, {}).get(slot)
    if not slot_doc:
        raise HTTPException(status_code=400, detail=f"No {slot} scheduled for day {day}")

    # QR scanning only works from 15 minutes before the slot's start time to
    # 15 minutes after it ends.
    _assert_mess_scan_window(slot_doc)

    target_user, _ = verify_qr(request)
    
    user_mess = target_user.get("mess", {})
    if user_mess.get("mess_id") != mess["_id"]:
        raise HTTPException(status_code=400, detail="Participant not allotted to this mess")

    scans = user_mess.get("scans") or {}
    day_scans = scans.get(day_key) or {}

    if day_scans.get(slot, {}).get("scanned"):
        raise HTTPException(status_code=400, detail=f"Already logged in for {slot} on day {day}")

    day_scans[slot] = {"scanned": True, "scanned_at": datetime.utcnow()}
    scans[day_key] = day_scans

    participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": {"mess.scans": scans}}
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

@router.get("/{mess_id}")
def get_mess(mess_id: str, current_user: dict = Depends(get_current_user)):
    """A single hall's document. Declared last so it never captures a literal
    path (`/my_mess`, `/allocate`) defined earlier in this file."""
    mess = mess_collection.find_one({"mess_id": mess_id}, {"_id": 0})
    if not mess:
        raise HTTPException(status_code=404, detail="Mess not found")
    return mess
