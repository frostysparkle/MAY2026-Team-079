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
from log_redaction import safe_email
# Email identity is defined in one place, by the module that derives `participant_id`
# from an address, so the two collections cannot disagree about what counts as the
# same person.
from routers.auth import _email_filter, normalise_email
from logger import log_audit, log_denied
from security import get_password_hash
from id_generator import BackendTeamIDGenerator

router = APIRouter(prefix="/backend_teams", tags=["Backend Teams"])

generator = BackendTeamIDGenerator()


def _require_super_admin(current_user: dict, operation: str) -> str:
    """
    The Super Admin gate these four routes share, now with the refusal recorded.

    Every write in this file creates, alters, or destroys a *staff account* — the
    accounts that scan meals, open hostel doors, and read the audit trail — and
    none of it was recorded anywhere. An account could be granted `super_admin`
    and later deleted leaving no evidence it had ever existed. That is the single
    largest hole in the old trail, and it is closed by the `log_audit` calls in
    this file plus this shared refusal line.
    """
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_super_admin",
            details={"operation": operation, "resource": "backend_teams", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Only Super Admins can manage backend teams")
    return user_id

# Roles that must be a real person the fest can already vouch for — each one
# carries privileges (super_admin/admin) or scanning duties tied to a body
# (volunteer), so it must resolve to an existing participant. "other" is the
# bucket role for staff without their own participant record (e.g. hostel/mess
# desk staff hired for the fest), so it alone may go unlinked.
ADMIN_ID_REQUIRED_ROLES = {"super_admin", "admin", "volunteer"}


@router.post("")
def create_backend_team(request: BackendTeamCreateRequest, current_user: dict = Depends(get_current_staff)):
    user_id = _require_super_admin(current_user, "create")

    # Staff accounts share one email namespace with participants, and the link between
    # the two is the address itself — so the same case-insensitive identity rule has to
    # apply here. Comparing raw strings meant a staff account could be created for
    # `A@x` while `a@x` already existed, and the participant lookup below would then
    # miss the very record the role requires it to find.
    email = normalise_email(request.email)

    if backend_teams_collection.find_one(_email_filter(email)):
        log_denied(
            current_user,
            "CREATE_STAFF_DENIED",
            None,
            reason="email_already_registered",
            details={"email_local": safe_email(email), "role": request.role},
        )
        raise HTTPException(status_code=400, detail="Email already registered in backend teams")
        
    # Look up the participant document that corresponds to this email (the admin_id link per schema)
    participant_doc = participants_collection.find_one(
        _email_filter(email), {"_id": 1, "profile.full_name": 1}
    )
    admin_id_ref = participant_doc["_id"] if participant_doc else None

    # super_admin / admin / volunteer must link to a real participant — an
    # account with one of these roles and no admin_id would be unauditable
    # (nothing in participants ties it to an actual person) and, for
    # volunteers specifically, unable to satisfy the hostel/mess/workshop
    # "must be a real participant" checks that key off this link elsewhere.
    if request.role in ADMIN_ID_REQUIRED_ROLES and admin_id_ref is None:
        # A common and confusing failure in practice: the organiser is creating a
        # volunteer for somebody who has not registered as a participant yet, and
        # the fix is to have that person sign up first. Recording it means the
        # pattern is visible when it happens repeatedly during onboarding.
        log_denied(
            current_user,
            "CREATE_STAFF_DENIED",
            None,
            reason="role_requires_linked_participant",
            details={
                "email_local": safe_email(email),
                "role": request.role,
                "department": request.department,
            },
        )
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
    if admin_id_ref is not None:
        already_linked = backend_teams_collection.find_one({"admin_id": admin_id_ref})
        if already_linked:
            # Names the account that holds the link, because "already linked" with
            # no indication of *what to* leaves the organiser guessing which
            # existing staff record to look at.
            log_denied(
                current_user,
                "CREATE_STAFF_DENIED",
                already_linked.get("paradox_id"),
                reason="participant_already_linked",
                details={
                    "email_local": safe_email(email),
                    "role": request.role,
                    "linked_to": already_linked.get("paradox_id"),
                    "linked_role": already_linked.get("role"),
                },
            )
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
        "email": email,
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
    # Who was given which privileges, by whom, and when. `role` and `department`
    # are the load-bearing fields: they decide what this account can do for the
    # rest of the fest, and they are immutable after creation, so this row is the
    # only place that decision is ever recorded.
    log_audit(
        current_user,
        "CREATE_STAFF",
        paradox_id,
        {
            "role": request.role,
            "department": request.department,
            "designation": request.designation,
            "email_local": safe_email(email),
            "linked_participant": bool(admin_id_ref),
            "name_resolved_from": (
                "request" if (request.name or "").strip() else ("participant" if linked_name else None)
            ),
        },
    )
    return {"message": "Backend team member created", "paradox_id": new_team["paradox_id"]}


@router.get("")
def get_backend_teams(current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
    if not admin:
        # A different message from the writes above, so it keeps its own call
        # rather than using the shared helper.
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_super_admin",
            details={"operation": "list", "resource": "backend_teams", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Only Super Admins can view backend teams")

    # `admin_id` holds the linked participant's raw ObjectId, which is not JSON
    # serialisable — so this endpoint used to 500 for any account that has one.
    # That is not an edge case: `super_admin`, `admin` and `volunteer` accounts are
    # *required* to link to a participant (see ADMIN_ID_REQUIRED_ROLES), so the
    # staff roster broke as soon as a single privileged account existed.
    #
    # Stringified rather than projected out, because the link is what makes a staff
    # account auditable and a client has a legitimate use for it. Same treatment
    # `/participants` already gives `mess.mess_id`.
    rows = []
    for row in backend_teams_collection.find({}, {"_id": 0, "password_hash": 0}):
        if row.get("admin_id") is not None:
            row["admin_id"] = str(row["admin_id"])
        rows.append(row)
    return rows


@router.put("/{paradox_id}")
def update_backend_team(paradox_id: str, request: BackendTeamUpdateRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "update")

    target = backend_teams_collection.find_one({"paradox_id": paradox_id})
    if not target:
        log_denied(
            current_user,
            "UPDATE_STAFF_DENIED",
            paradox_id,
            reason="staff_not_found",
            details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Backend team member not found")

    # `role` / `department` are not on BackendTeamUpdateRequest at all, so
    # there is nothing here that could touch either — see the model's
    # docstring for why they're immutable after creation.
    update_data = {k: v for k, v in request.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        backend_teams_collection.update_one({"paradox_id": paradox_id}, {"$set": update_data})

    # Field *names* only, never values: this request can carry a new password, and
    # `update_data` would otherwise put it — or its hash — into the trail. Whether
    # a password was among the changed fields is itself the interesting fact, so it
    # is called out separately.
    log_audit(
        current_user,
        "UPDATE_STAFF",
        paradox_id,
        {
            "fields_updated": sorted(k for k in update_data if k != "updated_at"),
            "password_changed": "password_hash" in update_data or "password" in update_data,
            "no_op": not update_data,
            "target_role": target.get("role"),
            "target_department": target.get("department"),
        },
    )
    return {"message": "Backend team updated successfully"}


@router.delete("/{paradox_id}")
def delete_backend_team(paradox_id: str, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user, "delete")

    target = backend_teams_collection.find_one({"paradox_id": paradox_id})
    if not target:
        log_denied(
            current_user,
            "DELETE_STAFF_DENIED",
            paradox_id,
            reason="staff_not_found",
            details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Backend team member not found")

    backend_teams_collection.delete_one({"paradox_id": paradox_id})
    # The deleted account's own details go into the row, because after this line
    # they exist nowhere else. Its id remains scattered across `workshop_team`
    # rosters, `mess_team` entries, and every scan it ever made — and without this
    # row, resolving that id later yields nothing at all.
    log_audit(
        current_user,
        "DELETE_STAFF",
        paradox_id,
        {
            "deleted_role": target.get("role"),
            "deleted_department": target.get("department"),
            "deleted_designation": target.get("designation"),
            "deleted_name": target.get("name"),
            "email_local": safe_email(target.get("email")),
            "was_linked_to_participant": bool(target.get("admin_id")),
        },
    )
    return {"message": "Backend team deleted"}
