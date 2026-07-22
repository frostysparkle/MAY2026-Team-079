from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError

from app.qr.totp import generate_secret, verify_and_step


async def provision_secret(
    qr_secrets: AsyncCollection[dict[str, Any]],
    user_id: ObjectId,
    checkpoint_context: str,
) -> str:
    """Issue (or rotate) the per-checkpoint TOTP secret and return it once.

    The secret is only ever returned here; no later call re-exposes it.
    """
    secret = generate_secret()
    now = datetime.now(UTC)
    await qr_secrets.update_one(
        {"user_id": user_id, "checkpoint_context": checkpoint_context},
        {
            "$set": {
                "user_id": user_id,
                "checkpoint_context": checkpoint_context,
                "secret_base32": secret,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return secret


@dataclass(slots=True)
class ScanOutcome:
    result: str
    user: dict[str, Any] | None = None
    detail: str | None = None


def _eligibility_block(user: dict[str, Any], checkpoint_context: str) -> ScanOutcome | None:
    """Optional access gating. Missing data means eligible (happy path)."""
    access = user.get("access") or {}
    if checkpoint_context == "hostel" and access.get("hostel_paid") is False:
        return ScanOutcome("payment_pending", detail="Hostel fee not yet paid.")
    if checkpoint_context == "mess" and access.get("mess_eligible") is False:
        return ScanOutcome("not_eligible", detail="No active meal plan.")
    return None


async def _audit(
    scan_logs: AsyncCollection[dict[str, Any]],
    participant_id: str,
    checkpoint_context: str,
    result: str,
    scanned_by: ObjectId,
) -> None:
    await scan_logs.insert_one(
        {
            "participant_id": participant_id,
            "checkpoint_context": checkpoint_context,
            "result": result,
            "scanned_by": scanned_by,
            "scanned_at": datetime.now(UTC),
        }
    )


async def verify_scan(
    users: AsyncCollection[dict[str, Any]],
    qr_secrets: AsyncCollection[dict[str, Any]],
    scan_logs: AsyncCollection[dict[str, Any]],
    participant_id: str,
    current_code: str,
    checkpoint_context: str,
    scanned_by: ObjectId,
) -> ScanOutcome:
    if not ObjectId.is_valid(participant_id):
        await _audit(scan_logs, participant_id, checkpoint_context, "unknown_participant", scanned_by)
        return ScanOutcome("unknown_participant")

    user = await users.find_one({"_id": ObjectId(participant_id)})
    if user is None:
        await _audit(scan_logs, participant_id, checkpoint_context, "unknown_participant", scanned_by)
        return ScanOutcome("unknown_participant")

    secret_doc = await qr_secrets.find_one(
        {"user_id": ObjectId(participant_id), "checkpoint_context": checkpoint_context}
    )
    if secret_doc is None:
        await _audit(scan_logs, participant_id, checkpoint_context, "wrong_checkpoint", scanned_by)
        return ScanOutcome("wrong_checkpoint")

    step = verify_and_step(secret_doc["secret_base32"], current_code)
    if step is None:
        await _audit(scan_logs, participant_id, checkpoint_context, "expired", scanned_by)
        return ScanOutcome("expired")

    blocked = _eligibility_block(user, checkpoint_context)
    if blocked is not None:
        await _audit(scan_logs, participant_id, checkpoint_context, blocked.result, scanned_by)
        return blocked

    # Replay protection: a matched (participant, context, step) records once.
    try:
        await scan_logs.insert_one(
            {
                "participant_id": participant_id,
                "checkpoint_context": checkpoint_context,
                "step": step,
                "result": "valid",
                "scanned_by": scanned_by,
                "scanned_at": datetime.now(UTC),
            }
        )
    except DuplicateKeyError:
        return ScanOutcome("duplicate")

    return ScanOutcome("valid", user=user)
