from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings
from app.core.security import hash_password
from app.db.collections import (
    ANNOUNCEMENTS,
    CONTACTS,
    EVENT_REGISTRATIONS,
    EVENTS,
    HOSTEL_ALLOCATIONS,
    INITIAL_COLLECTIONS,
    MEAL_PLANS,
    MESS_MENU,
    PAYMENTS,
    PHOTOS,
    QR_SECRETS,
    QUERIES,
    SCAN_LOGS,
    STAFF_ASSIGNMENTS,
    USERS,
)


@dataclass(frozen=True, slots=True)
class BootstrapResult:
    collections: tuple[str, ...]
    super_admin_email: str | None
    super_admin_created: bool


async def _create_collections(database: AsyncDatabase[dict[str, Any]]) -> None:
    existing = set(await database.list_collection_names())
    for collection_name in INITIAL_COLLECTIONS:
        if collection_name not in existing:
            await database.create_collection(collection_name)


async def _create_indexes(database: AsyncDatabase[dict[str, Any]]) -> None:
    users = database[USERS]
    existing_indexes = await users.index_information()
    for obsolete_index in ("uq_users_username", "uq_users_google_subject"):
        if obsolete_index in existing_indexes:
            await users.drop_index(obsolete_index)

    await users.create_indexes(
        [
            IndexModel(
                [("email", ASCENDING)],
                unique=True,
                partialFilterExpression={"email": {"$type": "string"}},
                name="uq_users_email",
            ),
            IndexModel(
                [("profile.roll_number", ASCENDING)],
                unique=True,
                partialFilterExpression={
                    "profile.roll_number": {"$type": "string"}
                },
                name="uq_users_roll_number",
            ),
            IndexModel([("roles", ASCENDING)], name="ix_users_roles"),
        ]
    )

    await database[EVENTS].create_indexes(
        [
            IndexModel(
                [("status", ASCENDING), ("event_date", ASCENDING)],
                name="ix_events_status_date",
            ),
            IndexModel([("event_date", ASCENDING)], name="ix_events_date"),
        ]
    )

    await database[EVENT_REGISTRATIONS].create_indexes(
        [
            IndexModel(
                [("user_id", ASCENDING), ("event_id", ASCENDING)],
                unique=True,
                name="uq_event_registrations_user_event",
            ),
            IndexModel(
                [("event_id", ASCENDING), ("status", ASCENDING)],
                name="ix_event_registrations_event_status",
            ),
            IndexModel(
                [("user_id", ASCENDING), ("status", ASCENDING)],
                name="ix_event_registrations_user_status",
            ),
        ]
    )

    await database[STAFF_ASSIGNMENTS].create_indexes(
        [
            IndexModel(
                [
                    ("user_id", ASCENDING),
                    ("role", ASCENDING),
                    ("scope_type", ASCENDING),
                    ("scope_id", ASCENDING),
                ],
                unique=True,
                name="uq_staff_assignments_user_role_scope",
            ),
            IndexModel(
                [
                    ("scope_type", ASCENDING),
                    ("scope_id", ASCENDING),
                    ("active", ASCENDING),
                ],
                name="ix_staff_assignments_scope_active",
            ),
            IndexModel(
                [("user_id", ASCENDING), ("active", ASCENDING)],
                name="ix_staff_assignments_user_active",
            ),
        ]
    )

    # One stored photo per user (Complete Your Profile), separate from the
    # participant document per the locked data-model decision.
    await database[PHOTOS].create_indexes(
        [IndexModel([("user_id", ASCENDING)], unique=True, name="uq_photos_user")]
    )

    # Event secrets are isolated by event; fixed checkpoints use their context
    # name as scope_id. Only authenticated ciphertext is stored.
    qr_secrets = database[QR_SECRETS]
    qr_secret_indexes = await qr_secrets.index_information()
    if "uq_qr_secrets_user_context" in qr_secret_indexes:
        await qr_secrets.drop_index("uq_qr_secrets_user_context")
    await qr_secrets.create_indexes(
        [
            IndexModel(
                [
                    ("user_id", ASCENDING),
                    ("checkpoint_context", ASCENDING),
                    ("scope_id", ASCENDING),
                ],
                unique=True,
                name="uq_qr_secrets_user_scope",
            )
        ]
    )

    # Scan logs remain the durable audit trail. Expiring replay state lives in
    # Redis so every API instance observes the same used-code marker.
    scan_logs = database[SCAN_LOGS]
    scan_log_indexes = await scan_logs.index_information()
    for obsolete_index in (
        "uq_scan_logs_replay",
        "uq_scan_logs_scope_replay",
    ):
        if obsolete_index in scan_log_indexes:
            await scan_logs.drop_index(obsolete_index)
    await scan_logs.create_indexes(
        [
            IndexModel(
                [
                    ("participant_id", ASCENDING),
                    ("checkpoint_context", ASCENDING),
                    ("scope_id", ASCENDING),
                    ("step", ASCENDING),
                ],
                name="ix_scan_logs_scope_step",
            ),
            IndexModel(
                [("participant_id", ASCENDING), ("scanned_at", ASCENDING)],
                name="ix_scan_logs_participant_time",
            ),
        ]
    )

    # Support queries (Epic 6): fetch a participant's own queries, and triage by
    # status for the admin queue.
    await database[QUERIES].create_indexes(
        [
            IndexModel(
                [("participant_id", ASCENDING), ("created_at", DESCENDING)],
                name="ix_queries_participant_time",
            ),
            IndexModel(
                [("status", ASCENDING), ("created_at", DESCENDING)],
                name="ix_queries_status_time",
            ),
        ]
    )

    # Contact directory (Epic 6): browse by area, and surface emergency contacts.
    await database[CONTACTS].create_indexes(
        [
            IndexModel([("category", ASCENDING)], name="ix_contacts_category"),
            IndexModel([("is_emergency", ASCENDING)], name="ix_contacts_emergency"),
        ]
    )

    # Mess menu (Epic 4): one entry per (location, meal).
    await database[MESS_MENU].create_indexes(
        [
            IndexModel(
                [("location", ASCENDING), ("meal", ASCENDING)],
                unique=True,
                name="uq_mess_menu_location_meal",
            )
        ]
    )

    # Hostel allocations (Epic 5): one per participant — a participant cannot be
    # allocated to two hostels simultaneously.
    await database[HOSTEL_ALLOCATIONS].create_indexes(
        [IndexModel([("user_id", ASCENDING)], unique=True, name="uq_hostel_alloc_user")]
    )

    # Announcements (Epic 8): newest-first feed, filterable by audience.
    await database[ANNOUNCEMENTS].create_indexes(
        [
            IndexModel([("created_at", DESCENDING)], name="ix_announcements_created"),
            IndexModel([("audience", ASCENDING)], name="ix_announcements_audience"),
        ]
    )

    # Payments (Epic 10): look up a user's latest payment per kind, and resolve
    # a gateway session on webhook. No card data is ever stored here.
    await database[MEAL_PLANS].create_indexes(
        [IndexModel([("active", ASCENDING)], name="ix_meal_plans_active")]
    )
    await database[PAYMENTS].create_indexes(
        [
            IndexModel(
                [("gateway_session_id", ASCENDING)],
                unique=True,
                partialFilterExpression={"gateway_session_id": {"$type": "string"}},
                name="uq_payments_session",
            ),
            IndexModel(
                [("user_id", ASCENDING), ("kind", ASCENDING), ("created_at", DESCENDING)],
                name="ix_payments_user_kind",
            ),
        ]
    )


async def _reconcile_event_registration_counts(
    database: AsyncDatabase[dict[str, Any]],
) -> None:
    """Backfill the admission counter for existing events.

    Run database initialization as a maintenance operation so registrations are
    not changing while this reconciliation is in progress.
    """
    events = database[EVENTS]
    registrations = database[EVENT_REGISTRATIONS]
    async for event in events.find({}, {"_id": 1}):
        registration_count = await registrations.count_documents(
            {
                "event_id": str(event["_id"]),
                "status": "registered",
            }
        )
        await events.update_one(
            {"_id": event["_id"]},
            {"$set": {"registration_count": registration_count}},
        )


def _validate_super_admin_credentials(email: str, password: str) -> None:
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise RuntimeError("INITIAL_SUPER_ADMIN_EMAIL must be a valid email address.")
    if len(password) < 8 or len(password) > 128:
        raise RuntimeError(
            "INITIAL_SUPER_ADMIN_PASSWORD must contain between 8 and 128 characters."
        )


async def _seed_initial_super_admin(
    database: AsyncDatabase[dict[str, Any]], settings: Settings
) -> bool:
    email = settings.initial_super_admin_email
    password = settings.initial_super_admin_password
    if email is None and password is None:
        return False
    if email is None or password is None:
        raise RuntimeError(
            "INITIAL_SUPER_ADMIN_EMAIL and INITIAL_SUPER_ADMIN_PASSWORD must be "
            "configured together."
        )

    _validate_super_admin_credentials(email, password)
    users = database[USERS]
    super_admin_count = await users.count_documents({"roles": "super_admin"})
    if super_admin_count > 1:
        raise RuntimeError(
            "More than one Super Admin exists. Resolve that conflict before "
            "initializing the database."
        )

    existing_super_admin = await users.find_one({"roles": "super_admin"})
    if (
        existing_super_admin is not None
        and existing_super_admin.get("email") != email
    ):
        raise RuntimeError(
            "A different Super Admin already exists. The configured Super Admin "
            "cannot replace it during bootstrap."
        )

    existing_user = await users.find_one({"email": email})

    if existing_user is not None:
        if "super_admin" not in existing_user.get("roles", []):
            raise RuntimeError(
                "INITIAL_SUPER_ADMIN_EMAIL belongs to an existing non-Super-Admin "
                "user. Granting that role requires an explicit administrative action."
            )
        if not existing_user.get("password_hash"):
            now = datetime.now(UTC)
            await users.update_one(
                {"_id": existing_user["_id"]},
                {
                    "$set": {
                        "password_hash": hash_password(password),
                        "status": "active",
                        "updated_at": now,
                    }
                },
            )
        return False

    now = datetime.now(UTC)
    await users.insert_one(
        {
            "email": email,
            "password_hash": hash_password(password),
            "roles": ["participant", "super_admin"],
            "status": "active",
            "profile": {},
            "profile_complete": False,
            "created_at": now,
            "updated_at": now,
        }
    )
    return True


async def initialize_database(
    database: AsyncDatabase[dict[str, Any]], settings: Settings
) -> BootstrapResult:
    await _create_collections(database)
    await _create_indexes(database)
    await _reconcile_event_registration_counts(database)
    super_admin_created = await _seed_initial_super_admin(database, settings)

    return BootstrapResult(
        collections=INITIAL_COLLECTIONS,
        super_admin_email=settings.initial_super_admin_email,
        super_admin_created=super_admin_created,
    )
