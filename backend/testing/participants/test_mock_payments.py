"""
`POST /mess/pay` and `POST /hostels/pay` — the mock payment endpoints.

Neither talks to a real gateway: `simulate_payment` (backend/payments.py)
always succeeds and each route charges its own fixed fee (`MESS_FEE`,
`HOSTEL_FEE`), never an amount the client sends. This is what stops a
participant paying an arbitrary amount, and it is the behaviour this file
pins down alongside the payment record's shape and where it is stored.
"""
import os
import random
import sys
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from database import backend_teams_collection, participants_collection
from main import app
from routers.mess import MESS_FEE
from routers.hostels import HOSTEL_FEE

client = TestClient(app)


@pytest.fixture
def participant():
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"}).json()
    return login["id"], {"Authorization": f"Bearer {login['access_token']}"}


@pytest.fixture
def staff_headers():
    rand = random.randint(100000, 999999)
    email = f"staffpay{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"BT{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "volunteer",
        "department": "mess",
        "designation": "Volunteer",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    token = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# POST /mess/pay
# ---------------------------------------------------------------------------

def test_mess_payment_succeeds_and_returns_a_receipt(participant):
    _, headers = participant
    resp = client.post("/mess/pay", json={"method": "upi"}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["paid"] is True
    assert body["amount"] == MESS_FEE
    assert body["method"] == "upi"
    assert body["transaction_id"]
    assert body["paid_at"]


def test_mess_payment_defaults_to_upi_when_method_is_omitted(participant):
    _, headers = participant
    resp = client.post("/mess/pay", json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["method"] == "upi"


@pytest.mark.parametrize("method", ["upi", "card", "netbanking"])
def test_every_supported_method_is_accepted(participant, method):
    _, headers = participant
    resp = client.post("/mess/pay", json={"method": method}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["method"] == method


def test_an_unsupported_method_is_rejected(participant):
    _, headers = participant
    resp = client.post("/mess/pay", json={"method": "cash"}, headers=headers)
    assert resp.status_code == 422


def test_a_client_supplied_amount_is_ignored_the_server_fee_always_wins(participant):
    _, headers = participant
    resp = client.post("/mess/pay", json={"method": "upi", "amount": 1}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["amount"] == MESS_FEE


def test_mess_payment_is_persisted_on_the_participant_document(participant):
    p_id, headers = participant
    resp = client.post("/mess/pay", json={"method": "card"}, headers=headers)
    txn_id = resp.json()["transaction_id"]

    stored = participants_collection.find_one({"participant_id": p_id})
    assert stored["mess"]["payment"]["transaction_id"] == txn_id
    assert stored["mess"]["payment"]["paid"] is True


def test_mess_payment_does_not_register_or_allocate_the_participant(participant):
    """Paying is independent of `mess.registered` / `mess.mess_id` — it can
    happen in any order relative to opting into allocation."""
    p_id, headers = participant
    client.post("/mess/pay", json={"method": "upi"}, headers=headers)
    stored = participants_collection.find_one({"participant_id": p_id})
    assert stored["mess"]["registered"] is False
    assert stored["mess"]["mess_id"] is None


def test_staff_cannot_pay_a_mess_fee(staff_headers):
    resp = client.post("/mess/pay", json={}, headers=staff_headers)
    assert resp.status_code == 403


def test_an_unauthenticated_request_is_rejected():
    resp = client.post("/mess/pay", json={})
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# POST /hostels/pay
# ---------------------------------------------------------------------------

def test_hostel_payment_succeeds_and_returns_a_receipt(participant):
    _, headers = participant
    resp = client.post("/hostels/pay", json={"method": "netbanking"}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["paid"] is True
    assert body["amount"] == HOSTEL_FEE
    assert body["method"] == "netbanking"
    assert body["transaction_id"]


def test_a_client_supplied_hostel_amount_is_ignored(participant):
    _, headers = participant
    resp = client.post("/hostels/pay", json={"amount": 99999}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["amount"] == HOSTEL_FEE


def test_hostel_payment_is_persisted_on_the_participant_document(participant):
    p_id, headers = participant
    resp = client.post("/hostels/pay", json={"method": "upi"}, headers=headers)
    txn_id = resp.json()["transaction_id"]

    stored = participants_collection.find_one({"participant_id": p_id})
    assert stored["accommodation"]["payment"]["transaction_id"] == txn_id


def test_hostel_payment_does_not_register_or_allocate_the_participant(participant):
    p_id, headers = participant
    client.post("/hostels/pay", json={"method": "upi"}, headers=headers)
    stored = participants_collection.find_one({"participant_id": p_id})
    assert stored["accommodation"]["registered"] is False
    assert stored["accommodation"]["hostel_id"] is None


def test_staff_cannot_pay_a_hostel_fee(staff_headers):
    resp = client.post("/hostels/pay", json={}, headers=staff_headers)
    assert resp.status_code == 403


def test_mess_and_hostel_payments_are_independent_of_each_other(participant):
    p_id, headers = participant
    client.post("/mess/pay", json={"method": "upi"}, headers=headers)
    stored_after_mess = participants_collection.find_one({"participant_id": p_id})
    assert stored_after_mess["accommodation"]["payment"] is None

    client.post("/hostels/pay", json={"method": "card"}, headers=headers)
    stored_after_both = participants_collection.find_one({"participant_id": p_id})
    assert stored_after_both["mess"]["payment"]["method"] == "upi"
    assert stored_after_both["accommodation"]["payment"]["method"] == "card"
