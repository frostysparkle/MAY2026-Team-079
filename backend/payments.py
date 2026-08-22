"""
Mock payment simulation.

The Paradox Connect backend has no real payments domain: no gateway, no
transaction collection, no refund flow. `POST /mess/pay` and
`POST /hostels/pay` need to simulate a settlement anyway, and this is the one
function both call to do it.

Isolated in its own module — rather than inlined in each route — so a later
change (a real gateway integration, a deliberate failure rate for testing,
etc.) touches this one function instead of every call site. Today it always
succeeds; nothing about its signature assumes that stays true.
"""
import uuid
from datetime import datetime
from typing import Optional


def simulate_payment(purpose: str, amount: int, method: Optional[str] = "upi") -> dict:
    """
    Simulate a payment attempt and return the record to store on the
    participant document.

    `purpose` is a short label ("mess" | "hostel") used only to prefix the
    mock transaction id, so a transaction reads as what it was for at a
    glance. `amount` is always the caller's own fixed fee — callers must never
    forward a client-supplied amount here.
    """
    method = method or "upi"
    transaction_id = f"PDX-{purpose.upper()}-{uuid.uuid4().hex[:8].upper()}"
    return {
        "paid": True,
        "transaction_id": transaction_id,
        "amount": amount,
        "method": method,
        "paid_at": datetime.utcnow(),
    }
