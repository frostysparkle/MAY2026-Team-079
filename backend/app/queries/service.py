from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection

from app.queries.schemas import RaiseQueryRequest, UpdateQueryRequest


class QueryNotFoundError(RuntimeError):
    pass


async def raise_query(
    queries: AsyncCollection[dict[str, Any]],
    participant_id: ObjectId,
    payload: RaiseQueryRequest,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    doc = {
        "participant_id": participant_id,
        "category": payload.category,
        "description": payload.description,
        "status": "open",
        "assigned_team": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await queries.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def list_my_queries(
    queries: AsyncCollection[dict[str, Any]], participant_id: ObjectId
) -> list[dict[str, Any]]:
    cursor = queries.find(
        {"participant_id": participant_id}, sort=[("created_at", -1)]
    )
    return [doc async for doc in cursor]


async def list_all_queries(
    queries: AsyncCollection[dict[str, Any]], status: str | None = None
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if status is not None:
        query["status"] = status
    cursor = queries.find(query, sort=[("created_at", -1)])
    return [doc async for doc in cursor]


async def update_query(
    queries: AsyncCollection[dict[str, Any]],
    query_id: str,
    payload: UpdateQueryRequest,
) -> dict[str, Any]:
    if not ObjectId.is_valid(query_id):
        raise QueryNotFoundError("Query not found.")
    changes: dict[str, Any] = {"updated_at": datetime.now(UTC)}
    if payload.status is not None:
        changes["status"] = payload.status
    if payload.assigned_team is not None:
        changes["assigned_team"] = payload.assigned_team
    result = await queries.find_one_and_update(
        {"_id": ObjectId(query_id)},
        {"$set": changes},
        return_document=ReturnDocument.AFTER,
    )
    if result is None:
        raise QueryNotFoundError("Query not found.")
    return result
