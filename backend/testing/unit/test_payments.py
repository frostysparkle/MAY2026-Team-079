"""Unit tests for backend/payments.py — the mock settlement helper."""
import re
from datetime import datetime, timedelta

import pytest

import payments
from payments import simulate_payment


def test_returns_the_full_payment_record():
    record = simulate_payment("mess", 1200, "upi")
    assert set(record) == {"paid", "transaction_id", "amount", "method", "paid_at"}


def test_payment_always_succeeds_today():
    """There is no failure branch; a test that expects one would be asserting a
    feature that does not exist."""
    assert simulate_payment("hostel", 900)["paid"] is True


def test_amount_is_whatever_the_caller_passes():
    """The routes pass their own fixed fee — a client-supplied amount never
    reaches here, because `MockPaymentRequest` carries only `method`."""
    assert simulate_payment("mess", 1200)["amount"] == 1200
    assert simulate_payment("hostel", 900)["amount"] == 900


def test_transaction_id_names_the_purpose():
    assert simulate_payment("mess", 1200)["transaction_id"].startswith("PDX-MESS-")
    assert simulate_payment("hostel", 900)["transaction_id"].startswith("PDX-HOSTEL-")


def test_transaction_id_ends_in_eight_uppercase_hex_characters():
    transaction_id = simulate_payment("mess", 1200)["transaction_id"]
    assert re.fullmatch(r"PDX-MESS-[0-9A-F]{8}", transaction_id)


def test_transaction_ids_are_unique_across_calls():
    ids = {simulate_payment("mess", 1200)["transaction_id"] for _ in range(25)}
    assert len(ids) == 25


@pytest.mark.parametrize("method", ["upi", "card", "netbanking"])
def test_method_is_recorded_verbatim(method):
    assert simulate_payment("mess", 1200, method)["method"] == method


@pytest.mark.parametrize("falsy", [None, ""])
def test_a_falsy_method_falls_back_to_upi(falsy):
    assert simulate_payment("mess", 1200, falsy)["method"] == "upi"


def test_default_method_is_upi():
    assert simulate_payment("mess", 1200)["method"] == "upi"


def test_method_is_not_validated_here():
    """
    Validation lives on `MockPaymentRequest`, not in this helper — an internal
    caller could store anything. Pinned so a future move of the check is a
    deliberate decision rather than a silent one.
    """
    assert simulate_payment("mess", 1200, "cowrie-shells")["method"] == "cowrie-shells"


def test_paid_at_is_a_naive_utc_datetime_near_now():
    record = simulate_payment("mess", 1200)
    assert isinstance(record["paid_at"], datetime)
    assert record["paid_at"].tzinfo is None
    assert abs(datetime.utcnow() - record["paid_at"]) < timedelta(seconds=5)


def test_paid_at_uses_the_module_clock(monkeypatch):
    from testing.helpers import fake_datetime

    frozen = datetime(2026, 6, 13, 10, 30, 0)
    monkeypatch.setattr(payments, "datetime", fake_datetime(frozen))
    assert simulate_payment("mess", 1200)["paid_at"] == frozen


def test_purpose_is_uppercased_even_when_given_lowercase_or_mixed():
    assert simulate_payment("MeSs", 1200)["transaction_id"].startswith("PDX-MESS-")
