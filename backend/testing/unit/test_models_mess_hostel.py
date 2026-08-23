"""
Unit tests for the mess and hostel request models.

Both sets are declared inside their routers rather than in models.py, so they are
imported from there. The mess menu model is the most structural of the two: its
keys are exactly how the menu is stored (`day_1` -> `breakfast` -> sitting), and a
PUT replaces the map wholesale.
"""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from routers.hostels import GENDERS as HOSTEL_GENDERS
from routers.hostels import HOSTEL_ROLES, HostelAssignTeamRequest, HostelCreateRequest
from routers.mess import (
    MEAL_SLOTS,
    MessAssignTeamRequest,
    MessCreateRequest,
    MessMealSlot,
    MessMenuRequest,
    MessUpdateRequest,
)

BREAKFAST = {
    "start_time": "2026-06-13T07:00:00",
    "end_time": "2026-06-13T09:00:00",
    "menu": "Idli, sambar",
}


# ---------------------------------------------------------------------------
# Mess create / update
# ---------------------------------------------------------------------------

def test_a_valid_mess_create_request():
    request = MessCreateRequest(mess_id="MESS1", name="North Hall", capacity=50,
                               type="north_indian__veg")
    assert request.capacity == 50


@pytest.mark.parametrize("mess_type", [
    "north_indian__veg", "north_indian__non_veg",
    "south_indian__veg", "south_indian__non_veg", "jain",
])
def test_every_mess_type_in_the_shared_vocabulary(mess_type):
    assert MessCreateRequest(mess_id="M", name="N", capacity=1, type=mess_type).type == mess_type


def test_the_hall_type_set_is_the_same_set_participants_choose_from():
    """`profile.mess_preference` and a hall's `type` are provably one set, which
    is what makes diet matching in `allocate_messes` possible."""
    from models import MESS_PREFERENCE_TYPES
    from routers.mess import MESS_TYPES

    assert MESS_TYPES is MESS_PREFERENCE_TYPES


@pytest.mark.parametrize("mess_type", ["veg", "non_veg", "NORTH_INDIAN__VEG", "", "vegan"])
def test_an_unknown_mess_type_is_rejected(mess_type):
    with pytest.raises(ValidationError) as excinfo:
        MessCreateRequest(mess_id="M", name="N", capacity=1, type=mess_type)
    assert "type must be one of" in str(excinfo.value)


def test_mess_type_is_case_sensitive_unlike_hostel_gender():
    """Pinned asymmetry: `HostelCreateRequest` lowercases its gender, this does
    not normalise at all."""
    with pytest.raises(ValidationError):
        MessCreateRequest(mess_id="M", name="N", capacity=1, type="Jain")


@pytest.mark.parametrize("capacity", [0, -1])
def test_mess_capacity_must_be_positive(capacity):
    with pytest.raises(ValidationError):
        MessCreateRequest(mess_id="M", name="N", capacity=capacity, type="jain")


@pytest.mark.parametrize("field", ["mess_id", "name", "capacity", "type"])
def test_every_mess_create_field_is_required(field):
    payload = {"mess_id": "M", "name": "N", "capacity": 1, "type": "jain"}
    payload.pop(field)
    with pytest.raises(ValidationError):
        MessCreateRequest(**payload)


def test_mess_update_is_entirely_optional():
    assert MessUpdateRequest().model_dump(exclude_unset=True) == {}


def test_mess_update_still_validates_a_supplied_type():
    assert MessUpdateRequest(type="jain").type == "jain"
    with pytest.raises(ValidationError):
        MessUpdateRequest(type="vegan")


def test_mess_update_capacity_must_be_positive_when_supplied():
    with pytest.raises(ValidationError):
        MessUpdateRequest(capacity=0)


def test_mess_id_is_not_updatable():
    assert "mess_id" not in MessUpdateRequest.model_fields


# ---------------------------------------------------------------------------
# Mess team assignment
# ---------------------------------------------------------------------------

def test_mess_team_role_is_required_but_user_id_is_not():
    """A hall may list desk staff who have no `paradox_id` at all, recorded by
    name and phone only."""
    request = MessAssignTeamRequest(role="other", name="Desk Staff", phone="9000000000")
    assert request.user_id is None


def test_mess_team_role_is_a_free_string_at_the_schema_layer():
    """The route derives `logging` from a whitelist of ("volunteer", "other"), so
    an unrecognised role lands with scanning off rather than being rejected."""
    assert MessAssignTeamRequest(role="wizard").role == "wizard"


def test_mess_team_assignment_requires_a_role():
    with pytest.raises(ValidationError):
        MessAssignTeamRequest(user_id="VLME1111")


# ---------------------------------------------------------------------------
# MessMealSlot
# ---------------------------------------------------------------------------

def test_a_meal_slot_parses_iso_strings_into_datetimes():
    slot = MessMealSlot(**BREAKFAST)
    assert isinstance(slot.start_time, datetime)
    assert slot.menu == "Idli, sambar"


def test_a_slot_whose_end_precedes_its_start_is_rejected():
    with pytest.raises(ValidationError) as excinfo:
        MessMealSlot(start_time="2026-06-13T09:00:00", end_time="2026-06-13T07:00:00", menu="x")
    assert "end_time must be after start_time" in str(excinfo.value)


def test_a_zero_length_slot_is_rejected():
    with pytest.raises(ValidationError):
        MessMealSlot(start_time="2026-06-13T07:00:00", end_time="2026-06-13T07:00:00", menu="x")


def test_slot_bounds_are_compared_after_utc_normalisation():
    """`_naive_utc` is applied to both sides, so a tz-aware pair is compared on
    the same axis as a naive one."""
    slot = MessMealSlot(
        start_time=datetime(2026, 6, 13, 7, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 6, 13, 14, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
    # 14:00+05:30 is 08:30Z, which is after 07:00Z.
        menu="x",
    )
    assert slot.menu == "x"


def test_a_mixed_naive_and_aware_pair_is_still_compared_correctly():
    with pytest.raises(ValidationError):
        MessMealSlot(
            start_time=datetime(2026, 6, 13, 12, 0, tzinfo=timezone.utc),
            end_time=datetime(2026, 6, 13, 10, 0),
            menu="x",
        )


@pytest.mark.parametrize("menu", ["", "   ", "\t\n"])
def test_a_blank_menu_is_rejected(menu):
    with pytest.raises(ValidationError):
        MessMealSlot(**{**BREAKFAST, "menu": menu})


def test_a_padded_menu_is_accepted_and_stored_unstripped():
    """The validator tests `.strip()` but returns the original, so the padding
    persists. Pinned as current behaviour."""
    assert MessMealSlot(**{**BREAKFAST, "menu": "  Idli  "}).menu == "  Idli  "


# ---------------------------------------------------------------------------
# MessMenuRequest
# ---------------------------------------------------------------------------

def test_meal_slot_vocabulary():
    assert MEAL_SLOTS == ("breakfast", "lunch", "dinner")


def test_an_empty_menu_is_valid_and_clears_the_hall():
    assert MessMenuRequest().menu == {}


def test_a_day_need_not_serve_all_three_meals():
    """What lets a travel day carry breakfast only."""
    request = MessMenuRequest(menu={"day_1": {"breakfast": BREAKFAST}})
    assert set(request.menu["day_1"]) == {"breakfast"}


def test_days_need_not_be_contiguous():
    request = MessMenuRequest(menu={
        "day_1": {"breakfast": BREAKFAST},
        "day_5": {"dinner": BREAKFAST},
    })
    assert set(request.menu) == {"day_1", "day_5"}


@pytest.mark.parametrize("day_key", ["day_1", "day_9", "day_10", "day_100"])
def test_well_formed_day_keys(day_key):
    assert MessMenuRequest(menu={day_key: {"lunch": BREAKFAST}}).menu[day_key]


@pytest.mark.parametrize("day_key", ["day_0", "day_01", "day1", "Day_1", "day_", "day_-1", "1", ""])
def test_malformed_day_keys_are_rejected(day_key):
    with pytest.raises(ValidationError) as excinfo:
        MessMenuRequest(menu={day_key: {"lunch": BREAKFAST}})
    assert "expected 'day_<n>'" in str(excinfo.value)


@pytest.mark.parametrize("slot", ["brunch", "Breakfast", "supper", ""])
def test_an_unknown_meal_slot_is_rejected(slot):
    with pytest.raises(ValidationError) as excinfo:
        MessMenuRequest(menu={"day_1": {slot: BREAKFAST}})
    assert "invalid slot" in str(excinfo.value)


def test_the_error_names_the_offending_day_and_slot():
    with pytest.raises(ValidationError) as excinfo:
        MessMenuRequest(menu={"day_2": {"brunch": BREAKFAST}})
    message = str(excinfo.value)
    assert "'brunch'" in message and "'day_2'" in message


def test_a_nested_slot_error_fails_the_whole_menu():
    with pytest.raises(ValidationError):
        MessMenuRequest(menu={"day_1": {"breakfast": {**BREAKFAST, "menu": ""}}})


# ---------------------------------------------------------------------------
# HostelCreateRequest
# ---------------------------------------------------------------------------

VALID_HOSTEL = {"name": "Ganga", "capacity": 4, "gender": "male", "sharing": 2, "num_rooms": 2}


def test_a_valid_hostel_create_request():
    assert HostelCreateRequest(**VALID_HOSTEL).gender == "male"


def test_the_gender_axis_is_the_pair_allocation_groups_by():
    assert HOSTEL_GENDERS == {"male", "female"}


@pytest.mark.parametrize("gender", ["MALE", " Female ", "male"])
def test_gender_is_stripped_and_lowercased(gender):
    assert HostelCreateRequest(**{**VALID_HOSTEL, "gender": gender}).gender == gender.strip().lower()


@pytest.mark.parametrize("gender", ["other", "unisex", ""])
def test_an_unknown_gender_is_rejected(gender):
    with pytest.raises(ValidationError) as excinfo:
        HostelCreateRequest(**{**VALID_HOSTEL, "gender": gender})
    assert "gender must be one of" in str(excinfo.value)


@pytest.mark.parametrize("field", ["capacity", "sharing", "num_rooms"])
def test_hostel_integers_must_be_positive(field):
    with pytest.raises(ValidationError):
        HostelCreateRequest(**{**VALID_HOSTEL, field: 0})


def test_rooms_must_be_able_to_hold_the_stated_capacity():
    with pytest.raises(ValidationError) as excinfo:
        HostelCreateRequest(**{**VALID_HOSTEL, "capacity": 10, "sharing": 2, "num_rooms": 2})
    assert "must be >= capacity" in str(excinfo.value)


def test_rooms_may_exceed_capacity():
    """Only the shortfall is an error. The excess is what makes
    `current_occupancy` able to overshoot `capacity` during allocation — see the
    xfail in test_hostels_allocation.py."""
    assert HostelCreateRequest(**{**VALID_HOSTEL, "capacity": 2, "sharing": 2, "num_rooms": 3})


def test_rooms_exactly_covering_capacity_is_allowed():
    assert HostelCreateRequest(**{**VALID_HOSTEL, "capacity": 4, "sharing": 2, "num_rooms": 2})


def test_hostel_id_is_never_accepted_from_a_client():
    assert "hostel_id" not in HostelCreateRequest.model_fields


# ---------------------------------------------------------------------------
# HostelAssignTeamRequest
# ---------------------------------------------------------------------------

def test_the_two_hostel_team_roles():
    assert HOSTEL_ROLES == {"hostel_volunteer", "guard"}


@pytest.mark.parametrize("role", ["hostel_volunteer", "guard", "GUARD", " Guard "])
def test_hostel_role_is_stripped_lowercased_and_closed(role):
    assert HostelAssignTeamRequest(user_id="OTHO1111", role=role).role == role.strip().lower()


@pytest.mark.parametrize("role", ["volunteer", "warden", ""])
def test_an_unknown_hostel_role_is_rejected(role):
    with pytest.raises(ValidationError) as excinfo:
        HostelAssignTeamRequest(user_id="OTHO1111", role=role)
    assert "role must be one of" in str(excinfo.value)


def test_a_hostel_team_member_may_scan_by_default():
    assert HostelAssignTeamRequest(user_id="OTHO1111", role="guard").attendance is True


def test_a_hostel_team_member_requires_a_user_id_unlike_a_mess_one():
    with pytest.raises(ValidationError):
        HostelAssignTeamRequest(role="guard")
