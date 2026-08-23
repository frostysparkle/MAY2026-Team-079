"""
Unit tests for the auth / profile / payment / scan request models in
backend/models.py.

These pin every 422 an endpoint can emit from schema validation, without an HTTP
round trip. The closed vocabularies matter beyond validation: `mess_preference`
and a mess hall's `type` are validated against the *same* set, which is what lets
`allocate_messes` match a participant to a hall at all.
"""
import pytest
from pydantic import ValidationError

from models import (
    COURSE_STAGES,
    GENDERS,
    HOUSES,
    MESS_PREFERENCE_TYPES,
    PAYMENT_METHODS,
    PROGRAMS,
    ChangePasswordRequest,
    EmergencyContact,
    ForgotPasswordRequest,
    LoginRequest,
    MockPaymentRequest,
    ProfileCompleteRequest,
    RegisterRequest,
    ResetPasswordRequest,
    ScanQRRequest,
)

VALID_PROFILE = {
    "full_name": "Asha Nair",
    "dob": "2004-05-01",
    "house": "Bandipur",
    "gender": "female",
    "phone": "9000000001",
    "country": "India",
    "state": "TN",
    "city": "Chennai",
    "address": "1 Test Street",
    "program": "DS",
    "course_stage": "diploma",
}


# ---------------------------------------------------------------------------
# Vocabularies
# ---------------------------------------------------------------------------

def test_the_twelve_iitm_houses_are_stored_bare():
    assert len(HOUSES) == 12
    assert "Bandipur" in HOUSES
    assert not any(house.endswith("House") for house in HOUSES)


def test_gender_is_a_strict_binary():
    assert set(GENDERS) == {"male", "female"}


def test_programs_and_course_stages():
    assert set(PROGRAMS) == {"DS", "MS", "AE", "ES"}
    assert set(COURSE_STAGES) == {"foundational", "diploma", "degree"}


def test_mess_preference_set_is_the_cuisine_diet_cross_product_plus_jain():
    assert MESS_PREFERENCE_TYPES == {
        "north_indian__veg", "north_indian__non_veg",
        "south_indian__veg", "south_indian__non_veg",
        "jain",
    }


def test_payment_methods():
    assert set(PAYMENT_METHODS) == {"upi", "card", "netbanking"}


# ---------------------------------------------------------------------------
# Auth models
# ---------------------------------------------------------------------------

def test_register_accepts_a_valid_pair():
    request = RegisterRequest(email="23f000001@ds.study.iitm.ac.in", password="longenough")
    assert request.email == "23f000001@ds.study.iitm.ac.in"


@pytest.mark.parametrize("password", ["", "short", "1234567"])
def test_register_rejects_passwords_under_eight_characters(password):
    with pytest.raises(ValidationError):
        RegisterRequest(email="a@ds.study.iitm.ac.in", password=password)


def test_register_accepts_exactly_eight_characters():
    assert RegisterRequest(email="a@ds.study.iitm.ac.in", password="12345678").password


@pytest.mark.parametrize("email", ["not-an-email", "", "a@", "@b.com", "a b@c.com"])
def test_register_rejects_malformed_emails(email):
    with pytest.raises(ValidationError):
        RegisterRequest(email=email, password="longenough")


def test_register_does_not_itself_enforce_the_iitm_domain():
    """The domain rule lives in the route (`POST /auth/register` -> 400), not in
    the model, which is why a gmail address is a 400 rather than a 422."""
    assert RegisterRequest(email="someone@gmail.com", password="longenough")


def test_login_password_has_no_minimum():
    """Deliberate: an existing account may predate the minimum, and a login must
    still be able to fail on credentials rather than on schema."""
    assert LoginRequest(email="a@ds.study.iitm.ac.in", password="x").password == "x"


def test_forgot_password_needs_a_valid_email():
    assert ForgotPasswordRequest(email="a@ds.study.iitm.ac.in")
    with pytest.raises(ValidationError):
        ForgotPasswordRequest(email="nope")


def test_reset_password_enforces_the_new_password_minimum():
    assert ResetPasswordRequest(token="t", new_password="longenough")
    with pytest.raises(ValidationError):
        ResetPasswordRequest(token="t", new_password="short")


def test_change_password_enforces_only_the_new_password_minimum():
    assert ChangePasswordRequest(current_password="x", new_password="longenough")
    with pytest.raises(ValidationError):
        ChangePasswordRequest(current_password="x", new_password="short")


# ---------------------------------------------------------------------------
# EmergencyContact
# ---------------------------------------------------------------------------

def test_emergency_contact_requires_all_three_fields():
    assert EmergencyContact(name="Ravi", relation="father", phone="9000000000")
    for missing in ("name", "relation", "phone"):
        payload = {"name": "Ravi", "relation": "father", "phone": "9000000000"}
        payload.pop(missing)
        with pytest.raises(ValidationError):
            EmergencyContact(**payload)


def test_emergency_contact_relation_is_not_a_closed_set():
    """Documented as a comment in models.py but never validated; pinned so a
    later tightening is a deliberate change."""
    assert EmergencyContact(name="R", relation="neighbour", phone="9").relation == "neighbour"


# ---------------------------------------------------------------------------
# ProfileCompleteRequest
# ---------------------------------------------------------------------------

def test_a_complete_profile_validates():
    request = ProfileCompleteRequest(**VALID_PROFILE)
    assert request.mess_preference is None
    assert request.emergency_contact is None
    assert request.photo is None


@pytest.mark.parametrize("field", list(VALID_PROFILE))
def test_every_core_profile_field_is_required(field):
    payload = dict(VALID_PROFILE)
    payload.pop(field)
    with pytest.raises(ValidationError):
        ProfileCompleteRequest(**payload)


@pytest.mark.parametrize("house", ["Hogwarts", "bandipur", "Bandipur House", ""])
def test_house_must_come_from_the_closed_set(house):
    with pytest.raises(ValidationError) as excinfo:
        ProfileCompleteRequest(**{**VALID_PROFILE, "house": house})
    assert "house must be one of" in str(excinfo.value)


@pytest.mark.parametrize("gender", ["Male", "other", "unspecified", ""])
def test_gender_must_come_from_the_closed_set(gender):
    with pytest.raises(ValidationError) as excinfo:
        ProfileCompleteRequest(**{**VALID_PROFILE, "gender": gender})
    assert "gender must be one of" in str(excinfo.value)


@pytest.mark.parametrize("program", ["ds", "BS", "", "DSX"])
def test_program_must_come_from_the_closed_set(program):
    with pytest.raises(ValidationError) as excinfo:
        ProfileCompleteRequest(**{**VALID_PROFILE, "program": program})
    assert "program must be one of" in str(excinfo.value)


@pytest.mark.parametrize("stage", ["Diploma", "masters", ""])
def test_course_stage_must_come_from_the_closed_set(stage):
    with pytest.raises(ValidationError) as excinfo:
        ProfileCompleteRequest(**{**VALID_PROFILE, "course_stage": stage})
    assert "course_stage must be one of" in str(excinfo.value)


@pytest.mark.parametrize("preference", sorted(MESS_PREFERENCE_TYPES))
def test_every_mess_preference_in_the_set_is_accepted(preference):
    assert ProfileCompleteRequest(
        **{**VALID_PROFILE, "mess_preference": preference}
    ).mess_preference == preference


def test_mess_preference_may_be_omitted_meaning_not_yet_chosen():
    assert ProfileCompleteRequest(**VALID_PROFILE).mess_preference is None


def test_mess_preference_may_be_explicitly_null():
    assert ProfileCompleteRequest(**{**VALID_PROFILE, "mess_preference": None}).mess_preference is None


@pytest.mark.parametrize("preference", ["veg", "non_veg", "north_indian", "vegan"])
def test_a_bare_diet_is_not_a_valid_preference_on_the_way_in(preference):
    """
    `allocate_messes` still *accepts* a bare diet already stored on a document
    (`_diet_of("veg") == "veg"`), but a client can no longer submit one.
    """
    with pytest.raises(ValidationError) as excinfo:
        ProfileCompleteRequest(**{**VALID_PROFILE, "mess_preference": preference})
    assert "mess_preference must be one of" in str(excinfo.value)


def test_model_fields_set_distinguishes_omitted_from_explicit_null():
    """
    This is the mechanism `PATCH /profile/complete` uses to tell "left out" from
    "sent null" for `mess_preference` and `emergency_contact`. Without it, an
    omitted emergency contact would erase a stored one.
    """
    omitted = ProfileCompleteRequest(**VALID_PROFILE)
    explicit = ProfileCompleteRequest(**{**VALID_PROFILE, "emergency_contact": None})
    assert "emergency_contact" not in omitted.model_fields_set
    assert "emergency_contact" in explicit.model_fields_set


def test_nested_emergency_contact_is_parsed_into_a_model():
    request = ProfileCompleteRequest(**{
        **VALID_PROFILE,
        "emergency_contact": {"name": "Ravi", "relation": "father", "phone": "9000000000"},
    })
    assert isinstance(request.emergency_contact, EmergencyContact)
    assert request.emergency_contact.model_dump() == {
        "name": "Ravi", "relation": "father", "phone": "9000000000",
    }


def test_an_incomplete_emergency_contact_fails_the_whole_request():
    with pytest.raises(ValidationError):
        ProfileCompleteRequest(**{**VALID_PROFILE, "emergency_contact": {"name": "Ravi"}})


def test_dob_and_phone_are_free_strings():
    """No format is enforced today; pinned so a future format rule is a decision."""
    request = ProfileCompleteRequest(**{**VALID_PROFILE, "dob": "not-a-date", "phone": "abc"})
    assert request.dob == "not-a-date"


# ---------------------------------------------------------------------------
# MockPaymentRequest
# ---------------------------------------------------------------------------

def test_payment_method_defaults_to_upi():
    assert MockPaymentRequest().method == "upi"


@pytest.mark.parametrize("method", sorted(PAYMENT_METHODS))
def test_every_allowed_payment_method(method):
    assert MockPaymentRequest(method=method).method == method


@pytest.mark.parametrize("method", ["cash", "UPI", "", "bitcoin"])
def test_an_unknown_payment_method_is_rejected(method):
    with pytest.raises(ValidationError) as excinfo:
        MockPaymentRequest(method=method)
    assert "method must be one of" in str(excinfo.value)


def test_an_explicit_null_method_is_allowed_and_coerced_downstream():
    """The model permits None; `simulate_payment` turns it into "upi"."""
    assert MockPaymentRequest(method=None).method is None


def test_payment_request_carries_no_amount():
    """The reason a participant cannot choose what to pay."""
    assert "amount" not in MockPaymentRequest.model_fields


# ---------------------------------------------------------------------------
# ScanQRRequest
# ---------------------------------------------------------------------------

def test_scan_request_requires_all_three_fields():
    assert ScanQRRequest(participant_id="DS23F000001", data="AAA", timestamp="2026-06-13T10:00:00Z")
    for missing in ("participant_id", "data", "timestamp"):
        payload = {"participant_id": "P", "data": "D", "timestamp": "T"}
        payload.pop(missing)
        with pytest.raises(ValidationError):
            ScanQRRequest(**payload)


def test_scan_request_does_not_validate_the_timestamp_format():
    """`verify_qr` parses it and maps a failure to 400 "Invalid timestamp
    format", so the model deliberately stays permissive."""
    assert ScanQRRequest(participant_id="P", data="D", timestamp="yesterday").timestamp
