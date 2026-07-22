from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


PaymentKind = Literal["hostel", "mess"]
PaymentStatus = Literal["created", "paid", "failed"]  # created == pending


class MealPlanOut(BaseModel):
    id: str
    name: str
    description: str
    amount: int
    currency: str
    active: bool


class MealPlanListResponse(BaseModel):
    plans: list[MealPlanOut]


class CreateMealPlanRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    amount: int = Field(ge=1)
    active: bool = True

    @field_validator("name", "description")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class UpdateMealPlanRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    amount: int | None = Field(default=None, ge=1)
    active: bool | None = None

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


class HostelCheckoutRequest(BaseModel):
    """No body needed; hostel fee is a fixed amount configured server-side."""


class MessCheckoutRequest(BaseModel):
    plan_id: str = Field(min_length=1)


class CheckoutResponse(BaseModel):
    payment_id: str
    checkout_url: str


class PaymentOut(BaseModel):
    id: str
    kind: PaymentKind
    status: PaymentStatus
    amount: int
    currency: str
    plan_name: str | None
    txn_ref: str | None
    created_at: str | None
    paid_at: str | None


class MyPaymentsResponse(BaseModel):
    hostel: PaymentOut | None
    mess: PaymentOut | None


class ReconciliationItem(BaseModel):
    id: str
    full_name: str | None
    email: str
    hostel_status: str  # paid | pending | failed | not_started
    mess_status: str


class ReconciliationResponse(BaseModel):
    participants: list[ReconciliationItem]


class MockSettleRequest(BaseModel):
    session_id: str = Field(min_length=1)
    outcome: Literal["paid", "failed"] = "paid"


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


def serialize_plan(doc: dict[str, Any]) -> MealPlanOut:
    return MealPlanOut(
        id=str(doc["_id"]),
        name=doc.get("name", ""),
        description=doc.get("description", ""),
        amount=int(doc.get("amount", 0)),
        currency=doc.get("currency", "INR"),
        active=bool(doc.get("active")),
    )


def serialize_payment(doc: dict[str, Any]) -> PaymentOut:
    return PaymentOut(
        id=str(doc["_id"]),
        kind=doc.get("kind", "hostel"),
        status=doc.get("status", "created"),
        amount=int(doc.get("amount", 0)),
        currency=doc.get("currency", "INR"),
        plan_name=doc.get("plan_name"),
        txn_ref=doc.get("txn_ref"),
        created_at=_iso(doc.get("created_at")),
        paid_at=_iso(doc.get("paid_at")),
    )
