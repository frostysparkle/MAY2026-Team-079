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


class EventIDGenerator:
    """
    Event ids and round ids, each with their own counter and a prefix derived
    from the event type at call time (e.g. "technical" -> "EVTEC1111").
    """

    def __init__(self):
        self.current_event_id = 1111
        self.current_round_id = 11111

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
