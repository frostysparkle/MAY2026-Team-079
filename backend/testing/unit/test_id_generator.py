"""
Unit tests for backend/id_generator.py.

Two of the four classes crash on out-of-vocabulary input rather than reporting
it. Both are normally shielded by `Literal[...]` annotations on the request
models, so the crash is only reachable from internal callers — but
`events.update_event` and `events.allocate_teams` both pass
`event.get("event_type", "others")` read back from a stored document, which no
model validates on the way out. Those are the xfails below.
"""
import pytest

from id_generator import (
    BackendTeamIDGenerator,
    EventIDGenerator,
    SequentialIDGenerator,
    generate_room_numbers,
)


# ---------------------------------------------------------------------------
# SequentialIDGenerator
# ---------------------------------------------------------------------------

def test_sequential_starts_at_111_and_increments():
    generator = SequentialIDGenerator("WKSP")
    assert generator.next_id() == "WKSP111"
    assert generator.next_id() == "WKSP112"
    assert generator.next_id() == "WKSP113"


def test_sequential_honours_a_custom_start():
    assert SequentialIDGenerator("HSTL", start=500).next_id() == "HSTL500"


def test_sequential_exposes_its_counter_for_test_isolation():
    """`conftest.reset_process_state` relies on this attribute being writable."""
    generator = SequentialIDGenerator("X")
    generator.next_id()
    generator.current_id = 111
    assert generator.next_id() == "X111"


def test_two_generators_do_not_share_a_counter():
    first, second = SequentialIDGenerator("A"), SequentialIDGenerator("B")
    first.next_id()
    assert second.next_id() == "B111"


# ---------------------------------------------------------------------------
# generate_room_numbers
# ---------------------------------------------------------------------------

def test_room_numbers_are_sequential_strings():
    assert generate_room_numbers(3) == ["101", "102", "103"]


def test_room_numbers_honour_a_custom_start():
    assert generate_room_numbers(2, start=201) == ["201", "202"]


@pytest.mark.parametrize("count", [0, -1, -10])
def test_non_positive_room_counts_yield_nothing(count):
    assert generate_room_numbers(count) == []


def test_room_numbers_cross_a_hundred_boundary():
    assert generate_room_numbers(3, start=199) == ["199", "200", "201"]


# ---------------------------------------------------------------------------
# EventIDGenerator
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "event_type,expected",
    [
        ("technical", "EVTEC1111"),
        ("culturals", "EVCUL1111"),
        ("sports", "EVSPO1111"),
        ("others", "EVOTH1111"),
    ],
)
def test_event_id_prefix_is_derived_from_the_type(event_type, expected):
    assert EventIDGenerator().next_event_id(event_type) == expected


def test_round_and_team_ids_have_their_own_prefixes_and_counters():
    generator = EventIDGenerator()
    assert generator.next_round_id("technical") == "RNDTEC11111"
    assert generator.next_team_id("technical") == "TMTEC111111"
    # Three independent counters: advancing one leaves the others alone.
    assert generator.next_event_id("technical") == "EVTEC1111"
    assert generator.next_round_id("technical") == "RNDTEC11112"
    assert generator.next_team_id("technical") == "TMTEC111112"


def test_team_ids_are_unique_across_event_types():
    """One counter for teams regardless of type, so ids never collide even when
    the prefix differs."""
    generator = EventIDGenerator()
    first = generator.next_team_id("technical")
    second = generator.next_team_id("sports")
    assert first == "TMTEC111111"
    assert second == "TMSPO111112"


@pytest.mark.parametrize("method", ["next_event_id", "next_round_id", "next_team_id"])
def test_unknown_event_type_reports_a_clear_error(method):
    """
    It used to leave the prefix variable unassigned and raise `UnboundLocalError`,
    which the client saw as a 500 pointing at a variable rather than at the bad value.
    """
    generator = EventIDGenerator()
    with pytest.raises(ValueError) as excinfo:
        getattr(generator, method)("quidditch")
    message = str(excinfo.value)
    assert "quidditch" in message
    assert "technical" in message, "the accepted set is named"


@pytest.mark.parametrize("method", ["next_event_id", "next_round_id", "next_team_id"])
def test_a_rejected_type_does_not_consume_a_counter(method):
    """The refusal happens before the increment, so a failed call cannot leave a gap
    in the id sequence."""
    generator = EventIDGenerator()
    before = (generator.current_event_id, generator.current_round_id, generator.current_team_id)
    with pytest.raises(ValueError):
        getattr(generator, method)("quidditch")
    assert (generator.current_event_id, generator.current_round_id,
            generator.current_team_id) == before


def test_the_event_type_code_table_covers_the_model_vocabulary():
    from id_generator import EVENT_TYPE_CODES
    from models import EVENT_TYPES

    assert set(EVENT_TYPE_CODES) == set(EVENT_TYPES)


# ---------------------------------------------------------------------------
# BackendTeamIDGenerator
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "role,department,expected",
    [
        ("super_admin", "workshops", "SAWO1111"),
        ("admin", "technical", "ADTE1111"),
        ("other", "hostels", "OTHO1111"),
        ("volunteer", "mess", "VLME1111"),
        ("volunteer", "sports", "VLSP1111"),
        ("admin", "culturals", "ADCU1111"),
        ("other", "uhc", "OTUH1111"),
    ],
)
def test_paradox_id_encodes_role_and_department(role, department, expected):
    assert BackendTeamIDGenerator().next_id(role, department) == expected


def test_one_counter_is_shared_across_every_role_department_pair():
    generator = BackendTeamIDGenerator()
    assert generator.next_id("admin", "mess") == "ADME1111"
    assert generator.next_id("volunteer", "uhc") == "VLUH1112"
    assert generator.next_id("admin", "mess") == "ADME1113"


def test_role_and_department_code_tables_cover_the_model_vocabularies():
    """The `Literal[...]` sets on `BackendTeamCreateRequest` are exactly what the
    code tables must cover; a value in one and not the other is a 500."""
    from models import BACKEND_TEAM_DEPARTMENTS, BACKEND_TEAM_ROLES

    assert set(BackendTeamIDGenerator.ROLE_CODES) == set(BACKEND_TEAM_ROLES)
    assert set(BackendTeamIDGenerator.DEPARTMENT_CODES) == set(BACKEND_TEAM_DEPARTMENTS)


@pytest.mark.parametrize("role,department", [("wizard", "mess"), ("admin", "quidditch")])
def test_unknown_role_or_department_reports_a_clear_error(role, department):
    """Previously a bare `KeyError`, which reached the client as a 500 naming
    nothing."""
    with pytest.raises(ValueError) as excinfo:
        BackendTeamIDGenerator().next_id(role, department)
    message = str(excinfo.value)
    assert role in message and department in message


def test_a_rejected_staff_id_does_not_consume_the_counter():
    generator = BackendTeamIDGenerator()
    with pytest.raises(ValueError):
        generator.next_id("wizard", "mess")
    assert generator.next_id("admin", "mess") == "ADME1111"
