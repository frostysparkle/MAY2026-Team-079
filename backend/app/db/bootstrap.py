from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo import ASCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings
from app.db.collections import (
    EVENT_REGISTRATIONS,
    INITIAL_COLLECTIONS,
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
