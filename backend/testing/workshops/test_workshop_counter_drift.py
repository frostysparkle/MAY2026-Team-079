"""
``registration_count`` bookkeeping across the on-spot walk-in path.

``registration_count`` is a denormalised counter — the number of seats a workshop
believes it has sold. The admin board reads it directly for seats booked, fill
percentage, show rate, seats left, and whether a workshop is sold out, so anything
that lets it drift away from the actual roster corrupts six figures at once.

The walk-in branch of ``POST /workshops/{id}/attendance`` was the one way it could
drift. That branch removes whatever booking the participant already holds for the
slot, then charges a seat for the workshop they walked into. The removal released
nothing, which broke in two directions:

* **Walked into a different workshop in the same slot.** The booking on the
  original workshop was deleted while that workshop kept charging for the seat, so
  it read fuller than it was for the rest of the fest.
* **Walked into the workshop they were already booked on.** The pre-registration
  was deleted and re-added as a walk-in, while the increment charged a *second*
  seat — one person, two seats.

The roster is the authority. Every test below compares the counter against
``len(participants holding a booking on that workshop)``.
"""
import base64
import json
import os
import random
import sys
from datetime import datetime, timedelta

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from database import (
    backend_teams_collection,
    participants_collection,
    workshop_logs_collection,
    workshops_collection,
)
from main import app

client = TestClient(app)

PASSWORD = "secure_password"


def qr_for(participant_id: str, public_key_pem: str) -> dict:
    """A live QR payload, encrypted to that participant's own public key."""
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    ciphertext = public_key.encrypt(
        json.dumps({"participant_id": participant_id}).encode("utf-8"),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                     algorithm=hashes.SHA256(), label=None),
    )
    return {
        "participant_id": participant_id,
        "data": base64.b64encode(ciphertext).decode("utf-8"),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


def roster_count(workshop_key: str) -> int:
    """
    How many participants actually hold a booking on this workshop — the figure
    `registration_count` is supposed to mirror.
    """
    doc = workshops_collection.find_one({"workshop_id": workshop_key})
    return participants_collection.count_documents({"workshops.workshop_id": doc["_id"]})


def counter(workshop_key: str) -> int:
    return workshops_collection.find_one(
        {"workshop_id": workshop_key}
    ).get("registration_count", 0)


def assert_counter_matches_roster(*workshop_keys: str):
    for key in workshop_keys:
        assert counter(key) == roster_count(key), (
            f"{key}: counter {counter(key)} != roster {roster_count(key)}"
        )


@pytest.fixture
def desk():
    """
    Two workshops sharing one slot, one volunteer who may scan, one participant.

    Sharing a slot is essential: the walk-in branch removes bookings by `slot_id`,
    so a second workshop in the same slot is what makes the cross-workshop release
    reachable at all.
    """
    workshops_collection.delete_many({})
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})
    workshop_logs_collection.delete_many({})

    tag = random.randint(100000, 999999)

    p_email = f"23f{tag}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": p_email, "password": PASSWORD})
    p_login = client.post("/auth/login", json={"email": p_email, "password": PASSWORD})
    assert p_login.status_code == 200, p_login.text

    sa_id = f"SA{tag}"
    sa_email = f"sa{tag}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": sa_id,
        "email": sa_email,
        "password_hash": security.get_password_hash(PASSWORD),
        "role": "super_admin",
        "department": "technicals",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    sa_token = client.post(
        "/auth/admin/login", json={"email": sa_email, "password": PASSWORD}
    ).json()["access_token"]
    sa_headers = {"Authorization": f"Bearer {sa_token}"}

    slot_id = f"SLOT_{tag}"
    keys = []
    for n in (1, 2):
        key = f"WKS_{tag}_{n}"
        resp = client.post("/workshops", json={
            "workshop_id": key,
            "slot_id": slot_id,
            "name": f"Workshop {n}",
            "description": "Counter bookkeeping.",
            "venue": "Lab",
            "capacity": 100,
            "instructions": "Bring a laptop",
        }, headers=sa_headers)
        assert resp.status_code in (200, 201), resp.text
        # The volunteer who scans. The super admin stands in for one.
        client.post(f"/workshops/{key}/volunteers",
                    json={"user_id": sa_id, "role": "workshop_volunteer", "attendance": True},
                    headers=sa_headers)
        keys.append(key)

    return {
        "p_token": p_login.json()["access_token"],
        "p_id": p_login.json()["id"],
        "p_pubkey": p_login.json()["public_key"],
        "sa": sa_headers,
        "a": keys[0],
        "b": keys[1],
        "slot_id": slot_id,
    }


def register(desk, key: str):
    resp = client.post(f"/workshops/{key}/register",
                       headers={"Authorization": f"Bearer {desk['p_token']}"})
    assert resp.status_code == 200, resp.text


def walk_in(desk, key: str):
    return client.post(
        f"/workshops/{key}/attendance",
        params={"scan_type": "on-spot"},
        json=qr_for(desk["p_id"], desk["p_pubkey"]),
        headers=desk["sa"],
    )


# ── the two drift cases ───────────────────────────────────────────────────────

def test_walking_into_another_workshop_releases_the_original_seat(desk):
    """
    The cross-workshop case.

    Booked on A, walks into B. A no longer holds the booking, so A must no longer
    charge for it. Before the fix A stayed at 1 with an empty roster — a phantom
    seat that never came back.
    """
    register(desk, desk["a"])
    assert counter(desk["a"]) == 1

    resp = walk_in(desk, desk["b"])
    assert resp.status_code == 200, resp.text

    assert roster_count(desk["a"]) == 0
    assert counter(desk["a"]) == 0
    assert roster_count(desk["b"]) == 1
    assert counter(desk["b"]) == 1
    assert_counter_matches_roster(desk["a"], desk["b"])


def test_walking_into_the_workshop_already_booked_charges_one_seat(desk):
    """
    The same-workshop case, which nets to zero.

    The booking is deleted and re-added as a walk-in, so the participant still
    holds exactly one seat. Before the fix the increment ran without the matching
    release and the workshop charged two seats for one person.
    """
    register(desk, desk["a"])
    assert counter(desk["a"]) == 1

    resp = walk_in(desk, desk["a"])
    assert resp.status_code == 200, resp.text

    assert roster_count(desk["a"]) == 1
    assert counter(desk["a"]) == 1
    assert_counter_matches_roster(desk["a"])


# ── the paths that were already correct, guarded against the fix ─────────────

def test_a_plain_walk_in_charges_exactly_one_seat(desk):
    """Nobody to release, so the release must not fire and take a seat away."""
    resp = walk_in(desk, desk["b"])
    assert resp.status_code == 200, resp.text

    assert counter(desk["b"]) == 1
    assert_counter_matches_roster(desk["b"])


def test_a_second_walk_in_scan_is_idempotent(desk):
    """
    Already marked present, so the route returns early. It must not charge again,
    and the guarded release must not drive the counter down either.
    """
    walk_in(desk, desk["b"])
    assert counter(desk["b"]) == 1

    resp = walk_in(desk, desk["b"])
    assert resp.status_code == 200
    assert resp.json()["message"] == "Attendee already marked present"

    assert counter(desk["b"]) == 1
    assert_counter_matches_roster(desk["b"])


def test_the_counter_is_never_driven_negative(desk):
    """
    The decrement is guarded on `registration_count > 0`, so data predating this
    route — a booking whose seat was never counted — cannot push it below zero.
    """
    workshops_collection.update_one(
        {"workshop_id": desk["a"]}, {"$set": {"registration_count": 0}}
    )
    # A booking on A with no seat charged for it, which is the inconsistent state.
    doc_a = workshops_collection.find_one({"workshop_id": desk["a"]})
    participants_collection.update_one(
        {"participant_id": desk["p_id"]},
        {"$push": {"workshops": {
            "slot_id": desk["slot_id"],
            "booking_type": "pre-registered",
            "workshop_id": doc_a["_id"],
            "attended": False,
        }}},
    )

    resp = walk_in(desk, desk["b"])
    assert resp.status_code == 200, resp.text
    assert counter(desk["a"]) == 0


def test_attendance_is_recorded_alongside_the_seat_accounting(desk):
    """
    The fix must not have cost the walk-in its actual purpose: the participant is
    present, and `participant_count` reflects it.
    """
    walk_in(desk, desk["b"])

    doc = workshops_collection.find_one({"workshop_id": desk["b"]})
    assert doc.get("participant_count", 0) == 1

    booking = next(
        w for w in participants_collection.find_one(
            {"participant_id": desk["p_id"]}
        )["workshops"] if w["workshop_id"] == doc["_id"]
    )
    assert booking["attended"] is True
    assert booking["booking_type"] == "on-spot"
