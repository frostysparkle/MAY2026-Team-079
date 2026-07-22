"""Derived onboarding journey.

The journey is a pure function of the modules that already own the data (profile,
hostel allocation, payments/access flags, event registrations) plus the small
`onboarding` intent stored on the user. Nothing here is a parallel copy — see
Correctness Property 1.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo.asynchronous.collection import AsyncCollection

from app.journey.schemas import (
    AccommodationJourney,
    JourneyOut,
    JourneyStepOut,
    MessJourney,
)


# Onboarding order (indices drive step-state resolution).
STEP_ORDER = ["profile", "accommodation", "mess", "payment", "events"]
_NEXT_INDEX = {name: i for i, name in enumerate(STEP_ORDER)}
_NEXT_INDEX["done"] = len(STEP_ORDER)


@dataclass(frozen=True, slots=True)
class JourneyInputs:
    profile_complete: bool
    accommodation_choice: str | None
    mess_choice: str | None
    mess_plan_id: str | None
    has_allocation: bool
    hostel_paid: bool
    mess_paid: bool
    events_registered: int


def _next_step(inp: JourneyInputs, payment_due: bool) -> str:
    if not inp.profile_complete:
        return "profile"
    if inp.accommodation_choice is None:
        return "accommodation"
    if inp.mess_choice is None:
        return "mess"
    if payment_due:
        return "payment"
    if inp.events_registered == 0:
        return "events"
    return "done"


def _step_state(index: int, current_index: int, *, skipped: bool, done_label: str) -> str:
    if index == current_index:
        return "current"
    if index > current_index:
        return "upcoming"
    # index < current_index → this stage is behind us.
    return "skipped" if skipped else done_label


def resolve_journey(inp: JourneyInputs) -> JourneyOut:
    """Pure resolver: same inputs → same journey (Property 1, 2, 3)."""
    acc_due = inp.accommodation_choice == "yes" and not inp.hostel_paid
    mess_due = inp.mess_choice == "yes" and not inp.mess_paid
    payment_due = acc_due or mess_due

    next_step = _next_step(inp, payment_due)
    n = _NEXT_INDEX[next_step]

    nothing_to_pay = not (inp.accommodation_choice == "yes" or inp.mess_choice == "yes")

    steps = [
        JourneyStepOut(key="profile", state=_step_state(0, n, skipped=False, done_label="done")),
        JourneyStepOut(
            key="accommodation",
            state=_step_state(1, n, skipped=inp.accommodation_choice == "no", done_label="done"),
        ),
        JourneyStepOut(
            key="mess",
            state=_step_state(2, n, skipped=inp.mess_choice == "no", done_label="done"),
        ),
        JourneyStepOut(
            key="payment",
            state=_step_state(3, n, skipped=nothing_to_pay, done_label="done"),
        ),
        JourneyStepOut(
            key="events",
            state=(
                "done"
                if inp.events_registered > 0
                else _step_state(4, n, skipped=False, done_label="done")
            ),
        ),
    ]

    return JourneyOut(
        profile_complete=inp.profile_complete,
        accommodation=AccommodationJourney(
            choice=inp.accommodation_choice,  # type: ignore[arg-type]
            allocated=inp.has_allocation,
            paid=inp.hostel_paid,
        ),
        mess=MessJourney(
            choice=inp.mess_choice,  # type: ignore[arg-type]
            plan_id=inp.mess_plan_id,
            paid=inp.mess_paid,
        ),
        payment_due=payment_due,
        events_registered=inp.events_registered,
        steps=steps,
        next_step=next_step,  # type: ignore[arg-type]
        complete=next_step in ("events", "done"),
    )


async def gather_journey(
    user: dict[str, Any],
    hostel_allocations: AsyncCollection[dict[str, Any]],
    registrations: AsyncCollection[dict[str, Any]],
) -> JourneyOut:
    """Assemble resolver inputs from the authoritative stores and resolve."""
    onboarding = user.get("onboarding") or {}
    access = user.get("access") or {}

    allocation = await hostel_allocations.find_one({"user_id": user["_id"]})
    events_registered = await registrations.count_documents(
        {"user_id": user["_id"], "status": "registered"}
    )

    inputs = JourneyInputs(
        profile_complete=bool(user.get("profile_complete")),
        accommodation_choice=onboarding.get("accommodation_choice"),
        mess_choice=onboarding.get("mess_choice"),
        mess_plan_id=onboarding.get("mess_plan_id"),
        has_allocation=allocation is not None,
        hostel_paid=access.get("hostel_paid") is True,
        mess_paid=access.get("mess_eligible") is True,
        events_registered=events_registered,
    )
    return resolve_journey(inputs)


async def set_accommodation_choice(
    users: AsyncCollection[dict[str, Any]],
    user: dict[str, Any],
    choice: str,
) -> None:
    """Record accommodation intent (Property 7: intent only — the block/room
    stays admin-assigned; the fee is paid in the payment step)."""
    await users.update_one(
        {"_id": user["_id"]},
        {"$set": {"onboarding.accommodation_choice": choice, "updated_at": _now()}},
    )


async def set_mess_choice(
    users: AsyncCollection[dict[str, Any]],
    user: dict[str, Any],
    choice: str,
    plan_id: str | None,
) -> None:
    await users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "onboarding.mess_choice": choice,
                "onboarding.mess_plan_id": plan_id if choice == "yes" else None,
                "updated_at": _now(),
            }
        },
    )


def _now() -> datetime:
    return datetime.now(UTC)
