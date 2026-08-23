"""
Unit tests for the event models in backend/models.py.

The event schema is the deepest in the app — nested team rules, a registration
window, a schedule of rounds, and a client-defined registration form — so almost
every 422 an event endpoint can return originates here rather than in the route.
"""
import pytest
from pydantic import ValidationError

from models import (
    ANNOUNCEMENT_PRIORITIES,
    EVENT_TEAM_ROLES,
    EVENT_TYPES,
    PARTICIPANT_TEAM_ROLES,
    AnnouncementCreateRequest,
    EventCreateRequest,
    EventRegistrationInput,
    EventTeamAssignRequest,
    EventTeamRoleUpdateRequest,
    EventUpdateRequest,
    PrizeMoney,
    RegistrationField,
    RegistrationWindow,
    RegistrationWindowUpdate,
    ScheduleRound,
    TeamRule,
)

VALID_EVENT = {
    "event_type": "technical",
    "name": "Hackathon",
    "description": "24 hours of building.",
    "team": {"min": 1, "max": 1},
    "registration": {
        "start_time": "2026-06-01T10:00:00Z",
        "end_time": "2026-06-10T10:00:00Z",
    },
}


# ---------------------------------------------------------------------------
# Vocabularies
# ---------------------------------------------------------------------------

def test_event_vocabularies():
    assert set(EVENT_TYPES) == {"technical", "culturals", "sports", "others"}
    assert set(EVENT_TEAM_ROLES) == {"event_head", "member", "volunteer"}
    assert set(PARTICIPANT_TEAM_ROLES) == {"leader", "member"}
    assert set(ANNOUNCEMENT_PRIORITIES) == {"low", "mid", "high"}


# ---------------------------------------------------------------------------
# PrizeMoney
# ---------------------------------------------------------------------------

def test_prize_money_requires_a_position_and_a_non_negative_amount():
    assert PrizeMoney(position="first", amount=5000).amount == 5000
    assert PrizeMoney(position="participation", amount=0).amount == 0


@pytest.mark.parametrize("amount", [-1, -5000])
def test_a_negative_prize_is_rejected(amount):
    with pytest.raises(ValidationError):
        PrizeMoney(position="first", amount=amount)


def test_a_blank_position_is_rejected():
    with pytest.raises(ValidationError):
        PrizeMoney(position="", amount=1)


# ---------------------------------------------------------------------------
# ScheduleRound
# ---------------------------------------------------------------------------

def test_a_round_needs_a_name_and_a_valid_window():
    rnd = ScheduleRound(name="Round 1", start_time="2026-06-13T10:00:00Z",
                        end_time="2026-06-13T12:00:00Z")
    assert rnd.round_id is None, "assigned by the backend, never accepted from a client"
    assert rnd.description == ""
    assert rnd.venue is None


def test_a_round_whose_end_precedes_its_start_is_rejected():
    with pytest.raises(ValidationError) as excinfo:
        ScheduleRound(name="R", start_time="2026-06-13T12:00:00Z", end_time="2026-06-13T10:00:00Z")
    assert "end_time must be after start_time" in str(excinfo.value)


def test_a_blank_round_name_is_rejected():
    with pytest.raises(ValidationError):
        ScheduleRound(name="", start_time="2026-06-13T10:00:00Z", end_time="2026-06-13T12:00:00Z")


def test_a_round_id_supplied_by_a_client_is_accepted_by_the_model():
    """The model tolerates it because `PUT /events/{id}` round-trips stored
    rounds through the same type; `create_event` overwrites it regardless."""
    assert ScheduleRound(round_id="RNDTEC11111", name="R",
                         start_time="2026-06-13T10:00:00Z",
                         end_time="2026-06-13T12:00:00Z").round_id == "RNDTEC11111"


# ---------------------------------------------------------------------------
# RegistrationField
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field_type", ["text", "number", "email", "phone", "url", "select", "checkbox"])
def test_every_allowed_registration_field_type(field_type):
    assert RegistrationField(field_id="f", label="L", type=field_type).type == field_type


@pytest.mark.parametrize("field_type", ["textarea", "Text", "", "file"])
def test_an_unknown_registration_field_type_is_rejected(field_type):
    with pytest.raises(ValidationError) as excinfo:
        RegistrationField(field_id="f", label="L", type=field_type)
    assert "type must be one of" in str(excinfo.value)


def test_a_registration_field_is_required_by_default():
    assert RegistrationField(field_id="f", label="L", type="text").required is True


@pytest.mark.parametrize("blank_field", ["field_id", "label"])
def test_a_registration_field_needs_an_id_and_a_label(blank_field):
    payload = {"field_id": "f", "label": "L", "type": "text", blank_field: ""}
    with pytest.raises(ValidationError):
        RegistrationField(**payload)


# ---------------------------------------------------------------------------
# TeamRule
# ---------------------------------------------------------------------------

def test_team_rule_defaults_describe_a_solo_event():
    rule = TeamRule()
    assert (rule.min, rule.max) == (1, 1)
    assert rule.house_vs_house_event is False
    assert rule.allow_single_registration is True


def test_min_may_not_exceed_max():
    with pytest.raises(ValidationError) as excinfo:
        TeamRule(min=4, max=2)
    assert "team.min must not be greater than team.max" in str(excinfo.value)


def test_min_equal_to_max_is_a_fixed_size_team():
    assert TeamRule(min=3, max=3).min == 3


@pytest.mark.parametrize("bound", [{"min": 0}, {"max": 0}, {"min": -1}])
def test_team_bounds_must_be_at_least_one(bound):
    with pytest.raises(ValidationError):
        TeamRule(**bound)


# ---------------------------------------------------------------------------
# RegistrationWindow
# ---------------------------------------------------------------------------

def test_a_registration_window_is_open_by_default():
    window = RegistrationWindow(start_time="2026-06-01T10:00:00Z", end_time="2026-06-10T10:00:00Z")
    assert window.allowed is True


def test_both_bounds_are_mandatory():
    """An event with no window has no reliable answer to "is registration
    open" — the ambiguity a bare `open: bool` used to paper over."""
    with pytest.raises(ValidationError):
        RegistrationWindow(start_time="2026-06-01T10:00:00Z")
    with pytest.raises(ValidationError):
        RegistrationWindow(end_time="2026-06-01T10:00:00Z")


def test_window_end_must_follow_start():
    with pytest.raises(ValidationError):
        RegistrationWindow(start_time="2026-06-10T10:00:00Z", end_time="2026-06-01T10:00:00Z")


def test_the_update_variant_can_flip_allowed_alone():
    update = RegistrationWindowUpdate(allowed=False)
    assert update.start_time is None and update.end_time is None


def test_the_update_variant_cross_checks_only_when_both_bounds_are_present():
    assert RegistrationWindowUpdate(start_time="2026-06-01T10:00:00Z")
    with pytest.raises(ValidationError):
        RegistrationWindowUpdate(start_time="2026-06-10T10:00:00Z", end_time="2026-06-01T10:00:00Z")


# ---------------------------------------------------------------------------
# EventRegistrationInput
# ---------------------------------------------------------------------------

def test_an_empty_input_means_solo():
    request = EventRegistrationInput()
    assert request.team_name is None and request.team_id is None
    assert request.registration_data == {}


def test_a_team_name_creates_and_a_team_id_joins():
    assert EventRegistrationInput(team_name="Rockets").team_name == "Rockets"
    assert EventRegistrationInput(team_id="TMTEC111111").team_id == "TMTEC111111"


def test_a_name_and_an_id_together_are_mutually_exclusive():
    with pytest.raises(ValidationError) as excinfo:
        EventRegistrationInput(team_name="Rockets", team_id="TMTEC111111")
    assert "not both" in str(excinfo.value)


def test_registration_data_accepts_arbitrary_json_values():
    request = EventRegistrationInput(registration_data={"size": "L", "count": 2, "ok": True})
    assert request.registration_data["count"] == 2


# ---------------------------------------------------------------------------
# EventCreateRequest / EventUpdateRequest
# ---------------------------------------------------------------------------

def test_a_minimal_valid_event():
    request = EventCreateRequest(**VALID_EVENT)
    assert request.poster == ""
    assert request.prize_money == []
    assert request.schedule == []
    assert request.registration_fields == []


@pytest.mark.parametrize("event_type", sorted(EVENT_TYPES))
def test_every_event_type_is_accepted(event_type):
    assert EventCreateRequest(**{**VALID_EVENT, "event_type": event_type}).event_type == event_type


@pytest.mark.parametrize("event_type", ["Technical", "quidditch", "", "other"])
def test_an_unknown_event_type_is_rejected_which_shields_the_id_generator(event_type):
    with pytest.raises(ValidationError):
        EventCreateRequest(**{**VALID_EVENT, "event_type": event_type})


@pytest.mark.parametrize("field", ["name", "description"])
def test_name_and_description_may_not_be_blank(field):
    with pytest.raises(ValidationError):
        EventCreateRequest(**{**VALID_EVENT, field: ""})


@pytest.mark.parametrize("field", ["event_type", "name", "description", "team", "registration"])
def test_the_mandatory_event_fields(field):
    payload = dict(VALID_EVENT)
    payload.pop(field)
    with pytest.raises(ValidationError):
        EventCreateRequest(**payload)


def test_create_does_not_accept_an_event_id():
    assert "event_id" not in EventCreateRequest.model_fields


def test_a_nested_error_fails_the_whole_request():
    with pytest.raises(ValidationError):
        EventCreateRequest(**{**VALID_EVENT, "team": {"min": 5, "max": 2}})
    with pytest.raises(ValidationError):
        EventCreateRequest(**{
            **VALID_EVENT,
            "schedule": [{"name": "R", "start_time": "2026-06-13T12:00:00Z",
                          "end_time": "2026-06-13T10:00:00Z"}],
        })


def test_update_is_entirely_optional():
    assert EventUpdateRequest().model_dump(exclude_unset=True) == {}


def test_update_does_not_accept_event_type_or_event_id():
    """An event's type drives its id prefix, so it is fixed at creation."""
    assert "event_type" not in EventUpdateRequest.model_fields
    assert "event_id" not in EventUpdateRequest.model_fields


def test_update_uses_the_partial_registration_variant():
    """This is what lets `PUT /events/{id}` flip `allowed` without resending the
    window; the route merges onto the stored value."""
    request = EventUpdateRequest(registration={"allowed": False})
    assert isinstance(request.registration, RegistrationWindowUpdate)
    assert request.registration.start_time is None


def test_update_distinguishes_an_empty_list_from_an_omission():
    """`prize_money: []` is not None, so the route writes it — clearing the
    prizes. Pinned because it is easy to mistake for a no-op."""
    request = EventUpdateRequest(prize_money=[])
    assert "prize_money" in request.model_dump(exclude_unset=True)
    assert request.prize_money == []


# ---------------------------------------------------------------------------
# Team assignment and announcements
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("role", sorted(EVENT_TEAM_ROLES))
def test_every_event_team_role_is_accepted(role):
    assert EventTeamAssignRequest(user_id="SAWO1111", role=role).role == role
    assert EventTeamRoleUpdateRequest(role=role).role == role


@pytest.mark.parametrize("role", ["head", "Event_Head", "", "organiser"])
def test_an_unknown_event_team_role_is_rejected(role):
    with pytest.raises(ValidationError):
        EventTeamAssignRequest(user_id="SAWO1111", role=role)


def test_team_assignment_requires_a_non_empty_user_id():
    with pytest.raises(ValidationError):
        EventTeamAssignRequest(user_id="", role="member")


def test_an_announcement_defaults_to_mid_priority():
    assert AnnouncementCreateRequest(message="Report at 9am").priority == "mid"


@pytest.mark.parametrize("priority", sorted(ANNOUNCEMENT_PRIORITIES))
def test_every_announcement_priority(priority):
    assert AnnouncementCreateRequest(message="m", priority=priority).priority == priority


@pytest.mark.parametrize("priority", ["urgent", "High", ""])
def test_an_unknown_announcement_priority_is_rejected(priority):
    with pytest.raises(ValidationError):
        AnnouncementCreateRequest(message="m", priority=priority)


def test_an_empty_announcement_message_is_rejected():
    with pytest.raises(ValidationError):
        AnnouncementCreateRequest(message="")
