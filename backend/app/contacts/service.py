from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection

from app.contacts.schemas import CreateContactRequest


class ContactNotFoundError(RuntimeError):
    pass


async def list_contacts(
    contacts: AsyncCollection[dict[str, Any]], emergency_only: bool = False
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"is_emergency": True} if emergency_only else {}
    cursor = contacts.find(query, sort=[("category", 1), ("name", 1)])
    return [doc async for doc in cursor]


async def create_contact(
    contacts: AsyncCollection[dict[str, Any]], payload: CreateContactRequest
) -> dict[str, Any]:
    now = datetime.now(UTC)
    doc = {
        "name": payload.name,
        "role": payload.role,
        "category": payload.category,
        "phone": payload.phone,
        "email": payload.email,
        "is_emergency": payload.is_emergency,
        "created_at": now,
        "updated_at": now,
    }
    result = await contacts.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def update_contact(
    contacts: AsyncCollection[dict[str, Any]],
    contact_id: str,
    changes: dict[str, Any],
) -> dict[str, Any]:
    if not ObjectId.is_valid(contact_id):
        raise ContactNotFoundError("Contact not found.")
    changes = {**changes, "updated_at": datetime.now(UTC)}
    result = await contacts.find_one_and_update(
        {"_id": ObjectId(contact_id)},
        {"$set": changes},
        return_document=ReturnDocument.AFTER,
    )
    if result is None:
        raise ContactNotFoundError("Contact not found.")
    return result


async def delete_contact(
    contacts: AsyncCollection[dict[str, Any]], contact_id: str
) -> None:
    if not ObjectId.is_valid(contact_id):
        raise ContactNotFoundError("Contact not found.")
    result = await contacts.delete_one({"_id": ObjectId(contact_id)})
    if result.deleted_count == 0:
        raise ContactNotFoundError("Contact not found.")
