"""Unit tests for the pure journey resolver (Correctness Properties 1-3)."""

from app.journey.service import JourneyInputs, resolve_journey


def _inputs(**overrides):
    base = dict(
        profile_complete=False,
        accommodation_choice=None,
        mess_choice=None,
        mess_plan_id=None,
        has_allocation=False,
        hostel_paid=False,
        mess_paid=False,
        events_registered=0,
    )
    base.update(overrides)
    return JourneyInputs(**base)


def _state(journey, key):
    return next(s.state for s in journey.steps if s.key == key)


def test_new_user_goes_to_profile():
    j = resolve_journey(_inputs())
    assert j.next_step == "profile"
    assert j.complete is False
    assert _state(j, "profile") == "current"


def test_profile_done_prompts_accommodation():
    j = resolve_journey(_inputs(profile_complete=True))
    assert j.next_step == "accommodation"
    assert _state(j, "profile") == "done"


def test_decline_accommodation_prompts_mess_and_marks_skipped():
    j = resolve_journey(_inputs(profile_complete=True, accommodation_choice="no"))
    assert j.next_step == "mess"
    assert _state(j, "accommodation") == "skipped"


def test_unpaid_chosen_booking_makes_payment_due():
    j = resolve_journey(
        _inputs(profile_complete=True, accommodation_choice="yes", mess_choice="no")
    )
    assert j.payment_due is True
    assert j.next_step == "payment"


def test_paid_accommodation_advances_to_events():
    j = resolve_journey(
        _inputs(
            profile_complete=True,
            accommodation_choice="yes",
            mess_choice="no",
            hostel_paid=True,
        )
    )
    assert j.payment_due is False
    assert j.next_step == "events"
    assert j.complete is True  # events step reached → onboarding unlocked


def test_no_bookings_bypasses_payment():
    j = resolve_journey(
        _inputs(profile_complete=True, accommodation_choice="no", mess_choice="no")
    )
    assert j.payment_due is False
    assert j.next_step == "events"
    assert _state(j, "payment") == "skipped"


def test_fully_onboarded_is_done():
    j = resolve_journey(
        _inputs(
            profile_complete=True,
            accommodation_choice="no",
            mess_choice="no",
            events_registered=2,
        )
    )
    assert j.next_step == "done"
    assert j.complete is True
    assert _state(j, "events") == "done"


def test_mess_paid_not_due():
    j = resolve_journey(
        _inputs(
            profile_complete=True,
            accommodation_choice="no",
            mess_choice="yes",
            mess_plan_id="plan1",
            mess_paid=True,
        )
    )
    assert j.payment_due is False
    assert j.next_step == "events"
