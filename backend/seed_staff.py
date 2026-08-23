"""
Create the fest's staff: one bootstrap Super Admin, then the whole duty roster.

Why this script has to exist
===========================

Every other catalogue seed (`seed.py`, `seed_mess.py`, `seed_events.py`,
`seed_workshops.py`) now goes through the API, and every one of those routes is
Super Admin only. `POST /backend_teams` is *itself* Super Admin only, so on an
empty database there is no way through HTTP to create the first staff account —
the API cannot bootstrap itself. That first account is therefore written
straight to Mongo here, and everything after it goes through the API like any
other staff account an organiser would create by hand.

Three phases, in order::

    python seed_staff.py --bootstrap          # direct to Mongo: the first Super Admin
    python seed_staff.py --roster             # via the API: the whole duty roster
    # ... run the catalogue seeds ...
    python seed_staff.py --assign             # via the API: put staff on each body

`--bootstrap --roster` together is the normal first step. `--assign` must wait
until the catalogues exist, because it needs the events, hostels, halls and
workshops to attach people to. With no flags, all three run in that order.

Two backend rules shape the roster
==================================

* ``super_admin``, ``admin`` and ``volunteer`` accounts **must** link to an
  existing participant with the same address (``backend_teams``
  ``ADMIN_ID_REQUIRED_ROLES``), and one participant may back at most one staff
  account. Only ``other`` may go unlinked. So every ``admin`` here gets a
  participant document written for it first, and the bulk duty staff — hostel
  desks, mess counters, workshop rooms — are created as ``other``, which is
  also exactly what ``POST /hostels/{id}/team`` insists on.
* ``department`` values line up with ``event_type`` on purpose, which is what
  lets ``GET /events/{id}/participation`` authorise a departmental admin
  without a translation table. Event staff are therefore created in the
  department matching their event's own type.

Reserved id ranges
==================

The staff email local parts use a reserved ``<yy>F9<nnnnnn>`` block. Term 9
cannot occur in a real roll number (``seed_students.ROLL_PATTERN`` allows only
terms 1–3), so a staff account can never collide with a seeded student, and the
derived ``participant_id`` still reads like a real one (``DS26F9100001``).

The bootstrap ``paradox_id`` likewise comes from a reserved counter base
(``BOOTSTRAP_ID_SEQUENCE``) well clear of the API's own generator, which starts
at 1111 and restarts there on every process restart —
``routers.backend_teams`` mints ids from an in-memory counter that never
consults the database.

Passwords come from ``PARADOX_STAFF_PASSWORD`` or ``--password``, are hashed
once and reused across the roster: several hundred separate bcrypt hashes would
add minutes to a seed run and buy nothing for demo data.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from datetime import timedelta
from getpass import getpass
from pathlib import Path
from typing import Optional, Sequence

import httpx

import seed_calendar
from database import (
    backend_teams_collection,
    check_connection,
    participants_collection,
)
from embedding_service import zero_embedding
from id_generator import BackendTeamIDGenerator
from models import BACKEND_TEAM_DEPARTMENTS, COURSE_STAGES, HOUSES, MESS_PREFERENCE_TYPES, PROGRAMS
from security import generate_rsa_key_pair, get_password_hash

DEFAULT_API = "http://localhost:8000"
DATA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "data"

#: Every staff address lives on one program domain, so `participant_id` is
#: uniformly `DS…` and a reader can tell a staff account from its id alone.
EMAIL_DOMAIN = "ds.study.iitm.ac.in"

#: Written onto every document this script creates, and the only thing `--wipe`
#: targets — no API path ever sets it, so a real account cannot be caught by it.
SEED_MARKER = "seed_staff"

#: The reserved roll block. `26F9…` is unreachable for a real student.
ROLL_YEAR = 26
ROLL_TERM = 9

#: Where each category's sequence numbers start inside the reserved block, so a
#: category can grow without renumbering its neighbours.
SEQUENCE_BASES = {
    "super_admin": 1,
    "event_head": 100_001,
    "event_member": 200_001,
    "hostel": 300_001,
    "mess": 400_001,
    "workshop": 500_001,
}

#: The bootstrap account's `paradox_id` counter, far above the API generator's
#: 1111 start so the two can never issue the same id.
BOOTSTRAP_ID_SEQUENCE = 9001

DEFAULT_PASSWORD = "Paradox@2026"

#: How many RSA keypairs to generate and cycle across the staff participants.
#: A 2048-bit keypair takes real time; the accounts that need one are few, and
#: each still gets a working pair even though several share it.
DEFAULT_KEY_POOL = 4

# A small local name bank, indexed deterministically. Deliberately not imported
# from `seed_students_data`: this script is meant to run on its own, and coupling
# it to the student generator's reference data would make one unusable without
# the other.
FIRST_NAMES_MALE = (
    "Aarav", "Rohit", "Karthik", "Devanshu", "Imran", "Nikhil", "Siddharth",
    "Vivek", "Arjun", "Manish", "Rahul", "Tarun",
)
FIRST_NAMES_FEMALE = (
    "Ananya", "Meera", "Divya", "Sneha", "Fatima", "Priya", "Kavya",
    "Ishita", "Nandini", "Ritu", "Shalini", "Trisha",
)
SURNAMES = (
    "Sharma", "Iyer", "Reddy", "Nair", "Banerjee", "Patel", "Menon",
    "Chauhan", "Pillai", "Deshpande", "Rao", "Sengupta",
)


# =============================================================================
# Mirrors of two backend helpers
# =============================================================================
#
# Both are copied rather than imported, for the reason `seed_students` already
# copies `participant_id_for`: importing `routers.auth` would pull FastAPI,
# every dependency and every router into a script that only needs two pure
# string functions.


def normalise_email(email: str) -> str:
    """Mirrors ``routers.auth.normalise_email`` — stripped and lowercased.

    Applied to everything this script writes directly, because the API stores
    addresses normalised and matches them case-insensitively; an unnormalised
    seeded address would still be found, but the collection would stop
    converging on one canonical form.
    """
    return (email or "").strip().lower()


def participant_id_for(email: str) -> str:
    """Mirrors ``routers.auth.generate_participant_id``."""
    match = re.match(r"^([^@]+)@([a-z]+)\.study\.iitm\.ac\.in$", email.lower())
    if match:
        return f"{match.group(2).upper()}{match.group(1).upper()}"
    return email.split("@")[0].upper()


def staff_email(category: str, index: int) -> str:
    """The deterministic address for slot ``index`` of ``category``."""
    sequence = SEQUENCE_BASES[category] + index
    return normalise_email(f"{ROLL_YEAR:02d}f{ROLL_TERM}{sequence:06d}@{EMAIL_DOMAIN}")


# =============================================================================
# The roster specification
# =============================================================================


@dataclass(frozen=True)
class StaffSlot:
    """
    One staff account, and the body it will later be attached to.

    Derived from the frontend datasets rather than from the database, so
    ``--roster`` can run before the catalogues exist and ``--assign`` can
    recompute exactly the same list afterwards and pair each account with its
    target. Both phases read the same files in the same order, so the pairing
    is stable without anything being stored to correlate them.

    ``role`` / ``department`` are the ``backend_teams`` fields; ``entity_role``
    is the role the account takes on its body (``event_head``, ``guard``,
    ``workshop_volunteer``, ...), which is a different vocabulary and is only
    used by ``--assign``.
    """

    category: str          # super_admin | event_head | event_member | hostel | mess | workshop
    index: int
    email: str
    role: str              # backend_teams role
    department: str        # backend_teams department
    designation: str
    name: str
    needs_participant: bool
    entity_role: Optional[str] = None   # role on the event/hostel/mess/workshop
    target: Optional[str] = None        # event name | hostel name | mess_id | workshop name
    gender: str = "male"


def _person(category: str, index: int) -> tuple[str, str]:
    """A stable ``(full_name, gender)`` for one slot."""
    seed = SEQUENCE_BASES[category] + index
    gender = "female" if seed % 2 else "male"
    pool = FIRST_NAMES_FEMALE if gender == "female" else FIRST_NAMES_MALE
    first = pool[seed % len(pool)]
    surname = SURNAMES[(seed // len(pool)) % len(SURNAMES)]
    return f"{first} {surname}", gender


def _load_json(name: str) -> list[dict]:
    path = DATA_DIR / name
    if not path.is_file():
        raise SystemExit(f"Dataset not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_datasets() -> dict[str, list[dict]]:
    """
    The four catalogues, read straight from disk.

    Sorted by the field ``--assign`` will match on, so the ordering that pairs
    a staff slot with its target does not depend on the file's own ordering.
    """
    events = sorted(_load_json("paradoxEvents.json"), key=lambda e: e["name"])
    workshops = sorted(_load_json("paradoxWorkshops.json"), key=lambda w: w["name"])
    hostels = sorted(_load_json("paradoxHostels.json"), key=lambda h: h["name"])
    messes = sorted(_load_json("paradoxMess.json"), key=lambda m: m["mess_id"])
    return {"events": events, "workshops": workshops, "hostels": hostels, "mess": messes}


def admin_slot(email: str) -> StaffSlot:
    """The bootstrap Super Admin."""
    name, gender = _person("super_admin", 0)
    return StaffSlot(
        category="super_admin",
        index=0,
        email=normalise_email(email),
        role="super_admin",
        department="technical",
        designation="Fest Super Admin",
        name=name,
        needs_participant=True,
        gender=gender,
    )


def staff_slots(datasets: Optional[dict[str, list[dict]]] = None) -> list[StaffSlot]:
    """
    The whole duty roster, excluding the bootstrap Super Admin.

    One ``event_head`` and one team member per event; two duty staff per hostel
    block (a volunteer and a guard); two per mess hall; one volunteer per
    workshop.
    """
    datasets = datasets or load_datasets()
    slots: list[StaffSlot] = []

    for index, event in enumerate(datasets["events"]):
        event_type = event["event_type"]
        for category, entity_role, label in (
            ("event_head", "event_head", "Event Head"),
            ("event_member", "volunteer", "Event Volunteer"),
        ):
            name, gender = _person(category, index)
            slots.append(
                StaffSlot(
                    category=category,
                    index=index,
                    email=staff_email(category, index),
                    # The head is an `admin` in the event's own department, which is
                    # what `GET /events/{id}/participation` checks against the
                    # event's type. The volunteer is `other`, which needs no linked
                    # participant — team membership is what authorises them, not
                    # their role.
                    role="admin" if category == "event_head" else "other",
                    department=event_type,
                    designation=f"{label} - {event['name']}",
                    name=name,
                    needs_participant=(category == "event_head"),
                    entity_role=entity_role,
                    target=event["name"],
                    gender=gender,
                )
            )

    # Two per block. `POST /hostels/{id}/team` refuses any account whose
    # backend_teams role is not exactly "other", so both are created that way.
    for block_index, block in enumerate(datasets["hostels"]):
        for offset, entity_role in enumerate(("hostel_volunteer", "guard")):
            index = block_index * 2 + offset
            name, gender = _person("hostel", index)
            slots.append(
                StaffSlot(
                    category="hostel",
                    index=index,
                    email=staff_email("hostel", index),
                    role="other",
                    department="hostels",
                    designation=f"{entity_role.replace('_', ' ').title()} - {block['name']}",
                    name=name,
                    needs_participant=False,
                    entity_role=entity_role,
                    target=block["name"],
                    gender=gender,
                )
            )

    # Two per hall. The mess team's own `role` is free text, and `logging` — the
    # scan permission — is granted for "volunteer" and "other" only, so both
    # values used here are ones that can actually scan a meal.
    for hall_index, hall in enumerate(datasets["mess"]):
        for offset, entity_role in enumerate(("volunteer", "other")):
            index = hall_index * 2 + offset
            name, gender = _person("mess", index)
            slots.append(
                StaffSlot(
                    category="mess",
                    index=index,
                    email=staff_email("mess", index),
                    role="other",
                    department="mess",
                    designation=f"Mess {entity_role.title()} - {hall['name']}",
                    name=name,
                    needs_participant=False,
                    entity_role=entity_role,
                    target=hall["mess_id"],
                    gender=gender,
                )
            )

    for index, workshop in enumerate(datasets["workshops"]):
        name, gender = _person("workshop", index)
        slots.append(
            StaffSlot(
                category="workshop",
                index=index,
                email=staff_email("workshop", index),
                role="other",
                department="workshops",
                designation=f"Workshop Volunteer - {workshop['name'][:60]}",
                name=name,
                needs_participant=False,
                entity_role="workshop_volunteer",
                target=workshop["name"],
                gender=gender,
            )
        )

    return slots


# =============================================================================
# Participant documents for the staff who need one
# =============================================================================


class KeyPool:
    """
    A small pool of RSA keypairs, cycled across the staff participants.

    Same trade-off ``seed_students`` makes: a 2048-bit keypair is expensive and
    a demo account gains nothing from having a unique one. Every account still
    gets a working pair.
    """

    def __init__(self, size: int = DEFAULT_KEY_POOL) -> None:
        self._pairs = [generate_rsa_key_pair() for _ in range(max(1, size))]
        self._cursor = 0

    def take(self) -> tuple[str, str]:
        pair = self._pairs[self._cursor % len(self._pairs)]
        self._cursor += 1
        return pair


def participant_document(slot: StaffSlot, password_hash: str, key_pair: tuple[str, str]) -> dict:
    """
    A participant document for a staff member, in the exact shape
    ``POST /auth/register`` writes plus a completed profile.

    The profile is completed rather than left empty for two reasons: a staff
    account's ``name`` falls back to the linked participant's
    ``profile.full_name`` when the request omits one, and ``GET
    /hostels/my_hostel`` resolves a duty volunteer's phone number through this
    document. Every value is drawn from the closed vocabularies in ``models``,
    so this profile is one ``PATCH /profile/complete`` would have accepted.
    """
    private_key, public_key = key_pair
    sequence = SEQUENCE_BASES[slot.category] + slot.index
    now = seed_calendar.NOW - timedelta(days=seed_calendar.REGISTRATION_OPEN_DAYS_AGO + 2)

    return {
        "participant_id": participant_id_for(slot.email),
        "email": slot.email,
        "password_hash": password_hash,
        "profile": {
            "full_name": slot.name,
            "dob": f"{1990 + sequence % 12}-0{1 + sequence % 9}-1{sequence % 9}",
            "house": HOUSES[sequence % len(HOUSES)],
            "gender": slot.gender,
            "phone": f"9{sequence % 1000000000:09d}",
            "mess_preference": sorted(MESS_PREFERENCE_TYPES)[sequence % len(MESS_PREFERENCE_TYPES)],
            "country": "India",
            "state": "Tamil Nadu",
            "city": "Chennai",
            "address": f"{1 + sequence % 200}, Paradox Staff Quarters",
            "emergency_contact": None,
            "program": PROGRAMS[sequence % len(PROGRAMS)],
            "course_stage": COURSE_STAGES[sequence % len(COURSE_STAGES)],
            "event_preferences": None,
        },
        "mess": {"registered": False, "mess_id": None, "scans": {}, "payment": None},
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
        # Not written by any API path, so `--wipe` can target this cohort without
        # ever matching a real account.
        "seed_source": SEED_MARKER,
    }


def ensure_participants(
    slots: Sequence[StaffSlot],
    password_hash: str,
    *,
    dry_run: bool = False,
    log=print,
) -> dict[str, int]:
    """
    Write a participant document for every slot that needs one.

    Written directly rather than through ``POST /auth/register`` so the
    ``seed_source`` marker can be set — the API has no field for it, and
    without it ``--wipe`` would have no safe way to tell a seeded staff
    account from a real participant.
    """
    tally = {"created": 0, "existing": 0}
    needed = [s for s in slots if s.needs_participant]
    if not needed:
        return tally

    pool = KeyPool() if not dry_run else None
    for slot in needed:
        if participants_collection.find_one({"email": slot.email}, {"_id": 1}):
            tally["existing"] += 1
            continue
        tally["created"] += 1
        if dry_run:
            continue
        participants_collection.insert_one(
            participant_document(slot, password_hash, pool.take())
        )

    log(
        f"  participants for staff: {tally['created']} created, "
        f"{tally['existing']} already present"
    )
    return tally


# =============================================================================
# Phase 1 — bootstrap, direct to Mongo
# =============================================================================


def bootstrap_super_admin(
    slot: StaffSlot,
    password_hash: str,
    *,
    dry_run: bool = False,
    log=print,
) -> dict:
    """
    Create the first Super Admin, participant document and all.

    The one place in this project that writes a ``backend_teams`` document by
    hand. It has to: ``POST /backend_teams`` requires a Super Admin token, so on
    an empty database there is nobody who could authorise the request that
    creates the first Super Admin.

    Idempotent — an existing account with this address is left exactly as it is,
    including its password, so re-running never invalidates a token somebody is
    already holding.
    """
    tally = {"created": 0, "existing": 0}

    existing = backend_teams_collection.find_one({"email": slot.email})
    if existing:
        tally["existing"] = 1
        log(f"  super admin already present: {existing.get('paradox_id')} <{slot.email}>")
        return tally

    ensure_participants([slot], password_hash, dry_run=dry_run, log=log)

    participant = participants_collection.find_one({"email": slot.email}, {"_id": 1})
    if participant is None and not dry_run:
        raise SystemExit(
            f"Could not find or create the participant record for {slot.email}; "
            "a super_admin account must link to one"
        )

    # Built from the generator's own code tables rather than a hardcoded string,
    # so a rename of a role or department code cannot leave this out of step —
    # but with a reserved counter, because the generator's own counter is
    # in-memory, starts at 1111, and restarts there on every process restart.
    paradox_id = (
        BackendTeamIDGenerator.ROLE_CODES[slot.role]
        + BackendTeamIDGenerator.DEPARTMENT_CODES[slot.department]
        + str(BOOTSTRAP_ID_SEQUENCE)
    )

    tally["created"] = 1
    log(f"  created super admin {paradox_id} <{slot.email}>")
    if dry_run:
        return tally

    if backend_teams_collection.find_one({"paradox_id": paradox_id}):
        raise SystemExit(
            f"paradox_id {paradox_id} is already taken; bump "
            f"seed_staff.BOOTSTRAP_ID_SEQUENCE and try again"
        )

    now = seed_calendar.NOW
    backend_teams_collection.insert_one(
        {
            "paradox_id": paradox_id,
            "email": slot.email,
            "name": slot.name,
            "password_hash": password_hash,
            "role": slot.role,
            "department": slot.department,
            "designation": slot.designation,
            "admin_id": participant["_id"] if participant else None,
            "created_at": now,
            "updated_at": now,
            "seed_source": SEED_MARKER,
        }
    )
    return tally


# =============================================================================
# Phase 2 — the roster, through the API
# =============================================================================


def _detail(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def login(client: httpx.Client, email: str, password: str) -> str:
    """Sign in as staff and return the bearer token."""
    response = client.post("/auth/admin/login", json={"email": email, "password": password})
    if response.status_code != 200:
        raise SystemExit(f"Login failed ({response.status_code}): {_detail(response)}")

    body = response.json()
    if body.get("role") != "super_admin":
        raise SystemExit(
            f"{email} has role {body.get('role')!r}; only a Super Admin may manage staff."
        )
    return body["access_token"]


def existing_staff(client: httpx.Client) -> dict[str, dict]:
    """Every staff account already on file, keyed by normalised email."""
    response = client.get("/backend_teams")
    if response.status_code != 200:
        raise SystemExit(f"Could not list backend teams: {_detail(response)}")
    return {normalise_email(row.get("email", "")): row for row in response.json()}


def create_roster(
    client: Optional[httpx.Client],
    slots: Sequence[StaffSlot],
    password: str,
    *,
    dry_run: bool = False,
    log=print,
) -> dict[str, int]:
    """
    Create every roster account through ``POST /backend_teams``.

    Idempotent on email: an address already on file is skipped, and a 409 from
    the API (the participant is already linked to another account) is counted as
    already-done rather than as a failure, so a re-run after a partial failure
    completes instead of stopping.

    ``client`` may be None only for a dry run, which sends nothing and therefore
    has nothing to list against.
    """
    tally = {"created": 0, "skipped": 0, "failed": 0}
    on_file = {} if client is None else existing_staff(client)
    log(f"  {len(on_file)} staff account(s) already in the database")

    for slot in slots:
        if slot.email in on_file:
            tally["skipped"] += 1
            continue

        body = {
            "email": slot.email,
            "password": password,
            "role": slot.role,
            "department": slot.department,
            "designation": slot.designation,
            "name": slot.name,
        }
        if dry_run:
            tally["created"] += 1
            continue

        response = client.post("/backend_teams", json=body)
        if response.status_code == 200:
            tally["created"] += 1
            log(f"  created {response.json().get('paradox_id')} - {slot.designation}")
        elif response.status_code == 409:
            # Already linked to another staff account: the account exists in every
            # sense that matters here.
            tally["skipped"] += 1
        else:
            tally["failed"] += 1
            log(f"  FAILED  {slot.email} ({slot.designation}): {_detail(response)}")

    return tally


# =============================================================================
# Phase 3 — attach staff to the bodies they run
# =============================================================================


def _get(client: httpx.Client, path: str) -> list[dict]:
    response = client.get(path)
    if response.status_code != 200:
        raise SystemExit(f"Could not list {path}: {_detail(response)}")
    return response.json()


def _team_user_ids(document: dict, field: str) -> set[str]:
    """The ``user_id`` values already on one body's team."""
    return {
        str(member.get("user_id"))
        for member in (document.get(field) or [])
        if member.get("user_id")
    }


def assign_staff(
    client: httpx.Client,
    slots: Sequence[StaffSlot],
    *,
    log=print,
) -> dict[str, int]:
    """
    Put every roster account onto the event, block, hall or workshop it belongs
    to.

    Runs after the catalogue seeds, because it needs those bodies to exist. Each
    body is matched by the same field the corresponding seed script matches on —
    events, blocks and workshops by ``name`` (their ids are backend-assigned),
    halls by ``mess_id`` (client-supplied, so stable).

    Membership is checked against the listing before anything is pushed, rather
    than relying on the routes to refuse a duplicate. Three of the four do
    refuse (409), but ``POST /workshops/{id}/volunteers`` has no duplicate check
    at all — it ``$push``es unconditionally — so a re-run without this would
    give every workshop a second copy of the same volunteer.
    """
    tally = {"assigned": 0, "skipped": 0, "missing": 0, "failed": 0}

    staff_by_email = existing_staff(client)
    paradox_id_for = {
        slot.email: staff_by_email[slot.email]["paradox_id"]
        for slot in slots
        if slot.email in staff_by_email
    }
    absent = [slot for slot in slots if slot.email not in paradox_id_for]
    if absent:
        log(
            f"  {len(absent)} roster account(s) do not exist yet - "
            f"run --roster first; they will be skipped"
        )

    events = {event["name"]: event for event in _get(client, "/events")}
    hostels = {block["name"]: block for block in _get(client, "/hostels")}
    messes = {hall["mess_id"]: hall for hall in _get(client, "/mess")}
    workshops = {workshop["name"]: workshop for workshop in _get(client, "/workshops")}

    # `GET /workshops` only includes `workshop_team` for a Super Admin, which is
    # what this client is. Without it every workshop would look unstaffed and the
    # duplicate guard below would be blind.
    if workshops and "workshop_team" not in next(iter(workshops.values())):
        log("  WARNING workshop_team is not visible on GET /workshops; duplicate guard disabled")

    catalogues = {
        "event_head": (events, "event_team", "/events/{id}/team"),
        "event_member": (events, "event_team", "/events/{id}/team"),
        "hostel": (hostels, "hostel_team", "/hostels/{id}/team"),
        "mess": (messes, "mess_team", "/mess/{id}/team"),
        "workshop": (workshops, "workshop_team", "/workshops/{id}/volunteers"),
    }
    id_fields = {
        "event_head": "event_id",
        "event_member": "event_id",
        "hostel": "hostel_id",
        "mess": "mess_id",
        "workshop": "workshop_id",
    }

    for slot in slots:
        user_id = paradox_id_for.get(slot.email)
        if user_id is None:
            tally["skipped"] += 1
            continue

        catalogue, team_field, path_template = catalogues[slot.category]
        body_doc = catalogue.get(slot.target)
        if body_doc is None:
            tally["missing"] += 1
            log(f"  MISSING {slot.category} target {slot.target!r} - not in the database")
            continue

        if user_id in _team_user_ids(body_doc, team_field):
            tally["skipped"] += 1
            continue

        entity_id = body_doc[id_fields[slot.category]]
        path = path_template.replace("{id}", str(entity_id))

        if slot.category in ("event_head", "event_member"):
            payload = {"user_id": user_id, "role": slot.entity_role}
        elif slot.category == "hostel":
            # `attendance` is the scan permission. A duty member assigned without
            # it is on the roster and refused at the door, which is exactly the
            # state the route logs a warning for.
            payload = {"user_id": user_id, "role": slot.entity_role, "attendance": True}
        elif slot.category == "mess":
            # `logging` (the mess scan permission) is derived by the route from
            # `role`, and granted only for "volunteer" and "other" — both of the
            # values the roster uses. `name` and `phone` are stored on the team
            # entry itself because a mess team member need not be a participant.
            payload = {
                "user_id": user_id,
                "role": slot.entity_role,
                "name": slot.name,
                "phone": f"9{SEQUENCE_BASES[slot.category] + slot.index:09d}"[:10],
            }
        else:
            payload = {"user_id": user_id, "role": slot.entity_role, "attendance": True}

        response = client.post(path, json=payload)
        if response.status_code == 200:
            tally["assigned"] += 1
            # Keep the local copy in step so a second slot targeting the same body
            # sees this member without re-fetching the whole catalogue.
            body_doc.setdefault(team_field, []).append({"user_id": user_id})
        elif response.status_code == 409:
            tally["skipped"] += 1
        else:
            tally["failed"] += 1
            log(f"  FAILED  {slot.designation}: {_detail(response)}")

    return tally


# =============================================================================
# Wipe
# =============================================================================


#: Migration map for a data-quality issue predating this script's current
#: department vocabulary. `admin_slot` below has written `department:
#: "technical"` (singular, matching `models.BACKEND_TEAM_DEPARTMENTS` and
#: `EventCreateRequest.event_type`) for a while, but the bootstrap Super Admin
#: account in the live database was created by an older run that wrote the
#: plural "technicals" instead — the same drift `HOUSE_NAME_FIXUPS` in
#: `seed_students.py` corrects for houses. Built from `BACKEND_TEAM_DEPARTMENTS`
#: rather than hand-typed, so a value not in the closed set today can never be
#: "fixed" into something equally wrong.
DEPARTMENT_NAME_FIXUPS: dict[str, str] = {
    f"{dept}s": dept for dept in BACKEND_TEAM_DEPARTMENTS if f"{dept}s" != dept
}


def fix_department_names(log=print) -> dict[str, int]:
    """
    Rewrite any ``backend_teams`` document whose ``department`` is a pluralised
    form of one of ``models.BACKEND_TEAM_DEPARTMENTS`` to the singular the
    schema actually validates against.

    Idempotent, and scoped to exactly the plural forms in
    ``DEPARTMENT_NAME_FIXUPS`` — an account already on a valid department has
    nothing matching any of these keys, and a value outside the closed set
    entirely (a genuine typo, say) is reported rather than guessed at.
    """
    tally: dict[str, int] = {dept: 0 for dept in BACKEND_TEAM_DEPARTMENTS}

    for plural, singular in DEPARTMENT_NAME_FIXUPS.items():
        result = backend_teams_collection.update_many(
            {"department": plural}, {"$set": {"department": singular}}
        )
        if result.modified_count:
            tally[singular] += result.modified_count

    unrecognised = sorted(
        backend_teams_collection.distinct(
            "department", {"department": {"$nin": list(BACKEND_TEAM_DEPARTMENTS)}}
        )
    )

    fixed = sum(tally.values())
    log(f"  fixed {fixed} staff account(s)")
    for dept in BACKEND_TEAM_DEPARTMENTS:
        if tally[dept]:
            log(f"    {dept:<10} +{tally[dept]}")
    if unrecognised:
        log(f"  still unrecognised: {unrecognised}")

    return {"fixed": fixed, "unrecognised": len(unrecognised)}


def wipe_seeded(log=print) -> dict[str, int]:
    """
    Remove every account this script created, staff and participant alike.

    Scoped by ``seed_source``, which no API path writes, so an account created
    by a real person cannot be caught by it. Note that roster accounts created
    through the API carry no marker — they are matched by their reserved
    ``<yy>F9…`` address instead, which is equally unreachable for a real
    student.
    """
    reserved = re.compile(rf"^{ROLL_YEAR:02d}f{ROLL_TERM}\d{{6}}@", re.IGNORECASE)

    staff = backend_teams_collection.delete_many(
        {"$or": [{"seed_source": SEED_MARKER}, {"email": {"$regex": reserved.pattern, "$options": "i"}}]}
    ).deleted_count
    participants = participants_collection.delete_many(
        {"$or": [{"seed_source": SEED_MARKER}, {"email": {"$regex": reserved.pattern, "$options": "i"}}]}
    ).deleted_count

    log(f"  removed {staff} staff account(s) and {participants} staff participant(s)")
    return {"staff": staff, "participants": participants}


# =============================================================================
# CLI
# =============================================================================


def _resolve_password(explicit: Optional[str]) -> str:
    password = explicit or os.getenv("PARADOX_STAFF_PASSWORD")
    if not password:
        password = getpass("Password for every seeded staff account: ") or DEFAULT_PASSWORD
    if len(password) < 8:
        raise SystemExit("Staff passwords must be at least 8 characters (backend_teams requires it)")
    return password


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    parser.add_argument(
        "--admin-email",
        default=staff_email("super_admin", 0),
        help="Bootstrap Super Admin address (default is the reserved staff address)",
    )
    parser.add_argument(
        "--password",
        help="Password for every seeded account; PARADOX_STAFF_PASSWORD is used if omitted",
    )
    parser.add_argument("--bootstrap", action="store_true", help="Create the first Super Admin (direct to Mongo)")
    parser.add_argument("--roster", action="store_true", help="Create the duty roster (through the API)")
    parser.add_argument(
        "--assign",
        action="store_true",
        help="Attach staff to events, hostels, halls and workshops (needs the catalogues seeded)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report what would happen, write nothing")
    parser.add_argument("--wipe", action="store_true", help="Remove every account this script created")
    parser.add_argument(
        "--fix-department-names",
        action="store_true",
        help=(
            "rewrite any backend_teams document whose department is a pluralised "
            "form ('technicals') to the singular models.BACKEND_TEAM_DEPARTMENTS "
            "expects, then stop"
        ),
    )
    args = parser.parse_args()

    if args.fix_department_names:
        if not check_connection():
            raise SystemExit("Database unreachable; cannot fix department names.")
        if args.dry_run:
            preview = sum(
                backend_teams_collection.count_documents({"department": plural})
                for plural in DEPARTMENT_NAME_FIXUPS
            )
            print(f"would fix {preview} staff account(s) [dry run]")
        else:
            fix_department_names()
        return 0

    if args.wipe:
        if not check_connection():
            raise SystemExit("Database unreachable; refusing to wipe.")
        wipe_seeded()
        return 0

    # No phase named means all three, in dependency order.
    phases = {"bootstrap": args.bootstrap, "roster": args.roster, "assign": args.assign}
    if not any(phases.values()):
        phases = {"bootstrap": True, "roster": True, "assign": True}

    datasets = load_datasets()
    admin = admin_slot(args.admin_email)
    roster = staff_slots(datasets)
    print(
        f"Roster: 1 super admin + {len(roster)} staff "
        f"({sum(1 for s in roster if s.needs_participant)} needing a participant record)"
        + (" [dry run]" if args.dry_run else "")
    )

    password = _resolve_password(args.password)

    if phases["bootstrap"]:
        if not check_connection():
            raise SystemExit("Database unreachable; cannot bootstrap the first Super Admin.")
        print("\nBootstrap (direct to Mongo)")
        bootstrap_super_admin(admin, get_password_hash(password), dry_run=args.dry_run)

    if not (phases["roster"] or phases["assign"]):
        return 0

    if args.dry_run:
        if phases["roster"]:
            print("\nRoster [dry run] - no requests sent")
            tally = create_roster(None, roster, password, dry_run=True)
            print(f"  would create {tally['created']} account(s)")
        if phases["assign"]:
            print("\nAssignment [dry run] - needs a live API and seeded catalogues")
        return 0

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=60.0) as client:
        token = login(client, admin.email, password)
        client.headers["Authorization"] = f"Bearer {token}"

        if phases["roster"]:
            print("\nRoster (through the API)")
            ensure_participants(roster, get_password_hash(password))
            tally = create_roster(client, roster, password)
            print("  " + " ".join(f"{k}={v}" for k, v in tally.items()))
            if tally["failed"]:
                return 1

        if phases["assign"]:
            print("\nAssignment (through the API)")
            assign_tally = assign_staff(client, roster)
            print("  " + " ".join(f"{k}={v}" for k, v in assign_tally.items()))
            if assign_tally["failed"]:
                return 1
            if assign_tally["missing"]:
                print(
                    "  note: targets reported missing mean a catalogue seed has not run yet "
                    "(seed.py / seed_mess.py / seed_events.py / seed_workshops.py)"
                )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
