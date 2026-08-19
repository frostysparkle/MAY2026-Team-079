from fastapi import APIRouter, HTTPException, Depends
from collections import Counter

from database import participants_collection, backend_teams_collection
from dependencies import get_current_staff

router = APIRouter(prefix="/participants", tags=["Participants"])


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
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one({"paradox_id": user_id, "role": "super_admin"}):
        raise HTTPException(status_code=403, detail="Not authorized")

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
        "accommodation.logged_in": 1,
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
        if accommodation.get("logged_in"):
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
