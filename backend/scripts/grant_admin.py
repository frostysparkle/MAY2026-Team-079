"""Emergency maintenance command to set an existing user's role by email.

The target must register through the application first. Normal role management
belongs in the authenticated admin API; this command exists for local recovery.

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
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise SystemExit(f"'{email}' is not a valid email address.")
    domain = email.rsplit("@", 1)[1]
    if domain not in settings.allowed_email_domains:
        raise SystemExit(
            f"'{email}' does not use an allowed IITM domain "
            f"({', '.join(settings.allowed_email_domains)})."
        )
    if role not in ROLE_ORDER:
        raise SystemExit(
            f"'{role}' is not a valid role. Choose one of: {', '.join(ROLE_ORDER)}."
        )
    return email


async def _grant(db: Any, email: str, role: str) -> None:
    users = db[USERS]
    now = datetime.now(UTC)
    existing = await users.find_one({"email": email})

    if existing is not None:
        await users.update_one(
            {"_id": existing["_id"]},
            {"$set": {"roles": [role], "updated_at": now}},
        )
        return

    raise SystemExit(
        f"No account exists for '{email}'. Ask the user to register first."
    )


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
        await _grant(mongo.database, email, role)
    finally:
        await mongo.close()

    print(f"'{email}' now has role '{role}'.")


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
