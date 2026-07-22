from typing import Literal

from pydantic import BaseModel


Choice = Literal["yes", "no"]
StepKey = Literal["profile", "accommodation", "mess", "payment", "events"]
StepState = Literal["done", "current", "upcoming", "skipped"]
NextStep = Literal["profile", "accommodation", "mess", "payment", "events", "done"]


class AccommodationJourney(BaseModel):
    choice: Choice | None
    allocated: bool
    paid: bool


class MessJourney(BaseModel):
    choice: Choice | None
    plan_id: str | None
    paid: bool


class JourneyStepOut(BaseModel):
    key: StepKey
    state: StepState


class JourneyOut(BaseModel):
    profile_complete: bool
    accommodation: AccommodationJourney
    mess: MessJourney
    payment_due: bool
    events_registered: int
    steps: list[JourneyStepOut]
    next_step: NextStep
    complete: bool


class AccommodationChoiceRequest(BaseModel):
    choice: Choice


class MessChoiceRequest(BaseModel):
    choice: Choice
    plan_id: str | None = None


class PendingPaymentItem(BaseModel):
    kind: Literal["hostel", "mess"]
    label: str
    amount: int
    currency: str


class PendingPaymentsResponse(BaseModel):
    items: list[PendingPaymentItem]
    total: int
    currency: str
