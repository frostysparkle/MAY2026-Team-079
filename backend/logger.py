from database import system_logs_collection
from datetime import datetime
from typing import Any, Dict, Mapping, Optional, Union

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
    """
    log_doc = {
        "timestamp": datetime.utcnow(),
        **actor_identity(actor),
        "action": action,
        "target_id": target_id,
        "details": details or {},
    }
    system_logs_collection.insert_one(log_doc)
