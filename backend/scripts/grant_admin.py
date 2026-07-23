"""Grant a role (default: admin) to a user by email.

If the user already exists, their roles are set to exactly [role]. If they do
not exist yet, an "invited" account is created that is activated on the first
verified Google sign-in with the same email (mirrors the initial super-admin
seed in app/db/bootstrap.py).

The email domain must be one of ALLOWED_GOOGLE_DOMAINS.

Usage:
    python -m scripts.grant_admin 23f1001524@ds.study.iitm.ac.in
    python -m scripts.grant_admin someone@ds.study.iitm.ac.in --role super_admin

Requires MONGODB_URI in backend/.env.
"""

import argparse
import asyncio
from datetime import UTC, datetime
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from app.auth.roles import ROLE_ORDER  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.collections import USERS  # noqa: E402
from app.db.mongo import MongoService  # noqa: E402


def _validate(settings: Any, email: str, role: str) -> str:
    email = email.strip().casefold()
    if "@" not in email:
        raise SystemExit(f"'{email}' is not a valid email address.")
    domain = email.rsplit("@", 1)[1]
    if domain not in settings.allowed_google_domains:
        raise SystemExit(
            f"'{email}' does not use an allowed IITM domain "
            f"({', '.join(settings.allowed_google_domains)})."
        )
    if role not in ROLE_ORDER:
        raise SystemExit(
            f"'{role}' is not a valid role. Choose one of: {', '.join(ROLE_ORDER)}."
        )
    return email


async def _grant(db: Any, email: str, role: str) -> str:
    users = db[USERS]
    now = datetime.now(UTC)
    existing = await users.find_one({"email": email})

    if existing is not None:
        await users.update_one(
            {"_id": existing["_id"]},
            {"$set": {"roles": [role], "updated_at": now}},
        )
        return "updated"

    await users.insert_one(
        {
            "email": email,
            "roles": [role],
            "status": "invited",
            "profile": {},
            "profile_complete": False,
            "email_verified": False,
            "created_at": now,
            "updated_at": now,
        }
    )
    return "invited"


async def _run(email: str, role: str) -> None:
    settings = get_settings()
    if settings.mongodb_uri is None:
        raise SystemExit("MONGODB_URI is not set. Add it to backend/.env first.")
    email = _validate(settings, email, role)

    mongo = MongoService(settings)
    mongo.connect()
    try:
        if not await mongo.ping():
            raise SystemExit("MongoDB is not reachable.")
        outcome = await _grant(mongo.database, email, role)
    finally:
        await mongo.close()

    if outcome == "updated":
        print(f"'{email}' now has role '{role}'.")
    else:
        print(
            f"Invited '{email}' as '{role}'. The account activates on their first "
            "verified Google sign-in with this email."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Grant a role to a user by email.")
    parser.add_argument("email", help="target user's college email")
    parser.add_argument(
        "--role",
        default="admin",
        help="role to grant (default: admin)",
    )
    args = parser.parse_args()
    asyncio.run(_run(args.email, args.role))


if __name__ == "__main__":
    main()
