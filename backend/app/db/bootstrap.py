from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings
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
    legacy_password_users: int


async def _create_collections(database: AsyncDatabase[dict[str, Any]]) -> None:
    existing = set(await database.list_collection_names())
    for collection_name in INITIAL_COLLECTIONS:
        if collection_name not in existing:
            await database.create_collection(collection_name)


async def _create_indexes(database: AsyncDatabase[dict[str, Any]]) -> None:
    users = database[USERS]
    existing_indexes = await users.index_information()
    if "uq_users_username" in existing_indexes:
        await users.drop_index("uq_users_username")

    await users.create_indexes(
        [
            IndexModel(
                [("google_subject", ASCENDING)],
                unique=True,
                partialFilterExpression={"google_subject": {"$type": "string"}},
                name="uq_users_google_subject",
            ),
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

    # One TOTP secret per participant per checkpoint context. Re-provisioning
    # overwrites the row (rotates the secret).
    await database[QR_SECRETS].create_indexes(
        [
            IndexModel(
                [("user_id", ASCENDING), ("checkpoint_context", ASCENDING)],
                unique=True,
                name="uq_qr_secrets_user_context",
            )
        ]
    )

    # Scan audit log + replay protection: a matched (participant, context, step)
    # can only be recorded once.
    await database[SCAN_LOGS].create_indexes(
        [
            IndexModel(
                [
                    ("participant_id", ASCENDING),
                    ("checkpoint_context", ASCENDING),
                    ("step", ASCENDING),
                ],
                unique=True,
                partialFilterExpression={"step": {"$exists": True}},
                name="uq_scan_logs_replay",
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


def _validate_super_admin_email(settings: Settings, email: str) -> None:
    if "@" not in email:
        raise RuntimeError("INITIAL_SUPER_ADMIN_EMAIL must be a valid email address.")
    domain = email.rsplit("@", 1)[1]
    if domain not in settings.allowed_google_domains:
        raise RuntimeError(
            "INITIAL_SUPER_ADMIN_EMAIL must use an allowed IITM Google domain."
        )


async def _seed_initial_super_admin(
    database: AsyncDatabase[dict[str, Any]], settings: Settings
) -> bool:
    email = settings.initial_super_admin_email
    if email is None:
        return False

    _validate_super_admin_email(settings, email)
    users = database[USERS]
    existing_user = await users.find_one({"email": email})

    if existing_user is not None:
        if "super_admin" not in existing_user.get("roles", []):
            raise RuntimeError(
                "INITIAL_SUPER_ADMIN_EMAIL belongs to an existing non-Super-Admin "
                "user. Granting that role requires an explicit administrative action."
            )
        return False

    now = datetime.now(UTC)
    await users.insert_one(
        {
            "email": email,
            "roles": ["super_admin"],
            "status": "invited",
            "profile": {},
            "profile_complete": False,
            "email_verified": False,
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
    super_admin_created = await _seed_initial_super_admin(database, settings)
    legacy_password_users = await database[USERS].count_documents(
        {"password_hash": {"$exists": True}}
    )

    return BootstrapResult(
        collections=INITIAL_COLLECTIONS,
        super_admin_email=settings.initial_super_admin_email,
        super_admin_created=super_admin_created,
        legacy_password_users=legacy_password_users,
    )
