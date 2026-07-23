from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError

from app.qr.totp import generate_secret, verify_and_step


class EventCheckpointUnavailableError(RuntimeError):
    pass


class EventRegistrationRequiredError(RuntimeError):
    pass


def checkpoint_scope_id(checkpoint_context: str, event_id: str | None) -> str:
    if checkpoint_context == "event":
        if event_id is None or not ObjectId.is_valid(event_id):
            raise EventCheckpointUnavailableError("Event not found.")
        return event_id
    return checkpoint_context


async def _require_event_registration(
    events: AsyncCollection[dict[str, Any]],
    registrations: AsyncCollection[dict[str, Any]],
    user_id: ObjectId,
    event_id: str,
) -> None:
    event = await events.find_one(
        {"_id": ObjectId(event_id), "status": "published"}
    )
    if event is None:
        raise EventCheckpointUnavailableError("Event not found.")

    registration = await registrations.find_one(
        {
            "user_id": user_id,
            "event_id": event_id,
            "status": "registered",
        }
    )
    if registration is None:
        raise EventRegistrationRequiredError(
            "Register for this event before provisioning its digital ID."
        )


async def provision_secret(
    qr_secrets: AsyncCollection[dict[str, Any]],
    events: AsyncCollection[dict[str, Any]],
    registrations: AsyncCollection[dict[str, Any]],
    user_id: ObjectId,
    checkpoint_context: str,
    event_id: str | None,
) -> str:
    """Issue (or rotate) a scope-specific TOTP secret and return it once.

    The secret is only ever returned here; no later call re-exposes it.
    """
    scope_id = checkpoint_scope_id(checkpoint_context, event_id)
    if checkpoint_context == "event":
        await _require_event_registration(
            events, registrations, user_id, scope_id
        )

    secret = generate_secret()
    now = datetime.now(UTC)
    await qr_secrets.update_one(
        {
            "user_id": user_id,
            "checkpoint_context": checkpoint_context,
            "scope_id": scope_id,
        },
        {
            "$set": {
                "user_id": user_id,
                "checkpoint_context": checkpoint_context,
                "scope_id": scope_id,
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
    """Access gating per checkpoint.

    Mess requires an explicit mess pass (Epic 4, FR-4.2/4.3): eligibility must be
    granted, so an unset participant is 'not eligible'. Hostel payment gating is
    softer for the MVP: only an explicit False blocks (Epic 5 / payments open
    question).
    """
    access = user.get("access") or {}
    if checkpoint_context == "mess" and access.get("mess_eligible") is not True:
        return ScanOutcome("not_eligible", detail="No active mess pass.")
    if checkpoint_context == "hostel" and access.get("hostel_paid") is False:
        return ScanOutcome("payment_pending", detail="Hostel fee not yet paid.")
    return None


async def _audit(
    scan_logs: AsyncCollection[dict[str, Any]],
    participant_id: str,
    checkpoint_context: str,
    scope_id: str,
    result: str,
    scanned_by: ObjectId,
) -> None:
    log = {
        "participant_id": participant_id,
        "checkpoint_context": checkpoint_context,
        "scope_id": scope_id,
        "result": result,
        "scanned_by": scanned_by,
        "scanned_at": datetime.now(UTC),
    }
    if checkpoint_context == "event":
        log["event_id"] = scope_id
    await scan_logs.insert_one(log)


async def verify_scan(
    users: AsyncCollection[dict[str, Any]],
    events: AsyncCollection[dict[str, Any]],
    registrations: AsyncCollection[dict[str, Any]],
    qr_secrets: AsyncCollection[dict[str, Any]],
    scan_logs: AsyncCollection[dict[str, Any]],
    participant_id: str,
    current_code: str,
    checkpoint_context: str,
    scanned_by: ObjectId,
    hostel_allocations: AsyncCollection[dict[str, Any]] | None = None,
    event_id: str | None = None,
) -> ScanOutcome:
    try:
        scope_id = checkpoint_scope_id(checkpoint_context, event_id)
    except EventCheckpointUnavailableError:
        return ScanOutcome("wrong_checkpoint")

    if not ObjectId.is_valid(participant_id):
        await _audit(
            scan_logs,
            participant_id,
            checkpoint_context,
            scope_id,
            "unknown_participant",
            scanned_by,
        )
        return ScanOutcome("unknown_participant")

    user = await users.find_one({"_id": ObjectId(participant_id)})
    if user is None:
        await _audit(
            scan_logs,
            participant_id,
            checkpoint_context,
            scope_id,
            "unknown_participant",
            scanned_by,
        )
        return ScanOutcome("unknown_participant")
    if user.get("status") != "active":
        await _audit(
            scan_logs,
            participant_id,
            checkpoint_context,
            scope_id,
            "not_eligible",
            scanned_by,
        )
        return ScanOutcome("not_eligible", detail="Participant account is inactive.")

    if checkpoint_context == "event":
        try:
            await _require_event_registration(
                events, registrations, user["_id"], scope_id
            )
        except EventCheckpointUnavailableError:
            await _audit(
                scan_logs,
                participant_id,
                checkpoint_context,
                scope_id,
                "wrong_checkpoint",
                scanned_by,
            )
            return ScanOutcome("wrong_checkpoint")
        except EventRegistrationRequiredError:
            await _audit(
                scan_logs,
                participant_id,
                checkpoint_context,
                scope_id,
                "not_eligible",
                scanned_by,
            )
            return ScanOutcome(
                "not_eligible",
                detail="Participant is not registered for this event.",
            )

    secret_doc = await qr_secrets.find_one(
        {
            "user_id": ObjectId(participant_id),
            "checkpoint_context": checkpoint_context,
            "scope_id": scope_id,
        }
    )
    if secret_doc is None:
        await _audit(
            scan_logs,
            participant_id,
            checkpoint_context,
            scope_id,
            "wrong_checkpoint",
            scanned_by,
        )
        return ScanOutcome("wrong_checkpoint")

    step = verify_and_step(secret_doc["secret_base32"], current_code)
    if step is None:
        await _audit(
            scan_logs,
            participant_id,
            checkpoint_context,
            scope_id,
            "expired",
            scanned_by,
        )
        return ScanOutcome("expired")

    blocked = _eligibility_block(user, checkpoint_context)
    if blocked is not None:
        await _audit(
            scan_logs,
            participant_id,
            checkpoint_context,
            scope_id,
            blocked.result,
            scanned_by,
        )
        return blocked

    # Hostel check-in (FR-5.2): a participant with no allocation is not eligible.
    allocation: dict[str, Any] | None = None
    if checkpoint_context == "hostel" and hostel_allocations is not None:
        allocation = await hostel_allocations.find_one({"user_id": ObjectId(participant_id)})
        if allocation is None:
            await _audit(
                scan_logs,
                participant_id,
                checkpoint_context,
                scope_id,
                "not_eligible",
                scanned_by,
            )
            return ScanOutcome("not_eligible", detail="No accommodation assigned.")

    # Replay protection includes the concrete event/checkpoint scope.
    log: dict[str, Any] = {
        "participant_id": participant_id,
        "checkpoint_context": checkpoint_context,
        "scope_id": scope_id,
        "step": step,
        "result": "valid",
        "scanned_by": scanned_by,
        "scanned_at": datetime.now(UTC),
    }
    if checkpoint_context == "event":
        log["event_id"] = scope_id
    try:
        await scan_logs.insert_one(log)
    except DuplicateKeyError:
        return ScanOutcome("duplicate")

    detail: str | None = None
    if allocation is not None:
        await hostel_allocations.update_one(
            {"_id": allocation["_id"]},
            {"$set": {"checked_in": True, "checked_in_at": datetime.now(UTC)}},
        )
        detail = f"{allocation.get('hostel_block', '')} · Room {allocation.get('room', '')}"

    return ScanOutcome("valid", user=user, detail=detail)
