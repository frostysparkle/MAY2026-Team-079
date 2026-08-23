"""
Events — creation, registration, team management, attendance scanning, and
announcements.

Schema (restructured, no backward compatibility with the previous shape — see
docs/events_detailed_documentation.md for the full document layout):

    {
      event_id, event_type, name, description, embedding, poster,
      team: {min, max, house_vs_house_event, allow_single_registration},
      prize_money: [{position, amount}],
      registration: {start_time, end_time, allowed},
      schedule: [{round_id, name, description, start_time, end_time, venue}],
      registration_fields: [{field_id, label, type, required}],
      event_team: [{user_id, role}],       # role: event_head | member | volunteer
      announcements: [{announcement_id, message, priority, created_by, created_at}],
      created_by, created_at, updated_at
    }

Two things that used to live on the event document do not any more:

  * The registration roster mirror (the old `logs` array). Registration state
    was already the source of truth on `participants.events[]`; the mirror
    only ever grew, and every reader that needed a count already queried
    `participants_collection` directly (`event_capacity`, `view_participation`).
    Removing it does not remove any capability — it removes a second, easily
    drifting copy of the same fact.
  * Attendance scans and audit actions were already logged elsewhere
    (`event_logs_collection`, `system_logs_collection` via `log_audit`) and are
    unaffected by this file.

Team membership constraint: a `backend_teams` user may sit on at most one
event's `event_team`, enforced across the whole collection, not just within
one event. A team member also cannot register as a participant for the event
they are on the team of (unchanged from before, still enforced below).

Registration open/closed is never physically flipped by a background job:
`_registration_open` computes it on every read, from `registration.allowed`
(a Super Admin kill-switch) AND the current time being inside
`[start_time, end_time]`. Both conditions must hold.

A participant registers exactly one of two ways — never both at once
(`EventRegistrationInput._create_xor_join` rejects a request naming both a
`team_name` and a `team_id`):

  * Solo: neither `team_name` nor `team_id` set. Refused with 400 if the
    event's `team.allow_single_registration` is false and `team.max` > 1.
  * As a team: `team_name` creates a new team and becomes its leader — its
    `team_id` is backend-assigned via `EventIDGenerator.next_team_id`, the
    same generator that assigns `event_id` and `round_id`, never chosen by
    the client. `team_id` joins an existing team as a member, refused with
    404/400 if that team does not exist for this event or is already at
    `team.max`. See `_resolve_registration_team`.
"""
import asyncio
import json
import uuid
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from logger import (
    OUTCOME_ALLOWED, OUTCOME_DENIED, OUTCOME_DUPLICATE,
    log_audit, log_batch, log_denied, log_integrity, log_scan,
)
from typing import Literal, Optional, List
from datetime import datetime
import random

import log_config

from models import (
    EventCreateRequest,
    EventUpdateRequest,
    EventRegistrationInput,
    EventTeamAssignRequest,
    EventTeamRoleUpdateRequest,
    AnnouncementCreateRequest,
    ScanQRRequest,
    parse_instant_utc,
)
from database import event_collection, participants_collection, backend_teams_collection, event_logs_collection
from dependencies import get_current_user, get_current_staff, get_current_participant, verify_qr
from embedding_service import generate_embedding
from id_generator import EVENT_TYPE_CODES, EventIDGenerator

generator = EventIDGenerator()

router = APIRouter(prefix="/events", tags=["Events"])

_log = log_config.get_logger("paradox.events")


# ── shared helpers ───────────────────────────────────────────────────────────

def _is_super_admin(current_user: dict) -> bool:
    user_id = current_user.get("paradox_id")
    return bool(
        backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"})
        or current_user.get("role") == "super_admin"
    )


def _require_super_admin(current_user: dict) -> None:
    if not _is_super_admin(current_user):
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_super_admin",
            details={"resource": "events", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Only Super Admins can perform this action")


def _registration_open(event: dict) -> bool:
    """
    Effective open/closed state: the manual override AND the time window,
    both required. Neither alone is authoritative — an admin can force-close
    early with `allowed=False`, but cannot force registration open outside the
    published window.
    """
    registration = event.get("registration") or {}
    if not registration.get("allowed", True):
        return False
    start = registration.get("start_time")
    end = registration.get("end_time")
    if not start or not end:
        return False
    try:
        start_dt = parse_instant_utc(start, "start_time")
        end_dt = parse_instant_utc(end, "end_time")
    except ValueError:
        # Registration reads as closed forever, for every participant, with no
        # symptom other than an event nobody can sign up for. An admin looking at
        # the event sees `allowed: true` and a window that has not passed, and no
        # explanation anywhere. This is the explanation.
        log_integrity(
            "event registration treated as closed: its window will not parse",
            reason="registration_window_unparseable",
            details={
                "event_id": event.get("event_id"),
                "start_type": type(start).__name__,
                "end_type": type(end).__name__,
            },
        )
        return False
    now = datetime.utcnow()
    return start_dt <= now <= end_dt


def _with_computed_registration(event: dict) -> dict:
    """Attaches `registration.is_open` without persisting it — it is derived,
    never stored, so it can never drift from the fields it is derived from."""
    registration = dict(event.get("registration") or {})
    registration["is_open"] = _registration_open(event)
    event = dict(event)
    event["registration"] = registration
    return event


def _stored_event_type(event: dict) -> str:
    """
    This event's `event_type`, checked before it reaches an id generator.

    Every id this module mints — round ids, team ids — derives its prefix from the
    event type, and for a *stored* event that value has never been validated by any
    request model: `EventCreateRequest.event_type` is a `Literal`, but a document
    written by a migration or by hand is not bound by it.

    Reading it back and handing it straight to the generator therefore turned bad
    stored data into an opaque 500 (an `UnboundLocalError` on an unassigned prefix
    variable). Resolved once, here, so the four call sites read the same and a corrupt
    document reports which field is wrong instead of crashing.
    """
    event_type = event.get("event_type", "others")
    if event_type not in EVENT_TYPE_CODES:
        log_integrity(
            "event has an event_type no id generator recognises",
            reason="stored_event_type_unknown",
            details={
                "event_id": event.get("event_id"),
                "event_type": str(event_type),
                "known_types": sorted(EVENT_TYPE_CODES),
            },
        )
        raise HTTPException(
            status_code=422,
            detail=f"This event's event_type {event_type!r} is not one of "
                   f"{sorted(EVENT_TYPE_CODES)}; it cannot be used to generate ids",
        )
    return event_type


def _event_team_role(event: dict, user_id: str) -> Optional[str]:
    for member in event.get("event_team", []):
        if str(member.get("user_id")) == str(user_id):
            return member.get("role")
    return None


def _is_event_team_member(event: dict, user_id: str) -> bool:
    return _event_team_role(event, user_id) is not None


def _is_event_head(event: dict, user_id: str) -> bool:
    return _event_team_role(event, user_id) == "event_head"


# ── create / read ────────────────────────────────────────────────────────────

@router.post("")
def create_event(request: EventCreateRequest, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user)

    schedule_data = []
    for rnd in request.schedule:
        schedule_data.append({
            "round_id": generator.next_round_id(request.event_type),
            "name": rnd.name,
            "description": rnd.description,
            "start_time": rnd.start_time,
            "end_time": rnd.end_time,
            "venue": rnd.venue
        })

    new_event = {
        "event_id": generator.next_event_id(request.event_type),
        "event_type": request.event_type,
        "name": request.name,
        "description": request.description,
        "embedding": generate_embedding(request.description),
        "poster": request.poster,
        "team": request.team.model_dump(),
        "prize_money": [pm.model_dump() for pm in request.prize_money],
        "registration": request.registration.model_dump(),
        "schedule": schedule_data,
        "registration_fields": [rf.model_dump() for rf in request.registration_fields],
        "event_team": [],
        "announcements": [],
        "created_by": current_user["_id"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    event_collection.insert_one(new_event)
    log_audit(current_user, "CREATE_EVENT", new_event["event_id"], {"event_name": new_event["name"]})
    return {"message": "Event created", "event_id": new_event["event_id"]}


@router.get("")
def list_events(current_user: dict = Depends(get_current_user)):
    """
    `created_by` holds the creating admin's raw ObjectId, which is not JSON
    serialisable, so it is projected out. There is no `logs` field to project
    out any more — the registration roster mirror was removed; the source of
    truth is `participants.events[]`, read by `/capacity` and `/participation`.

    `registration.is_open` is attached per event without being stored, so it
    reflects `registration.allowed` and the time window at read time.
    """
    events = list(event_collection.find({}, {"_id": 0, "created_by": 0}))
    return [_with_computed_registration(e) for e in events]


# Allow-list of the fields that make up the published festival brochure.
# Written as an inclusion projection on purpose: any field added to the events
# collection later stays private until it is named here explicitly.
PUBLIC_EVENT_FIELDS = {
    "_id": 0,
    "event_id": 1,
    "event_type": 1,
    "name": 1,
    "description": 1,
    "embedding": 1,
    "poster": 1,
    "team": 1,
    "prize_money": 1,
    "registration": 1,
    "schedule": 1,
}


@router.get("/public")
def list_public_events():
    """
    The festival brochure — every event, readable without signing in.

    Deliberately unauthenticated: this is the pre-login events catalogue the
    landing page renders, and it must work for a visitor with no account. Only
    the published fields above are returned — never `event_team` (staff
    identities), `registration_fields`, `announcements`, or internal
    bookkeeping.

    Declared before any `/{event_id}` route so the literal path is not
    captured as an event id.
    """
    events = list(event_collection.find({}, PUBLIC_EVENT_FIELDS))
    return [_with_computed_registration(e) for e in events]


# ── update / delete ──────────────────────────────────────────────────────────

@router.put("/{event_id}")
def update_event(event_id: str, request: EventUpdateRequest, current_user: dict = Depends(get_current_staff)):
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    _require_super_admin(current_user)

    update_data = {k: v for k, v in request.model_dump(exclude_unset=True).items() if v is not None}

    if "team" in update_data:
        update_data["team"] = request.team.model_dump()
    if "prize_money" in update_data:
        update_data["prize_money"] = [pm.model_dump() for pm in request.prize_money]
    if "registration" in update_data:
        # `RegistrationWindowUpdate` is partial — merge onto what's stored so a
        # request that only flips `allowed` cannot blank `start_time`/`end_time`.
        merged = dict(event.get("registration") or {})
        merged.update({k: v for k, v in request.registration.model_dump().items() if v is not None})
        if not merged.get("start_time") or not merged.get("end_time"):
            raise HTTPException(status_code=422, detail="registration.start_time and end_time are required")
        if parse_instant_utc(merged["end_time"], "end_time") <= parse_instant_utc(merged["start_time"], "start_time"):
            raise HTTPException(status_code=422, detail="registration.end_time must be after start_time")
        update_data["registration"] = merged
    if "schedule" in update_data:
        update_data["schedule"] = [
            {
                "round_id": rnd.round_id or generator.next_round_id(_stored_event_type(event)),
                "name": rnd.name,
                "description": rnd.description,
                "start_time": rnd.start_time,
                "end_time": rnd.end_time,
                "venue": rnd.venue,
            }
            for rnd in request.schedule
        ]
    if "registration_fields" in update_data:
        update_data["registration_fields"] = [rf.model_dump() for rf in request.registration_fields]

    if "description" in update_data and event.get("description") != update_data["description"]:
        update_data["embedding"] = generate_embedding(update_data["description"])

    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        event_collection.update_one({"event_id": event_id}, {"$set": update_data})
    log_audit(current_user, "UPDATE_EVENT", event_id, {"fields_updated": list(update_data.keys())})
    return {"message": "Event updated successfully"}


@router.delete("/{event_id}")
def delete_event(event_id: str, current_user: dict = Depends(get_current_staff)):
    _require_super_admin(current_user)

    # A mistyped id used to answer 200 "Event deleted" and write a DELETE_EVENT
    # row all the same, so the trail recorded a deletion that never happened and
    # the client could not tell it from a real one. Every other write in this
    # module 404s on an unknown event; the destructive one now does too.
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        log_denied(
            current_user, "DELETE_EVENT_DENIED", event_id,
            reason="event_not_found",
            details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Event not found")

    result = participants_collection.update_many(
        {"events.event_id": event["_id"]},
        {"$pull": {"events": {"event_id": event["_id"]}}}
    )
    event_collection.delete_one({"event_id": event_id})
    log_audit(current_user, "DELETE_EVENT", event_id, {
        "name": event.get("name"),
        "event_type": event.get("event_type"),
        "registrations_removed": result.modified_count,
    })
    return {"message": "Event deleted"}


# ── team management ──────────────────────────────────────────────────────────

@router.post("/{event_id}/team")
def assign_event_team(event_id: str, request: EventTeamAssignRequest, current_user: dict = Depends(get_current_staff)):
    """
    Add a staff member to this event's team.

    A `user_id` must reference an existing `backend_teams` account — an event
    team names people who can scan, allocate teams, and post announcements,
    and an id nobody holds would grant those to nothing.

    One person, one event: enforced by refusing the assignment if `user_id` is
    already on *any* event's team, this one included (an existing member is
    changed via `PATCH .../team/{user_id}`, not re-added via `POST`).
    """
    _require_super_admin(current_user)

    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not backend_teams_collection.find_one({"paradox_id": request.user_id}):
        raise HTTPException(status_code=404, detail="user_id must reference an existing backend_teams member")

    existing_event = event_collection.find_one({"event_team.user_id": request.user_id})
    if existing_event:
        if existing_event["event_id"] == event_id:
            raise HTTPException(
                status_code=409,
                detail="Already on this event's team; use PATCH to change their role",
            )
        raise HTTPException(
            status_code=409,
            detail=f"user_id is already on the team of event {existing_event['event_id']}; "
                   "a person may be on only one event's team",
        )

    event_collection.update_one(
        {"event_id": event_id},
        {"$push": {"event_team": {"role": request.role, "user_id": request.user_id}}}
    )
    log_audit(current_user, "ASSIGN_EVENT_TEAM", event_id, {"assigned_user": request.user_id, "role": request.role})
    return {"message": "Team member assigned"}


@router.patch("/{event_id}/team/{team_user_id}")
def update_event_team_role(
    event_id: str,
    team_user_id: str,
    request: EventTeamRoleUpdateRequest,
    current_user: dict = Depends(get_current_staff),
):
    _require_super_admin(current_user)

    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not _is_event_team_member(event, team_user_id):
        raise HTTPException(status_code=404, detail="user_id is not on this event's team")

    event_collection.update_one(
        {"event_id": event_id, "event_team.user_id": team_user_id},
        {"$set": {"event_team.$.role": request.role}}
    )
    log_audit(current_user, "UPDATE_EVENT_TEAM_ROLE", event_id, {"team_user_id": team_user_id, "role": request.role})
    return {"message": "Team member role updated"}


@router.delete("/{event_id}/team/{team_user_id}")
def remove_event_team_member(event_id: str, team_user_id: str, current_user: dict = Depends(get_current_staff)):
    """Frees this person up to be assigned to a different event's team."""
    _require_super_admin(current_user)

    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not _is_event_team_member(event, team_user_id):
        raise HTTPException(status_code=404, detail="user_id is not on this event's team")

    event_collection.update_one(
        {"event_id": event_id},
        {"$pull": {"event_team": {"user_id": team_user_id}}}
    )
    log_audit(current_user, "REMOVE_EVENT_TEAM_MEMBER", event_id, {"team_user_id": team_user_id})
    return {"message": "Team member removed"}


# ── registration ─────────────────────────────────────────────────────────────

def _validate_registration_data(event: dict, registration_data: dict) -> None:
    """Every `registration_fields` entry marked `required` must be present and
    non-empty in what the participant submitted."""
    registration_data = registration_data or {}
    missing = []
    for field in event.get("registration_fields", []):
        if not field.get("required"):
            continue
        field_id = field.get("field_id")
        value = registration_data.get(field_id)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(field.get("label") or field_id)
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing required registration field(s): {', '.join(missing)}",
        )


def _team_size(event: dict, team_id: str) -> int:
    """How many participants are currently registered under this team_id for
    this event. Team membership lives only on `participants.events[]` — there
    is no roster mirror on the event document — so counting means querying
    the participants collection, the same source `event_capacity` and
    `view_participation` already read from."""
    return participants_collection.count_documents({
        "events": {"$elemMatch": {"event_id": event["_id"], "team_id": team_id}}
    })


def _resolve_registration_team(event: dict, reg_input: Optional[EventRegistrationInput]) -> tuple:
    """
    Solo vs. team, decided once, in one place, so `register_for_event` cannot
    drift between what it validates and what it writes.

    Returns ``(team_id, team_role)`` — both ``None``/``"solo"`` for a solo
    registration. Raises the same `HTTPException`s the route used to raise
    inline.

    A team_name and a team_id are mutually exclusive at the schema layer
    already (`EventRegistrationInput._create_xor_join`); everything here is
    validation that depends on *this event's* rules, which the model itself
    has no way to see.
    """
    team_rules = event.get("team", {})
    max_size = team_rules.get("max", 1)
    allow_solo = team_rules.get("allow_single_registration", True)

    team_name = reg_input.team_name if reg_input else None
    team_id = reg_input.team_id if reg_input else None

    if (team_name or team_id) and max_size <= 1:
        raise HTTPException(
            status_code=400,
            detail="This event does not support team registration",
        )

    if team_name:
        # Creating a team. The id is backend-assigned — the same way event_id
        # and round_id are — so `team_name` is stored purely as a display
        # label alongside it, never used as the id itself.
        new_team_id = generator.next_team_id(_stored_event_type(event))
        return new_team_id, "leader"

    if team_id:
        current_size = _team_size(event, team_id)
        if current_size == 0:
            raise HTTPException(status_code=404, detail="No team found with that team_id for this event")
        if current_size >= max_size:
            raise HTTPException(status_code=400, detail="This team is already full")
        return team_id, "member"

    # Solo — `team_role` stays "member" (no team_id) for this case, matching
    # the label already used for anyone on a team who isn't its leader.
    if not allow_solo and max_size > 1:
        raise HTTPException(
            status_code=400,
            detail="This event requires team registration; provide team_name to create a "
                   "team or team_id to join one",
        )
    return None, "member"


@router.post("/{event_id}/register")
def register_for_event(event_id: str, reg_input: Optional[EventRegistrationInput] = None, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can register for events")

    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not _registration_open(event):
        raise HTTPException(status_code=400, detail="Registration is closed for this event")

    user_events = current_user.get("events", [])
    if any(str(ev.get("event_id")) == str(event["_id"]) for ev in user_events):
        raise HTTPException(status_code=409, detail="User is already registered for this event.")

    # Block event team members from registering as participants for their own event.
    # backend_teams.admin_id is an ObjectId reference to the participant's _id document.
    backend_member = backend_teams_collection.find_one({"admin_id": current_user["_id"]})
    if backend_member:
        paradox_id = backend_member.get("paradox_id")
        if _is_event_team_member(event, paradox_id):
            raise HTTPException(
                status_code=403,
                detail="Event team members cannot register as participants for their own event."
            )

    registration_data = reg_input.registration_data if reg_input else {}
    _validate_registration_data(event, registration_data)

    team_id, team_role = _resolve_registration_team(event, reg_input)

    registration_entry = {
        "team_id": team_id,
        "event_id": event["_id"],
        "team_role": team_role,
        "registration_data": registration_data
    }

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$push": {"events": registration_entry}}
    )
    log_audit(current_user, "EVENT_REGISTER", event_id, {"team_id": team_id, "team_role": team_role})

    response = {"message": "Registered for event successfully.", "team_role": team_role}
    if team_id:
        response["team_id"] = team_id
    return response


@router.put("/{event_id}/register")
def edit_event_registration(event_id: str, reg_input: EventRegistrationInput, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can edit event registrations")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not _registration_open(event):
        raise HTTPException(status_code=400, detail="Registration is closed")

    _validate_registration_data(event, reg_input.registration_data)

    result = participants_collection.update_one(
        {"_id": current_user["_id"], "events.event_id": event["_id"]},
        {"$set": {"events.$.registration_data": reg_input.registration_data}}
    )
    if result.matched_count == 0:
        log_denied(
            current_user, "EVENT_REGISTRATION_EDIT_DENIED", event_id,
            reason="not_registered_for_event",
            details={"participant_id": current_user.get("participant_id")},
        )
        raise HTTPException(status_code=404, detail="Not registered for this event")

    # `EVENT_REGISTER` and `EVENT_DEREGISTER` were both audited; the edit in between
    # was not, so a registration's answers could be rewritten with no record. Field
    # *names* only — `registration_data` holds whatever the event asked for, which
    # for many events is personal information.
    log_audit(current_user, "EVENT_REGISTRATION_EDIT", event_id, {
        "participant_id": current_user.get("participant_id"),
        "fields_updated": sorted((reg_input.registration_data or {}).keys()),
    })
    return {"message": "Registration updated"}


@router.delete("/{event_id}/register")
def deregister_event(event_id: str, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants can deregister")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not _registration_open(event):
        raise HTTPException(status_code=400, detail="Registration is closed")

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$pull": {"events": {"event_id": event["_id"]}}}
    )
    log_audit(current_user, "EVENT_DEREGISTER", event_id, {
        # The team they were in, captured before the pull removes it. Losing a member
        # can drop a team below `team.min`, and afterwards nothing links this person
        # to the team they left.
        "participant_id": current_user.get("participant_id"),
        "team_id": next(
            (
                ev.get("team_id")
                for ev in current_user.get("events") or []
                if str(ev.get("event_id")) == str(event["_id"])
            ),
            None,
        ),
    })
    return {"message": "Deregistered successfully"}


@router.get("/my_registrations")
def my_registrations(current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        return []
    events = current_user.get("events", [])
    for ev in events:
        if "event_id" in ev and not isinstance(ev["event_id"], str):
            ev["event_id"] = str(ev["event_id"])
    return events


def _unique_attendance_today(event: dict) -> int:
    """
    How many distinct participants have been scanned in today.

    ``POST /events/{event_id}/scan`` dedupes on
    ``(event, participant, scanner, day)`` — *including the scanner* — so that
    each volunteer keeps an accurate tally of their own gate in
    ``my_daily_scans``. The side effect is that one participant admitted by two
    volunteers writes two rows, and simply counting rows reported a half-empty
    venue as full.

    Counting distinct ``participant_id`` values instead keeps both readings
    correct: the per-scanner rows stay exactly as they were, so ``my_daily_scans``
    and the ``logs`` audit trail are untouched, while every *attendance* figure
    counts heads.
    """
    day_str = datetime.utcnow().strftime("%Y-%m-%d")
    return len(event_logs_collection.distinct("participant_id", {
        "event_id": str(event["_id"]),
        "day": day_str
    }))


@router.get("/{event_id}/capacity")
def event_capacity(event_id: str, current_user: dict = Depends(get_current_user)):
    """
    How full this event is right now, as counts and nothing else — Story 3.3.

    This is deliberately the only fullness figure a *participant* can read. Every
    other one is staff-gated because every other one returns identities:
    ``participation`` needs ``get_current_staff`` and hands back the roster,
    ``logs`` needs ``super_admin`` and hands back the scan rows. A participant
    deciding whether to walk to a venue needs neither — they need two integers.

    So this returns two integers. No ``participant_id``, no name, no email, no
    registration data, for anybody. It is safe to expose precisely because there
    is nothing in it to leak.

    ``registered`` is counted from the participants collection, which
    ``deregister_event`` pulls from, so it falls when somebody cancels rather
    than only ever rising.

    ``attended_today`` counts distinct participants, not scan rows — see
    ``_unique_attendance_today``.

    The published capacity is **not** returned. It already rides in the event's
    ``registration`` map, which both ``GET /events`` and ``GET /events/public``
    already return in full, so the client that asks this question is holding it
    already. Parsing it in a second place is how two places come to disagree.
    """
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    return {
        "event_id": event_id,
        "registered": participants_collection.count_documents({"events.event_id": event["_id"]}),
        "attended_today": _unique_attendance_today(event)
    }


@router.get("/{event_id}/participation")
def view_participation(event_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    admin_doc = backend_teams_collection.find_one({"paradox_id": user_id})
    is_super_admin = admin_doc and admin_doc.get("role") == "super_admin"
    is_event_team = _is_event_team_member(event, user_id)

    is_uhc = admin_doc and admin_doc.get("department") == "uhc"
    is_dept_admin = admin_doc and admin_doc.get("department") == event.get("event_type")

    if not (is_super_admin or is_event_team or is_uhc or is_dept_admin):
        raise HTTPException(status_code=403, detail="Not authorized to view participation details")

    participants = list(participants_collection.find({"events.event_id": event["_id"]}))

    result = []
    for p in participants:
        ev_reg = next((ev for ev in p.get("events", []) if str(ev["event_id"]) == str(event["_id"])), None)
        prof = p.get("profile", {})

        # UHC filtering logic
        if is_uhc and not is_super_admin and not is_event_team:
            email = admin_doc.get("email", "")
            admin_house = email.split("-")[0].lower() if "-" in email else None
            # `(... or "")` rather than `.get("house", "")`: the default only applies
            # to a *missing* key, so a profile storing an explicit `house: None` — the
            # ordinary state of an account that has not completed registration — used
            # to reach `.lower()` on None and answer 500 for the whole roster, because
            # of one incomplete participant.
            participant_house = (prof.get("house") or "").lower()
            if participant_house != admin_house:
                continue

        result.append({
            "participant_id": p.get("participant_id"),
            "name": prof.get("full_name"),
            "email": p.get("email"),
            "phone": prof.get("phone"),
            "house": prof.get("house"),
            "team_id": ev_reg.get("team_id") if ev_reg else None,
            "team_role": ev_reg.get("team_role") if ev_reg else None
        })

    # Fetch event team details
    event_team_details = []
    for member in event.get("event_team", []):
        admin_id = member.get("user_id")
        # Could be in backend_teams or participants (if they are a student volunteer)
        # Pull profile details
        admin = backend_teams_collection.find_one({"paradox_id": admin_id})
        member_name = "Unknown"
        member_phone = "Unknown"
        if admin:
            member_name = admin.get("designation", "Admin")

        # Try to find participant if they have a student profile
        p_doc = participants_collection.find_one({"participant_id": admin_id})

        if p_doc:
            prof = p_doc.get("profile", {})
            member_name = prof.get("full_name", member_name)
            member_phone = prof.get("phone", member_phone)

        event_team_details.append({
            "user_id": str(admin_id),
            "role": member.get("role"),
            "name": member_name,
            "phone": member_phone
        })

    response_data = {
        "count": len(result),
        "participants": result,
        "event_team": event_team_details
    }

    if not is_uhc:
        response_data["total_daily_scans"] = _unique_attendance_today(event)

    return response_data


@router.post("/{event_id}/allocate_teams")
def allocate_teams(event_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        log_denied(
            current_user, "ALLOCATE_EVENT_TEAMS_DENIED", event_id,
            reason="event_not_found", details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Event not found")

    if not _is_event_head(event, user_id):
        log_denied(
            current_user, "ALLOCATE_EVENT_TEAMS_DENIED", event_id,
            reason="not_event_head", details={"status": 403},
        )
        raise HTTPException(status_code=403, detail="Only Event Heads are authorized to allocate teams")

    team_rules = event.get("team", {})
    min_size = team_rules.get("min", 1)
    max_size = team_rules.get("max", 1)

    if max_size <= 1:
        # A 200 that did nothing, and unaudited. An Event Head who runs allocation on
        # a solo event gets "Not a team event" and no record that they tried — and if
        # `team.max` is missing from the document entirely it defaults to 1 and lands
        # here too, which looks the same but is a data problem.
        log_config.info(
            _log,
            f"team allocation skipped for {event_id}: not a team event",
            {
                "event_id": event_id,
                "reason": "not_a_team_event",
                "team_max": team_rules.get("max"),
                "team_rules_present": bool(team_rules),
            },
        )
        return {"message": "Not a team event"}

    participants = list(participants_collection.find({"events.event_id": event["_id"]}))
    solo_players = []

    for p in participants:
        ev_reg = next((ev for ev in p.get("events", []) if str(ev["event_id"]) == str(event["_id"])), None)
        if ev_reg and not ev_reg.get("team_id"):
            solo_players.append(p)

    random.shuffle(solo_players)
    teams_created = 0
    # Participants this run leaves without a team, and the groups that were too
    # small to form one. Collected so the summary can report the complement of
    # `teams_created` rather than only the successes.
    unteamed: List[Optional[str]] = []
    dropped_chunks: List[dict] = []

    log_config.info(
        _log,
        f"event team allocation starting for {event_id}",
        {
            "event_id": event_id,
            "registered": len(participants),
            "unteamed_candidates": len(solo_players),
            "team_min": min_size,
            "team_max": max_size,
            "house_vs_house": bool(team_rules.get("house_vs_house_event", False)),
        },
    )

    if team_rules.get("house_vs_house_event", False):
        # Group by house
        house_groups = {}
        for sp in solo_players:
            house = sp.get("profile", {}).get("house", "Unknown")
            house_groups.setdefault(house, []).append(sp)

        for house, players in house_groups.items():
            for i in range(0, len(players), max_size):
                team_chunk = players[i:i+max_size]
                if len(team_chunk) >= min_size:
                    # Same `next_team_id` a participant-created team gets, so
                    # every team_id in this event — self-formed or
                    # auto-allocated — comes from the one counter.
                    team_id = generator.next_team_id(_stored_event_type(event))
                    for p in team_chunk:
                        assign_result = participants_collection.update_one(
                            {"_id": p["_id"], "events.event_id": event["_id"]},
                            {"$set": {"events.$.team_id": team_id, "events.$.team_role": "member"}}
                        )
                        if assign_result.matched_count == 0:
                            log_integrity(
                                "team assignment matched no registration",
                                reason="team_assign_not_applied",
                                details={
                                    "participant_id": p.get("participant_id"),
                                    "event_id": event_id,
                                    "team_id": team_id,
                                },
                            )
                    teams_created += 1
                else:
                    # A trailing group too small to form a team. Because this runs once
                    # per house, an event with many small houses can leave a large
                    # fraction of its entrants teamless — and every one of them keeps
                    # `team_id: None`, which is indistinguishable from never having
                    # been through allocation at all. They are named here.
                    unteamed.extend(p.get("participant_id") for p in team_chunk)
                    dropped_chunks.append(
                        {"house": house, "size": len(team_chunk), "min_required": min_size}
                    )
    else:
        # Mixed random
        for i in range(0, len(solo_players), max_size):
            team_chunk = solo_players[i:i+max_size]
            if len(team_chunk) >= min_size:
                team_id = generator.next_team_id(_stored_event_type(event))
                for p in team_chunk:
                    assign_result = participants_collection.update_one(
                        {"_id": p["_id"], "events.event_id": event["_id"]},
                        {"$set": {"events.$.team_id": team_id, "events.$.team_role": "member"}}
                    )
                    if assign_result.matched_count == 0:
                        log_integrity(
                            "team assignment matched no registration",
                            reason="team_assign_not_applied",
                            details={
                                "participant_id": p.get("participant_id"),
                                "event_id": event_id,
                                "team_id": team_id,
                            },
                        )
                teams_created += 1
            else:
                unteamed.extend(p.get("participant_id") for p in team_chunk)
                dropped_chunks.append({"house": None, "size": len(team_chunk), "min_required": min_size})

    for participant_id in unteamed:
        log_denied(
            current_user,
            "EVENT_TEAM_ALLOCATION_SKIPPED",
            participant_id,
            reason="group_below_minimum_size",
            details={"event_id": event_id, "team_min": min_size, "team_max": max_size},
        )

    log_batch(
        current_user,
        "ALLOCATE_EVENT_TEAMS",
        event_id,
        {
            # Unchanged and still first, for existing readers.
            "teams_created": teams_created,
            "candidates": len(solo_players),
            "teamed_count": len(solo_players) - len(unteamed),
            "unteamed_count": len(unteamed),
            "unteamed": [pid for pid in unteamed if pid],
            "dropped_groups": dropped_chunks,
            "team_min": min_size,
            "team_max": max_size,
        },
    )
    if unteamed:
        log_config.warning(
            _log,
            f"event team allocation left {len(unteamed)} of {len(solo_players)} candidate(s) without a team",
            {
                "event_id": event_id,
                "reason": "groups_below_minimum_size",
                "unteamed_count": len(unteamed),
                "dropped_groups": dropped_chunks,
            },
        )
    return {"message": f"Allocated {teams_created} teams"}


@router.post("/{event_id}/scan")
def scan_event_participant(event_id: str, request: ScanQRRequest, current_user: dict = Depends(get_current_staff)):
    """
    Admit one participant at an event gate.

    This route had the largest blind spot in the system. A scan of somebody not
    registered for the event returned **200** with `is_participating: false` and
    wrote nothing at all — no log row, no audit row — so a refused entry was
    indistinguishable from no scan ever having happened. It was also the only scan
    endpoint in the codebase with no `log_audit` call of any kind, successful or
    otherwise.

    The response is deliberately unchanged, including the 200 for a non-participant:
    the gate app decides what to show from `is_participating`, and changing the
    status code would break it. What changes is that all three outcomes — admitted,
    refused, and already-scanned — now leave a record.
    """
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        log_denied(
            current_user, "EVENT_SCAN_DENIED", event_id,
            reason="event_not_found", details={"scan_domain": "event"},
        )
        raise HTTPException(status_code=404, detail="Event not found")

    if not _is_event_team_member(event, user_id):
        log_denied(
            current_user, "EVENT_SCAN_DENIED", event_id,
            reason="not_on_event_team",
            details={"scan_domain": "event", "team_size": len(event.get("event_team") or [])},
        )
        raise HTTPException(status_code=403, detail="Not authorized to scan for this event")

    target_user, _ = verify_qr(request, actor=current_user, domain="event", target_id=event_id)

    is_participating = any(str(ev.get("event_id")) == str(event["_id"]) for ev in target_user.get("events", []))

    # Log successful scan
    if is_participating:
        now = datetime.utcnow()
        # Create a unique key for today to ensure we only log unique scans per participant per day per event per scanner
        day_str = now.strftime("%Y-%m-%d")
        log_filter = {
            "event_id": str(event["_id"]),
            "participant_id": target_user.get("participant_id"),
            "scanned_by": user_id,
            "day": day_str
        }
        already_logged = event_logs_collection.find_one(log_filter)
        if not already_logged:
            log_entry = {**log_filter, "timestamp": now}
            event_logs_collection.insert_one(log_entry)
            log_scan(
                current_user, "event", "EVENT_SCAN", OUTCOME_ALLOWED,
                participant_id=target_user.get("participant_id"),
                target_id=event_id,
                details={"day": day_str, "event_oid": str(event["_id"])},
            )
        else:
            # A repeat scan by the same volunteer on the same day. The dedupe made
            # this a silent no-op returning 200, so a queue being scanned twice and
            # a queue being scanned once looked identical. Recorded as `duplicate`,
            # not `denied` — the participant is admitted either way — and it is what
            # explains why a volunteer's own `my_daily_scans` tally is lower than the
            # number of people they physically scanned.
            log_scan(
                current_user, "event", "EVENT_SCAN_DUPLICATE", OUTCOME_DUPLICATE,
                participant_id=target_user.get("participant_id"),
                target_id=event_id,
                reason="already_scanned_today_by_this_scanner",
                details={"day": day_str, "first_scanned_at": already_logged.get("timestamp")},
            )
    else:
        # The refusal that left no trace whatsoever. A student turned away from an
        # event they believe they registered for now produces a row naming them, the
        # gate, the volunteer, and how many events they *are* registered for — which
        # is what separates "never registered" from "registered for a different
        # event" from "deregistered without realising".
        log_scan(
            current_user, "event", "EVENT_SCAN_UNREGISTERED", OUTCOME_DENIED,
            participant_id=target_user.get("participant_id"),
            target_id=event_id,
            reason="not_registered_for_event",
            details={
                "event_oid": str(event["_id"]),
                "registrations_held": len(target_user.get("events") or []),
                # 200 is still returned; this makes clear in the trail that the gate
                # app, not this endpoint, decided whether to let them in.
                "http_status": 200,
            },
        )

    return {
        "name": target_user.get("profile", {}).get("full_name"),
        "email": target_user.get("email"),
        "is_participating": is_participating
    }


@router.get("/{event_id}/my_daily_scans")
def my_daily_scans(event_id: str, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not _is_event_team_member(event, user_id):
        raise HTTPException(status_code=403, detail="Not authorized")

    day_str = datetime.utcnow().strftime("%Y-%m-%d")
    count = event_logs_collection.count_documents({
        "event_id": str(event["_id"]),
        "scanned_by": user_id,
        "day": day_str
    })

    return {"daily_unique_scans": count}


@router.get("/{event_id}/logs")
def event_logs(event_id: str, current_user: dict = Depends(get_current_staff)):
    """
    Every attendance scan recorded for this event.

    These rows have always been written by ``POST /events/{event_id}/scan`` but
    nothing read them back: participation only reported *today's* count, and
    ``my_daily_scans`` only the caller's own. That left the per-event attendance
    history unreachable, which is what the dashboard's event log view needs.

    Mirrors ``GET /workshops/{workshop_id}/logs`` — same super-admin gate, same
    ``{"logs": [...]}`` envelope — so the two read identically on the client.

    Rows key on the event's ObjectId, not its readable ``event_id``, so the lookup
    happens here rather than being a detail every caller has to know.
    """
    _require_super_admin(current_user)

    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    logs = list(
        event_logs_collection
        .find({"event_id": str(event["_id"])}, {"_id": 0})
        .sort("timestamp", -1)
    )
    log_audit(current_user, "READ_EVENT_LOGS", event_id, {"returned": len(logs)})
    return {"logs": logs}


class TeamUpdateInput(BaseModel):
    """
    A partial update: a head may move a participant without restating their role,
    or change the role without restating the team.

    Both fields default to ``None``, so "absent" and "explicitly null" look the
    same on the model — the route separates them with ``model_fields_set``
    instead. Only ``team_id`` is nullable in the data: clearing it takes the
    participant off their team, whereas a stored ``team_role`` is always one of
    `models.PARTICIPANT_TEAM_ROLES` — "leader" or "member".
    """
    team_id: Optional[str] = None
    team_role: Optional[Literal["leader", "member"]] = None


@router.put("/{event_id}/participant_teams/{participant_id}")
def update_participant_team(event_id: str, participant_id: str, payload: TeamUpdateInput, current_user: dict = Depends(get_current_staff)):
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not _is_event_head(event, user_id):
        log_denied(
            current_user, "UPDATE_EVENT_TEAM_DENIED", event_id,
            reason="not_event_head",
            details={"participant_id": participant_id, "status": 403},
        )
        raise HTTPException(status_code=403, detail="Only Event Heads are authorized to modify participant teams")

    participant = participants_collection.find_one({"participant_id": participant_id, "events.event_id": event["_id"]})
    if not participant:
        log_denied(
            current_user, "UPDATE_EVENT_TEAM_DENIED", event_id,
            reason="participant_not_registered",
            details={"participant_id": participant_id},
        )
        raise HTTPException(status_code=404, detail="Participant not registered for this event")

    previous = next(
        (ev for ev in participant.get("events") or [] if str(ev.get("event_id")) == str(event["_id"])),
        {},
    )

    def refuse(reason: str, detail: str) -> HTTPException:
        log_denied(
            current_user, "UPDATE_EVENT_TEAM_DENIED", event_id,
            reason=reason,
            details={"participant_id": participant_id, "status": 400},
        )
        return HTTPException(status_code=400, detail=detail)

    # An empty body used to be an accepted request that wrote null over both
    # fields, quietly dropping the participant out of their team — the caller
    # asked for nothing and got a mutation. Absent fields are now left alone,
    # and a request that names neither is refused rather than guessed at.
    supplied = payload.model_fields_set
    if not supplied:
        raise refuse("no_fields_supplied", "Provide team_id or team_role to update")

    clearing_team = "team_id" in supplied and payload.team_id is None

    team_id = payload.team_id if "team_id" in supplied else previous.get("team_id")
    if "team_role" in supplied:
        team_role = payload.team_role
    elif clearing_team:
        # Off any team, they hold the role a solo registrant holds.
        team_role = "member"
    else:
        team_role = previous.get("team_role")
    # No stored registration has a null role, so neither may a moved one.
    if team_role is None:
        team_role = "member"
    if team_id is None and team_role == "leader":
        raise refuse(
            "leader_without_team",
            "A participant with no team cannot hold the team leader role",
        )

    # `team.max` is the event's own rule about how many may compete together;
    # registration enforces it (`_resolve_registration_team`) and a hand-move
    # has to as well, or a head can seat a team that the event's rules forbid.
    # Counted excluding this participant, so re-stating someone's existing team
    # is measured against the same ceiling as moving them in for the first time.
    if team_id is not None:
        team_rules = event.get("team") or {}
        max_size = team_rules.get("max", 1)
        if max_size <= 1:
            raise refuse(
                "event_has_no_teams",
                "This event does not support team registration",
            )
        others = participants_collection.count_documents({
            "participant_id": {"$ne": participant_id},
            "events": {"$elemMatch": {"event_id": event["_id"], "team_id": team_id}},
        })
        if others + 1 > max_size:
            raise refuse("team_full", "This team is already full")

    participants_collection.update_one(
        {"participant_id": participant_id, "events.event_id": event["_id"]},
        {"$set": {"events.$.team_id": team_id, "events.$.team_role": team_role}}
    )
    # Previously unaudited: an Event Head could move anybody between teams, or clear
    # their team entirely, with no trace. In a house-versus-house event that is the
    # difference between a result standing and being contested, so the row carries
    # both the old and the new team.
    log_audit(current_user, "UPDATE_EVENT_TEAM", event_id, {
        "participant_id": participant_id,
        "team_id": team_id,
        "team_role": team_role,
        "previous_team_id": previous.get("team_id"),
        "previous_team_role": previous.get("team_role"),
        "team_cleared": clearing_team,
    })
    return {"message": "Participant team updated"}


# ── announcements ────────────────────────────────────────────────────────────

def _is_registered_for(event: dict, current_user: dict) -> bool:
    if "participant_id" not in current_user:
        return False
    return any(
        str(ev.get("event_id")) == str(event["_id"])
        for ev in current_user.get("events", [])
    )


def _may_read_announcements(event: dict, current_user: dict) -> bool:
    if _is_super_admin(current_user):
        return True
    paradox_id = current_user.get("paradox_id")
    if paradox_id and _is_event_team_member(event, paradox_id):
        return True
    return _is_registered_for(event, current_user)


@router.post("/{event_id}/announcements")
def create_announcement(
    event_id: str,
    request: AnnouncementCreateRequest,
    current_user: dict = Depends(get_current_staff),
):
    """
    Publish a notification about this event to everybody registered for it.

    Restricted to the event's own Event Head, or a Super Admin — a volunteer
    or member on the team can scan and view participation, but broadcasting to
    every registrant is a head-of-event decision.

    Appended to `event.announcements`; delivered to participants via
    `GET /{event_id}/announcements` (poll) or `GET /{event_id}/announcements/stream`
    (SSE) — see below.
    """
    user_id = current_user.get("paradox_id")
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not (_is_super_admin(current_user) or _is_event_head(event, user_id)):
        raise HTTPException(status_code=403, detail="Only the Event Head can post announcements for this event")

    announcement = {
        "announcement_id": f"ANN{uuid.uuid4().hex[:12].upper()}",
        "message": request.message,
        "priority": request.priority,
        "created_by": user_id,
        "created_at": datetime.utcnow(),
    }
    event_collection.update_one(
        {"event_id": event_id},
        {"$push": {"announcements": announcement}}
    )
    log_audit(current_user, "CREATE_ANNOUNCEMENT", event_id, {"priority": request.priority})
    return {"message": "Announcement published", "announcement": announcement}


@router.get("/{event_id}/announcements")
def list_announcements(event_id: str, current_user: dict = Depends(get_current_user)):
    """
    Newest first. Readable by whoever the announcement is *for* — a registered
    participant — plus whoever might have sent it: the event's own team, or a
    Super Admin.
    """
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not _may_read_announcements(event, current_user):
        raise HTTPException(status_code=403, detail="Not authorized to read this event's announcements")

    announcements = sorted(
        event.get("announcements", []),
        key=lambda a: a.get("created_at") or datetime.min,
        reverse=True,
    )
    return announcements


def _serialise_announcement(announcement: dict) -> dict:
    body = dict(announcement)
    created_at = body.get("created_at")
    if isinstance(created_at, datetime):
        body["created_at"] = created_at.isoformat() + "Z"
    return body


async def _announcement_stream(event_id: str, event_oid, request: Request):
    """
    Poll the event document for announcements newer than what the client has
    already seen, and emit each one as an SSE frame.

    Implemented as DB polling rather than an in-memory pub/sub queue on
    purpose: an in-memory queue only reaches subscribers connected to the same
    process, which breaks the moment this API runs with more than one uvicorn
    worker (the default for any real deployment). Polling the document is
    slightly higher latency but correct regardless of worker count, and it
    needs no new infrastructure (no Redis, no message broker) beyond what this
    project already has.

    Resumable via the standard `Last-Event-ID` header: a reconnecting client
    (whether via a retrying `fetch` loop or a library that honours SSE's
    reconnection contract) is not shown announcements it already has.
    """
    last_seen_id = request.headers.get("last-event-id")
    seen_ids: set = set()

    if last_seen_id:
        # Seed `seen_ids` with every announcement up to and including the one
        # the client already has, so a reconnect does not replay history.
        current = event_collection.find_one({"_id": event_oid}, {"announcements": 1})
        for ann in (current or {}).get("announcements", []):
            seen_ids.add(ann.get("announcement_id"))
            if ann.get("announcement_id") == last_seen_id:
                break

    heartbeat_every = 15  # seconds
    poll_every = 3  # seconds
    elapsed_since_heartbeat = 0.0

    try:
        while True:
            if await request.is_disconnected():
                break

            current = event_collection.find_one({"_id": event_oid}, {"announcements": 1})
            announcements = (current or {}).get("announcements", [])
            new_ones = [a for a in announcements if a.get("announcement_id") not in seen_ids]
            new_ones.sort(key=lambda a: a.get("created_at") or datetime.min)

            for ann in new_ones:
                seen_ids.add(ann.get("announcement_id"))
                payload = json.dumps(_serialise_announcement(ann))
                yield f"id: {ann.get('announcement_id')}\nevent: announcement\ndata: {payload}\n\n"
                elapsed_since_heartbeat = 0.0

            await asyncio.sleep(poll_every)
            elapsed_since_heartbeat += poll_every
            if elapsed_since_heartbeat >= heartbeat_every:
                yield ": heartbeat\n\n"
                elapsed_since_heartbeat = 0.0
    except asyncio.CancelledError:
        # Client disconnected mid-sleep; exit quietly rather than propagating.
        return


@router.get("/{event_id}/announcements/stream")
async def stream_announcements(event_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """
    Live announcements for this event, as `text/event-stream`.

    Authenticated exactly like every other route in this API — an
    `Authorization: Bearer` header via `get_current_user` — rather than a
    `?token=` query parameter. The browser's native `EventSource` cannot send
    a header, so a browser client must instead open this with `fetch` and read
    `response.body` as a stream (or a small helper library such as
    `@microsoft/fetch-event-source` that does that parsing). This keeps the
    token out of the URL — and therefore out of server access logs, browser
    history, and any `Referer` header — matching every other endpoint here.

    Access is the same as the polling list above: the event's registered
    participants, its team, or a Super Admin.
    """
    event = event_collection.find_one({"event_id": event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not _may_read_announcements(event, current_user):
        raise HTTPException(status_code=403, detail="Not authorized to read this event's announcements")

    return StreamingResponse(
        _announcement_stream(event_id, event["_id"], request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx response buffering, if ever fronted by one
        },
    )
