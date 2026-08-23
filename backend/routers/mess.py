import re
from fastapi import APIRouter, HTTPException, Depends
from logger import (
    OUTCOME_ALLOWED, OUTCOME_DENIED,
    log_audit, log_batch, log_denied, log_integrity, log_scan,
)
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

import log_config
from database import mess_collection, participants_collection, backend_teams_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from models import (
    ScanQRRequest, MockPaymentRequest,
    MESS_CUISINES as CUISINES, MESS_DIETS as DIETS, MESS_PREFERENCE_TYPES as MESS_TYPES,
)
from payments import simulate_payment

router = APIRouter(prefix="/mess", tags=["Mess"])

# `log_config.info(...)` rather than `logging.info(...)` throughout this file:
# `assign_mess_team` has a local variable named `logging` and `toggle_mess_scan`
# has a parameter of that name, either of which would shadow the module.
_log = log_config.get_logger("paradox.mess")


def _require_super_admin(current_user: dict, operation: str) -> str:
    """The Super Admin gate shared by this router's administrative routes."""
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_super_admin",
            details={"operation": operation, "resource": "mess", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Not authorized")
    return user_id

# ---------------------------------------------------------------------------
# Mess type — the single field replacing the old, independent `preference`
# (veg | non_veg | jain) and `cuisines` (north_indian | south_indian list).
#
# Combined as "{cuisine}__{diet}" for every hall that serves a specific
# regional menu, plus a standalone "jain" for a hall that serves neither
# regional variant. This is the *complete* set of values a hall's `type` may
# take — there is no larger axis to extend it against, so it is validated as a
# closed set rather than as two independently-checked parts.
#
# CUISINES / DIETS / MESS_TYPES are now defined once in `models.py`
# (MESS_CUISINES / MESS_DIETS / MESS_PREFERENCE_TYPES) and imported here under
# their old names, so this module's own code and tests keep reading exactly as
# they did — but a participant's `profile.mess_preference` (validated in
# `models.ProfileCompleteRequest`) and a hall's `type` are now provably the
# same set instead of two lists that happen to agree.
# ---------------------------------------------------------------------------

# The fixed mess fee charged by the mock payment endpoint below. Never
# accepted from the client — see `MockPaymentRequest`.
MESS_FEE = 1200

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
    user_id = _require_super_admin(current_user, "create")

    if mess_collection.find_one({"mess_id": request.mess_id}):
        log_denied(
            current_user,
            "CREATE_MESS_DENIED",
            request.mess_id,
            reason="mess_id_already_exists",
            details={"type": request.type, "capacity": request.capacity},
        )
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


# ---------------------------------------------------------------------------
# Opting in
#
# `POST /mess/allocate` only considers participants whose `mess.registered` is
# True, and both `POST /auth/register` and the participant factory store that
# flag False. Until now nothing in the API ever set it: the flag existed, the
# allocator filtered on it, and there was no way through HTTP to turn it on —
# so mess allocation could never place a single person. Accommodation has had
# `POST /hostels/register` all along; these two are its missing counterparts,
# and they are deliberately its mirror image, down to the refusal conditions,
# because a participant meets both flows in the same sitting.
#
# Declared here, above every `/{mess_id}` route, so "register" is never
# captured as a hall id — `DELETE /{mess_id}` in particular would otherwise
# match first and try to delete a hall called "register".
# ---------------------------------------------------------------------------

@router.post("/register")
def register_for_mess(current_user: dict = Depends(get_current_participant)):
    """
    Ask for a meal plan during the fest.

    Idempotent: asking twice is not an error, it just stays requested.

    Refused once a hall has been allotted, matching
    `POST /hostels/register` — moving somebody who has already been seated is an
    organiser's decision, and re-running allocation will not move them anyway
    (the allocator only looks at participants with no `mess.mess_id`).
    """
    if "participant_id" not in current_user:
        log_denied(
            current_user, "MESS_REGISTER_DENIED", None,
            reason="not_a_participant", details={"status": 400}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Only participants can request a meal plan")

    mess = current_user.get("mess") or {}
    if mess.get("mess_id"):
        log_denied(
            current_user, "MESS_REGISTER_DENIED", current_user.get("participant_id"),
            reason="already_allotted",
            details={"mess_id": str(mess.get("mess_id")), "status": 400},
        )
        raise HTTPException(status_code=400, detail="Mess already allotted")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"mess.registered": True}}
    )
    # The stored preference is recorded because it is what decides, whenever
    # allocation next runs, which halls this person can be seated in — and a
    # participant who has not chosen one is allocated as `veg` by default, which
    # is the kind of thing worth being able to look up afterwards rather than
    # infer.
    raw_preference = (current_user.get("profile") or {}).get("mess_preference")
    log_audit(current_user, "MESS_REGISTER", current_user.get("participant_id"), {
        "preference": raw_preference,
        "diet": _diet_of(raw_preference) if raw_preference else None,
        "already_paid": bool(mess.get("payment")),
        "was_registered": bool(mess.get("registered")),
    })
    return {"message": "Meal plan requested"}


@router.delete("/register")
def cancel_mess_request(current_user: dict = Depends(get_current_participant)):
    """
    Withdraw a pending meal plan request.

    Refused once a hall has been allotted: releasing a seat somebody has been
    given is an organiser decision, not a self-service one. Same rule as
    `DELETE /hostels/register`.
    """
    if "participant_id" not in current_user:
        log_denied(
            current_user, "MESS_CANCEL_DENIED", None,
            reason="not_a_participant", details={"status": 400}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Only participants can cancel a meal plan")

    mess = current_user.get("mess") or {}
    if mess.get("mess_id"):
        log_denied(
            current_user, "MESS_CANCEL_DENIED", current_user.get("participant_id"),
            reason="already_allotted",
            details={"mess_id": str(mess.get("mess_id")), "status": 400},
        )
        raise HTTPException(status_code=400, detail="Mess already allotted")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"mess.registered": False}}
    )
    log_audit(current_user, "MESS_CANCEL", current_user.get("participant_id"), {
        "was_registered": bool(mess.get("registered")),
    })
    return {"message": "Meal plan request withdrawn"}


@router.put("/{mess_id}")
def update_mess(mess_id: str, request: MessUpdateRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "update")

    existing = mess_collection.find_one({"mess_id": mess_id})
    if not existing:
        log_denied(
            current_user, "UPDATE_MESS_DENIED", mess_id,
            reason="mess_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Mess not found")

    update_data = {k: v for k, v in request.model_dump(exclude_unset=True).items() if v is not None}
    if not update_data:
        log_denied(
            current_user, "UPDATE_MESS_DENIED", mess_id,
            reason="nothing_to_update", details={"status": 400}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Nothing to update")

    # A capacity cut below the number already seated is worth flagging rather than
    # refusing: allocation reads capacity as its ceiling, so from this point the
    # hall is over-subscribed and no further placement will be made, while the
    # participants already seated stay seated. Nothing in the response says so.
    seated = participants_collection.count_documents({"mess.mess_id": existing["_id"]})
    if "capacity" in update_data and update_data["capacity"] < seated:
        log_config.warning(
            _log,
            "mess capacity reduced below the number already seated",
            {
                "mess_id": mess_id,
                "reason": "capacity_below_occupancy",
                "new_capacity": update_data["capacity"],
                "previous_capacity": existing.get("capacity"),
                "seated": seated,
            },
        )

    update_data["updated_at"] = datetime.utcnow()
    mess_collection.update_one({"mess_id": mess_id}, {"$set": update_data})
    # `type` is the field allocation matches a participant's diet against, so a
    # change here silently re-purposes the hall: everybody already seated keeps a
    # place in a hall that now serves something else. The previous value goes into
    # the row so that mismatch can be explained afterwards.
    log_audit(
        current_user,
        "UPDATE_MESS",
        mess_id,
        {
            **update_data,
            "previous_type": existing.get("type") if "type" in update_data else None,
            "previous_capacity": existing.get("capacity") if "capacity" in update_data else None,
            "seated": seated,
        },
    )
    return {"message": "Mess updated"}

@router.delete("/{mess_id}")
def delete_mess(mess_id: str, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "delete")

    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess:
        log_denied(
            current_user, "DELETE_MESS_DENIED", mess_id,
            reason="mess_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Mess not found")

    # Who is about to be affected, captured *before* the cascade runs — afterwards
    # the link is gone and this is unanswerable. This is the most destructive
    # operation in the file: it discards every scan marker for every participant
    # seated here, so a meal somebody was recorded as having eaten stops existing
    # on their document. The audit rows written by those scans survive, which is
    # what makes reconstruction possible at all.
    affected = [
        p.get("participant_id")
        for p in participants_collection.find({"mess.mess_id": mess["_id"]}, {"participant_id": 1})
    ]

    # Nobody is left holding a seat in a hall that no longer exists: every
    # participant seated here is released back to unallocated, with their scan
    # history cleared alongside it since it names slots on a menu that is gone.
    result = participants_collection.update_many(
        {"mess.mess_id": mess["_id"]},
        {"$set": {"mess.mess_id": None, "mess.scans": {}}}
    )
    mess_collection.delete_one({"mess_id": mess_id})
    log_audit(
        current_user,
        "DELETE_MESS",
        mess_id,
        {
            "name": mess.get("name"),
            "type": mess.get("type"),
            "capacity": mess.get("capacity"),
            "menu_days": len(mess.get("menu") or {}),
            "team_size": len(mess.get("mess_team") or []),
            "participants_released": result.modified_count,
            "scan_history_cleared_for": affected,
        },
    )
    log_config.warning(
        _log,
        f"mess {mess_id} deleted, releasing {result.modified_count} participant(s) and clearing their scan markers",
        {"mess_id": mess_id, "participants_released": result.modified_count, "destructive": True},
    )
    return {"message": "Mess deleted"}

@router.put("/{mess_id}/menu")
def update_mess_menu(mess_id: str, request: MessMenuRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")

    # Authorise before reporting existence. Unlike its siblings this gate is not a
    # plain Super Admin check — "on this hall's own team" cannot be answered
    # without the document — so the lookup happens first and its *result* is
    # withheld until the caller has been authorised. A staff member who is
    # neither is refused with the same 403 whether or not the hall exists, and the
    # 404 below is reachable only by somebody entitled to know: before this, any
    # staff token could tell a real mess_id from a mistyped one.
    mess = mess_collection.find_one({"mess_id": mess_id})

    is_super = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    on_team = any(m.get("user_id") == user_id for m in (mess or {}).get("mess_team", []))
    if not (is_super or on_team):
        log_denied(
            current_user, "UPDATE_MESS_MENU_DENIED", mess_id,
            reason="not_super_admin_or_team",
            # The trail still distinguishes what the response deliberately does
            # not: a refusal against a hall that was not there reads differently
            # from one against a hall the caller simply does not staff.
            details={"status": 403, "mess_exists": bool(mess)},
        )
        raise HTTPException(status_code=403, detail="Not authorized to edit this menu")

    if not mess:
        log_denied(
            current_user, "UPDATE_MESS_MENU_DENIED", mess_id,
            reason="mess_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Mess not found")

    menu_dict = {
        day_key: {slot_name: slot.model_dump() for slot_name, slot in slots.items()}
        for day_key, slots in request.menu.items()
    }

    # The menu is what every scan window is derived from, and this route replaces
    # it wholesale. A day or slot present before and absent now means the scan
    # window for that sitting has ceased to exist, and `scan_mess` will refuse it
    # with "No {slot} scheduled for day {n}" — which reads like a scanner fault to
    # the volunteer holding it. Recording what was removed is what connects the
    # two events.
    previous = mess.get("menu") or {}
    previous_slots = {f"{d}.{s}" for d, day in previous.items() for s in (day or {})}
    new_slots = {f"{d}.{s}" for d, day in menu_dict.items() for s in (day or {})}
    removed = sorted(previous_slots - new_slots)
    added = sorted(new_slots - previous_slots)

    mess_collection.update_one(
        {"mess_id": mess_id},
        {"$set": {"menu": menu_dict, "updated_at": datetime.utcnow(), "updated_by": user_id}}
    )
    log_audit(
        current_user,
        "UPDATE_MESS_MENU",
        mess_id,
        {
            "days": len(menu_dict),
            "slots": len(new_slots),
            "slots_added": added,
            "slots_removed": removed,
            "edited_as": "super_admin" if is_super else "mess_team",
        },
    )
    if removed:
        log_config.warning(
            _log,
            f"menu update removed {len(removed)} existing meal slot(s) from {mess_id}",
            {"mess_id": mess_id, "reason": "menu_slots_removed", "slots_removed": removed},
        )
    return {"message": "Menu updated"}

@router.post("/{mess_id}/team")
def assign_mess_team(mess_id: str, request: MessAssignTeamRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "assign_team")

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

    # The hall has to exist. This route never checked — the `$push` below simply
    # matched nothing — so assigning a team to a mistyped `mess_id` answered
    # "Team member assigned" and did nothing at all, with the miss recorded only
    # as `hall_exists: false` inside the success row.
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess:
        log_denied(
            current_user, "ASSIGN_MESS_TEAM_DENIED", mess_id,
            reason="mess_not_found",
            details={"team_user_id": request.user_id, "role": request.role, "status": 404},
        )
        raise HTTPException(status_code=404, detail="Mess not found")

    existing = any(
        member.get("user_id") == request.user_id
        for member in mess.get("mess_team") or []
    )
    if existing and request.user_id:
        log_denied(
            current_user, "ASSIGN_MESS_TEAM_DENIED", mess_id,
            reason="already_on_team",
            details={"team_user_id": request.user_id, "role": request.role},
        )
        raise HTTPException(status_code=409, detail="Team member already assigned to this mess")

    if not logging:
        # An unrecognised `role` produces a team member who cannot scan, and the
        # response still says "Team member assigned". The volunteer then stands at
        # a counter being refused with "Scanning disabled for you" and no
        # indication that the cause was a typo at assignment time, hours earlier.
        log_config.warning(
            _log,
            f"mess team member assigned with scanning off: role {request.role!r} is not a scanning role",
            {
                "mess_id": mess_id,
                "team_user_id": request.user_id,
                "role": request.role,
                "reason": "unrecognised_team_role",
            },
        )

    mess_collection.update_one({"mess_id": mess_id}, {"$push": {"mess_team": team_member}})

    log_audit(
        current_user,
        "ASSIGN_MESS_TEAM",
        mess_id,
        {
            "team_user_id": request.user_id,
            "role": request.role,
            "scanning_enabled": logging,
        },
    )
    return {"message": "Team member assigned"}

@router.put("/{mess_id}/team/{team_user_id}/toggle_scan")
def toggle_mess_scan(mess_id: str, team_user_id: str, logging: bool, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "toggle_scan")

    # A mistyped hall or team id matches nothing, and the route used to answer
    # "Scanning toggled" regardless, recording the miss only as `applied: false`
    # inside the success row. An admin who believed they had just re-enabled a
    # volunteer had changed nothing, and would not find out until that volunteer
    # was refused at the counter.
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess:
        log_denied(
            current_user, "TOGGLE_MESS_SCAN_DENIED", mess_id,
            reason="mess_not_found",
            details={"team_user_id": team_user_id, "requested_state": logging,
                     "status": 404},
        )
        raise HTTPException(status_code=404, detail="Mess not found")

    result = mess_collection.update_one(
        {"mess_id": mess_id, "mess_team.user_id": team_user_id},
        {"$set": {"mess_team.$.logging": logging}}
    )

    if result.matched_count == 0:
        log_denied(
            current_user, "TOGGLE_MESS_SCAN_DENIED", mess_id,
            reason="team_member_not_found",
            details={"team_user_id": team_user_id, "requested_state": logging,
                     "status": 404},
        )
        raise HTTPException(status_code=404, detail="user_id is not on this mess's team")

    # This had no audit row, which made it the natural blind spot behind "the
    # scanner stopped working": a volunteer's scanning privilege could be revoked
    # and there was nothing to show it had happened, or who did it. The refusal
    # they then hit at the counter (`Scanning disabled for you`) is now traceable
    # back to this row.
    log_audit(
        current_user,
        "TOGGLE_MESS_SCAN",
        mess_id,
        {
            "team_user_id": team_user_id,
            "scanning_enabled": logging,
        },
    )
    return {"message": "Scanning toggled"}

@router.post("/allocate")
def allocate_messes(current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "allocate")

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

    # Collected so the batch summary can report why each unplaced participant was
    # unplaced, rather than only how many were placed.
    skipped_by_reason: Dict[str, int] = {}
    placements: List[dict] = []

    log_config.info(
        _log,
        f"mess allocation starting for {len(participants)} candidate(s)",
        {
            "candidates": len(participants),
            "halls": len(messes),
            "diets_available": sorted(pref_groups.keys()),
            "seats_free": sum(max(m.get("capacity", 0) - seated[m["_id"]], 0) for m in messes),
        },
    )

    for p in participants:
        # `.get(key, default)` does not fire when the key exists holding None, and
        # a profile that never chose a preference stores exactly that. Treating
        # both the missing and the null case as the default is what stops a
        # genuine registrant being skipped silently on every run.
        #
        # `profile.mess_preference` may now hold either a bare diet ("veg") —
        # written before combined values existed, or by any caller that still
        # sends one — or a combined "{cuisine}__{diet}" value like
        # "north_indian__veg". `_diet_of` collapses either shape down to the
        # bare diet `pref_groups` is keyed by, so both are placed correctly.
        raw_pref = (p.get("profile") or {}).get("mess_preference") or "veg"
        pref = _diet_of(raw_pref)
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
                placements.append(
                    {"participant_id": p.get("participant_id"), "mess_id": chosen_mess.get("mess_id"), "diet": pref}
                )
                break

        if not assigned:
            # `assigned` was already being computed here and then never read — the
            # branch it was clearly meant to drive did not exist. This is it.
            #
            # Two distinct failures reach this point and they need completely
            # different responses. `no_hall_for_diet` means the fest has nowhere
            # that serves what this student eats, and no amount of re-running
            # allocation will place them; somebody has to open a hall or change
            # their preference. `capacity_exhausted` means the halls exist but are
            # full, which is a capacity decision. Reported per participant, because
            # "23 people were not placed" is not something anybody can act on.
            reason = "no_hall_for_diet" if not available_messes else "capacity_exhausted"
            skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + 1
            log_denied(
                current_user,
                "MESS_ALLOCATION_SKIPPED",
                p.get("participant_id"),
                reason=reason,
                details={
                    "diet": pref,
                    "raw_preference": raw_pref,
                    "halls_for_diet": [m.get("mess_id") for m in available_messes],
                    "diets_available": sorted(pref_groups.keys()),
                },
            )

    unplaceable = sum(skipped_by_reason.values())
    log_batch(
        current_user,
        "ALLOCATE_MESSES",
        None,
        {
            # Unchanged, and still the first field: existing readers and the
            # dashboard key off it.
            "allocated_count": allocated,
            # The complement, which is the half that was missing. A run that placed
            # 7 of 30 and a run that placed 7 of 7 reported the same number before.
            "candidates": len(participants),
            "skipped_count": unplaceable,
            "skipped_by_reason": skipped_by_reason,
            "seats_remaining": {
                m.get("mess_id"): max(m.get("capacity", 0) - seated[m["_id"]], 0) for m in messes
            },
        },
    )
    if unplaceable:
        log_config.warning(
            _log,
            f"mess allocation left {unplaceable} of {len(participants)} candidate(s) unplaced",
            {
                "allocated": allocated,
                "skipped": unplaceable,
                "skipped_by_reason": skipped_by_reason,
                "reason": "incomplete_allocation",
            },
        )
    return {"message": f"Allocated {allocated} participants to messes"}

@router.post("/pay")
def pay_mess_fee(request: MockPaymentRequest, current_user: dict = Depends(get_current_participant)):
    """
    Simulate settling the mess fee.

    Mock end to end: there is no real gateway behind this, `simulate_payment`
    always succeeds today, and `MESS_FEE` is the only amount this can ever
    charge — never one the client supplies. Deliberately independent of
    `mess.registered` / `mess.mess_id`: this only records that the fee was
    paid, it does not opt a participant into allocation or place them in a
    hall, so it can be called in any order relative to those.
    """
    if "participant_id" not in current_user:
        log_denied(
            current_user, "MESS_PAYMENT_DENIED", None,
            reason="not_a_participant", details={"status": 400}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Only participants can pay the mess fee")

    existing = (current_user.get("mess") or {}).get("payment")
    payment = simulate_payment("mess", MESS_FEE, request.method, purpose_actor=current_user)

    if existing:
        # The route is not idempotent: this write replaces the stored payment
        # outright, so the previous transaction id ceases to exist anywhere on the
        # document. If a participant is ever charged twice, the earlier
        # transaction survives only in this line and in its own audit row — which
        # is precisely the evidence a refund conversation needs.
        log_config.warning(
            _log,
            "mess payment overwrote an existing payment record",
            {
                "participant_id": current_user.get("participant_id"),
                "reason": "payment_overwritten",
                "previous_transaction_id": existing.get("transaction_id"),
                "previous_amount": existing.get("amount"),
                "previous_paid_at": existing.get("paid_at"),
                "new_transaction_id": payment["transaction_id"],
            },
        )

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"mess.payment": payment}}
    )
    # `target_id` was None, so the row named neither the payer nor the hall. The
    # participant id goes in it now — the actor is the same person, but a payment
    # is about an account, and every other row in the trail can be filtered by the
    # entity it concerns.
    log_audit(current_user, "MESS_PAYMENT", current_user.get("participant_id"), {
        "transaction_id": payment["transaction_id"], "amount": payment["amount"],
        "method": payment.get("method"),
        "replaced_transaction_id": (existing or {}).get("transaction_id"),
        "registered_for_mess": bool((current_user.get("mess") or {}).get("registered")),
    })
    return payment


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

def _assert_mess_scan_window(
    slot_doc: dict,
    mess_id: Optional[str] = None,
    day: Optional[int] = None,
    slot: Optional[str] = None,
    actor: Optional[dict] = None,
) -> None:
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
        #
        # But "defensive only" is exactly the assumption worth recording, because
        # when it is wrong this `return` disables the window guard entirely and
        # says nothing: the hall accepts scans at any hour of any day, and the
        # only externally visible symptom is meals being served outside their
        # sitting. A seeded or hand-edited menu is enough to reach it.
        log_integrity(
            "mess scan window guard skipped: slot times are not datetimes",
            reason="mess_window_guard_disabled",
            details={
                "mess_id": mess_id,
                "day": day,
                "slot": slot,
                "start_type": type(start).__name__,
                "end_type": type(end).__name__,
                "guard": "open",
            },
        )
        return

    now = datetime.utcnow()
    opens_at = _naive_utc(start) - SCAN_WINDOW
    closes_at = _naive_utc(end) + SCAN_WINDOW

    if now < opens_at:
        # The minutes-until figure is what makes this actionable at the counter:
        # "not yet open" plus "in 4 minutes" is a queue that should wait, while
        # "in 380 minutes" is a volunteer scanning for the wrong sitting entirely.
        log_denied(
            actor,
            "MESS_SCAN_DENIED",
            mess_id,
            reason="window_not_open",
            details={
                "day": day,
                "slot": slot,
                "opens_in_minutes": int((opens_at - now).total_seconds() // 60),
                "opens_at": opens_at,
                "scan_domain": "mess",
            },
        )
        raise HTTPException(status_code=403, detail="Scanning window not yet open for this slot")
    if now > closes_at:
        log_denied(
            actor,
            "MESS_SCAN_DENIED",
            mess_id,
            reason="window_closed",
            details={
                "day": day,
                "slot": slot,
                "closed_minutes_ago": int((now - closes_at).total_seconds() // 60),
                "closed_at": closes_at,
                "scan_domain": "mess",
            },
        )
        raise HTTPException(status_code=403, detail="Scanning window closed for this slot")

@router.post("/{mess_id}/scan")
def scan_mess(mess_id: str, request: ScanQRRequest, slot: str, day: int, current_user: dict = Depends(get_current_staff)):
    """
    Admit one participant to one sitting.

    Every refusal below is recorded with a reason. This is the endpoint a
    participant is most likely to come back and dispute — "I was turned away from
    dinner on day 2" — and before this the only trace a refusal left was a 400 on
    a handheld device. Successful scans keep their original `MESS_SCAN` audit row
    and its exact `details` keys, because `GET /audit-logs/summary` counts meals
    from them.
    """
    if slot not in MEAL_SLOTS:
        # Not audited: a bad `slot` is a client bug, not an operational event, and
        # it cannot be attributed to any particular sitting.
        log_denied(
            current_user, "MESS_SCAN_DENIED", mess_id,
            reason="invalid_slot", details={"slot": slot, "day": day}, audit=False,
        )
        raise HTTPException(status_code=400, detail=f"slot must be one of {MEAL_SLOTS}")
    if day < 1:
        log_denied(
            current_user, "MESS_SCAN_DENIED", mess_id,
            reason="invalid_day", details={"slot": slot, "day": day}, audit=False,
        )
        raise HTTPException(status_code=400, detail="day must be a positive integer")

    user_id = current_user.get("paradox_id")
    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess:
        log_denied(
            current_user, "MESS_SCAN_DENIED", mess_id,
            reason="mess_not_found", details={"slot": slot, "day": day},
        )
        raise HTTPException(status_code=404, detail="Mess not found")
    
    team_member = next((m for m in mess.get("mess_team", []) if m.get("user_id") == user_id), None)
    
    if not team_member:
        # Somebody is holding a scanner for a hall they are not on the team of.
        # Usually a volunteer sent to the wrong counter; occasionally a volunteer
        # whose team entry was never created. The team size distinguishes the two.
        log_denied(
            current_user, "MESS_SCAN_DENIED", mess_id,
            reason="not_on_mess_team",
            details={"slot": slot, "day": day, "team_size": len(mess.get("mess_team") or [])},
        )
        raise HTTPException(status_code=403, detail="Not authorized to scan for this mess")
        
    if not team_member.get("logging"):
        # Pairs with the `TOGGLE_MESS_SCAN` row: this is the counter-side symptom
        # of a privilege that was switched off, and the two are now joinable.
        log_denied(
            current_user, "MESS_SCAN_DENIED", mess_id,
            reason="scanning_disabled_for_member",
            details={"slot": slot, "day": day, "member_role": team_member.get("role")},
        )
        raise HTTPException(status_code=403, detail="Scanning disabled for you")

    day_key = f"day_{day}"
    slot_doc = (mess.get("menu") or {}).get(day_key, {}).get(slot)
    if not slot_doc:
        # Reads as a scanner fault to the volunteer, but the cause is upstream: the
        # menu has no such sitting, often because a menu update replaced it. The
        # days actually on the menu are recorded so the mismatch is obvious.
        log_denied(
            current_user, "MESS_SCAN_DENIED", mess_id,
            reason="slot_not_on_menu",
            details={
                "slot": slot,
                "day": day,
                "menu_days": sorted((mess.get("menu") or {}).keys(), key=_day_sort_key),
            },
        )
        raise HTTPException(status_code=400, detail=f"No {slot} scheduled for day {day}")

    # QR scanning only works from 15 minutes before the slot's start time to
    # 15 minutes after it ends.
    _assert_mess_scan_window(slot_doc, mess_id=mess_id, day=day, slot=slot, actor=current_user)

    target_user, _ = verify_qr(request, actor=current_user, domain="mess", target_id=mess_id)
    
    user_mess = target_user.get("mess", {})
    if user_mess.get("mess_id") != mess["_id"]:
        # Both halls are named — the one they were sent to and the one they belong
        # to — because that is what the volunteer needs in order to redirect the
        # student, and what later distinguishes a misdirected participant from an
        # allocation that never ran.
        log_scan(
            current_user, "mess", "MESS_SCAN_DENIED", OUTCOME_DENIED,
            participant_id=target_user.get("participant_id"),
            target_id=mess_id,
            reason="not_allotted_to_this_mess",
            details={
                "slot": slot,
                "day": day,
                "allotted_mess_oid": str(user_mess.get("mess_id")) if user_mess.get("mess_id") else None,
                "registered_for_mess": bool(user_mess.get("registered")),
            },
        )
        raise HTTPException(status_code=400, detail="Participant not allotted to this mess")

    scans = user_mess.get("scans") or {}
    day_scans = scans.get(day_key) or {}

    if day_scans.get(slot, {}).get("scanned"):
        # The original scan's timestamp is the whole point of this line: it settles
        # whether this is a double-swipe seconds apart at a busy counter, or a
        # genuine second attempt hours later by someone claiming they were never
        # served.
        log_scan(
            current_user, "mess", "MESS_SCAN_DENIED", OUTCOME_DENIED,
            participant_id=target_user.get("participant_id"),
            target_id=mess_id,
            reason="already_scanned",
            details={
                "slot": slot,
                "day": day,
                "first_scanned_at": day_scans.get(slot, {}).get("scanned_at"),
            },
        )
        raise HTTPException(status_code=400, detail=f"Already logged in for {slot} on day {day}")

    day_scans[slot] = {"scanned": True, "scanned_at": datetime.utcnow()}
    scans[day_key] = day_scans

    # This writes the participant's entire `mess.scans` map back from the copy read
    # at the top of the request, so a concurrent scan of the same person at another
    # counter can be overwritten between the read and this write. The set of slots
    # being written is recorded so a marker that later turns out to be missing can
    # be traced to the request that flattened it.
    result = participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": {"mess.scans": scans}}
    )
    if result.modified_count == 0:
        log_integrity(
            "mess scan marker was not stored",
            reason="scan_write_not_applied",
            details={
                "participant_id": target_user.get("participant_id"),
                "mess_id": mess_id,
                "day": day,
                "slot": slot,
                "matched": result.matched_count,
            },
        )

    log_scan(
        current_user, "mess", "MESS_SCAN", OUTCOME_ALLOWED,
        participant_id=target_user.get("participant_id"),
        target_id=mess_id,
        # `slot` and `day` keep their exact original names and types: the meal
        # figures in `GET /audit-logs/summary` de-duplicate on
        # `details.participant_id` / `day` / `slot`, so renaming or reshaping any of
        # the three would silently change every meal count on the dashboard.
        details={"slot": slot, "day": day, "written_slots": sorted(day_scans.keys())},
    )
    return {"message": "Scan successful, entry allowed"}

@router.get("/{mess_id}/statistics")
def mess_statistics(mess_id: str, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "statistics")

    mess = mess_collection.find_one({"mess_id": mess_id})
    if not mess:
        log_denied(
            current_user, "READ_MESS_ROSTER_DENIED", mess_id,
            reason="mess_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Mess not found")
    
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
        
    # This response is a roster with names, emails, and phone numbers on it, so who
    # read it is worth recording alongside who changed it.
    log_audit(
        current_user,
        "READ_MESS_ROSTER",
        mess_id,
        {"returned": len(participants), "capacity": mess.get("capacity")},
    )

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
