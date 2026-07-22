from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, Request, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_hostel_allocations_collection,
    get_meal_plans_collection,
    get_payments_collection,
    get_users_collection,
)
from app.auth.roles import require_role
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.payments.gateway import (
    MockGateway,
    WebhookVerificationError,
    get_gateway,
    is_mock_gateway,
)
from app.payments.schemas import (
    CheckoutResponse,
    CreateMealPlanRequest,
    MealPlanListResponse,
    MealPlanOut,
    MessCheckoutRequest,
    MockSettleRequest,
    MyPaymentsResponse,
    ReconciliationItem,
    ReconciliationResponse,
    UpdateMealPlanRequest,
    serialize_payment,
    serialize_plan,
)
from app.payments.service import (
    PaymentNotFoundError,
    PlanNotFoundError,
    create_checkout,
    create_plan,
    delete_plan,
    display_status,
    get_plan,
    latest_payment,
    list_plans,
    settle_from_webhook,
    update_plan,
)


router = APIRouter(prefix="/payments", tags=["payments"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


def _plan_not_found() -> ApiError:
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code="plan_not_found",
        message="Meal plan not found.",
    )


# ------------------------------------------------------------- meal plans ---


@router.get("/plans", response_model=MealPlanListResponse, summary="List meal plans")
async def list_plans_route(
    _user: Annotated[dict[str, Any], Depends(get_current_user)],
    plans: Annotated[AsyncCollection[dict[str, Any]], Depends(get_meal_plans_collection)],
) -> MealPlanListResponse:
    try:
        docs = await list_plans(plans, active_only=True)
    except PyMongoError as exc:
        raise _db_error() from exc
    return MealPlanListResponse(plans=[serialize_plan(d) for d in docs])


@router.post(
    "/plans",
    response_model=MealPlanOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a meal plan (admin+)",
)
async def create_plan_route(
    body: CreateMealPlanRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    plans: Annotated[AsyncCollection[dict[str, Any]], Depends(get_meal_plans_collection)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MealPlanOut:
    try:
        doc = await create_plan(plans, body, settings.payment_currency)
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_plan(doc)


@router.patch(
    "/plans/{plan_id}", response_model=MealPlanOut, summary="Update a meal plan (admin+)"
)
async def update_plan_route(
    plan_id: str,
    body: UpdateMealPlanRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    plans: Annotated[AsyncCollection[dict[str, Any]], Depends(get_meal_plans_collection)],
) -> MealPlanOut:
    changes = body.changes()
    if not changes:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_changes",
            message="No fields to update.",
        )
    try:
        doc = await update_plan(plans, plan_id, changes)
    except PlanNotFoundError as exc:
        raise _plan_not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_plan(doc)


@router.delete(
    "/plans/{plan_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a meal plan (admin+)",
)
async def delete_plan_route(
    plan_id: str,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    plans: Annotated[AsyncCollection[dict[str, Any]], Depends(get_meal_plans_collection)],
) -> None:
    try:
        await delete_plan(plans, plan_id)
    except PlanNotFoundError as exc:
        raise _plan_not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc


# --------------------------------------------------------------- checkout ---


@router.post(
    "/hostel/checkout",
    response_model=CheckoutResponse,
    summary="Start a hostel fee payment (FR-10.1)",
)
async def hostel_checkout_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    payments: Annotated[AsyncCollection[dict[str, Any]], Depends(get_payments_collection)],
    allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CheckoutResponse:
    try:
        allocation = await allocations.find_one({"user_id": current_user["_id"]})
        if allocation is None:
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="no_allocation",
                message="You need a hostel allocation before paying.",
            )
        gateway = get_gateway(settings)
        doc, url = await create_checkout(
            payments,
            gateway,
            current_user["_id"],
            "hostel",
            settings.hostel_fee_amount,
            settings.payment_currency,
        )
    except PyMongoError as exc:
        raise _db_error() from exc
    return CheckoutResponse(payment_id=str(doc["_id"]), checkout_url=url)


@router.post(
    "/mess/checkout",
    response_model=CheckoutResponse,
    summary="Start a mess fee payment for a meal plan (FR-10.2)",
)
async def mess_checkout_route(
    body: MessCheckoutRequest,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    payments: Annotated[AsyncCollection[dict[str, Any]], Depends(get_payments_collection)],
    plans: Annotated[AsyncCollection[dict[str, Any]], Depends(get_meal_plans_collection)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CheckoutResponse:
    try:
        plan = await get_plan(plans, body.plan_id)
        if not plan.get("active"):
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="plan_inactive",
                message="That meal plan is not available.",
            )
        gateway = get_gateway(settings)
        doc, url = await create_checkout(
            payments,
            gateway,
            current_user["_id"],
            "mess",
            int(plan["amount"]),
            settings.payment_currency,
            plan_id=str(plan["_id"]),
            plan_name=plan.get("name"),
        )
    except PlanNotFoundError as exc:
        raise _plan_not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return CheckoutResponse(payment_id=str(doc["_id"]), checkout_url=url)


# ---------------------------------------------------------------- webhook ---


@router.post("/webhook", summary="Gateway payment webhook (signature-verified)")
async def webhook_route(
    request: Request,
    payments: Annotated[AsyncCollection[dict[str, Any]], Depends(get_payments_collection)],
    users: Annotated[AsyncCollection[dict[str, Any]], Depends(get_users_collection)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    raw = await request.body()
    signature = request.headers.get("X-Signature")
    gateway = get_gateway(settings)
    try:
        event = gateway.parse_webhook(raw, signature)
    except WebhookVerificationError as exc:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_webhook",
            message=str(exc),
        ) from exc
    try:
        await settle_from_webhook(payments, users, event)
    except PaymentNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="payment_not_found",
            message="No payment for this session.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return {"status": "ok"}


@router.post(
    "/mock/settle",
    summary="DEV ONLY: simulate the gateway completing a checkout (mock gateway)",
)
async def mock_settle_route(
    body: MockSettleRequest,
    _user: Annotated[dict[str, Any], Depends(get_current_user)],
    payments: Annotated[AsyncCollection[dict[str, Any]], Depends(get_payments_collection)],
    users: Annotated[AsyncCollection[dict[str, Any]], Depends(get_users_collection)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    if not is_mock_gateway(settings):
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="Not available.",
        )
    gateway = get_gateway(settings)
    assert isinstance(gateway, MockGateway)
    payload = {
        "session_id": body.session_id,
        "status": body.outcome,
        "txn_ref": f"MOCK-{body.session_id[:12]}" if body.outcome == "paid" else None,
    }
    raw, signature = gateway.sign(payload)
    event = gateway.parse_webhook(raw, signature)
    try:
        await settle_from_webhook(payments, users, event)
    except PaymentNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="payment_not_found",
            message="No payment for this session.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return {"status": body.outcome}


# ---------------------------------------------------------------- status ---


@router.get(
    "/me",
    response_model=MyPaymentsResponse,
    summary="My hostel & mess payment status + receipts (FR-10.3)",
)
async def my_payments_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    payments: Annotated[AsyncCollection[dict[str, Any]], Depends(get_payments_collection)],
) -> MyPaymentsResponse:
    try:
        hostel = await latest_payment(payments, current_user["_id"], "hostel")
        mess = await latest_payment(payments, current_user["_id"], "mess")
    except PyMongoError as exc:
        raise _db_error() from exc
    return MyPaymentsResponse(
        hostel=serialize_payment(hostel) if hostel else None,
        mess=serialize_payment(mess) if mess else None,
    )


@router.get(
    "/reconciliation",
    response_model=ReconciliationResponse,
    summary="Payment reconciliation by participant (admin+, FR-10.4)",
)
async def reconciliation_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    payments: Annotated[AsyncCollection[dict[str, Any]], Depends(get_payments_collection)],
    users: Annotated[AsyncCollection[dict[str, Any]], Depends(get_users_collection)],
) -> ReconciliationResponse:
    try:
        items: list[ReconciliationItem] = []
        async for user in users.find({}, sort=[("created_at", 1)]):
            hostel = await latest_payment(payments, user["_id"], "hostel")
            mess = await latest_payment(payments, user["_id"], "mess")
            items.append(
                ReconciliationItem(
                    id=str(user["_id"]),
                    full_name=(user.get("profile") or {}).get("full_name"),
                    email=user["email"],
                    hostel_status=display_status(hostel),
                    mess_status=display_status(mess),
                )
            )
    except PyMongoError as exc:
        raise _db_error() from exc
    return ReconciliationResponse(participants=items)
