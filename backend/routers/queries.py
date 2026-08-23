"""
Participant queries — Epic 6 (raise · track · assign · answer) and Story 5.4.

Why this is a collection of its own
-----------------------------------
A query needs a participant to write free text that a *different* user reads
back. Nothing else in this API does that. Every participant-writable field is
either returned only to its own author (``events[].registration_data``, via
``GET /events/my_registrations``) or is load-bearing data a query would corrupt
(``profile.*`` is every roster's identity, ``team_id`` is what
``allocate_teams`` reads, ``accommodation.registered`` is a one-bit flag that
cancels a hostel request). So the channel had to be new.

How a query reaches a team
--------------------------
There is no per-category routing. Every query, regardless of ``category``
(``hostel`` | ``mess`` | ``event`` | ``workshop`` | ``general``), is visible to
and answerable by the same flat **query resolution team** — a roster a Super
Admin builds in ``query_team_collection`` (see the ``/queries/team`` routes
below), independent of the ``hostel_team``/``mess_team``/``event_team``/
``workshop_team`` arrays those entities carry for their own purposes.
``category`` and ``target_id`` remain on the query purely as labels: they say
what the query is about and are still validated against a real entity at
write time, but they no longer decide who can read or answer it.

A query team member sees, and may self-claim (``PATCH`` with
``assigned_to`` set to their own id), the entire queue — resolved queries stay
in it too, so the roster keeps a shared history rather than losing a query the
moment it closes. Filtering that down to "still open" is what the ``status``
query param on ``GET /queries`` is for.

What is deliberately not in a query document
--------------------------------------------
No email, no phone. Denormalising contact details onto a row every query team
member can fetch would widen disclosure well past what answering a question
needs. The reply thread is the channel back, so the team never needs a number.
``participant_name`` and ``participant_house`` are stored because a thread
addressed to nobody in particular is unanswerable.
"""

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from typing import Optional
import uuid

from logger import log_audit, log_denied
from database import (
    queries_collection,
    query_team_collection,
    backend_teams_collection,
    hostel_collection,
    mess_collection,
    event_collection,
    workshops_collection,
)
from dependencies import get_current_user, get_current_staff, get_current_participant
from models import QueryCreateRequest, QueryUpdateRequest, QueryReplyRequest, QueryTeamAssignRequest

router = APIRouter(prefix="/queries", tags=["Queries"])

# category -> (collection, readable id field) — used only to validate that a
# query's target_id names a real entity at write time. No team field is read
# off these collections any more; who may handle a query is entirely a
# question of query_team_collection / super_admin now.
CATEGORY_ROUTING = {
    "hostel": (hostel_collection, "hostel_id"),
    "mess": (mess_collection, "mess_id"),
    "event": (event_collection, "event_id"),
    "workshop": (workshops_collection, "workshop_id"),
}

# `general` has no target entity, so it has no entity to validate against.
# Listed separately rather than folded into the map above, because a `general`
# query with a `target_id` is a category error, not a routing one.
CATEGORIES = set(CATEGORY_ROUTING) | {"general"}

STATUSES = {"open", "assigned", "resolved"}


def _is_super_admin(paradox_id: str) -> bool:
    return bool(backend_teams_collection.find_one({"paradox_id": paradox_id, "role": "super_admin"}))


def _is_query_team_member(paradox_id: str) -> bool:
    return bool(query_team_collection.find_one({"user_id": paradox_id}))


def _require_query_access(current_user: dict) -> str:
    """
    Every staff-side query route needs the same thing: a Super Admin, or a
    member of the flat query resolution team. Anyone else is refused outright
    — there is no per-entity scope left to fall back to an empty result with.
    """
    paradox_id = current_user.get("paradox_id")
    if not (_is_super_admin(paradox_id) or _is_query_team_member(paradox_id)):
        # Queries carry participants' free text, which is the one place in this API a
        # student writes something a different user reads back. Refusing access to it
        # is worth a durable row.
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_on_query_team",
            details={"resource": "queries", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Not authorized to access queries")
    return paradox_id


def _require_super_admin(current_user: dict) -> None:
    if not _is_super_admin(current_user.get("paradox_id")):
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_super_admin",
            details={"resource": "query_team", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Only Super Admins can manage the query team")


def _public_view(query: dict) -> dict:
    """One shape for both sides of the thread, so neither can drift from the other."""
    return {k: v for k, v in query.items() if k != "_id"}


@router.post("")
def raise_query(request: QueryCreateRequest, current_user: dict = Depends(get_current_participant)):
    """
    Raise a query — Story 6.1, and the durable record Story 5.4 needs.

    The target entity is validated at write time rather than at read time: a
    query naming a block that does not exist would otherwise be accepted, routed
    to nobody, and sit unanswered looking exactly like a query nobody has got to
    yet.
    """
    category = request.category.lower().strip()
    if category not in CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {', '.join(sorted(CATEGORIES))}",
        )

    target_id = request.target_id
    if category == "general":
        # A general query has no owning entity. Keeping it None means the scope
        # filter cannot accidentally match it against a team's target list.
        target_id = None
    else:
        if not target_id:
            raise HTTPException(status_code=400, detail=f"A {category} query must name a {category}")
        collection, id_field = CATEGORY_ROUTING[category]
        if not collection.find_one({id_field: target_id}):
            raise HTTPException(status_code=404, detail=f"No {category} found with id {target_id}")

    profile = current_user.get("profile") or {}
    now = datetime.utcnow()
    query_doc = {
        "query_id": f"QRY{now.strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:6].upper()}",
        "participant_id": current_user["participant_id"],
        "participant_name": profile.get("full_name"),
        "participant_house": profile.get("house"),
        "category": category,
        "target_id": target_id,
        "subject": request.subject.strip(),
        "body": request.body.strip(),
        "status": "open",
        "assigned_team": None,
        "assigned_to": None,
        "replies": [],
        "created_at": now,
        "updated_at": now,
        "resolved_at": None,
    }
    queries_collection.insert_one(query_doc)
    log_audit(
        current_user,
        "RAISE_QUERY",
        query_doc["query_id"],
        {"category": category, "target_id": target_id},
    )
    return {"message": "Query raised", "query_id": query_doc["query_id"], "query": _public_view(query_doc)}


@router.get("/mine")
def my_queries(current_user: dict = Depends(get_current_participant)):
    """
    Track your own queries — Story 6.2. Newest first, replies included, so the
    participant sees the status *and* what was said about it.

    Declared before ``/{query_id}`` so the literal path is not captured as an id.
    """
    rows = queries_collection.find(
        {"participant_id": current_user["participant_id"]}, {"_id": 0}
    ).sort("created_at", -1)
    return list(rows)


@router.get("")
def list_queries(
    status: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_staff),
):
    """
    The shared queue — Story 6.3, and the source for the operational
    dashboard's open-queries and hostel-issues panels (Story 9.1).

    Not scoped by entity any more: a Super Admin and every member of the query
    resolution team see the same unrestricted queue, across every category
    including ``general``, resolved queries included — a query team member can
    self-claim any of it by ``PATCH``-ing ``assigned_to`` to their own id. A
    staff member who is on neither gets a 403; there is no per-entity scope
    left to fall back to an empty result with.

    ``status`` and ``category`` filter server-side for the same reason
    ``/audit-logs`` does: ``limit`` applies before any client-side filter could.
    """
    _require_query_access(current_user)

    if status is not None and status not in STATUSES:
        raise HTTPException(
            status_code=400, detail=f"Invalid status. Must be one of: {', '.join(sorted(STATUSES))}"
        )

    mongo_filter: dict = {}
    if status is not None:
        mongo_filter["status"] = status
    if category is not None:
        mongo_filter["category"] = category

    rows = queries_collection.find(mongo_filter, {"_id": 0}).sort("created_at", -1).limit(limit)
    return list(rows)


@router.patch("/{query_id}")
def update_query(query_id: str, request: QueryUpdateRequest, current_user: dict = Depends(get_current_staff)):
    """
    Set status and assignment — Story 6.3.

    Only the fields a request carries are written, so a screen that reassigns a
    query cannot blank its status on the way past. A query team member sets
    ``assigned_to`` to their own id to self-claim a query; a Super Admin may
    assign to anyone.
    """
    _require_query_access(current_user)
    query = queries_collection.find_one({"query_id": query_id})
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")

    # `model_fields_set` separates "left out of the request" from "sent as null" —
    # the same distinction `PATCH /profile/complete` relies on. Guarding on
    # `is not None` alone conflated the two, which made an assignment impossible to
    # clear: a query handed to somebody who then left the fest stayed assigned to
    # them forever, because the only way to express "nobody" was a null the route
    # read as "unchanged".
    sent = request.model_fields_set

    update: dict = {}
    if request.status is not None:
        if request.status not in STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {', '.join(sorted(STATUSES))}",
            )
        update["status"] = request.status
        # Stamped when the work finishes, and left alone otherwise.
        #
        # It used to be overwritten with None on *any* non-resolved status, so
        # resolve -> reopen -> resolve destroyed the first resolution time — and that
        # field is the only record of when the work was actually done, which is what
        # "how long did that take" is answered from. A resolved_at on a reopened query
        # is not misleading: `status` already says it is open again, and the pair
        # together are the history.
        if request.status == "resolved":
            update["resolved_at"] = datetime.utcnow()

    if "assigned_team" in sent:
        update["assigned_team"] = request.assigned_team
    if "assigned_to" in sent:
        update["assigned_to"] = request.assigned_to
        # Handing a query to somebody is what "assigned" means. An explicit
        # status in the same request still wins, so resolve-and-assign works.
        # Releasing it (an explicit null) implies nothing — the status is whatever
        # the caller says it is, or whatever it already was.
        if request.assigned_to is not None:
            update.setdefault("status", "assigned")

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")

    update["updated_at"] = datetime.utcnow()
    queries_collection.update_one({"query_id": query_id}, {"$set": update})
    log_audit(current_user, "UPDATE_QUERY", query_id, {"fields_updated": sorted(update.keys())})
    return {"message": "Query updated", "query": _public_view(queries_collection.find_one({"query_id": query_id}))}


@router.post("/{query_id}/replies")
def reply_to_query(query_id: str, request: QueryReplyRequest, current_user: dict = Depends(get_current_user)):
    """
    The conversation — Story 6.4, and the half of 6.2 that makes a status useful.

    Takes either token type: the participant who raised it and a query team
    member write to the same thread. Nobody else can read or write it, which is
    checked per-role rather than per-token, so a staff member off the query
    team is refused even though their token is valid.
    """
    query = queries_collection.find_one({"query_id": query_id})
    if not query:
        log_denied(
            current_user, "REPLY_QUERY_DENIED", query_id,
            reason="query_not_found", details={"status": 404}, audit=False,
        )
        raise HTTPException(status_code=404, detail="Query not found")

    is_staff = "paradox_id" in current_user
    if is_staff:
        author_id = current_user["paradox_id"]
        if not (_is_super_admin(author_id) or _is_query_team_member(author_id)):
            log_denied(
                current_user, "REPLY_QUERY_DENIED", query_id,
                reason="not_on_query_team", details={"status": 403},
            )
            raise HTTPException(status_code=403, detail="Not authorized to handle this query")
        author_name = current_user.get("designation") or current_user.get("role") or "Fest team"
        author_type = "staff"
    else:
        author_id = current_user["participant_id"]
        if query.get("participant_id") != author_id:
            # A participant reaching for a thread that is not theirs. Recorded because
            # the threads contain other students' words, so an attempt to read or
            # append to one is worth being able to review afterwards.
            log_denied(
                current_user, "REPLY_QUERY_DENIED", query_id,
                reason="not_query_author",
                details={"status": 403, "owner_participant_id": query.get("participant_id")},
            )
            raise HTTPException(status_code=403, detail="Not your query")
        author_name = (current_user.get("profile") or {}).get("full_name") or "Participant"
        author_type = "participant"

    now = datetime.utcnow()
    reply = {
        "author_id": author_id,
        "author_type": author_type,
        "author_name": author_name,
        "body": request.body.strip(),
        "timestamp": now,
    }
    queries_collection.update_one(
        {"query_id": query_id},
        {"$push": {"replies": reply}, "$set": {"updated_at": now}},
    )
    log_audit(current_user, "REPLY_QUERY", query_id, {"author_type": author_type})
    return {"message": "Reply added", "reply": reply}


# ── query resolution team roster ────────────────────────────────────────────
#
# A flat, Super-Admin-managed list of who may see and handle every query,
# independent of category. Deliberately its own collection
# (``query_team_collection``) rather than an array embedded anywhere else —
# see database.py — so it can be queried by user_id the same way
# ``backend_teams_collection`` is.


def _team_member_view(row: dict) -> dict:
    """The roster row, denormalized with a display name where one is on file —
    the same shape `events.py` hands back for `event_team` details."""
    staff = backend_teams_collection.find_one({"paradox_id": row["user_id"]}) or {}
    return {
        "user_id": row["user_id"],
        "name": staff.get("name") or staff.get("designation"),
        "designation": staff.get("designation"),
        "department": staff.get("department"),
        "added_at": row.get("added_at"),
        "added_by": row.get("added_by"),
    }


@router.post("/team")
def add_query_team_member(request: QueryTeamAssignRequest, current_user: dict = Depends(get_current_staff)):
    """
    Add a staff member to the query resolution team — Super Admin only.

    `user_id` must already exist in `backend_teams_collection`; this roster
    grants query access on top of an existing staff account, it does not
    create one.
    """
    _require_super_admin(current_user)

    if not backend_teams_collection.find_one({"paradox_id": request.user_id}):
        raise HTTPException(status_code=404, detail="user_id must reference an existing backend_teams member")

    if query_team_collection.find_one({"user_id": request.user_id}):
        raise HTTPException(status_code=400, detail="This staff member is already on the query team")

    row = {
        "user_id": request.user_id,
        "added_at": datetime.utcnow(),
        "added_by": current_user.get("paradox_id"),
    }
    query_team_collection.insert_one(row)
    log_audit(current_user, "ASSIGN_QUERY_TEAM", request.user_id, {})
    return {"message": "Added to query team", "member": _team_member_view(row)}


@router.get("/team")
def list_query_team(current_user: dict = Depends(get_current_staff)):
    """The current roster — Super Admin only, same as `event_team` details are staff-gated."""
    _require_super_admin(current_user)
    rows = query_team_collection.find({}, {"_id": 0}).sort("added_at", 1)
    return [_team_member_view(row) for row in rows]


@router.delete("/team/{user_id}")
def remove_query_team_member(user_id: str, current_user: dict = Depends(get_current_staff)):
    """Frees this person from query duty. Does not touch anything they already replied to or were assigned."""
    _require_super_admin(current_user)

    if not query_team_collection.find_one({"user_id": user_id}):
        raise HTTPException(status_code=404, detail="user_id is not on the query team")

    query_team_collection.delete_one({"user_id": user_id})
    log_audit(current_user, "REMOVE_QUERY_TEAM_MEMBER", user_id, {})
    return {"message": "Removed from query team"}
