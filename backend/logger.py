import logging
from database import system_logs_collection
from datetime import datetime
from typing import Any, Dict, Mapping, Optional, Union

import log_config
import log_context
from log_redaction import redact

# Two trails, written together, deliberately not one.
#
# `system_logs_collection` is the queryable record a Super Admin reads back
# through `GET /audit-logs` — durable, filterable, and surfaced in the dashboard.
# The file log is the forensic stream: it captures far more (every request, every
# refusal, every stack trace), it carries the correlation id that ties a row to
# the request that produced it, and — the reason it matters most — it survives
# the database being the thing that broke. When Mongo is down, the audit trail
# records nothing at all; the file log records exactly that fact.
_log = log_config.get_logger("paradox.audit")

# Either a user document as returned by the `get_current_*` dependencies, or a
# bare id where that is genuinely all the caller has.
Actor = Union[Mapping[str, Any], str, None]


def email_local_part(email: Optional[str]) -> Optional[str]:
    """`bt413179@ds.study.iitm.ac.in` -> `bt413179`. The last-resort label."""
    if not email or "@" not in email:
        return None
    local = email.split("@", 1)[0].strip()
    return local or None


def actor_identity(actor: Actor) -> Dict[str, Optional[str]]:
    """
    Who is acting, resolved to something a person can read.

    An audit entry has to answer "who did this?" without a join. Two reasons it
    is denormalised onto the record rather than looked up when the trail is read:
    a name resolved later is the name *now*, not the name at the time of the
    action, and a staff member or participant who is later deleted would take
    their own history's readability with them.

    `actor_id` stays exactly as it was — the same `paradox_id` or
    `participant_id` — so existing filters, exports, and per-entity views are
    unaffected. `actor_name`/`actor_type`/`actor_role` are additions beside it.

    A bare string id is still accepted, and yields an id with no name; the read
    endpoint resolves those against the collections as a fallback.
    """
    if actor is None:
        return {"actor_id": None, "actor_name": None, "actor_type": None, "actor_role": None}

    if isinstance(actor, str):
        return {"actor_id": actor, "actor_name": None, "actor_type": None, "actor_role": None}

    # Staff carry a paradox_id; participants carry a participant_id. This is the
    # only thing that distinguishes the two id namespaces, which is why the type
    # is recorded rather than left to be guessed from the shape of the id.
    if actor.get("paradox_id"):
        return {
            "actor_id": actor.get("paradox_id"),
            # `designation` before the email because "Mess Head" reads better than
            # "bt413179" for a record whose staff account was created without a name.
            "actor_name": (
                actor.get("name")
                or actor.get("designation")
                or email_local_part(actor.get("email"))
            ),
            "actor_type": "staff",
            "actor_role": actor.get("role"),
        }

    profile = actor.get("profile") or {}
    return {
        "actor_id": actor.get("participant_id"),
        "actor_name": profile.get("full_name") or email_local_part(actor.get("email")),
        "actor_type": "participant",
        "actor_role": "participant",
    }


def log_audit(
    actor: Actor,
    action: str,
    target_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
):
    """
    Standardized function to log auditable actions in the system.

    `actor` is normally the `current_user` document, so the actor's name is
    captured at the moment of the action. See `actor_identity`.

    Two things happen here beyond the original insert, both additive:

    * **The row is mirrored to the file log.** Same facts, plus the correlation
      id, so an action can be read in sequence with the request that caused it
      and with everything else that request did.
    * **A failed insert no longer fails the request.** It used to: this function
      is called *after* the work it describes has already been written, so an
      unreachable Mongo turned a completed scan into a 500, and the client
      retried an operation that had in fact succeeded. Losing an audit row is
      bad; silently duplicating a meal scan because of it is worse. The failure
      is recorded to the file log, which is precisely the case that trail exists
      for.

    `details.request_id` is stamped on so a row can be traced back to its
    request. `GET /audit-logs` passes `details` through untouched, so this is
    visible to existing readers without any change to the response shape.
    """
    identity = actor_identity(actor)
    enriched: Dict[str, Any] = dict(details or {})
    request_id = log_context.get_request_id()
    if request_id and "request_id" not in enriched:
        enriched["request_id"] = request_id

    log_doc = {
        "timestamp": datetime.utcnow(),
        **identity,
        "action": action,
        "target_id": target_id,
        "details": enriched,
    }

    log_config.log_call(
        _log,
        logging.INFO,
        f"audit {action}",
        {
            "action": action,
            "target_id": target_id,
            "actor_id": identity.get("actor_id"),
            "actor_type": identity.get("actor_type"),
            "actor_role": identity.get("actor_role"),
            "details": redact(enriched),
            "audited": True,
        },
    )

    try:
        system_logs_collection.insert_one(log_doc)
    except Exception:
        log_config.log_call(
            _log,
            logging.ERROR,
            f"audit row could not be written for {action}",
            {
                "action": action,
                "target_id": target_id,
                "actor_id": identity.get("actor_id"),
                "audit_write_failed": True,
            },
            exc_info=True,
        )


# ==========================================================================
# THE REFUSAL TRAIL
#
# Everything above records things that *happened*. The helpers below record
# things that were *stopped*, which is the half the system was missing.
#
# The distinction matters because almost every question asked after the fact is
# about a refusal: the student who says they were turned away from dinner, the
# volunteer whose scanner "stopped working", the participant who never got a
# hostel room. None of those left any trace before this — a 400 went back to a
# handheld device and the reasoning behind it was gone the moment the response
# was sent.
#
# Naming rule, and it is load-bearing: a *success* keeps the exact action string
# it always had (`MESS_SCAN`, `HOSTEL_ENTRY`, `CREATE_WORKSHOP`), because
# `routers/audit.py` aggregates on those. `_meal_summary` counts rows where
# `action == "MESS_SCAN"` and de-duplicates on `details.participant_id`/`day`/
# `slot`; a refusal filed under the same string would be counted as a meal
# served. So refusals get their own strings — `MESS_SCAN_DENIED` and friends —
# which the summary's `by_action` breakdown picks up without disturbing any
# existing figure.
#
# `reason` is a short, stable slug rather than the user-facing message. The
# message is written for the person holding the phone and will be reworded; the
# slug is written for whoever is grepping six months later and must not change.
# ==========================================================================

# Outcomes a scan can have. `denied` is a refusal the system intended;
# `duplicate` is a re-scan that changed nothing, which is worth separating
# because it is usually operator behaviour (a queue scanning twice) rather than
# a fault; `error` is a refusal we could not attribute, which is the category
# that should always be empty and never is.
OUTCOME_ALLOWED = "allowed"
OUTCOME_DENIED = "denied"
OUTCOME_DUPLICATE = "duplicate"
OUTCOME_ERROR = "error"

_OUTCOME_LEVELS = {
    OUTCOME_ALLOWED: logging.INFO,
    OUTCOME_DENIED: logging.WARNING,
    OUTCOME_DUPLICATE: logging.INFO,
    OUTCOME_ERROR: logging.ERROR,
}


def _fields(base: Dict[str, Any], extra: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    merged = dict(base)
    if extra:
        merged.update(extra)
    return {key: value for key, value in merged.items() if value is not None}


def log_denied(
    actor: Actor,
    action: str,
    target_id: Optional[str] = None,
    reason: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    audit: bool = True,
    level: int = logging.WARNING,
):
    """
    A refused action.

    `action` is the full, final action string and should carry a `_DENIED` or
    `_FAILED` suffix — it is passed straight through rather than derived, so a
    call site can never accidentally file a refusal under a success string that
    the dashboard counts.

    `audit=False` writes only the file line, for refusals too frequent or too
    low-value to keep forever in the database: an unauthenticated request with a
    malformed token is noise in the audit trail and signal in the file log.
    """
    payload = _fields({"reason": reason, "outcome": OUTCOME_DENIED}, details)
    if audit:
        log_audit(actor, action, target_id, payload)
    else:
        identity = actor_identity(actor)
        log_config.log_call(
            _log,
            level,
            f"denied {action}",
            _fields(
                {
                    "action": action,
                    "target_id": target_id,
                    "actor_id": identity.get("actor_id"),
                    "actor_type": identity.get("actor_type"),
                    "outcome": OUTCOME_DENIED,
                    "reason": reason,
                },
                redact(details or {}),
            ),
        )


def log_scan(
    actor: Actor,
    domain: str,
    action: str,
    outcome: str,
    participant_id: Optional[str] = None,
    target_id: Optional[str] = None,
    reason: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    audit: bool = True,
):
    """
    One QR scan at one gate, whatever came of it.

    The four scan surfaces — mess counters, hostel doors, workshop desks, event
    gates — are the operational heart of the fest and the places where an
    argument is most likely to need settling later. They had four different
    partial records between them: mess and hostel audited only their successes,
    workshops wrote to `workshop_logs` and audited nothing, and the event gate
    wrote nothing whatsoever for a refusal and returned 200 anyway.

    This gives all four the same shape, so "every refusal at every gate in the
    last hour, and why" is one query rather than four incompatible ones.

    `domain` is the surface (`mess`, `hostel`, `workshop`, `event`) and is a log
    field only — it is never folded into the action string, so existing action
    strings stay exactly as they were.

    On `OUTCOME_ALLOWED` the caller passes the historical action string and the
    historical `details` keys, so the row is byte-for-byte what it used to be,
    plus `outcome` and `request_id`. Nothing downstream has to change.
    """
    level = _OUTCOME_LEVELS.get(outcome, logging.INFO)
    payload = _fields(
        {
            "participant_id": participant_id,
            "scan_domain": domain,
            "outcome": outcome,
            "reason": reason,
        },
        details,
    )

    if audit:
        log_audit(actor, action, target_id, payload)
        if level >= logging.WARNING:
            # `log_audit` already emitted an INFO line. A refusal deserves to be
            # in `errors.log` as well, which is the file a person opens first.
            identity = actor_identity(actor)
            log_config.log_call(
                _log,
                level,
                f"scan {outcome}: {action}",
                _fields(
                    {
                        "action": action,
                        "target_id": target_id,
                        "actor_id": identity.get("actor_id"),
                    },
                    redact(payload),
                ),
            )
        return

    identity = actor_identity(actor)
    log_config.log_call(
        _log,
        level,
        f"scan {outcome}: {action}",
        _fields(
            {
                "action": action,
                "target_id": target_id,
                "actor_id": identity.get("actor_id"),
                "actor_type": identity.get("actor_type"),
            },
            redact(payload),
        ),
    )


def log_batch(
    actor: Actor,
    action: str,
    target_id: Optional[str] = None,
    summary: Optional[Dict[str, Any]] = None,
    level: int = logging.INFO,
):
    """
    The outcome of a batch run — an allocation sweep, a cascade.

    Batches are where silence is most expensive. `POST /mess/allocate` returned
    "Allocated 7 participants to messes" and recorded only that number; the three
    people it could not place, and the reason for each, existed nowhere. A count
    of successes is not a report, because the interesting population is the
    complement.

    So a batch summary is expected to carry the skips as well: a total, a
    breakdown by reason, and — through the per-item `*_SKIPPED` rows the callers
    also write — the identity of every individual affected.
    """
    log_audit(actor, action, target_id, summary or {})
    identity = actor_identity(actor)
    log_config.log_call(
        _log,
        level,
        f"batch {action}",
        _fields(
            {
                "action": action,
                "target_id": target_id,
                "actor_id": identity.get("actor_id"),
                "batch": True,
            },
            redact(summary or {}),
        ),
    )


def log_integrity(
    message: str,
    reason: str,
    details: Optional[Dict[str, Any]] = None,
    actor: Actor = None,
    action: Optional[str] = None,
    target_id: Optional[str] = None,
    audit: bool = False,
):
    """
    Something that should be impossible just happened.

    Distinct from a refusal: a refusal is the system working. This is for the
    cases where the code has already decided to carry on regardless — a scan
    window guard that disabled itself because a stored `start_time` would not
    parse, an update that reported zero matched documents after the endpoint had
    already returned success, a counter that would have gone negative.

    Those were all written as silent `return`s and unchecked results, several
    with comments explaining that they could not happen. They can, and when they
    do the behaviour is not a crash but a quiet wrongness: a guard that no longer
    guards, an attendance mark that was never stored. ERROR level, because the
    request succeeding is exactly what makes these hard to find.
    """
    log_config.log_call(
        _log,
        logging.ERROR,
        message,
        _fields({"reason": reason, "integrity": True}, redact(details or {})),
    )
    if audit and action:
        log_audit(actor, action, target_id, _fields({"reason": reason}, details))
