import uuid
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection

from app.payments.gateway import PaymentGateway, WebhookEvent
from app.payments.schemas import CreateMealPlanRequest


class PlanNotFoundError(RuntimeError):
    pass


class PaymentNotFoundError(RuntimeError):
    pass


# ------------------------------------------------------------- meal plans ---


async def list_plans(
    plans: AsyncCollection[dict[str, Any]], active_only: bool
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"active": True} if active_only else {}
    return [doc async for doc in plans.find(query, sort=[("amount", 1)])]


async def get_plan(
    plans: AsyncCollection[dict[str, Any]], plan_id: str
) -> dict[str, Any]:
    if not ObjectId.is_valid(plan_id):
        raise PlanNotFoundError("Meal plan not found.")
    doc = await plans.find_one({"_id": ObjectId(plan_id)})
    if doc is None:
        raise PlanNotFoundError("Meal plan not found.")
    return doc


async def create_plan(
    plans: AsyncCollection[dict[str, Any]],
    payload: CreateMealPlanRequest,
    currency: str,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    doc = {
        "name": payload.name,
        "description": payload.description,
        "amount": payload.amount,
        "currency": currency,
        "active": payload.active,
        "created_at": now,
        "updated_at": now,
    }
    result = await plans.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def update_plan(
    plans: AsyncCollection[dict[str, Any]], plan_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    if not ObjectId.is_valid(plan_id):
        raise PlanNotFoundError("Meal plan not found.")
    changes = {**changes, "updated_at": datetime.now(UTC)}
    result = await plans.find_one_and_update(
        {"_id": ObjectId(plan_id)}, {"$set": changes}, return_document=ReturnDocument.AFTER
    )
    if result is None:
        raise PlanNotFoundError("Meal plan not found.")
    return result


async def delete_plan(
    plans: AsyncCollection[dict[str, Any]], plan_id: str
) -> None:
    if not ObjectId.is_valid(plan_id):
        raise PlanNotFoundError("Meal plan not found.")
    result = await plans.delete_one({"_id": ObjectId(plan_id)})
    if result.deleted_count == 0:
        raise PlanNotFoundError("Meal plan not found.")


# -------------------------------------------------------------- checkout ---


async def create_checkout(
    payments: AsyncCollection[dict[str, Any]],
    gateway: PaymentGateway,
    user_id: ObjectId,
    kind: str,
    amount: int,
    currency: str,
    plan_id: str | None = None,
    plan_name: str | None = None,
) -> tuple[dict[str, Any], str]:
    session_id = uuid.uuid4().hex
    now = datetime.now(UTC)
    description = f"Paradox {kind} fee"
    session = gateway.create_checkout(session_id, amount, currency, description)
    doc = {
        "user_id": user_id,
        "kind": kind,
        "status": "created",
        "amount": amount,
        "currency": currency,
        "plan_id": plan_id,
        "plan_name": plan_name,
        "gateway_session_id": session.session_id,
        "txn_ref": None,
        "created_at": now,
        "updated_at": now,
        "paid_at": None,
    }
    result = await payments.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc, session.checkout_url


# ------------------------------------------------------------- settlement ---


async def settle_from_webhook(
    payments: AsyncCollection[dict[str, Any]],
    users: AsyncCollection[dict[str, Any]],
    event: WebhookEvent,
) -> None:
    """Apply a verified gateway outcome. Idempotent: replaying a 'paid' webhook
    does not double-apply."""
    payment = await payments.find_one({"gateway_session_id": event.session_id})
    if payment is None:
        raise PaymentNotFoundError("No payment for this session.")
    if payment.get("status") == "paid":
        return  # already settled

    now = datetime.now(UTC)
    if event.status == "failed":
        await payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "failed", "updated_at": now}},
        )
        return

    await payments.update_one(
        {"_id": payment["_id"]},
        {
            "$set": {
                "status": "paid",
                "txn_ref": event.txn_ref,
                "paid_at": now,
                "updated_at": now,
            }
        },
    )
    # Grant the corresponding access on success.
    access_field = "access.hostel_paid" if payment["kind"] == "hostel" else "access.mess_eligible"
    await users.update_one(
        {"_id": payment["user_id"]},
        {"$set": {access_field: True, "updated_at": now}},
    )


# --------------------------------------------------------------- queries ---


async def latest_payment(
    payments: AsyncCollection[dict[str, Any]], user_id: ObjectId, kind: str
) -> dict[str, Any] | None:
    cursor = payments.find(
        {"user_id": user_id, "kind": kind}, sort=[("created_at", -1)]
    ).limit(1)
    docs = [doc async for doc in cursor]
    return docs[0] if docs else None


def display_status(payment: dict[str, Any] | None) -> str:
    if payment is None:
        return "not_started"
    status = payment.get("status")
    return "pending" if status == "created" else status
