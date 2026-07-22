"""Payment gateway abstraction.

Paradox Connect never touches raw card data (PRD §7.2): a gateway only produces
a hosted-checkout URL and later confirms the outcome via a signature-verified
webhook. The `MockGateway` simulates a hosted checkout for local/dev use; a real
provider (Razorpay/Stripe-style) implements the same `PaymentGateway` protocol
and is swapped in by setting PAYMENT_GATEWAY + PAYMENT_WEBHOOK_SECRET.
"""

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class CheckoutSession:
    session_id: str
    checkout_url: str


@dataclass(frozen=True, slots=True)
class WebhookEvent:
    session_id: str
    status: str  # "paid" | "failed"
    txn_ref: str | None


class WebhookVerificationError(RuntimeError):
    pass


class PaymentGateway(Protocol):
    def create_checkout(
        self, session_id: str, amount: int, currency: str, description: str
    ) -> CheckoutSession: ...

    def parse_webhook(self, raw_body: bytes, signature: str | None) -> WebhookEvent: ...


def _sign(secret: str, raw_body: bytes) -> str:
    return hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()


class MockGateway:
    """Simulated hosted checkout. The checkout URL points at a frontend mock
    page; settlement is triggered server-side (see the mock/settle route), which
    emits a signed webhook processed by the very same verification path a real
    provider would use."""

    def __init__(self, settings: Settings) -> None:
        self._secret = settings.payment_webhook_secret
        self._frontend = settings.frontend_base_url.rstrip("/")

    def create_checkout(
        self, session_id: str, amount: int, currency: str, description: str
    ) -> CheckoutSession:
        query = urlencode({"session": session_id, "amount": amount, "currency": currency})
        return CheckoutSession(
            session_id=session_id,
            checkout_url=f"{self._frontend}/payments/mock?{query}",
        )

    def sign(self, payload: dict[str, Any]) -> tuple[bytes, str]:
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        return raw, _sign(self._secret, raw)

    def parse_webhook(self, raw_body: bytes, signature: str | None) -> WebhookEvent:
        if not signature or not hmac.compare_digest(
            signature, _sign(self._secret, raw_body)
        ):
            raise WebhookVerificationError("Invalid webhook signature.")
        try:
            data = json.loads(raw_body)
        except ValueError as exc:
            raise WebhookVerificationError("Malformed webhook body.") from exc
        session_id = data.get("session_id")
        status = data.get("status")
        if not isinstance(session_id, str) or status not in {"paid", "failed"}:
            raise WebhookVerificationError("Missing or invalid webhook fields.")
        return WebhookEvent(session_id=session_id, status=status, txn_ref=data.get("txn_ref"))


def get_gateway(settings: Settings) -> PaymentGateway:
    # Only the mock gateway ships today; real providers plug in here.
    return MockGateway(settings)


def is_mock_gateway(settings: Settings) -> bool:
    return settings.payment_gateway == "mock"
