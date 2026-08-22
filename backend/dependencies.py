"""
Authentication, authorization, and QR verification — the gates every protected
route passes through, and therefore the place where refusals are most worth
recording.

Nothing about who is allowed to do what has changed in this module. Every status
code, every `detail` string, and every lookup is exactly as it was. What is new
is that each refusal now says *why* in the log, using a stable reason slug, and
that the QR failures are told apart from one another.

Why the QR part mattered enough to restructure: `verify_qr` ended in two bare
`except Exception` blocks, so a flat battery, a cracked screen, a clock two
minutes fast, a tampered payload, and a genuine key mismatch all produced the
same 400 and the same silence. At a gate with a queue forming, "the scanner isn't
working" was the only diagnosis available, and it was never enough to act on. The
client still receives the same generic messages — that is deliberate, since a
scanner should not tell a stranger which half of the check failed — but the log
now distinguishes them.
"""
import logging
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from jose.exceptions import ExpiredSignatureError
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

import log_config
from database import participants_collection, backend_teams_collection
from log_redaction import fingerprint, safe_email
from logger import log_denied
from security import SECRET_KEY, ALGORITHM, decrypt_private_key, decrypt_qr_data

security = HTTPBearer()

_log = log_config.get_logger("paradox.auth")

# How stale a QR may be before it is refused. Unchanged in value — it is the same
# 60 seconds the comparison below always used — but named, because the log lines
# report a skew against it and a bare literal in an arithmetic expression is not
# something a reader can check a reported number against.
QR_MAX_AGE = timedelta(seconds=60)


def _refuse_token(reason: str, status_code: int, detail: str, token: str, **fields):
    """
    Log an authentication refusal, then raise it.

    `audit=False`: these are recorded to the file log only. An expired token is
    the single most common refusal an API like this produces — every client with a
    week-old session generates one — and filling the audit trail a Super Admin
    reads with them would bury the deliberate actions it exists to show. The file
    log keeps them, which is where a question like "was this participant's session
    expiring all afternoon" gets answered.
    """
    log_denied(
        None,
        "AUTH_REFUSED",
        None,
        reason=reason,
        details={"status": status_code, "token_fp": fingerprint(token), **fields},
        audit=False,
    )
    raise HTTPException(status_code=status_code, detail=detail)


def _decode_token(token: str) -> Tuple[str, str]:
    """
    The `(user_id, token_type)` a bearer token claims, or a logged 401.

    Splits what `except JWTError` used to collapse. Expiry is separated from
    malformation because they mean completely different things operationally: an
    expired token is a client that needs to sign in again, while a malformed or
    badly-signed one is a client sending something it did not get from us — a
    stale deploy pointed at the wrong `SECRET_KEY`, or someone probing. Both
    still return the identical 401 the route always returned.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except ExpiredSignatureError:
        _refuse_token("token_expired", 401, "Invalid authentication credentials", token)
    except JWTError as exc:
        _refuse_token(
            "token_invalid",
            401,
            "Invalid authentication credentials",
            token,
            error=type(exc).__name__,
        )

    user_id = payload.get("sub")
    token_type = payload.get("type", "participant")
    if user_id is None:
        # A signature that verifies but a subject that is absent means a token
        # this application minted wrongly, which is a bug rather than a bad
        # client. Worth its own slug for exactly that reason.
        _refuse_token("token_missing_subject", 401, "Invalid authentication credentials", token)

    return user_id, token_type


def _require_type(token: str, token_type: str, expected: str, detail: str, user_id: str):
    """A token of the wrong kind for this route."""
    if token_type != expected:
        # Audited, unlike the token failures above. This is not a client with a
        # stale session; it is a caller holding valid credentials for one side of
        # the system reaching for the other — a participant token on a staff
        # endpoint. Rare, deliberate, and exactly what a Super Admin reviewing
        # access wants to be able to query.
        log_denied(
            user_id,
            "AUTHZ_DENIED",
            None,
            reason="wrong_token_type",
            details={
                "status": 403,
                "presented_type": token_type,
                "required_type": expected,
                "token_fp": fingerprint(token),
            },
        )
        raise HTTPException(status_code=403, detail=detail)


def _missing_user(user_id: str, token_type: str, detail: str, token: str):
    """
    A token that verifies, for an account that no longer exists.

    Audited, because it should be impossible in normal operation and is not
    self-explanatory when it happens: either the account was deleted while its
    holder still had a valid week-long token, or the token was minted against a
    different database than the one being read. Both are worth a durable row.
    """
    log_denied(
        user_id,
        "AUTH_REFUSED",
        user_id,
        reason="account_not_found",
        details={"status": 401, "token_type": token_type, "token_fp": fingerprint(token)},
    )
    raise HTTPException(status_code=401, detail=detail)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Accepts both participant and staff tokens. Use for endpoints accessible by both."""
    token = credentials.credentials
    user_id, token_type = _decode_token(token)

    if token_type == "staff":
        user = backend_teams_collection.find_one({"paradox_id": user_id})
    else:
        user = participants_collection.find_one({"participant_id": user_id})

    if user is None:
        _missing_user(user_id, token_type, "User not found", token)
    return user


def get_current_staff(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Requires a staff token (type='staff'). Rejects participant tokens at auth layer."""
    token = credentials.credentials
    user_id, token_type = _decode_token(token)
    _require_type(token, token_type, "staff", "Staff credentials required. Use /auth/admin/login.", user_id)

    user = backend_teams_collection.find_one({"paradox_id": user_id})
    if user is None:
        _missing_user(user_id, token_type, "Staff member not found", token)
    return user


def get_current_participant(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Requires a participant token (type='participant'). Rejects staff tokens at auth layer."""
    token = credentials.credentials
    user_id, token_type = _decode_token(token)
    _require_type(token, token_type, "participant", "Participant credentials required. Use /auth/login.", user_id)

    user = participants_collection.find_one({"participant_id": user_id})
    if user is None:
        _missing_user(user_id, token_type, "Participant not found", token)
    return user


def _refuse_qr(
    reason: str,
    status_code: int,
    detail: str,
    scanned_id: Optional[str],
    actor: Any = None,
    domain: Optional[str] = None,
    target_id: Optional[str] = None,
    **fields,
):
    """
    Log a QR refusal against the gate that made it, then raise it.

    Audited, because a QR that will not scan is the most disputed event at the
    fest and the one a participant is most likely to come back and ask about. The
    row names the participant whose code was presented, the staff member holding
    the scanner, and the reason — which is the whole of what settles it.
    """
    log_denied(
        actor,
        "QR_VERIFY_FAILED",
        target_id,
        reason=reason,
        details={
            "status": status_code,
            "scanned_id": scanned_id,
            "scan_domain": domain,
            **fields,
        },
    )
    raise HTTPException(status_code=status_code, detail=detail)


def verify_qr(request, actor: Any = None, domain: Optional[str] = None, target_id: Optional[str] = None):
    """
    Decrypt and freshness-check a scanned QR code.

    `actor`, `domain`, and `target_id` are new and optional, purely so a refusal
    can name the gate that produced it: the scanning staff member, which surface
    (`mess` / `hostel` / `workshop` / `event`), and which hall, block, workshop or
    event. All three default to None, so the original one-argument call still
    works exactly as before — nothing about the verification itself depends on
    them.
    """
    scanned_id = getattr(request, "participant_id", None)

    target_user = participants_collection.find_one({"participant_id": scanned_id})
    matched_by = "participant_id"
    if not target_user:
        target_user = participants_collection.find_one({"email": scanned_id})
        matched_by = "email"

    if not target_user:
        # Recorded with what was actually presented, because the usual cause is a
        # QR from a different fest, a screenshot of somebody else's code, or a
        # participant who never completed registration — and those are only
        # distinguishable if the scanned value is written down.
        _refuse_qr(
            "participant_not_found", 404, "Scanned user not found", scanned_id,
            actor, domain, target_id, lookups_tried=["participant_id", "email"],
        )

    participant_id = target_user.get("participant_id")

    private_key = target_user.get("qr_secrets", {}).get("private_key")
    if not private_key:
        # A registered participant with no keypair cannot ever scan in. It means
        # the document was created by something other than `POST /auth/register`
        # — a seed script, or a partially-completed migration — and no amount of
        # retrying at the gate will fix it. ERROR-worthy, and it names the person
        # so the account can actually be repaired.
        _refuse_qr(
            "missing_private_key", 400, "User missing private key", participant_id,
            actor, domain, target_id, matched_by=matched_by,
        )

    raw_timestamp = getattr(request, "timestamp", None)
    try:
        qr_timestamp = datetime.fromisoformat(str(raw_timestamp).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception as exc:
        # Previously indistinguishable from an expired code. The *shape* of the
        # value is logged rather than the value, since it is client-supplied
        # input, and its length plus the exception type is enough to tell a
        # timezone-format mismatch from a device sending an epoch integer.
        _refuse_qr(
            "timestamp_unparseable", 400, "Invalid timestamp format", participant_id,
            actor, domain, target_id,
            matched_by=matched_by,
            error=type(exc).__name__,
            timestamp_length=len(str(raw_timestamp)) if raw_timestamp is not None else 0,
        )

    skew = datetime.utcnow() - qr_timestamp
    skew_seconds = round(skew.total_seconds(), 2)
    if skew > QR_MAX_AGE:
        # The skew is the point of this line. A code a few seconds past the limit
        # is a slow queue; one 3600 seconds past is a device an hour out of sync,
        # which will refuse *every* participant it scans and needs its clock
        # fixed rather than its user retrained. A negative skew means the device
        # is ahead of the server, which the 60-second window tolerates silently
        # and which would otherwise be invisible.
        _refuse_qr(
            "qr_expired", 400, "QR Code expired", participant_id,
            actor, domain, target_id,
            matched_by=matched_by,
            skew_seconds=skew_seconds,
            max_age_seconds=QR_MAX_AGE.total_seconds(),
        )

    try:
        decrypted_payload = decrypt_qr_data(decrypt_private_key(private_key), request.data)
    except Exception as exc:
        # The most valuable of the five. `decrypt_qr_data` fails for reasons that
        # demand completely different responses — a truncated scan, a payload
        # encrypted against a regenerated keypair, base64 mangled in transit, or
        # a deliberately forged code — and every one of them used to arrive as
        # "Invalid or corrupted QR code" with nothing else recorded.
        #
        # The ciphertext is fingerprinted, never stored: identical fingerprints
        # across several refusals mean one device replaying one stale code, while
        # differing fingerprints mean a series of genuinely distinct bad scans.
        # That distinction is the difference between fixing one handset and
        # investigating a queue.
        _refuse_qr(
            "decrypt_failed", 400, "Invalid or corrupted QR code", participant_id,
            actor, domain, target_id,
            matched_by=matched_by,
            error=type(exc).__name__,
            ciphertext_fp=fingerprint(getattr(request, "data", None)),
            skew_seconds=skew_seconds,
        )

    # A successful verification, at DEBUG so it does not compete with the domain
    # line the caller is about to write. The skew is here too, because watching it
    # drift upward across a day is how a clock problem is caught *before* it
    # starts refusing people.
    log_config.log_call(
        _log,
        logging.DEBUG,
        "QR verified",
        {
            "participant_id": participant_id,
            "scan_domain": domain,
            "target_id": target_id,
            "matched_by": matched_by,
            "skew_seconds": skew_seconds,
        },
    )

    _check_payload_identity(decrypted_payload, target_user, actor, domain, target_id)

    return target_user, decrypted_payload


def _check_payload_identity(
    payload: Any,
    target_user: Dict[str, Any],
    actor: Any,
    domain: Optional[str],
    target_id: Optional[str],
) -> None:
    """
    Note when a decrypted payload names somebody other than the scanned account.

    An observation, not a new refusal. Every caller of `verify_qr` discards the
    decrypted payload — `mess`, `hostel`, and `event` bind it to `_`, and
    `workshops` binds it and never reads it — so nothing in the system currently
    checks that the code's contents agree with the `participant_id` the request
    claimed. The keypair used for decryption is the scanned account's own, so a
    mismatch is unlikely; it is logged rather than enforced because turning it
    into a refusal is a security change that deserves to be decided deliberately,
    not slipped in with instrumentation.
    """
    if not isinstance(payload, dict):
        return

    claimed = payload.get("participant_id") or payload.get("id")
    actual = target_user.get("participant_id")
    if claimed and actual and str(claimed) != str(actual):
        from logger import log_integrity

        log_integrity(
            "QR payload names a different participant than the scanned account",
            reason="qr_payload_identity_mismatch",
            details={
                "scanned_participant_id": actual,
                "payload_participant_id": str(claimed),
                "scan_domain": domain,
                "target_id": target_id,
            },
            actor=actor,
            action="QR_IDENTITY_MISMATCH",
            target_id=target_id,
            audit=True,
        )
