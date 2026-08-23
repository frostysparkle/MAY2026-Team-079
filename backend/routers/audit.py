from fastapi import APIRouter, HTTPException, Depends
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from database import (
    backend_teams_collection,
    participants_collection,
    system_logs_collection,
)
import log_config
from dependencies import get_current_staff
from logger import email_local_part

router = APIRouter(prefix="/audit-logs", tags=["Audit"])

_log = log_config.get_logger("paradox.audit.read")

# Keys inside `details` that hold a person's id rather than a value. Resolved to
# names alongside the actor, because a row like "assigned BT1755… as volunteer"
# names two different people and neither is readable as an id.
PERSON_DETAIL_KEYS = ("participant_id", "team_user_id", "assigned_user", "user_id")

# The meal sittings a `MESS_SCAN` can be filed under. A scan carrying anything
# else is counted but reported separately rather than discarded — see
# `_meal_summary`.
MEAL_SLOTS = ("breakfast", "lunch", "dinner")


def _naive_utc(value: str, field: str) -> datetime:
    """
    An ISO 8601 instant, in the form the trail is actually stored in.

    Entries are written with `datetime.utcnow()`, so `timestamp` holds a *naive*
    UTC datetime. Comparing those against a timezone-aware bound raises inside
    pymongo, and comparing them against a local-time bound silently shifts the
    window by the caller's offset — enough to file a whole evening's swipes under
    the wrong day. So an offset-bearing input is converted to UTC and then
    stripped, which is the only form that compares correctly against what is
    stored.
    """
    text = value.strip()
    # `fromisoformat` before 3.11 rejects a trailing `Z`, and callers send one.
    if text.endswith(("Z", "z")):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"`{field}` must be an ISO 8601 datetime, e.g. 2026-08-21T00:00:00Z",
        )
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _trail_query(
    target_id: Optional[str],
    action: Optional[str],
    since: Optional[str],
    until: Optional[str],
) -> Dict[str, Any]:
    """
    The Mongo filter shared by the trail and its summary.

    Built in one place precisely so the two cannot drift: a summary that counted a
    different set from the rows beside it would be worse than no summary at all.
    The window is half-open — `since` inclusive, `until` exclusive — so
    consecutive days tile without double-counting the midnight row.
    """
    query: Dict[str, Any] = {}
    if target_id is not None:
        query["target_id"] = target_id
    if action is not None:
        query["action"] = action

    window: Dict[str, datetime] = {}
    if since is not None:
        window["$gte"] = _naive_utc(since, "since")
    if until is not None:
        window["$lt"] = _naive_utc(until, "until")
    if window:
        query["timestamp"] = window

    return query


def _require_super_admin(current_user: dict) -> None:
    user_id = current_user.get("paradox_id")
    if not backend_teams_collection.find_one(
        {"paradox_id": user_id, "role": "super_admin"}
    ):
        # Deliberately a file-only line rather than an audit row. An attempt to read
        # the audit trail must not be able to write to the audit trail: otherwise
        # anyone holding a staff token could inflate this collection at will, and the
        # rows they generated would be indistinguishable from real activity. The file
        # log records it instead, which is outside the reach of this endpoint.
        log_config.warning(
            _log,
            "audit log access refused",
            {
                "reason": "not_super_admin",
                "actor_id": user_id,
                "actor_role": current_user.get("role"),
                "resource": "audit_logs",
                "status": 403,
                "refusal": True,
            },
        )
        raise HTTPException(
            status_code=403, detail="Only Super Admins can view audit logs"
        )


def _meal_summary(query: Dict[str, Any]) -> Dict[str, Any]:
    """
    Meals served in a window, counted per diner rather than per swipe.

    `MESS_SCAN` records one row per successful scan, so counting rows answers "how
    many times was a card read", not "how many people were fed" — a double scan at
    a busy counter inflated the board's headline. Collapsing to one entry per
    `(diner, day, slot)` is what makes the figure a meal count, and the difference
    is reported as `duplicate_scans` rather than hidden.

    Rows whose `day` or `slot` is missing or unrecognised are still counted in
    `meals_served`; they are simply also reported as `unclassified` because there
    is no cell in the day × slot grid to draw them in. Dropping them, which is
    what the client used to do, made the headline quietly smaller than the trail
    it was derived from.
    """
    scans = system_logs_collection.count_documents(query)

    # One document per distinct swipe. Done as an aggregation because the
    # de-duplication has to happen across the whole window, not across whatever
    # page a client happened to fetch.
    distinct = system_logs_collection.aggregate(
        [
            {"$match": query},
            {
                "$group": {
                    "_id": {
                        "participant": "$details.participant_id",
                        "day": "$details.day",
                        "slot": "$details.slot",
                    }
                }
            },
        ]
    )

    by_slot: Counter = Counter()
    by_day: Counter = Counter()
    diners: Set[str] = set()
    meals_served = 0
    unclassified = 0

    for row in distinct:
        key = row.get("_id") or {}
        participant = key.get("participant")
        if isinstance(participant, str) and participant:
            diners.add(participant)

        meals_served += 1

        slot = key.get("slot")
        slot_ok = isinstance(slot, str) and slot in MEAL_SLOTS
        try:
            day = int(key.get("day"))
            day_ok = True
        except (TypeError, ValueError):
            day, day_ok = 0, False

        if slot_ok and day_ok:
            by_slot[slot] += 1
            by_day[str(day)] += 1
        else:
            unclassified += 1

    return {
        "scans": scans,
        "meals_served": meals_served,
        "duplicate_scans": scans - meals_served,
        "unique_diners": len(diners),
        "unclassified": unclassified,
        "by_slot": {slot: by_slot.get(slot, 0) for slot in MEAL_SLOTS},
        "by_day": dict(sorted(by_day.items(), key=lambda item: int(item[0]))),
    }


def _iso_utc(value: Any) -> Any:
    """
    A timestamp the client can read unambiguously.

    Entries are written with `datetime.utcnow()`, and pymongo hands those back
    naive, so the response carried `2026-08-20T18:50:48` with no offset. A
    browser reads an offset-less string as *local* time, which shifted every
    displayed time by the reader's UTC offset. Stamping the zone here fixes the
    whole trail at once, including entries written before this change, and leaves
    what is stored — and therefore how Mongo sorts it — untouched.
    """
    if isinstance(value, datetime):
        aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        return aware.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def _display_names(ids: Iterable[Optional[str]]) -> Dict[str, str]:
    """
    Ids to readable names, in two queries for the whole page of results.

    Deliberately not one query per row: the trail is read 100-1000 entries at a
    time, and a lookup per entry would turn one request into hundreds. Two
    collections have to be consulted because `actor_id` spans both id namespaces
    — staff `paradox_id` and participant `participant_id` — with the older
    entries carrying nothing to say which.
    """
    wanted: Set[str] = {i for i in ids if i}
    if not wanted:
        return {}

    names: Dict[str, str] = {}

    for staff in backend_teams_collection.find(
        {"paradox_id": {"$in": list(wanted)}},
        {"_id": 0, "paradox_id": 1, "name": 1, "designation": 1, "email": 1},
    ):
        label = (
            staff.get("name")
            or staff.get("designation")
            or email_local_part(staff.get("email"))
        )
        if label:
            names[staff["paradox_id"]] = label

    # Only the ids still unaccounted for, so a staff name is never overwritten by
    # the participant record of the same person.
    remaining = wanted - set(names)
    if remaining:
        for person in participants_collection.find(
            {"participant_id": {"$in": list(remaining)}},
            {"_id": 0, "participant_id": 1, "profile.full_name": 1, "email": 1},
        ):
            label = (person.get("profile") or {}).get("full_name") or email_local_part(
                person.get("email")
            )
            if label:
                names[person["participant_id"]] = label

    return names


@router.get("/summary")
def audit_log_summary(
    target_id: Optional[str] = None,
    action: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    current_user: dict = Depends(get_current_staff),
):
    """
    Exact counts over the trail, with no row limit.

    `GET /audit-logs` takes a `limit`, which is right for a table but wrong for a
    total: the dashboard was reading `rows.length` off a capped page and labelling
    it "Recorded Actions", so a fest with more history than the cap silently
    reported the cap. Counting server-side is the only way for those figures to be
    totals rather than floors, and it costs one request instead of paging the
    whole trail into the browser.

    `actor_ids` is the distinct set, not a sample, which is what lets the caller
    answer "which staff acted in this window" exactly. It replaces intersecting
    the staff roster with whatever actors happened to appear in the newest N rows.

    `meals` is present only when the window could contain `MESS_SCAN` rows — that
    is, when `action` is unset or is `MESS_SCAN` — and is `null` otherwise, so a
    caller asking about hostel entries is not handed a meal count.
    """
    _require_super_admin(current_user)

    query = _trail_query(target_id, action, since, until)

    total = system_logs_collection.count_documents(query)

    by_action_rows = system_logs_collection.aggregate(
        [{"$match": query}, {"$group": {"_id": "$action", "count": {"$sum": 1}}}]
    )
    by_action = {
        row["_id"]: row["count"] for row in by_action_rows if row.get("_id") is not None
    }

    actor_ids = sorted(
        actor
        for actor in system_logs_collection.distinct("actor_id", query)
        if isinstance(actor, str) and actor
    )

    meals = None
    if action is None or action == "MESS_SCAN":
        meals = _meal_summary(
            _trail_query(target_id, "MESS_SCAN", since, until)
        )

    return {
        "total": total,
        "by_action": dict(sorted(by_action.items())),
        "distinct_actors": len(actor_ids),
        "actor_ids": actor_ids,
        "meals": meals,
        "window": {"since": since, "until": until},
    }


@router.get("")
def view_audit_logs(
    limit: int = 100,
    target_id: Optional[str] = None,
    action: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    current_user: dict = Depends(get_current_staff)
):
    """
    The audit trail, newest first.

    ``target_id`` narrows the trail to one entity — an event, workshop, mess hall,
    or hostel block — which is what the dashboard's per-entity log view reads.
    Filtering server-side rather than pulling the whole trail and sifting it in the
    client matters here: ``limit`` would otherwise silently cut off an entity's
    older entries, because it applies before any client-side filter can run.

    ``action`` narrows to one kind of action, e.g. ``HOSTEL_ENTRY``. Both are
    optional, so the unfiltered call is unchanged.

    ``since`` and ``until`` are ISO 8601 instants bounding ``timestamp``, half-open
    so consecutive windows tile cleanly. They exist because "today" was previously
    approximated by fetching the newest N rows and filtering them in the browser,
    which makes any daily figure a floor the moment the fest produces more than N
    rows in a day. Filtering here removes the cap from the question entirely.
    ``GET /audit-logs/summary`` takes the same four filters and returns exact
    counts over them.

    Every entry carries a ``names`` map from each person id it mentions to that
    person's name, so the client can show "Priya Raman" where it used to show
    ``BT1755…`` without knowing which collection an id belongs to. Entries written
    since names began being recorded already carry ``actor_name``; the map is what
    makes the entries written before that readable too. ``actor_id`` and
    ``details`` are unchanged, so exports and filters that key on ids still work.
    """
    _require_super_admin(current_user)

    query = _trail_query(target_id, action, since, until)

    logs: List[Dict[str, Any]] = list(
        system_logs_collection.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
    )

    # One pass to collect every id the page mentions, one lookup, then attach.
    referenced: Set[str] = set()
    for log in logs:
        if log.get("actor_id"):
            referenced.add(log["actor_id"])
        # `target_id` is usually an entity — a hall, a block, an event — but for
        # UPDATE_PARTICIPANT it is a person, so it is offered to the lookup too.
        # An id that matches nobody simply does not come back.
        if log.get("target_id"):
            referenced.add(log["target_id"])
        details = log.get("details") or {}
        for key in PERSON_DETAIL_KEYS:
            value = details.get(key)
            if isinstance(value, str) and value:
                referenced.add(value)

    names = _display_names(referenced)

    # Who read the trail, and with which filters — to the file log only, for the same
    # reason as the refusal above: recording audit reads *into* the audit collection
    # would let a Super Admin refreshing a dashboard bury the actions the trail
    # exists to show, and every read would generate a row that the next read
    # reports.
    log_config.info(
        _log,
        f"audit trail read: {len(logs)} row(s)",
        {
            "actor_id": current_user.get("paradox_id"),
            "returned": len(logs),
            "limit": limit,
            "filter_target_id": target_id,
            "filter_action": action,
            "filter_since": since,
            "filter_until": until,
        },
    )

    for log in logs:
        log["timestamp"] = _iso_utc(log.get("timestamp"))
        # Recorded at write time when available — that is the name as it was when
        # the action happened — and only otherwise resolved from the collections.
        if not log.get("actor_name"):
            log["actor_name"] = names.get(log.get("actor_id") or "")
        log.setdefault("actor_type", None)
        log.setdefault("actor_role", None)

        details = log.get("details") or {}
        mentioned: Dict[str, str] = {}
        for key in PERSON_DETAIL_KEYS:
            value = details.get(key)
            if isinstance(value, str) and value in names:
                mentioned[value] = names[value]
        target = log.get("target_id")
        if target in names:
            mentioned[target] = names[target]
        actor_id = log.get("actor_id")
        if actor_id and log.get("actor_name"):
            mentioned[actor_id] = log["actor_name"]
        log["names"] = mentioned

    return logs
