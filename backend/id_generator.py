"""
Shared sequential ID generators.

`hostels.py`, `mess.py`, and `workshops.py` each declared their own
`XIDGenerator` class — identical apart from the prefix string. Consolidated
here as one parameterised generator so the counter logic exists in a single
place.

`events.py` needed two independent counters (event ids and round ids) with a
prefix derived per-call from the event type, so it keeps its own
`EventIDGenerator` class below rather than being forced into the single-prefix
shape.

A caution that applies to every generator here, and the reason they are logged:
each counter lives in memory, starts from a hardcoded seed, and is never
reconciled against the database. A process restart therefore begins re-issuing
ids that have already been handed out, and no collection in this application has
a unique index on the id fields involved. The consequence is not an error but a
duplicate — two hostels or two workshops sharing one id, with lookups resolving
to whichever document Mongo returns first. `create_hostel` and `create_workshop`
check for that case explicitly; the WARNING below is what makes the underlying
condition visible in the first place.
"""
import log_config

_log = log_config.get_logger("paradox.ids")


class SequentialIDGenerator:
    """A simple prefix + incrementing counter ID generator, e.g. HSTL111, HSTL112, ..."""

    def __init__(self, prefix: str, start: int = 111):
        self.prefix = prefix
        self.current_id = start
        # Emitted once per process, at import time, for each generator that exists.
        # It is the line that explains a later id collision: the counter began here,
        # regardless of what is already stored.
        log_config.warning(
            _log,
            f"id generator for {prefix!r} starting from its in-memory seed {start}; "
            "ids already in the database are not consulted",
            {
                "prefix": prefix,
                "seed": start,
                "reason": "in_memory_id_counter",
            },
        )

    def next_id(self) -> str:
        generated_id = self.prefix + str(self.current_id)
        self.current_id += 1
        log_config.debug(
            _log, "id issued", {"id": generated_id, "prefix": self.prefix}
        )
        return generated_id


def generate_room_numbers(num_rooms: int, start: int = 101):
    """
    The room numbers a newly created hostel starts with, e.g.
    ``generate_room_numbers(3)`` -> ``["101", "102", "103"]``.

    Isolated from `create_hostel` on purpose: numbering is currently a flat
    sequential count, but a fest may later want floor-prefixed numbers
    (101, 102, ... 201, 202, ...) or a non-numeric scheme. Keeping the scheme
    behind this one function means that change touches only this function,
    not every call site that builds a hostel document.
    """
    return [str(start + i) for i in range(num_rooms)]


def _report_unknown_type(method: str, event_type) -> None:
    """
    Record an unrecognised event type before the `UnboundLocalError` it causes.

    `blob` is only assigned inside the `if type in [...]` check in each of the three
    methods below, so an unrecognised type raises `UnboundLocalError` on the next
    line — which reaches the client as an opaque 500 with no indication that the
    cause was an event type this generator has never heard of. The exception is
    deliberately left to happen (changing it into a 400 would change the API's
    behaviour); what changes is that the reason is now written down first.
    """
    log_config.error(
        _log,
        f"{method} called with an unrecognised event type; id generation will fail",
        {
            "reason": "unknown_event_type",
            "method": method,
            "event_type": str(event_type),
            "known_types": ["technical", "culturals", "sports", "others"],
        },
    )


class EventIDGenerator:
    """
    Event ids, round ids, and team ids, each with their own counter and a
    prefix derived from the event type at call time (e.g. "technical" ->
    "EVTEC1111", "TMTEC111111" for a team).

    A team id is assigned the same way as an event id or a round id: the
    backend mints it (`next_team_id`, called from
    `routers.events.register_for_event` when a participant creates a team)
    and a client never supplies one — a participant who wants to join an
    existing team is given that id by its leader out of band and sends it
    back on `EventRegistrationInput.team_id`, they do not choose it.
    """

    def __init__(self):
        self.current_event_id = 1111
        self.current_round_id = 11111
        self.current_team_id = 111111

    def next_event_id(self, type: str):
        if type in ["technical", "culturals", "sports", "others"]:
            blob = "EV" + type[:3].upper()
        else:
            _report_unknown_type("next_event_id", type)
        event_id = blob + str(self.current_event_id)
        self.current_event_id += 1
        return event_id

    def next_round_id(self, type: str):
        if type in ["technical", "culturals", "sports", "others"]:
            blob = "RND" + type[:3].upper()
        else:
            _report_unknown_type("next_round_id", type)
        round_id = blob + str(self.current_round_id)
        self.current_round_id += 1
        return round_id

    def next_team_id(self, type: str):
        if type in ["technical", "culturals", "sports", "others"]:
            blob = "TM" + type[:3].upper()
        else:
            _report_unknown_type("next_team_id", type)
        team_id = blob + str(self.current_team_id)
        self.current_team_id += 1
        return team_id


class BackendTeamIDGenerator:
    """
    `paradox_id`s for backend_teams (staff) accounts: a 2-letter role code
    plus a 2-letter department code plus one shared incrementing counter,
    e.g. a `volunteer` in `mess` -> "VLME1111". Visually distinguishes an
    account's role and department at a glance, the same way `EventIDGenerator`
    encodes an event's type into `event_id`.

    One counter shared across every role/department pair (not one per pair) —
    matches how `SequentialIDGenerator` hands out a single sequence regardless
    of sub-type for hostels/mess/workshops.
    """

    ROLE_CODES = {
        "super_admin": "SA",
        "admin": "AD",
        "other": "OT",
        "volunteer": "VL",
    }

    DEPARTMENT_CODES = {
        "technical": "TE",
        "sports": "SP",
        "culturals": "CU",
        "uhc": "UH",
        "hostels": "HO",
        "mess": "ME",
        "workshops": "WO",
    }

    def __init__(self, start: int = 1111):
        self.current_id = start
        # `paradox_id` is the identity every audit row, duty roster, and scan record
        # joins on, and it has no unique index either — so a re-issued staff id after
        # a restart would attribute one person's actions to another's history.
        log_config.warning(
            _log,
            f"staff id generator starting from its in-memory seed {start}; "
            "existing paradox_ids are not consulted",
            {"seed": start, "reason": "in_memory_id_counter", "id_type": "paradox_id"},
        )

    def next_id(self, role: str, department: str) -> str:
        # Both lookups are unguarded subscripts, so an unrecognised role or
        # department raises `KeyError` and reaches the client as a 500 rather than a
        # 400 naming the bad value. The exception is left as it is — turning it into
        # a 400 would change the API's behaviour — but the offending value and the
        # accepted set are recorded first, which is the whole of what a caller
        # debugging a failed staff creation needs.
        if role not in self.ROLE_CODES or department not in self.DEPARTMENT_CODES:
            log_config.error(
                _log,
                "staff id generation called with an unrecognised role or department",
                {
                    "reason": "unknown_role_or_department",
                    "role": str(role),
                    "department": str(department),
                    "role_known": role in self.ROLE_CODES,
                    "department_known": department in self.DEPARTMENT_CODES,
                    "known_roles": sorted(self.ROLE_CODES),
                    "known_departments": sorted(self.DEPARTMENT_CODES),
                },
            )

        role_code = self.ROLE_CODES[role]
        department_code = self.DEPARTMENT_CODES[department]
        generated_id = role_code + department_code + str(self.current_id)
        self.current_id += 1
        log_config.debug(
            _log,
            "staff id issued",
            {"paradox_id": generated_id, "role": role, "department": department},
        )
        return generated_id
