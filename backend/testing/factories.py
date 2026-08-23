"""
Document builders that mirror the shapes the application itself writes.

Each builder is copied field-for-field from the route that creates the document
(cited above each function), so a fixture cannot drift from production shape and
quietly make a test pass against a document the app would never produce.

Two shape details are the most common source of silent empty query results, and
are handled here so tests never have to remember them:

* ``participants.mess.mess_id`` holds the mess document's **ObjectId**, while
  ``participants.accommodation.hostel_id`` holds the readable **string** id.
  ``routers.mess.allocate_messes`` and ``routers.hostels.allocate_hostels``
  disagree on purpose, and ``routers.issues._placement_error`` compares each
  the corresponding way.
* ``participants.workshops[].workshop_id`` holds the workshop's **ObjectId**,
  not ``WKSP111``.

Overrides are deep-merged: ``participant_doc(profile={"house": "Gir"})`` keeps
every other profile field the default carries.
"""
import copy
from datetime import datetime, timedelta

from embedding_service import zero_embedding

# ---------------------------------------------------------------------------
# Vocabularies, restated here only so a test reads without a lookup. The
# authoritative sets live in models.py and are asserted against there.
# ---------------------------------------------------------------------------
MEAL_SLOTS = ("breakfast", "lunch", "dinner")


def deep_merge(base: dict, overrides: dict) -> dict:
    """
    Recursive dict merge; a non-dict override replaces wholesale.

    An **empty** dict override also replaces, rather than merging to a no-op:
    ``participant_doc(profile={})`` means "an account whose profile has not been
    completed yet", which is exactly the state ``POST /auth/register`` leaves
    behind, and there is nothing a caller could mean by merging ``{}``.
    """
    result = copy.deepcopy(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict) and value:
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


# ---------------------------------------------------------------------------
# Participants — shape from routers/auth.py:51-101 (`POST /auth/register`)
# ---------------------------------------------------------------------------

def participant_doc(
    password_hash: str = "$2b$12$placeholder",
    private_key: str = "PRIVATE",
    public_key: str = "PUBLIC",
    **overrides,
) -> dict:
    now = datetime.utcnow()
    doc = {
        "participant_id": "DS23F000001",
        "email": "23f000001@ds.study.iitm.ac.in",
        "password_hash": password_hash,
        "profile": {
            "full_name": "Test Participant",
            "dob": "2004-01-01",
            "house": "Bandipur",
            "gender": "male",
            "phone": "9000000001",
            "mess_preference": "north_indian__veg",
            "country": "India",
            "state": "TN",
            "city": "Chennai",
            "address": "1 Test Street",
            "emergency_contact": None,
            "program": "DS",
            "course_stage": "diploma",
            "event_preferences": None,
        },
        "mess": {
            "registered": False,
            "mess_id": None,
            "scans": {},
            "payment": None,
        },
        "accommodation": {
            "registered": False,
            "hostel_id": None,
            "room": None,
            "arrival": None,
            "inside": False,
            "departure": None,
            "payment": None,
        },
        "photo": None,
        "qr_secrets": {"private_key": private_key, "public_key": public_key},
        "embedding": {"workshop": zero_embedding(), "event": zero_embedding()},
        "events": [],
        "workshops": [],
        "created_at": now,
        "updated_at": now,
    }
    return deep_merge(doc, overrides)


def workshop_booking(workshop_oid, slot_id: str, booking_type: str = "pre-registered",
                     attended: bool = False) -> dict:
    """One entry of ``participants.workshops`` — see workshops.py:358-363."""
    return {
        "slot_id": slot_id,
        "booking_type": booking_type,
        "workshop_id": workshop_oid,
        "attended": attended,
    }


def event_registration(event_oid, team_id=None, team_role: str = "member",
                       registration_data: dict = None) -> dict:
    """One entry of ``participants.events`` — see events.py:509-514."""
    return {
        "team_id": team_id,
        "event_id": event_oid,
        "team_role": team_role,
        "registration_data": registration_data if registration_data is not None else {},
    }


# ---------------------------------------------------------------------------
# Backend teams — shape from routers/backend_teams.py:79-91
# ---------------------------------------------------------------------------

def staff_doc(password_hash: str = "$2b$12$placeholder", **overrides) -> dict:
    now = datetime.utcnow()
    doc = {
        "paradox_id": "SAWO1111",
        "email": "super.admin@ds.study.iitm.ac.in",
        "name": "Super Admin",
        "password_hash": password_hash,
        "role": "super_admin",
        "department": "workshops",
        "designation": "Fest Super Admin",
        "admin_id": None,
        "created_at": now,
        "updated_at": now,
    }
    return deep_merge(doc, overrides)


# ---------------------------------------------------------------------------
# Workshop slots — shape from routers/workshop_slots.py:55-63
# ---------------------------------------------------------------------------

def slot_doc(slot_id: str = "D1S1", start_offset_minutes: float = 120,
             duration_minutes: float = 90, created_by=None, **overrides) -> dict:
    """
    Times are relative to now by default, so a slot is genuinely in the future
    unless a test asks otherwise.
    """
    now = datetime.utcnow()
    start = now + timedelta(minutes=start_offset_minutes)
    doc = {
        "slot_id": slot_id,
        "start_time": (start).isoformat() + "Z",
        "end_time": (start + timedelta(minutes=duration_minutes)).isoformat() + "Z",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    return deep_merge(doc, overrides)


# ---------------------------------------------------------------------------
# Workshops — shape from routers/workshops.py:44-67
# ---------------------------------------------------------------------------

def workshop_doc(
    workshop_id: str = "WKSP111",
    slot_id: str = "D1S1",
    capacity: int = 20,
    start_offset_minutes: float = 120,
    registration_open: bool = True,
    registration_start_offset: float = -60,
    registration_end_offset: float = 60,
    created_by=None,
    **overrides,
) -> dict:
    now = datetime.utcnow()
    doc = {
        "workshop_id": workshop_id,
        "slot_id": slot_id,
        "name": f"Workshop {workshop_id}",
        "description": "A hands-on session.",
        "embedding": zero_embedding(),
        "venue": "Lab 1",
        "capacity": capacity,
        "registration_count": 0,
        "participant_count": 0,
        "instructions": "Bring a laptop.",
        "start_time": (now + timedelta(minutes=start_offset_minutes)).isoformat() + "Z",
        "registration_start": (now + timedelta(minutes=registration_start_offset)).isoformat() + "Z",
        "registration_end": (now + timedelta(minutes=registration_end_offset)).isoformat() + "Z",
        "registration_open": registration_open,
        "registration_closed_by_system": False,
        "workshop_team": [],
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    return deep_merge(doc, overrides)


def workshop_team_member(user_id: str, role: str = "workshop_volunteer",
                         attendance: bool = True) -> dict:
    return {"role": role, "user_id": user_id, "attendance": attendance}


# ---------------------------------------------------------------------------
# Events — shape from routers/events.py:105-120
# ---------------------------------------------------------------------------

def event_doc(
    event_id: str = "EVTEC1111",
    event_type: str = "technical",
    team_min: int = 1,
    team_max: int = 1,
    allow_single_registration: bool = True,
    house_vs_house_event: bool = False,
    registration_open: bool = True,
    registration_allowed: bool = True,
    created_by=None,
    **overrides,
) -> dict:
    now = datetime.utcnow()
    if registration_open:
        window_start, window_end = now - timedelta(hours=1), now + timedelta(hours=1)
    else:
        window_start, window_end = now - timedelta(hours=2), now - timedelta(hours=1)
    doc = {
        "event_id": event_id,
        "event_type": event_type,
        "name": f"Event {event_id}",
        "description": "A competitive event.",
        "embedding": zero_embedding(),
        "poster": "",
        "team": {
            "min": team_min,
            "max": team_max,
            "house_vs_house_event": house_vs_house_event,
            "allow_single_registration": allow_single_registration,
        },
        "prize_money": [{"position": "first", "amount": 5000}],
        "registration": {
            "start_time": window_start.isoformat() + "Z",
            "end_time": window_end.isoformat() + "Z",
            "allowed": registration_allowed,
        },
        "schedule": [
            {
                "round_id": "RNDTEC11111",
                "name": "Round 1",
                "description": "",
                "start_time": (now + timedelta(hours=3)).isoformat() + "Z",
                "end_time": (now + timedelta(hours=4)).isoformat() + "Z",
                "venue": "OAT",
            }
        ],
        "registration_fields": [],
        "event_team": [],
        "announcements": [],
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    return deep_merge(doc, overrides)


def registration_field(field_id: str = "tshirt", label: str = "T-shirt size",
                       field_type: str = "text", required: bool = True) -> dict:
    return {"field_id": field_id, "label": label, "type": field_type, "required": required}


def announcement(announcement_id: str = "ANNAAAAAAAAAAAA", message: str = "Report at 9am",
                 priority: str = "mid", created_by: str = "SAWO1111",
                 created_offset_seconds: float = 0) -> dict:
    """Note: ``created_at`` is a real ``datetime``, matching what
    ``create_announcement`` writes. Seeding a string here would make
    ``list_announcements`` raise while sorting."""
    return {
        "announcement_id": announcement_id,
        "message": message,
        "priority": priority,
        "created_by": created_by,
        "created_at": datetime.utcnow() + timedelta(seconds=created_offset_seconds),
    }


# ---------------------------------------------------------------------------
# Mess — shape from routers/mess.py:180-189
# ---------------------------------------------------------------------------

def mess_doc(mess_id: str = "MESS1", mess_type: str = "north_indian__veg",
             capacity: int = 50, menu: dict = None, **overrides) -> dict:
    doc = {
        "mess_id": mess_id,
        "name": f"Hall {mess_id}",
        "capacity": capacity,
        "type": mess_type,
        "menu": menu if menu is not None else {},
        "mess_team": [],
        "created_at": datetime.utcnow(),
    }
    return deep_merge(doc, overrides)


def meal_slot(start_offset_minutes: float = -10, duration_minutes: float = 60,
              menu_text: str = "Idli, sambar") -> dict:
    """
    One sitting, with **real datetimes** — ``MessMealSlot`` writes
    ``datetime`` objects, and ``_assert_mess_scan_window`` silently disables
    itself for anything else.

    Offsets are relative to now, which is how the ±15-minute scan window is
    tested without patching any clock.
    """
    start = datetime.utcnow() + timedelta(minutes=start_offset_minutes)
    return {
        "start_time": start,
        "end_time": start + timedelta(minutes=duration_minutes),
        "menu": menu_text,
    }


def mess_menu(days: dict = None) -> dict:
    """``mess_menu({1: ["breakfast", "lunch"]})`` -> a two-slot day_1."""
    if days is None:
        days = {1: ["breakfast"]}
    menu = {}
    for day_number, slots in days.items():
        menu[f"day_{day_number}"] = {slot: meal_slot() for slot in slots}
    return menu


def mess_team_member(user_id: str, role: str = "volunteer", logging: bool = True,
                     name: str = None, phone: str = None) -> dict:
    return {"user_id": user_id, "role": role, "name": name, "phone": phone, "logging": logging}


# ---------------------------------------------------------------------------
# Hostels — shape from routers/hostels.py:82-96
# ---------------------------------------------------------------------------

def hostel_doc(hostel_id: str = "HSTL111", gender: str = "male", capacity: int = 4,
               sharing: int = 2, num_rooms: int = 2, **overrides) -> dict:
    doc = {
        "hostel_id": hostel_id,
        "name": f"Block {hostel_id}",
        "capacity": capacity,
        "gender": gender,
        "sharing": sharing,
        "current_occupancy": 0,
        "rooms": [{"room_number": str(101 + i), "occupants": []} for i in range(num_rooms)],
        "hostel_team": [],
        "created_at": datetime.utcnow(),
    }
    return deep_merge(doc, overrides)


def hostel_team_member(user_id: str, role: str = "guard", attendance: bool = True) -> dict:
    return {"user_id": user_id, "role": role, "attendance": attendance}


# ---------------------------------------------------------------------------
# Queries — shape from routers/queries.py:147-164
# ---------------------------------------------------------------------------

def query_doc(query_id: str = "QRY20260101000000ABCDEF", participant_id: str = "DS23F000001",
              category: str = "general", target_id=None, status: str = "open",
              **overrides) -> dict:
    now = datetime.utcnow()
    doc = {
        "query_id": query_id,
        "participant_id": participant_id,
        "participant_name": "Test Participant",
        "participant_house": "Bandipur",
        "category": category,
        "target_id": target_id,
        "subject": "Need help",
        "body": "Something is unclear.",
        "status": status,
        "assigned_team": None,
        "assigned_to": None,
        "replies": [],
        "created_at": now,
        "updated_at": now,
        "resolved_at": None,
    }
    return deep_merge(doc, overrides)


# ---------------------------------------------------------------------------
# Issues — shape from routers/issues.py:293-310
# ---------------------------------------------------------------------------

def issue_doc(issue_id: str = "ISS17000000001234", participant_id: str = "DS23F000001",
              facility_type: str = "hostel", facility_id: str = "HSTL111",
              category: str = "water", status: str = "open", **overrides) -> dict:
    now = datetime.utcnow()
    doc = {
        "issue_id": issue_id,
        "participant_id": participant_id,
        "facility_type": facility_type,
        "facility_id": facility_id,
        "category": category,
        "subject": "Tap is broken",
        "body": "No water since morning.",
        "room": "101",
        "status": status,
        "updates": [],
        "created_at": now,
        "updated_at": now,
    }
    return deep_merge(doc, overrides)


# ---------------------------------------------------------------------------
# Audit rows — shape from logger.py:79-86
# ---------------------------------------------------------------------------

def audit_row(action: str = "CREATE_MESS", actor_id: str = "SAWO1111",
              target_id: str = "MESS1", details: dict = None,
              timestamp: datetime = None, **overrides) -> dict:
    doc = {
        "timestamp": timestamp or datetime.utcnow(),
        "actor_id": actor_id,
        "actor_name": "Super Admin",
        "actor_type": "staff",
        "actor_role": "super_admin",
        "action": action,
        "target_id": target_id,
        "details": details if details is not None else {},
    }
    return deep_merge(doc, overrides)


def mess_scan_row(participant_id: str = "DS23F000001", day: int = 1, slot: str = "breakfast",
                  mess_id: str = "MESS1", timestamp: datetime = None, **overrides) -> dict:
    """A ``MESS_SCAN`` audit row in the exact shape ``_meal_summary`` reduces."""
    return audit_row(
        action="MESS_SCAN",
        target_id=mess_id,
        details={"participant_id": participant_id, "slot": slot, "day": day},
        timestamp=timestamp,
        **overrides,
    )
