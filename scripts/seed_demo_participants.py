"""
Seed a demonstration participant roster and spread it across the mess halls and
hostel blocks, so the Super Admin dashboard shows realistic occupancy instead of
a campus where every hall reads 0.

── Why this script exists ──────────────────────────────────────────────────────
Occupancy is not a stored field anywhere. `GET /mess/{id}/statistics` counts the
participants whose `mess.mess_id` is that hall's `_id`, and
`GET /hostels/{id}/statistics` counts those whose `accommodation.hostel_id` is
that block's `hostel_id`. So the only way to make occupancy non-zero — or to
control how it is distributed — is to have participant documents that point at
the halls and blocks. This script creates those documents; it does not change
any endpoint, model, or stored shape.

It also does not use `POST /mess/allocate`, deliberately. That route fills the
first hall of a preference group to capacity before it touches the second, which
produces exactly the concentrated picture this seeding is meant to avoid. The
distribution here is planned per hall and per block instead.

── What it writes ──────────────────────────────────────────────────────────────
Participant documents of the same shape `POST /auth/register` creates, with the
profile filled in as `PATCH /profile/complete` would, plus one extra marker
field:

    demo_seed: "paradox-demo-v1"

Nothing in the backend reads that field — responses pick their fields explicitly
— but it is what makes these rows removable without guessing. Every write in
this script is filtered on it, so a real participant can never be touched.

Demo accounts carry an unusable password hash: nobody can log in as one, and
they have no `qr_secrets`, so they cannot be scanned either. They exist to be
counted.

── Distribution ────────────────────────────────────────────────────────────────
Mess: each hall is filled to a fixed share of *its own* capacity (see
`HALL_FILL`), so the three halls land within a few points of each other rather
than one being full and the next empty. Preferences follow from that, since
`preference` is the only axis allocation groups on — a jain participant can only
eat at a jain hall.

Hostels: about 90% of demo participants take a bed (the rest read as day
scholars, which is also why the hostels never show 100%). Blocks are filled
proportionally to capacity with a small deterministic jitter, so the 22 blocks
vary the way real ones do without any of them being an outlier. Participants
whose gender is neither male nor female are never given a bed: `POST
/hostels/allocate` groups blocks by gender and has nowhere to place them, and
the dashboard should show that honestly.

Everything random here is drawn from a fixed seed, so a re-run reproduces the
same roster, the same names, and the same per-hall numbers.

Usage::

    python scripts/seed_demo_participants.py --dry-run   # plan only, no writes
    python scripts/seed_demo_participants.py             # insert
    python scripts/seed_demo_participants.py --replace   # wipe demo rows, re-insert
    python scripts/seed_demo_participants.py --remove    # wipe demo rows only

Connection details come from `backend/database.py`, so this talks to the same
Mongo instance (and the same `TESTING=1` in-memory fallback) as the API.
"""

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

# `database.py` calls `load_dotenv("atlas-credentials.env")` with a *relative*
# path, so importing it from anywhere but `backend/` silently misses the Atlas
# credentials and falls back to `mongodb://localhost:27017/paradox` — seeding a
# local database while appearing to succeed (SETUP.md, "The path is relative").
# Loading the file by absolute path first puts MONGODB_URI in the environment,
# where `database.py` will find it whatever the working directory is.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / "atlas-credentials.env")

from database import hostel_collection, mess_collection, participants_collection  # noqa: E402

# The marker every document written here carries, and the only thing this script
# will ever delete. Bump the suffix to keep an older roster alongside a new one.
DEMO_TAG = "paradox-demo-v1"

# A bcrypt hash is 60 characters starting "$2b$". This is not one, so
# `verify_password` rejects every password against it — these accounts cannot be
# logged into, by anyone, ever.
UNUSABLE_PASSWORD_HASH = "!demo-account-no-login"

RANDOM_SEED = 2026

# Share of each hall's own capacity to fill. Kept close together on purpose:
# that is what "balanced" means here — comparable pressure per hall, not equal
# headcounts, since the halls are not the same size.
HALL_FILL = {"veg": 0.853, "non_veg": 0.859, "jain": 0.827}
# Any hall whose preference is outside the three known ones. It can never be
# allocated to through the API either, so it stays empty here too.
UNKNOWN_HALL_FILL = 0.0

# Gender mix of the roster. `other` is small but present: it is the share the
# hostel allocator structurally cannot place, and hiding it would make the
# dashboard's unallocated figure look like a bug rather than a fact.
GENDER_MIX = {"male": 0.70, "female": 0.28, "other": 0.02}

# Share of male/female participants given a bed. The remainder are day scholars.
ACCOMMODATION_RATE = 0.90
# Per-block jitter around the proportional fill, as a fraction of the target.
BLOCK_JITTER = 0.08
# Share of housed participants currently scanned in — what `currently_inside`
# reports. Mid-evening on a fest day, not everyone is in their room.
INSIDE_RATE = 0.62

FIRST_NAMES_MALE = [
    "Aarav", "Aditya", "Akhil", "Amit", "Aniruddh", "Arjun", "Ashwin", "Bharath",
    "Chirag", "Darshan", "Dev", "Dhruv", "Farhan", "Gaurav", "Harish", "Imran",
    "Ishaan", "Jatin", "Kabir", "Karthik", "Kunal", "Lakshman", "Manav", "Mohit",
    "Naveen", "Nikhil", "Om", "Pranav", "Rahul", "Rajat", "Rohan", "Sachin",
    "Sanjay", "Shaurya", "Siddharth", "Tanmay", "Uday", "Varun", "Vikram", "Yash",
]
FIRST_NAMES_FEMALE = [
    "Aanya", "Aditi", "Ananya", "Anjali", "Bhavya", "Charu", "Deepika", "Divya",
    "Esha", "Gayatri", "Harini", "Ishita", "Jhanvi", "Kavya", "Keerthi", "Lavanya",
    "Madhuri", "Meera", "Naina", "Nandini", "Neha", "Pallavi", "Pooja", "Priya",
    "Radhika", "Riya", "Sanjana", "Shreya", "Sneha", "Swara", "Tanvi", "Trisha",
    "Vaishnavi", "Vidya", "Yamini", "Zoya",
]
FIRST_NAMES_OTHER = ["Aryan", "Kiran", "Nithya", "Rudra", "Shivan", "Tejas"]
LAST_NAMES = [
    "Agarwal", "Balakrishnan", "Bose", "Chandran", "Desai", "Dutta", "Gupta",
    "Iyer", "Jain", "Joshi", "Kulkarni", "Menon", "Mehta", "Nair", "Patel",
    "Pillai", "Rao", "Reddy", "Sharma", "Shetty", "Singh", "Subramanian",
    "Trivedi", "Varma", "Verma",
]

# `profile.house` is a free string the backend never validates; these mirror
# `frontend/src/config/houses.ts` so the values match what the UI offers.
HOUSES = [
    "Bandipur House", "Corbett House", "Gir House", "Kanha House",
    "Kaziranga House", "Nallamala House", "Namdapha House", "Nilgiri House",
    "Pichavaram House", "Saranda House", "Sundarbans House", "Wayanad House",
]
PROGRAMS = ["DS", "ES", "AE", "MS"]
COURSE_STAGES = ["foundational", "diploma", "degree"]
# Email domain per program, matching the backend's
# `^[^@]+@[a-z]+\.study\.iitm\.ac\.in$` register check.
PROGRAM_DOMAIN = {"DS": "ds", "ES": "es", "AE": "ee", "MS": "mg"}
CITIES = [
    ("Chennai", "Tamil Nadu"), ("Bengaluru", "Karnataka"), ("Hyderabad", "Telangana"),
    ("Pune", "Maharashtra"), ("Mumbai", "Maharashtra"), ("Delhi", "Delhi"),
    ("Kolkata", "West Bengal"), ("Jaipur", "Rajasthan"), ("Kochi", "Kerala"),
    ("Bhopal", "Madhya Pradesh"), ("Lucknow", "Uttar Pradesh"), ("Guwahati", "Assam"),
]
RELATIONS = ["father", "mother", "elder_sibling", "guardian"]

# Matches the five fest days `POST /auth/register` initialises.
FEST_DAYS = range(1, 6)
MEAL_SLOTS = ("breakfast", "lunch", "dinner")


def default_mess_entries() -> list[dict]:
    """The same day/slot skeleton registration creates, with nothing logged.

    Left unlogged on purpose: a logged slot without a matching `MESS_SCAN` audit
    row would put the participant's meal history and the board's meals-served
    figure in disagreement, and the audit trail is the one the dashboard reads.
    """
    return [
        {"day": day, "slots": [{"slot": s, "logged": False} for s in MEAL_SLOTS]}
        for day in FEST_DAYS
    ]


def plan_mess(halls: list[dict]) -> list[tuple[dict, int]]:
    """How many diners each hall should end up with, from its own capacity."""
    plan = []
    for hall in halls:
        capacity = hall.get("capacity") or 0
        fill = HALL_FILL.get(hall.get("preference"), UNKNOWN_HALL_FILL)
        plan.append((hall, round(capacity * fill)))
    return plan


def split_by_gender(total: int) -> dict[str, int]:
    """Split the roster by gender, with the largest group absorbing rounding."""
    counts = {g: int(total * share) for g, share in GENDER_MIX.items()}
    counts["male"] += total - sum(counts.values())
    return counts


def plan_hostels(blocks: list[dict], gender_counts: dict[str, int], rng: random.Random):
    """
    How many beds each block should fill.

    Proportional to capacity so no block is an outlier, jittered so they are not
    all identical either, and clamped to the block's capacity. The last block of
    each gender absorbs the rounding difference, so the totals come out exact.
    """
    plan: dict[str, int] = {}
    for gender in ("male", "female"):
        group = [b for b in blocks if (b.get("gender") or "").lower() == gender]
        if not group:
            continue
        beds = sum(b.get("capacity") or 0 for b in group)
        if beds == 0:
            continue
        housed = min(round(gender_counts.get(gender, 0) * ACCOMMODATION_RATE), beds)

        assigned = 0
        for block in group[:-1]:
            capacity = block.get("capacity") or 0
            target = housed * capacity / beds
            jittered = target * (1 + rng.uniform(-BLOCK_JITTER, BLOCK_JITTER))
            take = max(0, min(capacity, round(jittered), housed - assigned))
            plan[block["hostel_id"]] = take
            assigned += take

        last = group[-1]
        plan[last["hostel_id"]] = max(
            0, min(last.get("capacity") or 0, housed - assigned)
        )
    return plan


def build_roster(halls: list[dict], blocks: list[dict], rng: random.Random):
    """
    Produce the demo participant documents and a summary of where they landed.

    Built in one pass so every constraint holds by construction: a participant's
    `mess_preference` always matches the hall they are placed in, and a bed is
    only ever handed to someone whose gender matches the block.
    """
    mess_plan = plan_mess(halls)
    total = sum(count for _, count in mess_plan)
    gender_counts = split_by_gender(total)
    hostel_plan = plan_hostels(blocks, gender_counts, rng)

    # Beds to hand out, as a per-gender queue of (hostel_id, room number).
    beds: dict[str, list[tuple[str, str]]] = {"male": [], "female": []}
    for block in blocks:
        gender = (block.get("gender") or "").lower()
        if gender not in beds:
            continue
        for n in range(hostel_plan.get(block["hostel_id"], 0)):
            # Mirrors the room numbering `POST /hostels/allocate` uses.
            beds[gender].append((block["hostel_id"], str(100 + n)))

    # Genders, in the order participants will be handed out of the pool. Shuffled
    # so a hall does not end up single-gender, which fill order would otherwise
    # guarantee.
    genders = [g for g, count in gender_counts.items() for _ in range(count)]
    rng.shuffle(genders)

    # Naive UTC, matching every other timestamp the backend stores.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    docs = []
    used_beds = {"male": 0, "female": 0}

    for index, (hall, count) in enumerate(mess_plan):
        for _ in range(count):
            serial = len(docs) + 1
            gender = genders[serial - 1]
            program = rng.choice(PROGRAMS)
            roll = f"26{PROGRAM_DOMAIN[program]}{serial:06d}"
            email = f"{roll}@{PROGRAM_DOMAIN[program]}.study.iitm.ac.in"

            pool = {
                "male": FIRST_NAMES_MALE,
                "female": FIRST_NAMES_FEMALE,
                "other": FIRST_NAMES_OTHER,
            }[gender]
            full_name = f"{rng.choice(pool)} {rng.choice(LAST_NAMES)}"
            city, state = rng.choice(CITIES)

            accommodation = {
                "registered": False,
                "hostel_id": None,
                "room": None,
                "logged_in": False,
            }
            queue = beds.get(gender)
            if queue is not None and used_beds[gender] < len(queue):
                hostel_id, room = queue[used_beds[gender]]
                used_beds[gender] += 1
                accommodation = {
                    "registered": True,
                    "hostel_id": hostel_id,
                    "room": room,
                    "logged_in": rng.random() < INSIDE_RATE,
                }

            docs.append(
                {
                    "participant_id": f"{program}{roll.upper()}",
                    "email": email,
                    "password_hash": UNUSABLE_PASSWORD_HASH,
                    "profile": {
                        "full_name": full_name,
                        "dob": f"200{rng.randint(2, 6)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
                        "house": rng.choice(HOUSES),
                        "gender": gender,
                        "phone": f"9{rng.randint(100000000, 999999999)}",
                        # The axis allocation groups on — always the hall's own.
                        "mess_preference": hall.get("preference"),
                        "country": "India",
                        "state": state,
                        "city": city,
                        "address": f"{rng.randint(1, 240)}, {rng.choice(LAST_NAMES)} Street",
                        "emergency_contact": {
                            "name": f"{rng.choice(FIRST_NAMES_MALE + FIRST_NAMES_FEMALE)} {full_name.split()[-1]}",
                            "relation": rng.choice(RELATIONS),
                            "phone": f"9{rng.randint(100000000, 999999999)}",
                        },
                        "program": program,
                        "course_stage": rng.choice(COURSE_STAGES),
                    },
                    "mess": {
                        "registered": True,
                        # The hall's `_id`, not its `mess_id`: that is what
                        # `/mess/{id}/statistics` matches on.
                        "mess_id": hall["_id"],
                        "entries": default_mess_entries(),
                    },
                    "accommodation": accommodation,
                    "photo": None,
                    "events": [],
                    "workshops": [],
                    "created_at": now - timedelta(days=rng.randint(3, 45)),
                    "updated_at": now,
                    "demo_seed": DEMO_TAG,
                }
            )
        # Keep hall order stable in the summary below.
        mess_plan[index] = (hall, count)

    return docs, mess_plan, hostel_plan, gender_counts


def report(docs, mess_plan, hostel_plan, gender_counts, blocks, log=print):
    """Print the planned distribution — the same figures the dashboard will show."""
    log("\nMess halls")
    seats = allocated = 0
    for hall, count in mess_plan:
        capacity = hall.get("capacity") or 0
        seats += capacity
        allocated += count
        pct = (count / capacity * 100) if capacity else 0
        log(
            f"  {hall.get('mess_id'):<6} {hall.get('name'):<10} "
            f"{hall.get('preference'):<8} {count:>5} / {capacity:<5} {pct:5.1f}%"
        )
    log(f"  {'TOTAL':<6} {'':<10} {'':<8} {allocated:>5} / {seats:<5} "
        f"{(allocated / seats * 100) if seats else 0:5.1f}%")

    log("\nHostel blocks")
    beds = housed = 0
    for block in blocks:
        capacity = block.get("capacity") or 0
        count = hostel_plan.get(block["hostel_id"], 0)
        beds += capacity
        housed += count
        pct = (count / capacity * 100) if capacity else 0
        log(
            f"  {block.get('hostel_id'):<6} {block.get('name'):<14} "
            f"{(block.get('gender') or ''):<7} {count:>5} / {capacity:<5} {pct:5.1f}%"
        )
    log(f"  {'TOTAL':<6} {'':<14} {'':<7} {housed:>5} / {beds:<5} "
        f"{(housed / beds * 100) if beds else 0:5.1f}%")

    inside = sum(1 for d in docs if d["accommodation"]["logged_in"])
    log(f"\nParticipants: {len(docs)} "
        f"(male {gender_counts.get('male', 0)}, female {gender_counts.get('female', 0)}, "
        f"other {gender_counts.get('other', 0)})")
    log(f"Housed: {housed} · day scholars: {len(docs) - housed} · currently inside: {inside}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--dry-run", action="store_true", help="plan only, write nothing")
    parser.add_argument("--remove", action="store_true", help="delete the demo roster and exit")
    parser.add_argument("--replace", action="store_true", help="delete an existing demo roster first")
    args = parser.parse_args()

    existing = participants_collection.count_documents({"demo_seed": DEMO_TAG})

    if args.remove:
        if args.dry_run:
            print(f"Would remove {existing} demo participants ({DEMO_TAG}).")
            return 0
        result = participants_collection.delete_many({"demo_seed": DEMO_TAG})
        print(f"Removed {result.deleted_count} demo participants ({DEMO_TAG}).")
        return 0

    if existing and not args.replace:
        print(
            f"{existing} demo participants are already present ({DEMO_TAG}).\n"
            "Re-run with --replace to rebuild them, or --remove to delete them."
        )
        return 1

    halls = list(mess_collection.find().sort("mess_id", 1))
    blocks = list(hostel_collection.find().sort("hostel_id", 1))
    if not halls:
        raise SystemExit("No mess halls found — run `python backend/seed_mess.py` first.")
    if not blocks:
        raise SystemExit("No hostel blocks found — run `python backend/seed.py` first.")

    rng = random.Random(RANDOM_SEED)
    docs, mess_plan, hostel_plan, gender_counts = build_roster(halls, blocks, rng)

    report(docs, mess_plan, hostel_plan, gender_counts, blocks)

    clashes = participants_collection.count_documents(
        {"email": {"$in": [d["email"] for d in docs]}, "demo_seed": {"$ne": DEMO_TAG}}
    )
    if clashes:
        raise SystemExit(
            f"{clashes} real participant(s) already use a generated demo email — "
            "change the roll-number prefix in this script before seeding."
        )

    if args.dry_run:
        print("\nDry run — nothing was written.")
        return 0

    if args.replace and existing:
        removed = participants_collection.delete_many({"demo_seed": DEMO_TAG}).deleted_count
        print(f"\nRemoved {removed} existing demo participants.")

    for start in range(0, len(docs), 500):
        participants_collection.insert_many(docs[start : start + 500])
    print(f"\nInserted {len(docs)} demo participants ({DEMO_TAG}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
