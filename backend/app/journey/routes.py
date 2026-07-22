from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_hostel_allocations_collection,
    get_meal_plans_collection,
    get_registrations_collection,
    get_users_collection,
)
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.journey.schemas import (
    AccommodationChoiceRequest,
    JourneyOut,
    MessChoiceRequest,
    PendingPaymentItem,
    PendingPaymentsResponse,
)
from app.journey.service import (
    gather_journey,
    set_accommodation_choice,
    set_mess_choice,
)


router = APIRouter(prefix="/me", tags=["journey"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


@router.get("/journey", response_model=JourneyOut, summary="My onboarding journey state")
async def my_journey_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    hostel_allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
) -> JourneyOut:
    try:
        return await gather_journey(current_user, hostel_allocations, registrations)
    except PyMongoError as exc:
        raise _db_error() from exc


@router.post(
    "/onboarding/accommodation",
    response_model=JourneyOut,
    summary="Record accommodation intent",
)
async def set_accommodation_route(
    body: AccommodationChoiceRequest,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    users: Annotated[AsyncCollection[dict[str, Any]], Depends(get_users_collection)],
    hostel_allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
) -> JourneyOut:
    try:
        await set_accommodation_choice(users, current_user, body.choice)
        # Reflect the change in the returned journey without a second round-trip.
        current_user.setdefault("onboarding", {})["accommodation_choice"] = body.choice
        return await gather_journey(current_user, hostel_allocations, registrations)
    except PyMongoError as exc:
        raise _db_error() from exc


@router.post(
    "/onboarding/mess",
    response_model=JourneyOut,
    summary="Record mess/meal-plan intent",
)
async def set_mess_route(
    body: MessChoiceRequest,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    users: Annotated[AsyncCollection[dict[str, Any]], Depends(get_users_collection)],
    meal_plans: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_meal_plans_collection)
    ],
    hostel_allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
) -> JourneyOut:
    plan_id = body.plan_id
    if body.choice == "yes":
        if not plan_id or not ObjectId.is_valid(plan_id):
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="plan_required",
                message="Choose a meal plan to continue.",
            )
        try:
            plan = await meal_plans.find_one({"_id": ObjectId(plan_id)})
        except PyMongoError as exc:
            raise _db_error() from exc
        if plan is None or not plan.get("active"):
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="plan_not_found",
                message="That meal plan is not available.",
            )
    try:
        await set_mess_choice(users, current_user, body.choice, plan_id)
        onboarding = current_user.setdefault("onboarding", {})
        onboarding["mess_choice"] = body.choice
        onboarding["mess_plan_id"] = plan_id if body.choice == "yes" else None
        return await gather_journey(current_user, hostel_allocations, registrations)
    except PyMongoError as exc:
        raise _db_error() from exc


@router.get(
    "/payments/pending",
    response_model=PendingPaymentsResponse,
    summary="Bookings chosen but not yet paid",
)
async def pending_payments_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    meal_plans: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_meal_plans_collection)
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PendingPaymentsResponse:
    onboarding = current_user.get("onboarding") or {}
    access = current_user.get("access") or {}
    currency = settings.payment_currency
    items: list[PendingPaymentItem] = []

    if onboarding.get("accommodation_choice") == "yes" and access.get("hostel_paid") is not True:
        items.append(
            PendingPaymentItem(
                kind="hostel",
                label="Hostel accommodation fee",
                amount=settings.hostel_fee_amount,
                currency=currency,
            )
        )

    if onboarding.get("mess_choice") == "yes" and access.get("mess_eligible") is not True:
        plan_id = onboarding.get("mess_plan_id")
        if plan_id and ObjectId.is_valid(plan_id):
            try:
                plan = await meal_plans.find_one({"_id": ObjectId(plan_id)})
            except PyMongoError as exc:
                raise _db_error() from exc
            if plan is not None:
                items.append(
                    PendingPaymentItem(
                        kind="mess",
                        label=plan.get("name", "Meal plan"),
                        amount=int(plan.get("amount", 0)),
                        currency=currency,
                    )
                )

    return PendingPaymentsResponse(
        items=items, total=sum(i.amount for i in items), currency=currency
    )
