"""
Backend teams (Super Admin) endpoints — create, list, update, and delete staff
accounts. Extracted from main.py so all backend-teams-focused routes live in
one file, matching the pattern already used by workshops, mess, events, etc.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime

from models import BackendTeamCreateRequest, BackendTeamUpdateRequest
from dependencies import get_current_staff
from database import participants_collection, backend_teams_collection
from security import get_password_hash
from id_generator import BackendTeamIDGenerator

router = APIRouter(prefix="/backend_teams", tags=["Backend Teams"])

generator = BackendTeamIDGenerator()

# Roles that must be a real person the fest can already vouch for — each one
# carries privileges (super_admin/admin) or scanning duties tied to a body
# (volunteer), so it must resolve to an existing participant. "other" is the
# bucket role for staff without their own participant record (e.g. hostel/mess
# desk staff hired for the fest), so it alone may go unlinked.
ADMIN_ID_REQUIRED_ROLES = {"super_admin", "admin", "volunteer"}


@router.post("")
def create_backend_team(request: BackendTeamCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can manage backend teams")
    
    if backend_teams_collection.find_one({"email": request.email}):
        raise HTTPException(status_code=400, detail="Email already registered in backend teams")
        
    # Look up the participant document that corresponds to this email (the admin_id link per schema)
    participant_doc = participants_collection.find_one(
        {"email": request.email}, {"_id": 1, "profile.full_name": 1}
    )
    admin_id_ref = participant_doc["_id"] if participant_doc else None

    # super_admin / admin / volunteer must link to a real participant — an
    # account with one of these roles and no admin_id would be unauditable
    # (nothing in participants ties it to an actual person) and, for
    # volunteers specifically, unable to satisfy the hostel/mess/workshop
    # "must be a real participant" checks that key off this link elsewhere.
    if request.role in ADMIN_ID_REQUIRED_ROLES and admin_id_ref is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"role '{request.role}' requires a registered participant with this email; "
                "no matching participant record was found"
            ),
        )

    # One backend_teams account per participant: a participant who already
    # backs one staff account cannot be linked to a second. Without this, two
    # accounts could both resolve every "is this really them" check (event
    # team membership, hostel duty roster, etc.) back to the same person.
    if admin_id_ref is not None and backend_teams_collection.find_one({"admin_id": admin_id_ref}):
        raise HTTPException(
            status_code=409,
            detail="This participant is already linked to another backend_teams account",
        )

    # A staff account had no name field at all, which is why the audit trail could
    # only ever show `BT…` ids for the people who took the actions. `admin_id`
    # already links to the participant document for staff who are also
    # registered, so their real name is available here without asking for it
    # again; an explicit `name` on the request wins over it.
    linked_name = (participant_doc or {}).get("profile", {}).get("full_name")
    resolved_name = (request.name or "").strip() or linked_name or None

    paradox_id = generator.next_id(request.role, request.department)

    new_team = {
        "paradox_id": paradox_id,
        "email": request.email,
        "name": resolved_name,
        "password_hash": get_password_hash(request.password),
        "role": request.role,
        "department": request.department,
        "designation": request.designation,
        "admin_id": admin_id_ref,  # ObjectId reference to participant document | None
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    backend_teams_collection.insert_one(new_team)
    return {"message": "Backend team member created", "paradox_id": new_team["paradox_id"]}


@router.get("")
def get_backend_teams(current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can view backend teams")
    return list(backend_teams_collection.find({}, {"_id": 0, "password_hash": 0}))


@router.put("/{paradox_id}")
def update_backend_team(paradox_id: str, request: BackendTeamUpdateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can manage backend teams")

    if not backend_teams_collection.find_one({"paradox_id": paradox_id}):
        raise HTTPException(status_code=404, detail="Backend team member not found")

    # `role` / `department` are not on BackendTeamUpdateRequest at all, so
    # there is nothing here that could touch either — see the model's
    # docstring for why they're immutable after creation.
    update_data = {k: v for k, v in request.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        backend_teams_collection.update_one({"paradox_id": paradox_id}, {"$set": update_data})
    return {"message": "Backend team updated successfully"}


@router.delete("/{paradox_id}")
def delete_backend_team(paradox_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can manage backend teams")

    if not backend_teams_collection.find_one({"paradox_id": paradox_id}):
        raise HTTPException(status_code=404, detail="Backend team member not found")

    backend_teams_collection.delete_one({"paradox_id": paradox_id})
    return {"message": "Backend team deleted"}
