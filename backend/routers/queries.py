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
Routing is derived from ``category`` + ``target_id``, never from the free-text
``assigned_team`` label:

============  ======================================================
category      who can read and answer it
============  ======================================================
``hostel``    the ``hostel_team`` of the named block
``mess``      the ``mess_team`` of the named hall
``event``     the ``event_team`` of the named event
``workshop``  the ``workshop_team`` of the named workshop
``general``   Super Admins only
============  ======================================================

Plus, in every case, the Super Admins and whoever the query is explicitly
assigned to. This is the second of the two options the delivery audit put up for
Story 6.4: the existing per-entity team arrays *are* the points of contact, so no
``por``/``poc`` value is added to ``backend_teams.role`` and no existing guard
moves.

What is deliberately not in a query document
--------------------------------------------
No email, no phone. A block's ``hostel_team`` cannot currently read
``/hostels/{id}/statistics`` — that is Super Admin only — so denormalising
contact details onto a row any team member can fetch would widen disclosure well
past what answering a question needs. The reply thread is the channel back, so
the team never needs a number. ``participant_name`` and ``participant_house`` are
stored because a thread addressed to nobody in particular is unanswerable.
"""

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from typing import Optional, List
import uuid

from logger import log_audit
from database import (
    queries_collection,
    backend_teams_collection,
    hostel_collection,
    mess_collection,
    event_collection,
    workshops_collection,
)
from dependencies import get_current_user, get_current_staff, get_current_participant
from models import QueryCreateRequest, QueryUpdateRequest, QueryReplyRequest

router = APIRouter(prefix="/queries", tags=["Queries"])

# category -> (collection, readable id field, team array field)
CATEGORY_ROUTING = {
    "hostel": (hostel_collection, "hostel_id", "hostel_team"),
    "mess": (mess_collection, "mess_id", "mess_team"),
    "event": (event_collection, "event_id", "event_team"),
    "workshop": (workshops_collection, "workshop_id", "workshop_team"),
}

# `general` has no target entity, so it has no team to route to and reaches the
# Super Admins. Listed separately rather than folded into the map above, because
# a `general` query with a `target_id` is a category error, not a routing one.
CATEGORIES = set(CATEGORY_ROUTING) | {"general"}

STATUSES = {"open", "assigned", "resolved"}


def _is_super_admin(paradox_id: str) -> bool:
    return bool(backend_teams_collection.find_one({"paradox_id": paradox_id, "role": "super_admin"}))


def _staff_targets(paradox_id: str) -> dict:
    """
    The entities this staff member is named on a team for, per category.

    Read from the same team arrays the scanners already authorise against, so a
    volunteer's query queue is exactly the set of places they are already
    trusted to work at — no new concept of membership is introduced.
    """
    targets = {}
    for category, (collection, id_field, team_field) in CATEGORY_ROUTING.items():
        docs = collection.find({f"{team_field}.user_id": paradox_id}, {"_id": 0, id_field: 1})
        targets[category] = [d[id_field] for d in docs if d.get(id_field)]
    return targets


def _scope_filter(paradox_id: str) -> dict:
    """
    The Mongo filter for everything this non-super-admin staff member may read.

    A staff member on no team at all gets ``{"query_id": None}`` rather than an
    empty ``$or`` — an empty ``$or`` is not a valid filter, and a filter that
    matches everything would be the exact opposite of what is meant.
    """
    clauses: List[dict] = []
    for category, ids in _staff_targets(paradox_id).items():
        if ids:
            clauses.append({"category": category, "target_id": {"$in": ids}})
    # Whoever a query was handed to keeps it, even if they are later taken off
    # the team it came from. Otherwise reassignment silently loses the thread.
    clauses.append({"assigned_to": paradox_id})
    return {"$or": clauses}


def _may_handle(paradox_id: str, query: dict) -> bool:
    if _is_super_admin(paradox_id):
        return True
    if query.get("assigned_to") == paradox_id:
        return True
    routing = CATEGORY_ROUTING.get(query.get("category"))
    if not routing or not query.get("target_id"):
        return False
    collection, id_field, team_field = routing
    return bool(collection.find_one({
        id_field: query["target_id"],
        f"{team_field}.user_id": paradox_id,
    }))


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
        collection, id_field, _ = CATEGORY_ROUTING[category]
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
    The staff queue — Story 6.3, and the source for the operational dashboard's
    open-queries and hostel-issues panels (Story 9.1).

    Scoped to the caller: a Super Admin sees every query including ``general``
    ones; anybody else sees only the blocks, halls, events, and workshops they
    are named on a team for, plus anything handed to them by name. A staff member
    on no team gets an empty list rather than a 403 — an empty queue is a real
    state, not an authorisation failure.

    ``status`` and ``category`` filter server-side for the same reason
    ``/audit-logs`` does: ``limit`` applies before any client-side filter could.
    """
    paradox_id = current_user.get("paradox_id")

    if status is not None and status not in STATUSES:
        raise HTTPException(
            status_code=400, detail=f"Invalid status. Must be one of: {', '.join(sorted(STATUSES))}"
        )

    mongo_filter: dict = {} if _is_super_admin(paradox_id) else _scope_filter(paradox_id)
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
    query cannot blank its status on the way past.
    """
    paradox_id = current_user.get("paradox_id")
    query = queries_collection.find_one({"query_id": query_id})
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")
    if not _may_handle(paradox_id, query):
        raise HTTPException(status_code=403, detail="Not authorized to handle this query")

    update: dict = {}
    if request.status is not None:
        if request.status not in STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {', '.join(sorted(STATUSES))}",
            )
        update["status"] = request.status
        # Stamped here rather than left to the client, so "how long did that take"
        # is answerable from the record alone. Cleared on reopen, because a
        # resolved_at on an open query is worse than none.
        update["resolved_at"] = datetime.utcnow() if request.status == "resolved" else None
    if request.assigned_team is not None:
        update["assigned_team"] = request.assigned_team
    if request.assigned_to is not None:
        update["assigned_to"] = request.assigned_to
        # Handing a query to somebody is what "assigned" means. An explicit
        # status in the same request still wins, so resolve-and-assign works.
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

    Takes either token type: the participant who raised it and the staff member
    handling it write to the same thread. Nobody else can read or write it, which
    is checked per-role rather than per-token, so a staff member who is not on
    the owning team is refused even though their token is valid.
    """
    query = queries_collection.find_one({"query_id": query_id})
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")

    is_staff = "paradox_id" in current_user
    if is_staff:
        author_id = current_user["paradox_id"]
        if not _may_handle(author_id, query):
            raise HTTPException(status_code=403, detail="Not authorized to handle this query")
        author_name = current_user.get("designation") or current_user.get("role") or "Fest team"
        author_type = "staff"
    else:
        author_id = current_user["participant_id"]
        if query.get("participant_id") != author_id:
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
