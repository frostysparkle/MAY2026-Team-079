"""
Country-coded phone numbers for participant profiles.

The profile used to accept any string (and the complete-profile form only
allowed a bare 10-digit Indian mobile). International students, and anyone
who typed a country code, either failed the form or stored something the
other side could not validate. Numbers are now:

* entered with a country calling code;
* capped at that country's national-significant-number length;
* stored canonically as ``+{code} {national}``.

India is the default country and is pinned to 10 national digits (TRAI
mobile length), which is what the previous form already required. A bare
10-digit number starting 6–9 is still accepted so existing Indian records
and clients that have not grown a country picker yet keep working.

Lengths live in ``phone_countries.json`` (mirrored on the frontend). Keep
the two copies in lockstep.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple, Optional


DEFAULT_ISO = "IN"

# Indian mobiles are 10 digits starting 6–9. Bare numbers in that shape are
# treated as +91 so stored profiles from before the country picker still
# validate.
_INDIA_MOBILE_START = frozenset("6789")


class PhoneCountry(NamedTuple):
    iso: str
    name: str
    calling_code: str
    nsn_min: int
    nsn_max: int


class ParsedPhone(NamedTuple):
    country: PhoneCountry
    national: str


def _load_countries() -> tuple[PhoneCountry, ...]:
    payload = json.loads(
        Path(__file__).with_name("phone_countries.json").read_text(encoding="utf-8")
    )
    return tuple(
        PhoneCountry(
            iso=row["iso"],
            name=row["name"],
            calling_code=str(row["callingCode"]),
            nsn_min=int(row["min"]),
            nsn_max=int(row["max"]),
        )
        for row in payload
    )


@lru_cache(maxsize=1)
def phone_countries() -> tuple[PhoneCountry, ...]:
    return _load_countries()


@lru_cache(maxsize=1)
def _by_iso() -> dict[str, PhoneCountry]:
    return {country.iso: country for country in phone_countries()}


@lru_cache(maxsize=1)
def _calling_code_index() -> tuple[tuple[str, PhoneCountry], ...]:
    """Longest calling code first, first country listed for a shared code wins.

    NANP countries all share ``1``; the JSON lists the United States first for
    that code, which is the one we bind a `+1` number to when parsing.
    """
    seen: dict[str, PhoneCountry] = {}
    for country in phone_countries():
        seen.setdefault(country.calling_code, country)
    return tuple(
        sorted(seen.items(), key=lambda item: len(item[0]), reverse=True)
    )


def country_by_iso(iso: str) -> Optional[PhoneCountry]:
    return _by_iso().get(iso)


def default_country() -> PhoneCountry:
    india = country_by_iso(DEFAULT_ISO)
    if india is None:  # pragma: no cover - the table always includes India
        raise RuntimeError("phone country table is missing India")
    return india


def digits_only(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def format_phone(country: PhoneCountry, national: str) -> str:
    return f"+{country.calling_code} {national}"


def length_hint(country: PhoneCountry) -> str:
    if country.nsn_min == country.nsn_max:
        return f"{country.nsn_max} digits"
    return f"{country.nsn_min}–{country.nsn_max} digits"


def _match_calling_code(digits: str) -> Optional[tuple[PhoneCountry, str]]:
    for code, country in _calling_code_index():
        if digits.startswith(code) and len(digits) > len(code):
            return country, digits[len(code):]
        if digits == code:
            return country, ""
    return None


def parse_phone(value: str) -> Optional[ParsedPhone]:
    """Split a typed or stored number into country + national digits.

    Returns None when there is no country we can bind the digits to — an
    empty string, letters, or a national number that is not the Indian
    10-digit legacy shape. Length is *not* checked here; ``validate_phone``
    applies the country's min/max so the error can name the limit.
    """
    text = value.strip()
    if not text:
        return None
    if text.startswith("00") and not text.startswith("000"):
        text = f"+{text[2:]}"
    has_plus = text.startswith("+")
    digits = digits_only(text)
    if not digits:
        return None

    if has_plus:
        matched = _match_calling_code(digits)
        if matched is None:
            return None
        country, national = matched
    elif len(digits) == 10 and digits[0] in _INDIA_MOBILE_START:
        country = default_country()
        national = digits
    else:
        return None

    if (
        national.startswith("0")
        and country.nsn_min <= len(national) - 1 <= country.nsn_max
    ):
        national = national[1:]
    return ParsedPhone(country=country, national=national)


def phone_error(value: str) -> Optional[str]:
    """Why ``value`` is not a usable phone number, or None if it is."""
    text = value.strip()
    if not text:
        return "Enter a phone number."
    parsed = parse_phone(text)
    if parsed is None:
        return "Enter a phone number with a country code, e.g. +91 9876543210."
    country, national = parsed
    if not national:
        return f"Enter a number after +{country.calling_code}."
    if not national.isdigit():
        return "Phone number can only contain digits after the country code."
    if len(national) > country.nsn_max:
        return (
            f"Phone number cannot exceed {country.nsn_max} digits "
            f"for {country.name} (+{country.calling_code})."
        )
    if len(national) < country.nsn_min:
        return (
            f"Enter a {length_hint(country)} number for {country.name} "
            f"(+{country.calling_code})."
        )
    return None


def validate_phone(value: str) -> str:
    """Canonical ``+{code} {national}`` form, or ValueError naming the problem."""
    error = phone_error(value)
    if error:
        raise ValueError(error)
    parsed = parse_phone(value)
    assert parsed is not None  # phone_error already accepted it
    return format_phone(parsed.country, parsed.national)
