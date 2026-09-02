"""Country-coded phone parsing and the per-country digit cap."""
import pytest

from phone import (
    DEFAULT_ISO,
    country_by_iso,
    format_phone,
    parse_phone,
    phone_error,
    validate_phone,
)


def test_india_is_the_default_country():
    assert DEFAULT_ISO == "IN"
    india = country_by_iso("IN")
    assert india is not None
    assert india.calling_code == "91"
    assert india.nsn_min == india.nsn_max == 10


def test_a_bare_indian_mobile_is_accepted_as_plus_91():
    assert validate_phone("9876543210") == "+91 9876543210"
    assert validate_phone("9000000001") == "+91 9000000001"


def test_an_explicit_india_number_canonicalises():
    assert validate_phone("+91 9876543210") == "+91 9876543210"
    assert validate_phone("+919876543210") == "+91 9876543210"
    assert validate_phone("0091 9876543210") == "+91 9876543210"


def test_a_leading_trunk_zero_is_dropped_when_that_fits_the_limit():
    assert validate_phone("+91 09876543210") == "+91 9876543210"


def test_india_rejects_more_than_ten_national_digits():
    with pytest.raises(ValueError, match="cannot exceed 10 digits"):
        validate_phone("+91 98765432101")


def test_india_rejects_fewer_than_ten_national_digits():
    with pytest.raises(ValueError, match="10 digits"):
        validate_phone("+91 987654321")


def test_a_us_number_is_ten_digits_after_plus_1():
    assert validate_phone("+1 4155550100") == "+1 4155550100"


def test_uae_follows_its_own_limit_not_indias():
    assert validate_phone("+971 501234567") == "+971 501234567"
    with pytest.raises(ValueError, match="cannot exceed"):
        validate_phone("+971 50123456789")


def test_singapore_is_eight_national_digits():
    assert validate_phone("+65 81234567") == "+65 81234567"
    with pytest.raises(ValueError, match="cannot exceed 8 digits"):
        validate_phone("+65 812345678")


def test_an_unknown_country_code_is_rejected():
    assert phone_error("+999 12345678") is not None
    with pytest.raises(ValueError, match="country code"):
        validate_phone("+999 12345678")


def test_letters_are_rejected():
    with pytest.raises(ValueError):
        validate_phone("abc")


def test_empty_is_rejected():
    with pytest.raises(ValueError, match="Enter a phone number"):
        validate_phone("   ")


def test_parse_does_not_enforce_length():
    """Length is validate_phone's job so the error can name the country's cap."""
    parsed = parse_phone("+91 123")
    assert parsed is not None
    assert parsed.country.iso == "IN"
    assert parsed.national == "123"


def test_format_is_plus_code_space_national():
    india = country_by_iso("IN")
    assert india is not None
    assert format_phone(india, "9876543210") == "+91 9876543210"
