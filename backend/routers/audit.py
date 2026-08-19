from fastapi import APIRouter, HTTPException, Depends
from typing import Optional

from database import system_logs_collection, backend_teams_collection
from dependencies import get_current_staff

router = APIRouter(prefix="/audit-logs", tags=["Audit"])

@router.get("")
def view_audit_logs(
    limit: int = 100,
    target_id: Optional[str] = None,
    action: Optional[str] = None,
    current_user: dict = Depends(get_current_staff)
):
    """
    The audit trail, newest first.

    ``target_id`` narrows the trail to one entity — an event, workshop, mess hall,
    or hostel block — which is what the dashboard's per-entity log view reads.
    Filtering server-side rather than pulling the whole trail and sifting it in the
    client matters here: ``limit`` would otherwise silently cut off an entity's
    older entries, because it applies before any client-side filter can run.

    ``action`` narrows to one kind of action, e.g. ``HOSTEL_ENTRY``. Both are
    optional, so the unfiltered call is unchanged.
    """
    user_id = current_user.get("paradox_id")
    admin = backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})

    if not admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can view audit logs")

    query = {}
    if target_id is not None:
        query["target_id"] = target_id
    if action is not None:
        query["action"] = action

    logs = list(system_logs_collection.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit))
    return logs
