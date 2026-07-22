from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError

from app.mess.schemas import CreateMessMenuRequest

_MEAL_ORDER = {"breakfast": 0, "lunch": 1, "snacks": 2, "dinner": 3}


class MessMenuNotFoundError(RuntimeError):
    pass


class MessMenuConflictError(RuntimeError):
    pass


class ParticipantNotFoundError(RuntimeError):
    pass


async def list_menu(
    menu: AsyncCollection[dict[str, Any]],
) -> list[dict[str, Any]]:
    docs = [doc async for doc in menu.find({})]
    docs.sort(key=lambda d: (d.get("location", ""), _MEAL_ORDER.get(d.get("meal", ""), 9)))
    return docs


async def create_menu_item(
    menu: AsyncCollection[dict[str, Any]], payload: CreateMessMenuRequest
) -> dict[str, Any]:
    now = datetime.now(UTC)
    doc = {
        "location": payload.location,
        "meal": payload.meal,
        "items": payload.items,
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "updated_at": now,
        "created_at": now,
    }
    try:
        result = await menu.insert_one(doc)
    except DuplicateKeyError as exc:
        raise MessMenuConflictError(
            "A menu entry for this location and meal already exists."
        ) from exc
    doc["_id"] = result.inserted_id
    return doc


async def update_menu_item(
    menu: AsyncCollection[dict[str, Any]], item_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    if not ObjectId.is_valid(item_id):
        raise MessMenuNotFoundError("Menu item not found.")
    changes = {**changes, "updated_at": datetime.now(UTC)}
    try:
        result = await menu.find_one_and_update(
            {"_id": ObjectId(item_id)},
            {"$set": changes},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as exc:
        raise MessMenuConflictError(
            "A menu entry for this location and meal already exists."
        ) from exc
    if result is None:
        raise MessMenuNotFoundError("Menu item not found.")
    return result


async def delete_menu_item(
    menu: AsyncCollection[dict[str, Any]], item_id: str
) -> None:
    if not ObjectId.is_valid(item_id):
        raise MessMenuNotFoundError("Menu item not found.")
    result = await menu.delete_one({"_id": ObjectId(item_id)})
    if result.deleted_count == 0:
        raise MessMenuNotFoundError("Menu item not found.")


def is_mess_eligible(user: dict[str, Any]) -> bool:
    return (user.get("access") or {}).get("mess_eligible") is True


async def set_mess_eligibility(
    users: AsyncCollection[dict[str, Any]], participant_id: str, eligible: bool
) -> None:
    if not ObjectId.is_valid(participant_id):
        raise ParticipantNotFoundError("Participant not found.")
    result = await users.update_one(
        {"_id": ObjectId(participant_id)},
        {"$set": {"access.mess_eligible": eligible, "updated_at": datetime.now(UTC)}},
    )
    if result.matched_count == 0:
        raise ParticipantNotFoundError("Participant not found.")


async def list_eligibility(
    users: AsyncCollection[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [doc async for doc in users.find({}, sort=[("created_at", 1)])]


async def count_eligible(users: AsyncCollection[dict[str, Any]]) -> int:
    return await users.count_documents({"access.mess_eligible": True})
