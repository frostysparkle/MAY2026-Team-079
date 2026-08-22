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
"""


class SequentialIDGenerator:
    """A simple prefix + incrementing counter ID generator, e.g. HSTL111, HSTL112, ..."""

    def __init__(self, prefix: str, start: int = 111):
        self.prefix = prefix
        self.current_id = start

    def next_id(self) -> str:
        generated_id = self.prefix + str(self.current_id)
        self.current_id += 1
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
        event_id = blob + str(self.current_event_id)
        self.current_event_id += 1
        return event_id

    def next_round_id(self, type: str):
        if type in ["technical", "culturals", "sports", "others"]:
            blob = "RND" + type[:3].upper()
        round_id = blob + str(self.current_round_id)
        self.current_round_id += 1
        return round_id

    def next_team_id(self, type: str):
        if type in ["technical", "culturals", "sports", "others"]:
            blob = "TM" + type[:3].upper()
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

    def next_id(self, role: str, department: str) -> str:
        role_code = self.ROLE_CODES[role]
        department_code = self.DEPARTMENT_CODES[department]
        generated_id = role_code + department_code + str(self.current_id)
        self.current_id += 1
        return generated_id
