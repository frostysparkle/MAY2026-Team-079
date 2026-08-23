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
from typing import Any, Mapping, Optional

import log_config

_log = log_config.get_logger("paradox.payments")


def simulate_payment(
    purpose: str,
    amount: int,
    method: Optional[str] = "upi",
    purpose_actor: Optional[Mapping[str, Any]] = None,
) -> dict:
    """
    Simulate a payment attempt and return the record to store on the
    participant document.

    `purpose` is a short label ("mess" | "hostel") used only to prefix the
    mock transaction id, so a transaction reads as what it was for at a
    glance. `amount` is always the caller's own fixed fee — callers must never
    forward a client-supplied amount here.

    `purpose_actor` is optional and used only for the log line: the participant
    document the fee is being settled for, so a minted transaction id can be tied
    to a person without the caller having to log it separately. It is not part of
    the returned record and nothing about the simulation depends on it.

    Every mint is logged. Today this function cannot fail, so there is no failure
    branch to record — but a transaction id that exists in the log at the moment it
    was created is what makes a later dispute tractable, and it is the natural
    place for a real gateway's failures to be recorded when one replaces this.
    """
    method = method or "upi"
    transaction_id = f"PDX-{purpose.upper()}-{uuid.uuid4().hex[:8].upper()}"
    record = {
        "paid": True,
        "transaction_id": transaction_id,
        "amount": amount,
        "method": method,
        "paid_at": datetime.utcnow(),
    }

    log_config.info(
        _log,
        f"simulated {purpose} payment of {amount} settled",
        {
            "purpose": purpose,
            "amount": amount,
            "method": method,
            "transaction_id": transaction_id,
            "participant_id": (purpose_actor or {}).get("participant_id"),
            # Stated explicitly so nobody reading this trail later mistakes these
            # rows for evidence that money actually moved.
            "simulated": True,
        },
    )
    return record
