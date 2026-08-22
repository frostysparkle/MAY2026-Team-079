"""
Model-level validation for the restructured events schema (Task 1).

These instantiate the Pydantic models directly — no app, no database — so the
schema layer is verified in isolation before any route is wired against it.
"""
import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from models import (
    AnnouncementCreateRequest,
    EventCreateRequest,
    EventTeamAssignRequest,
    EventTeamRoleUpdateRequest,
    PrizeMoney,
    RegistrationField,
    RegistrationWindow,
    RegistrationWindowUpdate,
    ScheduleRound,
    TeamRule,
)


def _valid_event_payload(**overrides):
    payload = dict(
        event_type="technical",
        name="Robo Wars",
        description="Combat robotics competition.",
        poster="https://example.com/poster.jpg",
        team=TeamRule(min=1, max=4),
        prize_money=[PrizeMoney(position="1st", amount=10000)],
        registration=RegistrationWindow(
            start_time="2026-05-01T00:00:00Z", end_time="2026-05-30T00:00:00Z"
        ),
        schedule=[
            ScheduleRound(
                name="Qualifiers",
                start_time="2026-06-13T10:00:00Z",
                end_time="2026-06-13T12:00:00Z",
                venue="Main Arena",
            )
        ],
        registration_fields=[RegistrationField(field_id="team_name", label="Team name", type="text")],
    )
    payload.update(overrides)
    return payload


# ── TeamRule ─────────────────────────────────────────────────────────────────

def test_team_rule_accepts_a_valid_range():
    rule = TeamRule(min=1, max=4, house_vs_house_event=False, allow_single_registration=True)
    assert rule.max == 4


def test_team_rule_rejects_min_greater_than_max():
    with pytest.raises(ValidationError, match="min must not be greater than"):
        TeamRule(min=5, max=4)


def test_team_rule_rejects_non_positive_bounds():
    with pytest.raises(ValidationError):
        TeamRule(min=0, max=4)


# ── RegistrationWindow ───────────────────────────────────────────────────────

def test_registration_window_rejects_end_before_start():
    with pytest.raises(ValidationError, match="end_time must be after start_time"):
        RegistrationWindow(start_time="2026-05-30T00:00:00Z", end_time="2026-05-01T00:00:00Z")


def test_registration_window_accepts_a_valid_range_and_defaults_allowed_true():
    window = RegistrationWindow(start_time="2026-05-01T00:00:00Z", end_time="2026-05-30T00:00:00Z")
    assert window.allowed is True


def test_registration_window_update_allows_flipping_allowed_alone():
    update = RegistrationWindowUpdate(allowed=False)
    assert update.allowed is False
    assert update.start_time is None


def test_registration_window_update_still_checks_order_when_both_given():
    with pytest.raises(ValidationError, match="end_time must be after start_time"):
        RegistrationWindowUpdate(start_time="2026-05-30T00:00:00Z", end_time="2026-05-01T00:00:00Z")


# ── ScheduleRound ────────────────────────────────────────────────────────────

def test_schedule_round_rejects_end_before_start():
    with pytest.raises(ValidationError, match="end_time must be after start_time"):
        ScheduleRound(name="Final", start_time="2026-06-13T12:00:00Z", end_time="2026-06-13T10:00:00Z")


# ── RegistrationField ────────────────────────────────────────────────────────

def test_registration_field_rejects_unknown_type():
    with pytest.raises(ValidationError, match="type must be one of"):
        RegistrationField(field_id="f1", label="F1", type="essay")


# ── EventCreateRequest ───────────────────────────────────────────────────────

def test_event_create_request_accepts_a_full_valid_payload():
    request = EventCreateRequest(**_valid_event_payload())
    assert request.event_type == "technical"
    assert request.team.max == 4


def test_event_create_request_rejects_unknown_event_type():
    with pytest.raises(ValidationError):
        EventCreateRequest(**_valid_event_payload(event_type="esports"))


def test_event_create_request_rejects_blank_name():
    with pytest.raises(ValidationError):
        EventCreateRequest(**_valid_event_payload(name=""))


def test_event_create_request_does_not_accept_a_client_supplied_event_id():
    """`event_id` is backend-generated; a client field of that name is ignored,
    not validated, since the model has no such field at all."""
    request = EventCreateRequest(**_valid_event_payload(), )
    assert not hasattr(request, "event_id")


# ── EventTeamAssignRequest / role literal ───────────────────────────────────

def test_event_team_assign_accepts_the_three_valid_roles():
    for role in ("event_head", "member", "volunteer"):
        assert EventTeamAssignRequest(user_id="BT1", role=role).role == role


def test_event_team_assign_rejects_a_role_outside_the_three():
    with pytest.raises(ValidationError):
        EventTeamAssignRequest(user_id="BT1", role="event_member")


def test_event_team_role_update_rejects_unknown_role():
    with pytest.raises(ValidationError):
        EventTeamRoleUpdateRequest(role="lead")


# ── AnnouncementCreateRequest ────────────────────────────────────────────────

def test_announcement_accepts_the_three_priorities():
    for priority in ("low", "mid", "high"):
        assert AnnouncementCreateRequest(message="Venue changed", priority=priority).priority == priority


def test_announcement_rejects_unknown_priority():
    with pytest.raises(ValidationError):
        AnnouncementCreateRequest(message="Venue changed", priority="urgent")


def test_announcement_rejects_blank_message():
    with pytest.raises(ValidationError):
        AnnouncementCreateRequest(message="")
