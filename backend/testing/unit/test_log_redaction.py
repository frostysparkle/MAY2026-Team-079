"""
Unit tests for backend/log_redaction.py.

This module is the reason a log file cannot leak a password hash, an RSA private
key, or a QR ciphertext. Two properties matter most and are asserted directly:
every helper is total (nothing raises, whatever it is handed), and the key rules
have a definite precedence.
"""
import hashlib
from datetime import datetime

import pytest
from bson import ObjectId

from log_redaction import (
    FINGERPRINTED_KEY_PARTS,
    REDACTED,
    SENSITIVE_KEY_PARTS,
    fingerprint,
    redact,
    redact_headers,
    safe_email,
    truncate,
)


# ---------------------------------------------------------------------------
# fingerprint
# ---------------------------------------------------------------------------

def test_a_fingerprint_is_prefixed_and_length_capped():
    value = fingerprint("some-token")
    assert value.startswith("sha256:")
    assert len(value) == len("sha256:") + 12


def test_the_prefix_stops_a_label_being_mistaken_for_the_value():
    assert "some-token" not in fingerprint("some-token")


def test_fingerprints_are_deterministic_and_distinguishing():
    assert fingerprint("a") == fingerprint("a")
    assert fingerprint("a") != fingerprint("b")


def test_the_digest_matches_sha256():
    expected = "sha256:" + hashlib.sha256(b"abc").hexdigest()[:12]
    assert fingerprint("abc") == expected


def test_only_none_yields_none():
    assert fingerprint(None) is None
    for falsy in ("", 0, False, []):
        assert fingerprint(falsy) is not None, f"{falsy!r} should still be hashed"


def test_a_string_and_its_utf8_bytes_hash_identically():
    assert fingerprint("a") == fingerprint(b"a")


def test_a_custom_length_is_honoured_and_capped():
    assert len(fingerprint("x", length=4)) == len("sha256:") + 4
    assert fingerprint("x", length=0) == "sha256:"
    # A full sha256 hex digest is 64 characters; longer is silently capped.
    assert len(fingerprint("x", length=999)) == len("sha256:") + 64


def test_unencodable_surrogates_do_not_raise():
    assert fingerprint("\ud800").startswith("sha256:")


# ---------------------------------------------------------------------------
# safe_email
# ---------------------------------------------------------------------------

def test_an_address_is_reduced_to_its_local_part():
    assert safe_email("23f3001726@ds.study.iitm.ac.in") == "23f3001726"


def test_a_value_with_no_at_sign_is_kept_as_is():
    """`verify_qr` accepts either an id or an address in the same field, so a
    bare id must survive rather than being dropped."""
    assert safe_email("VLME1111") == "VLME1111"


def test_this_diverges_from_logger_email_local_part_on_purpose():
    from logger import email_local_part

    assert safe_email("VLME1111") == "VLME1111"
    assert email_local_part("VLME1111") is None


@pytest.mark.parametrize("value", [None, "", "   ", "@example.com", "  @x.com"])
def test_unusable_values_yield_none(value):
    assert safe_email(value) is None


@pytest.mark.parametrize("value", [123, b"a@b.com", {"email": "a@b.com"}, ["a@b.com"]])
def test_non_strings_yield_none(value):
    assert safe_email(value) is None


def test_only_the_first_at_sign_splits_and_whitespace_is_trimmed():
    assert safe_email("a@b@c.com") == "a"
    assert safe_email("  asha@x.com  ") == "asha"


def test_case_is_preserved():
    """Unlike the registration domain check, nothing here lowercases."""
    assert safe_email("Asha.N@x.com") == "Asha.N"


def test_a_unicode_local_part_survives():
    assert safe_email("üser@x.com") == "üser"


# ---------------------------------------------------------------------------
# truncate
# ---------------------------------------------------------------------------

def test_a_short_string_is_returned_unchanged():
    assert truncate("short") == "short"


def test_a_string_exactly_at_the_limit_is_unchanged():
    value = "x" * 300
    assert truncate(value) == value


def test_a_long_string_reports_how_much_was_dropped():
    result = truncate("x" * 350)
    assert result.startswith("x" * 300)
    assert result.endswith("…(+50 chars)")


def test_a_truncated_value_is_never_mistaken_for_a_short_one():
    assert "…(+" in truncate("y" * 400)


def test_a_custom_limit():
    assert truncate("abcdef", limit=3) == "abc…(+3 chars)"


@pytest.mark.parametrize("value", [None, 42, 3.5, True, [1, 2], {"a": 1}, b"x" * 500])
def test_non_strings_pass_through_untouched(value):
    assert truncate(value) is value


# ---------------------------------------------------------------------------
# redact — key rules
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("key", list(SENSITIVE_KEY_PARTS))
def test_every_sensitive_key_part_is_redacted(key):
    assert redact({key: "value"}) == {key: REDACTED}


@pytest.mark.parametrize(
    "key",
    ["password", "Password", "password_hash", "new_password", "current_password",
     "X-Authorization", "qr_secrets", "private_key", "public_key", "api_key",
     "apikey", "embedding", "workshop_embedding", "access_token", "secret_key",
     "credentials"],
)
def test_the_sensitive_match_is_a_case_insensitive_substring(key):
    assert redact({key: "value"})[key] == REDACTED


def test_the_actual_credential_fields_this_codebase_stores_are_covered():
    document = {
        "password_hash": "$2b$12$abc",
        "qr_secrets": {"private_key": "-----BEGIN", "public_key": "-----BEGIN"},
        "embedding": [0.0] * 768,
        "participant_id": "DS23F000001",
    }
    cleaned = redact(document)
    assert cleaned["password_hash"] == REDACTED
    assert cleaned["qr_secrets"] == REDACTED
    assert cleaned["embedding"] == REDACTED
    assert cleaned["participant_id"] == "DS23F000001", "harmless fields survive"


@pytest.mark.parametrize("key", list(FINGERPRINTED_KEY_PARTS))
def test_fingerprinted_keys_keep_a_correlatable_label(key):
    cleaned = redact({key: "ciphertext-bytes"})
    assert cleaned[key].startswith("sha256:")


def test_the_fingerprint_match_is_exact_or_underscore_suffixed():
    assert redact({"qr_data": "x"})["qr_data"].startswith("sha256:")
    # Not a fingerprint key: these merely *contain* "data".
    for benign in ("database", "metadata", "dataset"):
        assert redact({benign: "x"})[benign] == "x"


def test_sensitive_wins_over_fingerprinted():
    """`token_data` contains "token", so it is dropped rather than labelled."""
    assert redact({"token_data": "x"})["token_data"] == REDACTED


def test_a_none_valued_fingerprint_key_stays_none():
    assert redact({"data": None})["data"] is None


def test_an_already_fingerprinted_value_is_not_double_redacted():
    """A call site that fingerprinted deliberately must not have its label
    replaced by `[redacted]` — the label is the whole point."""
    label = fingerprint("token")
    assert redact({"token_fp": label})["token_fp"] == label
    assert redact(label) == label


# ---------------------------------------------------------------------------
# redact — structure
# ---------------------------------------------------------------------------

def test_nested_mappings_are_walked():
    cleaned = redact({"outer": {"inner": {"password": "p", "ok": "v"}}})
    assert cleaned["outer"]["inner"] == {"password": REDACTED, "ok": "v"}


def test_sequences_are_walked_and_normalised_to_lists():
    assert redact(("a", "b")) == ["a", "b"]
    assert redact({"rows": [{"password": "p"}]}) == {"rows": [{"password": REDACTED}]}
    assert isinstance(redact({"x"}), list)


def test_non_string_keys_are_stringified():
    assert redact({1: "a"}) == {"1": "a"}


def test_the_depth_cap_stops_a_pathological_structure():
    deep = current = {}
    for _ in range(12):
        current["next"] = {}
        current = current["next"]
    assert "[truncated: too deep]" in str(redact(deep))


def test_a_self_referential_structure_does_not_hang():
    cyclic = {}
    cyclic["self"] = cyclic
    assert "[truncated: too deep]" in str(redact(cyclic))


def test_mongo_types_are_left_for_the_formatter():
    oid, moment = ObjectId(), datetime(2026, 6, 13)
    cleaned = redact({"_id": oid, "at": moment})
    assert cleaned["_id"] is oid
    assert cleaned["at"] is moment


def test_the_input_is_not_mutated():
    original = {"password": "p", "nested": {"ok": 1}}
    redact(original)
    assert original == {"password": "p", "nested": {"ok": 1}}


def test_long_strings_inside_a_mapping_are_truncated():
    assert "…(+" in redact({"body": "x" * 400})["body"]


def test_redact_never_raises():
    class Hostile:
        def __repr__(self):
            raise RuntimeError("boom")

    # A leaf whose repr explodes is only stringified by the formatter, not here,
    # so this passes through; the contract is simply that nothing propagates.
    assert redact({"x": Hostile()}) is not None


# ---------------------------------------------------------------------------
# redact_headers
# ---------------------------------------------------------------------------

def test_credential_headers_become_fingerprints_not_holes():
    cleaned = redact_headers({"Authorization": "Bearer abc", "Cookie": "s=1"})
    assert cleaned["authorization"].startswith("sha256:")
    assert cleaned["cookie"].startswith("sha256:")
    assert "abc" not in str(cleaned)


def test_the_same_token_from_two_requests_yields_the_same_label():
    first = redact_headers({"Authorization": "Bearer abc"})["authorization"]
    second = redact_headers([("authorization", "Bearer abc")])["authorization"]
    assert first == second


def test_header_names_are_lowercased_and_other_values_kept():
    cleaned = redact_headers({"User-Agent": "pytest", "X-Request-ID": "abc"})
    assert cleaned == {"user-agent": "pytest", "x-request-id": "abc"}


def test_all_four_credential_header_names_are_covered():
    for name in ("authorization", "cookie", "set-cookie", "x-api-key"):
        assert redact_headers({name: "v"})[name].startswith("sha256:")


def test_a_long_header_value_is_truncated_harder_than_a_body_field():
    assert "…(+" in redact_headers({"x-long": "y" * 250})["x-long"]


def test_starlette_headers_are_accepted():
    from starlette.datastructures import Headers

    cleaned = redact_headers(Headers({"authorization": "Bearer abc", "accept": "*/*"}))
    assert cleaned["authorization"].startswith("sha256:")
    assert cleaned["accept"] == "*/*"


def test_an_unusable_input_is_described_rather_than_raised():
    assert redact_headers(object()) == {"[unredactable]": "TypeError"}
