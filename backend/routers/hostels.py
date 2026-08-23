from fastapi import APIRouter, HTTPException, Depends
from logger import (
    OUTCOME_ALLOWED, OUTCOME_DENIED,
    log_audit, log_batch, log_denied, log_integrity, log_scan,
)
from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

import log_config
from database import hostel_collection, participants_collection, backend_teams_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from models import ScanQRRequest, MockPaymentRequest
from id_generator import SequentialIDGenerator, generate_room_numbers
from payments import simulate_payment

generator = SequentialIDGenerator("HSTL")

router = APIRouter(prefix="/hostels", tags=["Hostels"])

_log = log_config.get_logger("paradox.hostels")


def _require_super_admin(current_user: dict, operation: str) -> str:
    """The Super Admin gate shared by this router's administrative routes."""
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_super_admin",
            details={"operation": operation, "resource": "hostels", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Not authorized")
    return user_id

# The fixed hostel fee charged by the mock payment endpoint below. Never
# accepted from the client — see `MockPaymentRequest`.
HOSTEL_FEE = 900

# The only genders a block may be created for. Allocation groups participants
# by this exact axis (`allocate_hostels` below), so anything outside this pair
# would be a block nobody's profile.gender could ever match.
GENDERS = {"male", "female"}

# The two roles a hostel_team member may hold. Both can scan (subject to their
# own `attendance` flag) — `hostel_volunteer` additionally handles on-ground
# issues raised against the block, `guard` is scanning-only. The second role's
# exact name is still provisional and may be renamed later; the set itself is
# what is enforced.
HOSTEL_ROLES = {"hostel_volunteer", "guard"}


class HostelCreateRequest(BaseModel):
    name: str
    capacity: int = Field(..., gt=0)
    gender: str  # male | female — drives random allocation grouping
    sharing: int = Field(..., gt=0, description="Max occupants per room")
    num_rooms: int = Field(..., gt=0, description="Number of rooms to pre-generate")

    @field_validator("gender")
    @classmethod
    def _valid_gender(cls, v):
        v = v.strip().lower()
        if v not in GENDERS:
            raise ValueError(f"gender must be one of {sorted(GENDERS)}")
        return v

    @model_validator(mode="after")
    def _rooms_cover_capacity(self):
        if self.num_rooms * self.sharing < self.capacity:
            raise ValueError(
                f"num_rooms ({self.num_rooms}) * sharing ({self.sharing}) must be >= capacity ({self.capacity})"
            )
        return self


class HostelUpdateRequest(BaseModel):
    """
    Every field optional: a caller updates only what it names. Mirrors
    `mess.MessUpdateRequest`'s shape and the same reasoning: `PATCH`-like
    semantics on top of a `PUT`, because the two admin dashboards this backs
    (mess halls, hostel blocks) always edit one field of a body at a time.

    `gender` and the rooming fields (`sharing`, `num_rooms`) are deliberately
    absent — the same restriction `HostelCreateRequest`'s own doc comment
    already states for `gender` ("cannot be changed afterwards by any route in
    this file"), extended to rooming for the same reason: `rooms` holds live
    `occupants` arrays keyed by room index, and neither growing nor shrinking
    that array can be done as a same-shaped `$set` the way `name`/`capacity`
    can — it needs a real migration of who is assigned where, which is exactly
    the "an organiser's decision, not a seed script's" judgement `seed.py`
    already makes about hostel drift in general. Only the two fields with no
    such structural entanglement are editable here.
    """
    name: Optional[str] = None
    capacity: Optional[int] = Field(None, gt=0)


class HostelAssignTeamRequest(BaseModel):
    user_id: str  # must reference an existing backend_teams member with role "other"
    role: str  # hostel_volunteer | guard
    attendance: bool = True  # whether this member may scan entries/exits

    @field_validator("role")
    @classmethod
    def _valid_role(cls, v):
        v = v.strip().lower()
        if v not in HOSTEL_ROLES:
            raise ValueError(f"role must be one of {sorted(HOSTEL_ROLES)}")
        return v


@router.post("")
def create_hostel(request: HostelCreateRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "create")

    hostel_id = generator.next_id()

    # The id generator is an in-memory counter that restarts from its seed on every
    # process restart and never consults the database, so a restarted process
    # re-issues ids it has already handed out. There is no unique index behind
    # `hostel_id`, so a collision would silently produce two blocks sharing one id
    # — and every participant allotted to "that" block would resolve to whichever
    # document Mongo returned first. Detected here rather than left to be
    # discovered from the symptom.
    if hostel_collection.find_one({"hostel_id": hostel_id}):
        log_integrity(
            "generated hostel_id already exists — the in-memory counter has wrapped after a restart",
            reason="hostel_id_collision",
            details={"hostel_id": hostel_id, "generator_prefix": "HSTL"},
            actor=current_user,
            action="ID_COLLISION",
            target_id=hostel_id,
            audit=True,
        )
    rooms = [{"room_number": rn, "occupants": []} for rn in generate_room_numbers(request.num_rooms)]

    hostel_doc = {
        "hostel_id": hostel_id,
        "name": request.name,
        "capacity": request.capacity,
        "gender": request.gender,
        "sharing": request.sharing,
        # Total ever allocated. Only ever incremented by `/allocate` — a
        # participant leaving (even permanently) does not free their seat, so
        # this is a lifetime count, not a live "currently inside" figure (see
        # `hostel_statistics.currently_inside` for that).
        "current_occupancy": 0,
        "rooms": rooms,
        "hostel_team": [],
        "created_at": datetime.utcnow()
    }
    hostel_collection.insert_one(hostel_doc)
    log_audit(current_user, "CREATE_HOSTEL", hostel_id, {
        "capacity": request.capacity, "sharing": request.sharing, "num_rooms": request.num_rooms,
        # `gender` decides which participants allocation will ever consider for this
        # block, and it cannot be changed afterwards by any route in this file, so
        # this row is the only record of that decision.
        "gender": request.gender,
        "name": request.name,
        "beds": request.num_rooms * request.sharing,
    })
    return {"message": "Hostel created", "hostel_id": hostel_id}

@router.put("/{hostel_id}")
def update_hostel(
    hostel_id: str, request: HostelUpdateRequest, current_user: dict = Depends(get_current_staff)
):
    """
    Edit a block's `name` or `capacity`, Super Admin only.

    Mirrors `mess.update_mess`: every field optional, nothing to update is a
    400, and a `capacity` cut below the block's real bed ceiling
    (`min(capacity, sharing * num_rooms)`, the same ceiling `allocate_hostels`
    enforces) is logged rather than refused — the residents already assigned
    keep their beds, and allocation simply stops placing anyone new here until
    capacity is raised again or beds free up. Rooming (`sharing`/`num_rooms`)
    and `gender` are not editable through this route; see
    `HostelUpdateRequest`.
    """
    _require_super_admin(current_user, "update")

    existing = hostel_collection.find_one({"hostel_id": hostel_id})
    if not existing:
        log_denied(
            current_user, "UPDATE_HOSTEL_DENIED", hostel_id,
            reason="hostel_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Hostel not found")

    update_data = {k: v for k, v in request.model_dump(exclude_unset=True).items() if v is not None}
    if not update_data:
        log_denied(
            current_user, "UPDATE_HOSTEL_DENIED", hostel_id,
            reason="nothing_to_update", details={"status": 400}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Nothing to update")

    beds = existing.get("sharing", 1) * len(existing.get("rooms") or [])
    real_ceiling = min(existing.get("capacity", 0), beds)
    if "capacity" in update_data and update_data["capacity"] < real_ceiling:
        log_config.warning(
            _log,
            "hostel capacity reduced below the block's real bed ceiling",
            {
                "hostel_id": hostel_id,
                "reason": "capacity_below_occupancy",
                "new_capacity": update_data["capacity"],
                "previous_capacity": existing.get("capacity"),
                "current_occupancy": existing.get("current_occupancy"),
                "beds": beds,
            },
        )

    update_data["updated_at"] = datetime.utcnow()
    hostel_collection.update_one({"hostel_id": hostel_id}, {"$set": update_data})
    log_audit(
        current_user,
        "UPDATE_HOSTEL",
        hostel_id,
        {
            **update_data,
            "previous_name": existing.get("name") if "name" in update_data else None,
            "previous_capacity": existing.get("capacity") if "capacity" in update_data else None,
            "current_occupancy": existing.get("current_occupancy"),
        },
    )
    return {"message": "Hostel updated"}


@router.get("")
def list_hostels(current_user: dict = Depends(get_current_user)):
    return list(hostel_collection.find({}, {"_id": 0}))

@router.post("/{hostel_id}/team")
def assign_hostel_team(hostel_id: str, request: HostelAssignTeamRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "assign_team")

    if not hostel_collection.find_one({"hostel_id": hostel_id}):
        log_denied(
            current_user, "ASSIGN_HOSTEL_TEAM_DENIED", hostel_id,
            reason="hostel_not_found",
            details={"team_user_id": request.user_id, "status": 404},
        )
        raise HTTPException(status_code=404, detail="Hostel not found")

    # `user_id` must be a real backend_teams member, and specifically one
    # created with role "other" — the bucket hostel_volunteer/guard staff are
    # created under (see backend_teams.py). This stops a super_admin's own
    # paradox_id, or an admin from another department, being added as a block's
    # duty staff by mistake.
    staff = backend_teams_collection.find_one({"paradox_id": request.user_id, "role": "other"})
    if not staff:
        # The message says what is required but not what was found, and the two
        # failures behind it are different: no such staff account at all, versus an
        # account that exists with a role other than `other`. The second is the
        # confusing one — an admin trying to put a `volunteer` on a hostel door.
        actual = backend_teams_collection.find_one({"paradox_id": request.user_id})
        log_denied(
            current_user, "ASSIGN_HOSTEL_TEAM_DENIED", hostel_id,
            reason="staff_role_not_other" if actual else "staff_not_found",
            details={
                "team_user_id": request.user_id,
                "requested_role": request.role,
                "actual_staff_role": (actual or {}).get("role"),
            },
        )
        raise HTTPException(
            status_code=404,
            detail="user_id must reference an existing backend_teams member with role 'other'"
        )

    existing = hostel_collection.find_one({"hostel_id": hostel_id, "hostel_team.user_id": request.user_id})
    if existing:
        log_denied(
            current_user, "ASSIGN_HOSTEL_TEAM_DENIED", hostel_id,
            reason="already_on_team",
            details={"team_user_id": request.user_id, "role": request.role},
        )
        raise HTTPException(status_code=409, detail="Team member already assigned to this hostel")

    team_member = {
        "user_id": request.user_id,
        "role": request.role,
        "attendance": request.attendance
    }
    hostel_collection.update_one({"hostel_id": hostel_id}, {"$push": {"hostel_team": team_member}})
    log_audit(current_user, "ASSIGN_HOSTEL_TEAM", hostel_id, {
        "team_user_id": request.user_id, "role": request.role,
        # Whether this member can actually scan on arrival. A guard assigned with
        # `attendance=False` is on the roster and refused at the door, which looks
        # identical to a broken scanner from where they are standing.
        "scanning_enabled": request.attendance,
    })
    if not request.attendance:
        log_config.warning(
            _log,
            "hostel team member assigned with scanning disabled",
            {
                "hostel_id": hostel_id,
                "team_user_id": request.user_id,
                "role": request.role,
                "reason": "assigned_without_scanning",
            },
        )
    return {"message": "Team member assigned"}

@router.put("/{hostel_id}/team/{team_user_id}/toggle_scan")
def toggle_hostel_scan(hostel_id: str, team_user_id: str, attendance: bool, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "toggle_scan")

    # A filter matching nothing is a 404, as in the mess counterpart. It used to
    # answer "Scanning toggled" and record the miss only as `applied: false`, so a
    # warden who believed they had re-enabled a guard had changed nothing.
    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel:
        log_denied(
            current_user, "TOGGLE_HOSTEL_SCAN_DENIED", hostel_id,
            reason="hostel_not_found",
            details={"team_user_id": team_user_id, "requested_state": attendance,
                     "status": 404},
        )
        raise HTTPException(status_code=404, detail="Hostel not found")

    result = hostel_collection.update_one(
        {"hostel_id": hostel_id, "hostel_team.user_id": team_user_id},
        {"$set": {"hostel_team.$.attendance": attendance}}
    )

    if result.matched_count == 0:
        log_denied(
            current_user, "TOGGLE_HOSTEL_SCAN_DENIED", hostel_id,
            reason="team_member_not_found",
            details={"team_user_id": team_user_id, "requested_state": attendance,
                     "status": 404},
        )
        raise HTTPException(status_code=404, detail="user_id is not on this hostel's team")

    # Previously unaudited, like its mess counterpart. Revoking a guard's scanning
    # at a hostel door is the difference between residents getting in and not, so
    # it belongs in the durable trail.
    log_audit(current_user, "TOGGLE_HOSTEL_SCAN", hostel_id, {
        "team_user_id": team_user_id,
        "scanning_enabled": attendance,
    })
    return {"message": "Scanning toggled"}

@router.post("/allocate")
def allocate_hostels(current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "allocate")

    hostels = list(hostel_collection.find({"gender": {"$in": sorted(GENDERS)}}))
    gender_groups = {}
    for h in hostels:
        gender_groups.setdefault(h.get("gender"), []).append(h)

    # An equality match against null also matches a document where the field is
    # absent — that is Mongo's rule, not a quirk of this collection — so this one
    # clause finds both the participant who has never been placed and the one whose
    # `accommodation` sub-document predates the key. `mess.py` spells the same
    # thing out as `$or [None, $exists: false]`, which is equivalent and redundant.
    #
    # This used to carry a comment claiming the opposite, along with a count of the
    # supposedly invisible candidates and a WARNING naming them as unplaceable —
    # `excluded_by_null_filter`. They were never excluded: they are in this very
    # result set, they get placed, and they were then counted a second time in
    # `allocated_count`. So the figure contradicted the one beside it and the
    # warning sent operators looking for a data problem that did not exist.
    participants = list(participants_collection.find({
        "accommodation.registered": True,
        "accommodation.hostel_id": None
    }))
    allocated = 0

    skipped_by_reason: Dict[str, int] = {}
    log_config.info(
        _log,
        f"hostel allocation starting for {len(participants)} candidate(s)",
        {
            "candidates": len(participants),
            "blocks": len(hostels),
            "genders_available": sorted(gender_groups.keys()),
            "beds_free": sum(
                max(h.get("sharing", 1) * len(h.get("rooms") or []) - h.get("current_occupancy", 0), 0)
                for h in hostels
            ),
        },
    )

    for p in participants:
        gender = (p.get("profile", {}).get("gender") or "").lower()
        available_hostels = gender_groups.get(gender, [])
        # Tracked per participant. The existing `placed` is scoped inside the hostel
        # loop below, so after the loops there was no per-participant signal at all
        # and an unplaced student left no trace.
        seated_somewhere = False
        for h in available_hostels:
            # `capacity` is a real ceiling, not decoration.
            #
            # This loop only ever consulted the room maths (`sharing` per room), so a
            # block created with capacity 2, sharing 2 and three rooms accepted six
            # residents — and `hostel_statistics` then reported `current_occupancy`
            # above `capacity`, a figure that cannot be true. `_rooms_cover_capacity`
            # on the create request only checks that the rooms can *hold* the stated
            # capacity; it permits more beds than that, which is where the excess came
            # from.
            #
            # Both bounds now apply, and the tighter one wins.
            beds = h.get("sharing", 1) * len(h.get("rooms") or [])
            ceiling = min(h.get("capacity", 0), beds)
            if h.get("current_occupancy", 0) >= ceiling:
                continue

            placed = False
            for room_index, room in enumerate(h.get("rooms", [])):
                if len(room.get("occupants", [])) < h.get("sharing", 1):
                    participant_id = p.get("participant_id")

                    # Updated by array index rather than the `$` positional
                    # operator: mongomock (used under TESTING=1) does not
                    # reliably resolve `$` when the filter combines a
                    # top-level field with an array-element match, and the
                    # index is already known here from `enumerate`.
                    hostel_collection.update_one(
                        {"hostel_id": h["hostel_id"]},
                        {
                            "$push": {f"rooms.{room_index}.occupants": participant_id},
                            "$inc": {"current_occupancy": 1}
                        }
                    )
                    # Keep the in-memory copy in sync so the next participant in
                    # this same loop sees this room as filled without re-reading
                    # the hostel document on every iteration. `current_occupancy`
                    # is synced for the same reason: the capacity ceiling above
                    # reads it, and a stale value would let the sweep overshoot.
                    room["occupants"].append(participant_id)
                    h["current_occupancy"] = h.get("current_occupancy", 0) + 1

                    participants_collection.update_one(
                        {"_id": p["_id"]},
                        {"$set": {
                            "accommodation.hostel_id": h["hostel_id"],
                            "accommodation.room": room["room_number"],
                            "accommodation.registered": True
                        }}
                    )
                    allocated += 1
                    placed = True
                    seated_somewhere = True
                    log_config.debug(
                        _log,
                        "hostel bed assigned",
                        {
                            "participant_id": participant_id,
                            "hostel_id": h["hostel_id"],
                            "room": room["room_number"],
                            "gender": gender,
                        },
                    )
                    break
            if placed:
                break

        if not seated_somewhere:
            # Three distinct causes, and they need different fixes. An unrecognised
            # or missing `profile.gender` means the participant can never be placed
            # until their profile is corrected — and a blank one silently matched no
            # group at all, which was the most invisible of the three. No block for
            # a recognised gender is an organisational gap. Exhausted capacity is a
            # capacity decision.
            if not gender:
                reason = "missing_gender"
            elif not available_hostels:
                reason = "no_block_for_gender"
            else:
                reason = "capacity_exhausted"
            skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + 1
            log_denied(
                current_user,
                "HOSTEL_ALLOCATION_SKIPPED",
                p.get("participant_id"),
                reason=reason,
                details={
                    "gender": gender or None,
                    "blocks_for_gender": [h.get("hostel_id") for h in available_hostels],
                    "genders_available": sorted(gender_groups.keys()),
                },
            )

    unplaceable = sum(skipped_by_reason.values())
    log_batch(
        current_user,
        "ALLOCATE_HOSTELS",
        None,
        {
            "allocated_count": allocated,
            "candidates": len(participants),
            "skipped_count": unplaceable,
            "skipped_by_reason": skipped_by_reason,
            # Places still fillable *after* this sweep, against the same ceiling the
            # sweep itself enforced — `min(capacity, sharing × rooms)`.
            #
            # It used to be computed from the room maths alone and from the occupancy
            # read *before* the loop ran, so it counted beds this very run had just
            # filled: a two-bed block that had taken one resident reported two free.
            # The in-memory `current_occupancy` is now kept in step as each bed is
            # assigned, which is what makes this figure current.
            "beds_remaining": {
                h.get("hostel_id"): max(
                    min(h.get("capacity", 0), h.get("sharing", 1) * len(h.get("rooms") or []))
                    - h.get("current_occupancy", 0),
                    0,
                )
                for h in hostels
            },
        },
    )
    if unplaceable:
        log_config.warning(
            _log,
            f"hostel allocation left {unplaceable} of {len(participants)} candidate(s) unplaced",
            {
                "allocated": allocated,
                "skipped": unplaceable,
                "skipped_by_reason": skipped_by_reason,
                "reason": "incomplete_allocation",
            },
        )
    return {"message": f"Allocated {allocated} participants to hostels"}

@router.post("/pay")
def pay_hostel_fee(request: MockPaymentRequest, current_user: dict = Depends(get_current_participant)):
    """
    Simulate settling the hostel fee.

    Mock end to end: there is no real gateway behind this, `simulate_payment`
    always succeeds today, and `HOSTEL_FEE` is the only amount this can ever
    charge — never one the client supplies. Deliberately independent of
    `accommodation.registered` / `accommodation.hostel_id`: this only records
    that the fee was paid, it does not opt a participant into allocation or
    place them in a block, so it can be called in any order relative to those.
    """
    if "participant_id" not in current_user:
        log_denied(
            current_user, "HOSTEL_PAYMENT_DENIED", None,
            reason="not_a_participant", details={"status": 400}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Only participants can pay the hostel fee")

    existing = (current_user.get("accommodation") or {}).get("payment")
    payment = simulate_payment("hostel", HOSTEL_FEE, request.method, purpose_actor=current_user)

    if existing:
        # Same non-idempotency as the mess fee: the prior transaction id is about to
        # be overwritten and this line is the only place it survives.
        log_config.warning(
            _log,
            "hostel payment overwrote an existing payment record",
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
        {"$set": {"accommodation.payment": payment}}
    )
    log_audit(current_user, "HOSTEL_PAYMENT", current_user.get("participant_id"), {
        "transaction_id": payment["transaction_id"], "amount": payment["amount"],
        "method": payment.get("method"),
        "replaced_transaction_id": (existing or {}).get("transaction_id"),
        "registered_for_accommodation": bool((current_user.get("accommodation") or {}).get("registered")),
    })
    return payment


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
        log_denied(
            current_user, "ACCOMMODATION_REGISTER_DENIED",
            current_user.get("participant_id"),
            reason="already_allotted",
            details={"hostel_id": current_user.get("accommodation", {}).get("hostel_id")},
        )
        raise HTTPException(status_code=400, detail="Accommodation already allotted")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"accommodation.registered": True}}
    )
    # `target_id` was None. The participant id goes in it, so a person's
    # accommodation history — requested, cancelled, allotted, scanned in — reads as
    # one filterable sequence. Whether their profile carries a usable gender is
    # recorded here because that is what decides, minutes or days later, whether
    # allocation can place them at all.
    log_audit(current_user, "ACCOMMODATION_REGISTER", current_user.get("participant_id"), {
        "gender": ((current_user.get("profile") or {}).get("gender") or "").lower() or None,
        "already_paid": bool((current_user.get("accommodation") or {}).get("payment")),
    })
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
        log_denied(
            current_user, "ACCOMMODATION_CANCEL_DENIED",
            current_user.get("participant_id"),
            reason="already_allotted",
            details={"hostel_id": current_user.get("accommodation", {}).get("hostel_id")},
        )
        raise HTTPException(status_code=400, detail="Accommodation already allotted")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"accommodation.registered": False}}
    )
    log_audit(current_user, "ACCOMMODATION_CANCEL", current_user.get("participant_id"), {
        "was_registered": bool((current_user.get("accommodation") or {}).get("registered")),
    })
    return {"message": "Accommodation request withdrawn"}


@router.get("/my_hostel")
def my_hostel(current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants have assigned hostels")

    accommodation = current_user.get("accommodation", {}) or {}
    hostel_id = accommodation.get("hostel_id")
    hostel_details = hostel_collection.find_one({"hostel_id": hostel_id}, {"_id": 0}) if hostel_id else None

    # Volunteer contact details, resolved by joining hostel_team.user_id against
    # backend_teams (for name + email) and, where that staff member is also a
    # registered participant, against participants (for phone). hostel_team no
    # longer carries name/phone directly under the new schema.
    volunteers = []
    if hostel_details:
        team = hostel_details.get("hostel_team", [])
        staff_ids = [m.get("user_id") for m in team if m.get("user_id")]
        staff_docs = {}
        if staff_ids:
            staff_docs = {
                s["paradox_id"]: s
                for s in backend_teams_collection.find(
                    {"paradox_id": {"$in": staff_ids}},
                    {"_id": 0, "paradox_id": 1, "name": 1, "email": 1, "admin_id": 1}
                )
            }

        admin_ids = [s["admin_id"] for s in staff_docs.values() if s.get("admin_id")]
        phone_by_admin_id = {}
        if admin_ids:
            for participant in participants_collection.find(
                {"_id": {"$in": admin_ids}}, {"profile.phone": 1}
            ):
                phone_by_admin_id[participant["_id"]] = (participant.get("profile") or {}).get("phone")

        for member in team:
            staff = staff_docs.get(member.get("user_id"), {})
            admin_id = staff.get("admin_id")
            volunteers.append({
                "name": staff.get("name"),
                "email": staff.get("email"),
                "phone": phone_by_admin_id.get(admin_id) if admin_id else None,
                "role": member.get("role")
            })

    return {
        "assigned_hostel": hostel_id,
        "room": accommodation.get("room"),
        "inside": accommodation.get("inside", False),
        "arrival": accommodation.get("arrival"),
        "departure": accommodation.get("departure"),
        # Whether this participant has asked for accommodation at all. Without
        # it the UI cannot tell "never requested" from "requested, not yet
        # allocated" — two states that need very different things said to them.
        "registered": accommodation.get("registered", False),
        "volunteers": volunteers
    }

@router.post("/{hostel_id}/scan")
def scan_hostel(hostel_id: str, request: ScanQRRequest, action: str, current_user: dict = Depends(get_current_staff)):
    """
    Record one participant crossing a hostel door.

    The most safety-relevant endpoint in the system: `accommodation.inside` is what
    answers "who is in this building" if the building ever has to be evacuated, and
    `arrival` / `departure` are what answer "was this student ever here at all".

    Every refusal is now recorded with the state that caused it. Before this, a
    refused scan produced a 400 at the door and nothing else — so a resident
    insisting they had been let out, against a record saying they were still
    inside, was an argument with no evidence on either side. The state triple
    (`inside`, `arrival`, `departure`) goes into every line precisely so that
    argument becomes answerable.
    """
    # action: "entry" | "exit" | "permanent_exit"
    if action not in ("entry", "exit", "permanent_exit"):
        log_denied(
            current_user, "HOSTEL_SCAN_DENIED", hostel_id,
            reason="invalid_action", details={"action": action}, audit=False,
        )
        raise HTTPException(status_code=400, detail="Invalid action. Must be 'entry', 'exit', or 'permanent_exit'")

    user_id = current_user.get("paradox_id")
    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel:
        log_denied(
            current_user, "HOSTEL_SCAN_DENIED", hostel_id,
            reason="hostel_not_found", details={"action": action},
        )
        raise HTTPException(status_code=404, detail="Hostel not found")

    team_member = next((m for m in hostel.get("hostel_team", []) if m.get("user_id") == user_id), None)

    if not team_member:
        log_denied(
            current_user, "HOSTEL_SCAN_DENIED", hostel_id,
            reason="not_on_hostel_team",
            details={"action": action, "team_size": len(hostel.get("hostel_team") or [])},
        )
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")

    if not team_member.get("attendance"):
        # The door-side symptom of `TOGGLE_HOSTEL_SCAN`, now joinable to it.
        log_denied(
            current_user, "HOSTEL_SCAN_DENIED", hostel_id,
            reason="scanning_disabled_for_member",
            details={"action": action, "member_role": team_member.get("role")},
        )
        raise HTTPException(status_code=403, detail="Scanning disabled for you")

    target_user, _ = verify_qr(request, actor=current_user, domain="hostel", target_id=hostel_id)

    user_acc = target_user.get("accommodation", {}) or {}
    if user_acc.get("hostel_id") != hostel_id:
        log_scan(
            current_user, "hostel", "HOSTEL_SCAN_DENIED", OUTCOME_DENIED,
            participant_id=target_user.get("participant_id"),
            target_id=hostel_id,
            reason="not_allotted_to_this_hostel",
            details={
                "action": action,
                "allotted_hostel_id": user_acc.get("hostel_id"),
                "registered_for_accommodation": bool(user_acc.get("registered")),
            },
        )
        raise HTTPException(status_code=400, detail="Participant not allotted to this hostel")

    is_inside = user_acc.get("inside", False)
    has_departed = user_acc.get("departure") is not None
    now = datetime.utcnow()
    update_fields = {}

    # The state every line below reports, gathered once. This is what makes a
    # refusal reconstructable: not just "already inside", but since when, and
    # whether they had ever arrived or departed.
    state = {
        "action": action,
        "inside": is_inside,
        "arrival": user_acc.get("arrival"),
        "departure": user_acc.get("departure"),
        "room": user_acc.get("room"),
    }

    def refuse(reason: str, detail: str):
        log_scan(
            current_user, "hostel", "HOSTEL_SCAN_DENIED", OUTCOME_DENIED,
            participant_id=target_user.get("participant_id"),
            target_id=hostel_id,
            reason=reason,
            details=state,
        )
        raise HTTPException(status_code=400, detail=detail)

    if action == "entry":
        if has_departed:
            # A participant who has formally left the fest being scanned back in.
            # Either they returned and somebody needs to reverse the departure, or
            # the permanent exit was scanned by mistake earlier. Both need the
            # departure timestamp, which is in `state`.
            refuse("already_permanently_departed", "Participant has permanently departed and cannot re-enter")
        if is_inside:
            # Usually a double scan at the door; occasionally a missed exit, which
            # means the building's occupancy figure is already wrong.
            refuse("already_inside", "Participant is already inside")
        update_fields["accommodation.inside"] = True
        # Stamped only the first time, ever — a returning-next-year re-entry
        # scan (were it ever allowed) should not overwrite the original arrival.
        if not user_acc.get("arrival"):
            update_fields["accommodation.arrival"] = now
    elif action == "exit":
        if not is_inside:
            refuse("already_outside", "Participant is already outside")
        update_fields["accommodation.inside"] = False
    else:  # permanent_exit
        if has_departed:
            refuse("already_permanently_departed", "Participant has already permanently departed")
        if not is_inside:
            refuse("not_inside_for_permanent_exit", "Participant must be inside the hostel to mark a permanent exit")
        update_fields["accommodation.inside"] = False
        update_fields["accommodation.departure"] = now

    result = participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": update_fields}
    )
    if result.modified_count == 0:
        # The door reported success while the record did not move. For this
        # endpoint that is worse than an error: the occupancy list is now wrong in
        # a way nobody has been told about.
        log_integrity(
            "hostel scan did not change the participant's state",
            reason="scan_write_not_applied",
            details={
                "participant_id": target_user.get("participant_id"),
                "hostel_id": hostel_id,
                "action": action,
                "matched": result.matched_count,
                "fields": sorted(update_fields.keys()),
            },
        )

    log_scan(
        current_user, "hostel", f"HOSTEL_{action.upper()}", OUTCOME_ALLOWED,
        participant_id=target_user.get("participant_id"),
        target_id=hostel_id,
        # `participant_id` keeps its original place in `details` via `log_scan`, so
        # existing per-entity views and exports are unaffected. The transition is
        # additive: `inside_before` / `inside_after` is what lets a day's door
        # traffic be replayed as a sequence rather than a set of point-in-time rows.
        details={
            "inside_before": is_inside,
            "inside_after": update_fields.get("accommodation.inside"),
            "arrival_stamped": "accommodation.arrival" in update_fields,
            "departure_stamped": "accommodation.departure" in update_fields,
            "room": user_acc.get("room"),
        },
    )
    return {"message": f"Scan successful, {action} allowed"}

@router.delete("/{hostel_id}")
def delete_hostel(hostel_id: str, current_user: dict = Depends(get_current_staff)):
    """
    Delete a hostel block, Super Admin only.

    Cascades: every participant currently pointing at this hostel has their
    accommodation reset (hostel_id, room, inside, arrival, departure) so they
    are no longer marked as living somewhere that no longer exists.
    `registered` is left untouched, since they still want a bed — just not this
    one — and should be eligible for a future `/allocate` run.
    """
    _require_super_admin(current_user, "delete")

    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel:
        log_denied(
            current_user, "DELETE_HOSTEL_DENIED", hostel_id,
            reason="hostel_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Hostel not found")

    # Captured before the cascade, because afterwards nothing links these people to
    # this block. This is the most destructive operation in the file: it discards
    # `arrival` and `departure` for everybody who lived here, which is the record of
    # whether they were ever physically present at the fest. Those facts survive
    # only in the `HOSTEL_ENTRY` / `HOSTEL_EXIT` audit rows and in this one.
    affected = [
        {
            "participant_id": p.get("participant_id"),
            "room": (p.get("accommodation") or {}).get("room"),
            "was_inside": bool((p.get("accommodation") or {}).get("inside")),
            "had_arrived": bool((p.get("accommodation") or {}).get("arrival")),
        }
        for p in participants_collection.find(
            {"accommodation.hostel_id": hostel_id},
            {"participant_id": 1, "accommodation.room": 1, "accommodation.inside": 1, "accommodation.arrival": 1},
        )
    ]
    still_inside = [row["participant_id"] for row in affected if row["was_inside"]]

    result = participants_collection.update_many(
        {"accommodation.hostel_id": hostel_id},
        {"$set": {
            "accommodation.hostel_id": None,
            "accommodation.room": None,
            "accommodation.inside": False,
            "accommodation.arrival": None,
            "accommodation.departure": None
        }}
    )
    hostel_collection.delete_one({"hostel_id": hostel_id})
    log_audit(current_user, "DELETE_HOSTEL", hostel_id, {
        "participants_reset": result.modified_count,
        "name": hostel.get("name"),
        "gender": hostel.get("gender"),
        "capacity": hostel.get("capacity"),
        "lifetime_occupancy": hostel.get("current_occupancy"),
        "team_size": len(hostel.get("hostel_team") or []),
        "residents": affected,
        "were_inside_at_deletion": still_inside,
    })
    if still_inside:
        # Deleting a block while people are recorded as being inside it means the
        # occupancy record for those people is being erased while they are, as far
        # as the system knew, physically in the building.
        log_config.warning(
            _log,
            f"hostel {hostel_id} deleted while {len(still_inside)} resident(s) were recorded as inside",
            {
                "hostel_id": hostel_id,
                "reason": "deleted_with_residents_inside",
                "participants_inside": still_inside,
                "destructive": True,
            },
        )
    return {"message": "Hostel deleted", "participants_reset": result.modified_count}

@router.get("/{hostel_id}/statistics")
def hostel_statistics(hostel_id: str, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "statistics")

    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel:
        log_denied(
            current_user, "READ_HOSTEL_ROSTER_DENIED", hostel_id,
            reason="hostel_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Hostel not found")

    participants = list(participants_collection.find({"accommodation.hostel_id": hostel_id}))

    inside_count = sum(1 for p in participants if p.get("accommodation", {}).get("inside", False))

    allotted = []
    for p in participants:
        prof = p.get("profile", {})
        allotted.append({
            "participant_id": p.get("participant_id"),
            "name": prof.get("full_name"),
            "email": p.get("email"),
            "room": p.get("accommodation", {}).get("room")
        })

    # A roster read, recorded like the mess equivalent. `currently_inside` also
    # goes in, because this endpoint is the occupancy snapshot somebody would be
    # asked to produce after an incident, and knowing what it said at the time it
    # was read is part of that.
    log_audit(current_user, "READ_HOSTEL_ROSTER", hostel_id, {
        "returned": len(participants),
        "currently_inside": inside_count,
        "capacity": hostel.get("capacity"),
    })

    return {
        "total_allocated": len(participants),
        "capacity": hostel.get("capacity"),
        "current_occupancy": hostel.get("current_occupancy"),
        "currently_inside": inside_count,
        "allotted_participants": allotted
    }

@router.get("/{hostel_id}")
def get_hostel(hostel_id: str, current_user: dict = Depends(get_current_user)):
    """A single hostel's document. Declared last so it never captures a literal
    path (`/allocate`, `/register`, `/my_hostel`) defined earlier in this file."""
    hostel = hostel_collection.find_one({"hostel_id": hostel_id}, {"_id": 0})
    if not hostel:
        raise HTTPException(status_code=404, detail="Hostel not found")
    return hostel
