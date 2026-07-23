from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError

from app.core.security import hash_password, verify_password


class EmailAlreadyRegisteredError(RuntimeError):
    pass


class InvalidCredentialsError(RuntimeError):
    pass


class AccountUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LoginResult:
    user: dict[str, Any]
    is_new_user: bool


async def register_user(
    users: AsyncCollection[dict[str, Any]],
    email: str,
    password: str,
    full_name: str | None,
) -> LoginResult:
    """Create a new participant account from an email and password."""
    existing = await users.find_one({"email": email})
    if existing is not None:
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Try signing in instead."
        )

    now = datetime.now(UTC)
    user = {
        "email": email,
        "password_hash": hash_password(password),
        "roles": ["participant"],
        "status": "active",
        "profile": {"full_name": full_name} if full_name else {},
        "profile_complete": False,
        "last_login_at": now,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await users.insert_one(user)
    except DuplicateKeyError as exc:
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Try signing in instead."
        ) from exc

    user["_id"] = result.inserted_id
    return LoginResult(user=user, is_new_user=True)


async def authenticate_user(
    users: AsyncCollection[dict[str, Any]],
    email: str,
    password: str,
) -> LoginResult:
    """Verify an email/password pair and return the matching account."""
    user = await users.find_one({"email": email})
    if user is None or not verify_password(password, user.get("password_hash")):
        raise InvalidCredentialsError("Incorrect email or password.")

    if user.get("status") not in {"active", "invited"}:
        raise AccountUnavailableError("This account is not active.")

    now = datetime.now(UTC)
    await users.update_one(
        {"_id": user["_id"]},
        {"$set": {"status": "active", "last_login_at": now, "updated_at": now}},
    )
    user["status"] = "active"
    user["last_login_at"] = now
    user["updated_at"] = now
    return LoginResult(user=user, is_new_user=False)
