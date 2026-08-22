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

router = APIRouter(prefix="/backend_teams", tags=["Backend Teams"])


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

    # A staff account had no name field at all, which is why the audit trail could
    # only ever show `BT…` ids for the people who took the actions. `admin_id`
    # already links to the participant document for staff who are also
    # registered, so their real name is available here without asking for it
    # again; an explicit `name` on the request wins over it.
    linked_name = (participant_doc or {}).get("profile", {}).get("full_name")
    resolved_name = (request.name or "").strip() or linked_name or None

    new_team = {
        "paradox_id": f"BT{int(datetime.utcnow().timestamp())}",
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
    backend_teams_collection.delete_one({"paradox_id": paradox_id})
    return {"message": "Backend team deleted"}
