from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError

from app.auth.google import GoogleIdentity


class IdentityConflictError(RuntimeError):
    pass


class AccountUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LoginResult:
    user: dict[str, Any]
    is_new_user: bool


async def login_google_user(
    users: AsyncCollection[dict[str, Any]], identity: GoogleIdentity
) -> LoginResult:
    user = await users.find_one({"google_subject": identity.subject})
    if user is not None:
        return await _update_returning_user(users, user, identity)

    email_user = await users.find_one({"email": identity.email})
    if email_user is not None:
        linked_subject = email_user.get("google_subject")
        if linked_subject and linked_subject != identity.subject:
            raise IdentityConflictError(
                "This email is already linked to a different Google account."
            )
        return await _link_invited_or_legacy_user(users, email_user, identity)

    now = datetime.now(UTC)
    user = {
        "google_subject": identity.subject,
        "email": identity.email,
        "email_verified": True,
        "roles": ["participant"],
        "status": "active",
        "profile": {"full_name": identity.name} if identity.name else {},
        "profile_complete": False,
        "last_login_at": now,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await users.insert_one(user)
    except DuplicateKeyError as exc:
        raise IdentityConflictError(
            "A user with this Google identity already exists. Try signing in again."
        ) from exc

    user["_id"] = result.inserted_id
    return LoginResult(user=user, is_new_user=True)


def _ensure_account_can_login(user: dict[str, Any]) -> None:
    if user.get("status") not in {"active", "invited"}:
        raise AccountUnavailableError("This account is not active.")


async def _update_returning_user(
    users: AsyncCollection[dict[str, Any]],
    user: dict[str, Any],
    identity: GoogleIdentity,
) -> LoginResult:
    _ensure_account_can_login(user)

    if user.get("email") != identity.email:
        email_owner = await users.find_one({"email": identity.email})
        if email_owner is not None and email_owner["_id"] != user["_id"]:
            raise IdentityConflictError(
                "This email is already linked to another Paradox Connect account."
            )

    now = datetime.now(UTC)
    changes: dict[str, Any] = {
        "email": identity.email,
        "email_verified": True,
        "status": "active",
        "last_login_at": now,
        "updated_at": now,
    }
    if not user.get("roles"):
        changes["roles"] = ["participant"]
    if identity.name and not user.get("profile", {}).get("full_name"):
        changes["profile.full_name"] = identity.name

    await users.update_one(
        {"_id": user["_id"]},
        {
            "$set": changes,
            "$unset": {
                "username": "",
                "password_hash": "",
                "must_change_password": "",
            },
        },
    )
    return LoginResult(user=_apply_changes(user, changes), is_new_user=False)


async def _link_invited_or_legacy_user(
    users: AsyncCollection[dict[str, Any]],
    user: dict[str, Any],
    identity: GoogleIdentity,
) -> LoginResult:
    _ensure_account_can_login(user)
    now = datetime.now(UTC)
    changes: dict[str, Any] = {
        "google_subject": identity.subject,
        "email": identity.email,
        "email_verified": True,
        "status": "active",
        "last_login_at": now,
        "updated_at": now,
    }
    if not user.get("roles"):
        changes["roles"] = ["participant"]
    if identity.name and not user.get("profile", {}).get("full_name"):
        changes["profile.full_name"] = identity.name

    try:
        await users.update_one(
            {"_id": user["_id"]},
            {
                "$set": changes,
                "$unset": {
                    "username": "",
                    "password_hash": "",
                    "must_change_password": "",
                },
            },
        )
    except DuplicateKeyError as exc:
        raise IdentityConflictError(
            "This Google account is already linked to another user."
        ) from exc

    return LoginResult(user=_apply_changes(user, changes), is_new_user=False)


def _apply_changes(user: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    updated_user = dict(user)
    updated_user.pop("username", None)
    updated_user.pop("password_hash", None)
    updated_user.pop("must_change_password", None)
    for field, value in changes.items():
        if field == "profile.full_name":
            updated_user["profile"] = dict(updated_user.get("profile", {}))
            updated_user["profile"]["full_name"] = value
        else:
            updated_user[field] = value
    return updated_user
