from fastapi import APIRouter, HTTPException, Depends, Query
from collections import Counter
from datetime import datetime
from typing import Optional
import re

from database import participants_collection, backend_teams_collection
from dependencies import get_current_staff
from logger import log_audit, log_denied
from models import PAGE_LIMIT_MAX, ParticipantAdminUpdateRequest

router = APIRouter(prefix="/participants", tags=["Participants"])


def _require_super_admin(current_user: dict, operation: str) -> str:
    """The shared Super Admin gate for this router, with the refusal recorded."""
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        log_denied(
            current_user,
            "AUTHZ_DENIED",
            None,
            reason="not_super_admin",
            details={"operation": operation, "resource": "participants", "status": 403},
        )
        raise HTTPException(status_code=403, detail="Not authorized")
    return user_id


@router.get("/statistics")
def participant_statistics(current_user: dict = Depends(get_current_staff)):
    """
    Fest-wide participant counts, for the admin overview board.

    Counts only. No name, email, phone, address, photo, or participant id leaves
    this endpoint, so the dashboard can read fest-wide totals without exposing a
    roster — the per-entity ``/statistics`` endpoints remain the only way to see
    who is actually allotted where.

    Super Admins only, matching ``/mess/{id}/statistics`` and
    ``/hostels/{id}/statistics``.

    ``total_registered`` is every account in the ``participants`` collection,
    which is what ``POST /auth/register`` creates — a real registration total
    rather than a count of people who happen to have turned up somewhere.
    """
    user_id = _require_super_admin(current_user, "statistics")

    # Only the fields the counts below need. Password hashes, QR keypairs, and
    # every profile field that identifies somebody stay out of memory entirely.
    participants = list(participants_collection.find({}, {
        "_id": 0,
        "profile.full_name": 1,
        "profile.house": 1,
        "profile.gender": 1,
        "profile.program": 1,
        "profile.course_stage": 1,
        "mess.registered": 1,
        "mess.mess_id": 1,
        "accommodation.registered": 1,
        "accommodation.hostel_id": 1,
        "accommodation.inside": 1,
        "events": 1,
        "workshops": 1,
        "created_at": 1,
    }))

    total = len(participants)
    profile_complete = 0
    mess_registered = mess_allotted = 0
    hostel_registered = hostel_allotted = on_campus = 0
    with_events = with_workshops = 0

    houses: Counter = Counter()
    programs: Counter = Counter()
    stages: Counter = Counter()
    genders: Counter = Counter()
    signups_by_day: Counter = Counter()

    for participant in participants:
        profile = participant.get("profile") or {}
        # A profile exists as `{}` from registration until `PATCH /profile/complete`
        # fills it, so `full_name` is what separates "signed up" from "ready".
        if profile.get("full_name"):
            profile_complete += 1
        if profile.get("house"):
            houses[profile["house"]] += 1
        if profile.get("program"):
            programs[profile["program"]] += 1
        if profile.get("course_stage"):
            stages[profile["course_stage"]] += 1
        if profile.get("gender"):
            genders[profile["gender"]] += 1

        mess = participant.get("mess") or {}
        if mess.get("registered"):
            mess_registered += 1
        if mess.get("mess_id"):
            mess_allotted += 1

        accommodation = participant.get("accommodation") or {}
        if accommodation.get("registered"):
            hostel_registered += 1
        if accommodation.get("hostel_id"):
            hostel_allotted += 1
        if accommodation.get("inside"):
            on_campus += 1

        if participant.get("events"):
            with_events += 1
        if participant.get("workshops"):
            with_workshops += 1

        created = participant.get("created_at")
        if created is not None and hasattr(created, "strftime"):
            signups_by_day[created.strftime("%Y-%m-%d")] += 1

    return {
        "total_registered": total,
        "profile_complete": profile_complete,
        "profile_incomplete": total - profile_complete,
        "mess_registered": mess_registered,
        "mess_allotted": mess_allotted,
        "hostel_registered": hostel_registered,
        "hostel_allotted": hostel_allotted,
        # Never negative: allocation can only ever catch up with the queue.
        "hostel_pending": max(0, hostel_registered - hostel_allotted),
        "currently_on_campus": on_campus,
        "with_event_registrations": with_events,
        "with_workshop_registrations": with_workshops,
        "by_house": dict(houses),
        "by_program": dict(programs),
        "by_course_stage": dict(stages),
        "by_gender": dict(genders),
        # Chronological, so the client can render it as a trend without sorting
        # a dict whose key order it should not have to trust.
        "signups_by_day": dict(sorted(signups_by_day.items())),
    }


@router.get("")
def list_participants(
    q: Optional[str] = None,
    house: Optional[str] = None,
    limit: int = Query(200, ge=1, le=PAGE_LIMIT_MAX),
    current_user: dict = Depends(get_current_staff),
):
    """
    The fest-wide participant roster — Story 7.3's missing read half.

    Super Admins only, matching every other roster in the API. ``/statistics``
    above stays deliberately roster-free: a dashboard that shows totals to
    whoever can see the dashboard must not be the thing that leaks a list of
    names, so the two are separate endpoints rather than one endpoint with a
    flag.

    Projection is an allow-list. ``password_hash`` and ``qr_secrets`` are the two
    fields that must never leave this collection, and an inclusion projection
    means a field added to the schema later stays private until it is named here.
    ``photo`` and ``embedding`` are excluded for size, not secrecy — a roster of
    200 base64 photographs is a response nobody wants.

    ``q`` matches a name, email, or participant id, case-insensitively, so one
    search box finds a person however the admin knows them.
    """
    user_id = _require_super_admin(current_user, "list")

    mongo_filter: dict = {}
    if house:
        mongo_filter["profile.house"] = house
    if q:
        needle = re.escape(q.strip())
        mongo_filter["$or"] = [
            {"participant_id": {"$regex": needle, "$options": "i"}},
            {"email": {"$regex": needle, "$options": "i"}},
            {"profile.full_name": {"$regex": needle, "$options": "i"}},
        ]

    rows = participants_collection.find(mongo_filter, {
        "_id": 0,
        "participant_id": 1,
        "email": 1,
        "profile": 1,
        "mess.registered": 1,
        "mess.mess_id": 1,
        "accommodation": 1,
        "events": 1,
        "workshops": 1,
        "created_at": 1,
        "updated_at": 1,
    }).limit(limit)

    participants = []
    for row in rows:
        # `mess.mess_id` and `events[].event_id` hold raw ObjectIds — not JSON
        # serialisable, and the reason a naive projection 500s here.
        mess = row.get("mess") or {}
        if mess.get("mess_id") is not None:
            mess["mess_id"] = str(mess["mess_id"])
        for registration in row.get("events") or []:
            if registration.get("event_id") is not None:
                registration["event_id"] = str(registration["event_id"])
        # Counts, not the arrays themselves: an admin roster wants "3 events", and
        # the per-event roster endpoints already answer "which three".
        row["event_count"] = len(row.pop("events", None) or [])
        row["workshop_count"] = len(row.pop("workshops", None) or [])
        participants.append(row)

    # Reading a roster is itself an auditable act. This response carries names,
    # email addresses, phone numbers, and addresses for up to `limit` people, and
    # the trail recorded who *changed* a participant while saying nothing about who
    # *read* every participant. The search term is recorded because "who looked up
    # this particular student, and when" is the question that follows a complaint
    # about staff misusing the roster; the returned rows themselves are not.
    log_audit(
        current_user,
        "READ_PARTICIPANT_ROSTER",
        None,
        {
            "search": q,
            "house": house,
            "limit": limit,
            "returned": len(participants),
        },
    )

    return {"count": len(participants), "participants": participants}


@router.patch("/{participant_id}")
def update_participant(
    participant_id: str,
    request: ParticipantAdminUpdateRequest,
    current_user: dict = Depends(get_current_staff),
):
    """
    Edit another person's record — Story 7.3's missing write half.

    Super Admins only. Until this existed there was no endpoint anywhere that
    wrote to a participant document other than the participant's own
    ``PATCH /profile/complete``, so an admin who spotted a misspelled name on a
    hostel roster could do nothing about it.

    Deliberately narrow. Only ``profile`` fields are writable:

    * ``email`` and ``participant_id`` are identity — ``participant_id`` is
      derived from the email by ``generate_participant_id`` and is the key every
      roster, log row, and QR payload joins on.
    * ``password_hash`` and ``qr_secrets`` are credentials.
    * ``mess`` / ``accommodation`` / ``events`` / ``workshops`` are owned by the
      allocation and registration routes, which enforce capacity and state. An
      admin writing them directly would put a participant in a hall with no seat
      left, or mark them inside a block the scanner thinks they left.

    Every field is optional and only the ones present are written, so a form that
    fixes a phone number cannot blank an address.
    """
    _require_super_admin(current_user, "update")

    participant = participants_collection.find_one({"participant_id": participant_id})
    if not participant:
        log_denied(
            current_user,
            "UPDATE_PARTICIPANT_DENIED",
            participant_id,
            reason="participant_not_found",
            details={"status": 404},
        )
        raise HTTPException(status_code=404, detail="Participant not found")

    supplied = request.model_dump(exclude_unset=True, exclude_none=True)
    if not supplied:
        log_denied(
            current_user,
            "UPDATE_PARTICIPANT_DENIED",
            participant_id,
            reason="nothing_to_update",
            details={"status": 400},
            audit=False,
        )
        raise HTTPException(status_code=400, detail="Nothing to update")

    update = {}
    for field, value in supplied.items():
        # Dotted keys, so an edit to one profile field leaves the rest of the map
        # alone. Setting `profile` wholesale would delete every field the form
        # does not carry.
        update[f"profile.{field}"] = value
    update["updated_at"] = datetime.utcnow()

    participants_collection.update_one({"participant_id": participant_id}, {"$set": update})
    log_audit(current_user, "UPDATE_PARTICIPANT", participant_id, {"fields_updated": sorted(supplied.keys())})

    updated = participants_collection.find_one({"participant_id": participant_id}, {"_id": 0, "profile": 1})
    return {"message": "Participant updated", "profile": (updated or {}).get("profile", {})}
