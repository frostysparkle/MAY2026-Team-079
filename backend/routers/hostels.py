from fastapi import APIRouter, HTTPException, Depends
from logger import log_audit
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

from database import hostel_collection, participants_collection, backend_teams_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from models import ScanQRRequest, MockPaymentRequest
from id_generator import SequentialIDGenerator, generate_room_numbers
from payments import simulate_payment

generator = SequentialIDGenerator("HSTL")

router = APIRouter(prefix="/hostels", tags=["Hostels"])

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
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    hostel_id = generator.next_id()
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
        "capacity": request.capacity, "sharing": request.sharing, "num_rooms": request.num_rooms
    })
    return {"message": "Hostel created", "hostel_id": hostel_id}

@router.get("")
def list_hostels(current_user: dict = Depends(get_current_user)):
    return list(hostel_collection.find({}, {"_id": 0}))

@router.post("/{hostel_id}/team")
def assign_hostel_team(hostel_id: str, request: HostelAssignTeamRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    if not hostel_collection.find_one({"hostel_id": hostel_id}):
        raise HTTPException(status_code=404, detail="Hostel not found")

    # `user_id` must be a real backend_teams member, and specifically one
    # created with role "other" — the bucket hostel_volunteer/guard staff are
    # created under (see backend_teams.py). This stops a super_admin's own
    # paradox_id, or an admin from another department, being added as a block's
    # duty staff by mistake.
    staff = backend_teams_collection.find_one({"paradox_id": request.user_id, "role": "other"})
    if not staff:
        raise HTTPException(
            status_code=404,
            detail="user_id must reference an existing backend_teams member with role 'other'"
        )

    existing = hostel_collection.find_one({"hostel_id": hostel_id, "hostel_team.user_id": request.user_id})
    if existing:
        raise HTTPException(status_code=409, detail="Team member already assigned to this hostel")

    team_member = {
        "user_id": request.user_id,
        "role": request.role,
        "attendance": request.attendance
    }
    hostel_collection.update_one({"hostel_id": hostel_id}, {"$push": {"hostel_team": team_member}})
    log_audit(current_user, "ASSIGN_HOSTEL_TEAM", hostel_id, {"team_user_id": request.user_id, "role": request.role})
    return {"message": "Team member assigned"}

@router.put("/{hostel_id}/team/{team_user_id}/toggle_scan")
def toggle_hostel_scan(hostel_id: str, team_user_id: str, attendance: bool, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    hostel_collection.update_one(
        {"hostel_id": hostel_id, "hostel_team.user_id": team_user_id},
        {"$set": {"hostel_team.$.attendance": attendance}}
    )
    return {"message": "Scanning toggled"}

@router.post("/allocate")
def allocate_hostels(current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    hostels = list(hostel_collection.find({"gender": {"$in": sorted(GENDERS)}}))
    gender_groups = {}
    for h in hostels:
        gender_groups.setdefault(h.get("gender"), []).append(h)

    participants = list(participants_collection.find({
        "accommodation.registered": True,
        "accommodation.hostel_id": None
    }))
    allocated = 0

    for p in participants:
        gender = (p.get("profile", {}).get("gender") or "").lower()
        available_hostels = gender_groups.get(gender, [])
        for h in available_hostels:
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
                    # the hostel document on every iteration.
                    room["occupants"].append(participant_id)

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
                    break
            if placed:
                break

    log_audit(current_user, "ALLOCATE_HOSTELS", None, {"allocated_count": allocated})
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
        raise HTTPException(status_code=400, detail="Only participants can pay the hostel fee")

    payment = simulate_payment("hostel", HOSTEL_FEE, request.method)
    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"accommodation.payment": payment}}
    )
    log_audit(current_user, "HOSTEL_PAYMENT", None, {
        "transaction_id": payment["transaction_id"], "amount": payment["amount"]
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
    # action: "entry" | "exit" | "permanent_exit"
    if action not in ("entry", "exit", "permanent_exit"):
        raise HTTPException(status_code=400, detail="Invalid action. Must be 'entry', 'exit', or 'permanent_exit'")

    user_id = current_user.get("paradox_id")
    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")

    team_member = next((m for m in hostel.get("hostel_team", []) if m.get("user_id") == user_id), None)

    if not team_member:
        raise HTTPException(status_code=403, detail="Not authorized to scan for this hostel")

    if not team_member.get("attendance"):
        raise HTTPException(status_code=403, detail="Scanning disabled for you")

    target_user, _ = verify_qr(request)

    user_acc = target_user.get("accommodation", {}) or {}
    if user_acc.get("hostel_id") != hostel_id:
        raise HTTPException(status_code=400, detail="Participant not allotted to this hostel")

    is_inside = user_acc.get("inside", False)
    has_departed = user_acc.get("departure") is not None
    now = datetime.utcnow()
    update_fields = {}

    if action == "entry":
        if has_departed:
            raise HTTPException(status_code=400, detail="Participant has permanently departed and cannot re-enter")
        if is_inside:
            raise HTTPException(status_code=400, detail="Participant is already inside")
        update_fields["accommodation.inside"] = True
        # Stamped only the first time, ever — a returning-next-year re-entry
        # scan (were it ever allowed) should not overwrite the original arrival.
        if not user_acc.get("arrival"):
            update_fields["accommodation.arrival"] = now
    elif action == "exit":
        if not is_inside:
            raise HTTPException(status_code=400, detail="Participant is already outside")
        update_fields["accommodation.inside"] = False
    else:  # permanent_exit
        if has_departed:
            raise HTTPException(status_code=400, detail="Participant has already permanently departed")
        if not is_inside:
            raise HTTPException(status_code=400, detail="Participant must be inside the hostel to mark a permanent exit")
        update_fields["accommodation.inside"] = False
        update_fields["accommodation.departure"] = now

    participants_collection.update_one(
        {"_id": target_user["_id"]},
        {"$set": update_fields}
    )
    log_audit(current_user, f"HOSTEL_{action.upper()}", hostel_id, {"participant_id": target_user.get("participant_id")})
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
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel:
        raise HTTPException(status_code=404, detail="Hostel not found")

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
    log_audit(current_user, "DELETE_HOSTEL", hostel_id, {"participants_reset": result.modified_count})
    return {"message": "Hostel deleted", "participants_reset": result.modified_count}

@router.get("/{hostel_id}/statistics")
def hostel_statistics(hostel_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

    hostel = hostel_collection.find_one({"hostel_id": hostel_id})
    if not hostel: raise HTTPException(status_code=404, detail="Hostel not found")

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
