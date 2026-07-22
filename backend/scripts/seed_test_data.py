"""Seed a matrix of test accounts for manual QA (spec: student-experience-redesign,
Requirement 10).

Idempotent: each run purges the previously seeded test data (anything tagged
`is_test` plus rows owned by test users) and rebuilds it, so real data is never
touched. Accounts are flagged `is_test=True` so only they can be assumed via the
gated `/auth/dev-login` endpoint.

Usage:
    python -m scripts.seed_test_data          # purge + re-seed
    python -m scripts.seed_test_data --reset  # purge only

Requires MONGODB_URI in backend/.env. To actually use the accounts in the app,
also set ENABLE_DEV_LOGIN=true (dev only) and VITE_ENABLE_DEV_SWITCHER=true.
"""

import argparse
import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()

from app.core.config import get_settings  # noqa: E402
from app.db.collections import (  # noqa: E402
    EVENT_REGISTRATIONS,
    EVENTS,
    HOSTEL_ALLOCATIONS,
    MEAL_PLANS,
    PAYMENTS,
    USERS,
)
from app.db.mongo import MongoService  # noqa: E402

DOMAIN = "ds.study.iitm.ac.in"
NOW = datetime.now(UTC)


def email(local: str) -> str:
    return f"{local}@{DOMAIN}"


async def purge(db: Any) -> None:
    """Remove previously seeded test data (safe: only is_test / test-owned rows)."""
    test_users = [u async for u in db[USERS].find({"is_test": True}, {"_id": 1})]
    uids = [u["_id"] for u in test_users]
    test_events = [e async for e in db[EVENTS].find({"is_test": True}, {"_id": 1})]
    eids = [str(e["_id"]) for e in test_events]

    if uids:
        await db[HOSTEL_ALLOCATIONS].delete_many({"user_id": {"$in": uids}})
        await db[PAYMENTS].delete_many({"user_id": {"$in": uids}})
        await db[EVENT_REGISTRATIONS].delete_many({"user_id": {"$in": uids}})
    if eids:
        await db[EVENT_REGISTRATIONS].delete_many({"event_id": {"$in": eids}})
    await db[EVENTS].delete_many({"is_test": True})
    await db[MEAL_PLANS].delete_many({"is_test": True})
    await db[USERS].delete_many({"is_test": True})


async def _user(db: Any, local: str, *, order: int, label: str, roles=None,
                profile_complete=True, onboarding=None, access=None) -> ObjectId:
    profile = (
        {"full_name": local.capitalize() + " Test", "age": 20, "gender": "other",
         "phone": "9000000000", "country": "India", "state": "Tamil Nadu",
         "city": "Chennai", "program": "standalone_degree", "course_stage": "degree"}
        if profile_complete
        else {}
    )
    doc = {
        "email": email(local),
        "google_subject": f"seed-{local}",
        "roles": roles or ["participant"],
        "status": "active",
        "email_verified": True,
        "profile": profile,
        "profile_complete": profile_complete,
        "onboarding": onboarding or {},
        "access": access or {},
        "is_test": True,
        "test_order": order,
        "test_label": label,
        "created_at": NOW,
        "updated_at": NOW,
    }
    res = await db[USERS].insert_one(doc)
    return res.inserted_id


async def _payment(db: Any, uid: ObjectId, kind: str, status: str, amount: int,
                   currency: str, plan_id=None, plan_name=None) -> None:
    await db[PAYMENTS].insert_one({
        "user_id": uid, "kind": kind, "status": status, "amount": amount,
        "currency": currency, "plan_id": plan_id, "plan_name": plan_name,
        "gateway_session_id": f"seed-{uid}-{kind}",
        "txn_ref": f"SEED-{kind.upper()}" if status == "paid" else None,
        "created_at": NOW, "updated_at": NOW,
        "paid_at": NOW if status == "paid" else None,
    })


async def _allocation(db: Any, uid: ObjectId, block: str, room: str) -> None:
    await db[HOSTEL_ALLOCATIONS].insert_one({
        "user_id": uid, "hostel_block": block, "room": room,
        "instructions": "Report to the block office with your digital ID.",
        "coordinator": "Warden · 9100000222", "checked_in": False,
        "checked_in_at": None, "created_at": NOW, "updated_at": NOW,
    })


async def _register(db: Any, uid: ObjectId, event_id: str) -> None:
    await db[EVENT_REGISTRATIONS].insert_one({
        "user_id": uid, "event_id": event_id, "status": "registered",
        "created_at": NOW, "updated_at": NOW,
    })


async def seed(db: Any, settings: Any) -> dict[str, int]:
    fee = settings.hostel_fee_amount
    cur = settings.payment_currency

    # --- meal plans (test) ---
    full_plan = await db[MEAL_PLANS].insert_one({
        "name": "Full Plan (3 meals)", "description": "Breakfast, lunch, dinner",
        "amount": 1500, "currency": cur, "active": True, "is_test": True,
        "created_at": NOW, "updated_at": NOW})
    full_plan_id = full_plan.inserted_id

    # --- events (test, published) ---
    day = NOW.date()
    events = []
    for i, (title, venue, cap) in enumerate([
        ("Battle of Bands", "Open Air Theatre", 500),
        ("Robowars", "CS Lab Block", 50),
        ("Startup Pitch", "CLT", 120),
    ]):
        d = (day + timedelta(days=1 + i)).isoformat()
        res = await db[EVENTS].insert_one({
            "title": title, "venue": venue, "event_date": d,
            "start_time": "10:00", "end_time": "13:00", "capacity": cap,
            "instructions": "Carry your digital ID. Doors close 10 min prior.",
            "status": "published", "is_test": True, "created_at": NOW, "updated_at": NOW})
        events.append(str(res.inserted_id))

    # --- accounts ---
    await _user(db, "newbie", order=1, label="New — no profile", profile_complete=False)

    await _user(db, "profileonly", order=2, label="Profile done — no bookings",
                onboarding={})

    hosteler = await _user(db, "hosteler", order=3, label="Accommodation booked + paid",
                           onboarding={"accommodation_choice": "yes", "mess_choice": "no"},
                           access={"hostel_paid": True})
    await _allocation(db, hosteler, "Block A", "214")
    await _payment(db, hosteler, "hostel", "paid", fee, cur)

    hostelunpaid = await _user(db, "hostelunpaid", order=4,
                               label="Accommodation — payment pending",
                               onboarding={"accommodation_choice": "yes", "mess_choice": "no"})
    await _payment(db, hostelunpaid, "hostel", "created", fee, cur)

    messie = await _user(db, "messie", order=5, label="Mess booked + paid",
                         onboarding={"accommodation_choice": "no", "mess_choice": "yes",
                                     "mess_plan_id": str(full_plan_id)},
                         access={"mess_eligible": True})
    await _payment(db, messie, "mess", "paid", 1500, cur, str(full_plan_id), "Full Plan (3 meals)")

    fullstack = await _user(db, "fullstack", order=6, label="Fully onboarded (all paid + events)",
                            onboarding={"accommodation_choice": "yes", "mess_choice": "yes",
                                        "mess_plan_id": str(full_plan_id)},
                            access={"hostel_paid": True, "mess_eligible": True})
    await _allocation(db, fullstack, "Block C", "007")
    await _payment(db, fullstack, "hostel", "paid", fee, cur)
    await _payment(db, fullstack, "mess", "paid", 1500, cur, str(full_plan_id), "Full Plan (3 meals)")
    await _register(db, fullstack, events[0])
    await _register(db, fullstack, events[2])

    eventfan = await _user(db, "eventfan", order=7, label="Registered for events",
                           onboarding={"accommodation_choice": "no", "mess_choice": "no"})
    await _register(db, eventfan, events[0])
    await _register(db, eventfan, events[1])

    paidpending = await _user(db, "paidpending", order=8, label="One paid, one pending",
                              onboarding={"accommodation_choice": "yes", "mess_choice": "yes",
                                          "mess_plan_id": str(full_plan_id)},
                              access={"hostel_paid": True})
    await _payment(db, paidpending, "hostel", "paid", fee, cur)
    await _payment(db, paidpending, "mess", "created", 1500, cur, str(full_plan_id), "Full Plan (3 meals)")

    await _user(db, "volunteer", order=9, label="Organizer / volunteer", roles=["organizer"])
    await _user(db, "warden", order=10, label="Admin", roles=["admin"])

    counts = {
        "users": await db[USERS].count_documents({"is_test": True}),
        "events": len(events),
        "meal_plans": 1,
        "registrations": await db[EVENT_REGISTRATIONS].count_documents(
            {"event_id": {"$in": events}}),
        "payments": await db[PAYMENTS].count_documents(
            {"gateway_session_id": {"$regex": "^seed-"}}),
    }
    return counts


async def _run(reset_only: bool) -> None:
    settings = get_settings()
    if settings.mongodb_uri is None:
        raise RuntimeError("MONGODB_URI is not set. Add it to backend/.env first.")
    mongo = MongoService(settings)
    mongo.connect()
    try:
        if not await mongo.ping():
            raise RuntimeError("MongoDB is not reachable.")
        db = mongo.database
        await purge(db)
        if reset_only:
            print("Test data purged.")
            return
        counts = await seed(db, settings)
    finally:
        await mongo.close()

    print("Seeded test data:")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    print(
        "\nAccounts use @ds.study.iitm.ac.in (e.g. newbie@, hosteler@, fullstack@, "
        "volunteer@, warden@).\nEnable ENABLE_DEV_LOGIN=true (dev only) to switch "
        "between them from the app."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed/reset Paradox test accounts.")
    parser.add_argument("--reset", action="store_true", help="purge test data only")
    args = parser.parse_args()
    asyncio.run(_run(args.reset))


if __name__ == "__main__":
    main()
