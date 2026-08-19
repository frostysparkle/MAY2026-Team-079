"""
Tests for GET /participants/statistics — the fest-wide participant counts the
admin overview board reads.

Two things matter here beyond the arithmetic: the endpoint is Super-Admin-only
like the other statistics endpoints, and it must never leak an identity. The
roster fields (name, email, phone, participant_id) are asserted absent from the
serialised response rather than from the dict, so a nested leak is caught too.
"""
import json
import os
import random
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from main import app
from database import participants_collection, backend_teams_collection
import security

client = TestClient(app)

PASSWORD = "secure_password"


@pytest.fixture(scope="module")
def setup_data():
    participants_collection.delete_many({})
    backend_teams_collection.delete_many({})

    # Three participants, deliberately at different stages of the funnel:
    #   complete  — full profile, mess allotted, hostel allotted and inside
    #   requested — full profile, hostel requested but not yet allotted
    #   bare      — registered only, profile never completed
    emails = {}
    for key in ("complete", "requested", "bare"):
        email = f"23f{random.randint(100000, 999999)}@ds.study.iitm.ac.in"
        emails[key] = email
        client.post("/auth/register", json={"email": email, "password": PASSWORD})

    def complete_profile(email, house, gender, program, stage):
        token = client.post(
            "/auth/login", json={"email": email, "password": PASSWORD}
        ).json()["access_token"]
        client.patch("/profile/complete", json={
            "full_name": "Test User", "dob": "2000-01-01", "house": house,
            "gender": gender, "phone": "1234567890", "mess_preference": "veg",
            "country": "India", "state": "TN", "city": "Chennai", "address": "IITM",
            "program": program, "course_stage": stage,
        }, headers={"Authorization": f"Bearer {token}"})

    complete_profile(emails["complete"], "Ganga", "Male", "DS", "diploma")
    complete_profile(emails["requested"], "Kaveri", "Female", "ES", "foundational")

    participants_collection.update_one({"email": emails["complete"]}, {"$set": {
        "mess.registered": True,
        "mess.mess_id": "M1",
        "accommodation.registered": True,
        "accommodation.hostel_id": "H1",
        "accommodation.logged_in": True,
        "events": [{"event_id": "E1"}],
        "workshops": [{"slot_id": "S1"}],
    }})
    participants_collection.update_one({"email": emails["requested"]}, {"$set": {
        "mess.registered": True,
        "accommodation.registered": True,
    }})

    admin_rand = random.randint(100000, 999999)
    sa_id = f"SA{admin_rand}"
    sa_email = f"sa{admin_rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": sa_id,
        "email": sa_email,
        "password_hash": security.get_password_hash(PASSWORD),
        "role": "super_admin",
        "department": "technicals",
        "designation": "Super Admin",
    })
    sa_token = client.post(
        "/auth/admin/login", json={"email": sa_email, "password": PASSWORD}
    ).json()["access_token"]

    staff_rand = random.randint(100000, 999999)
    staff_email = f"st{staff_rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"ST{staff_rand}",
        "email": staff_email,
        "password_hash": security.get_password_hash(PASSWORD),
        "role": "volunteer",
        "department": "technicals",
        "designation": "Volunteer",
    })
    staff_token = client.post(
        "/auth/admin/login", json={"email": staff_email, "password": PASSWORD}
    ).json()["access_token"]

    return {"sa_token": sa_token, "staff_token": staff_token, "emails": emails}


def test_statistics_requires_super_admin(setup_data):
    resp = client.get("/participants/statistics", headers={
        "Authorization": f"Bearer {setup_data['staff_token']}"
    })
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Not authorized"


def test_statistics_rejects_anonymous():
    assert client.get("/participants/statistics").status_code in (401, 403)


def test_total_registered_counts_every_account(setup_data):
    stats = client.get("/participants/statistics", headers={
        "Authorization": f"Bearer {setup_data['sa_token']}"
    }).json()

    # Three registered, only two of whom ever completed a profile — the point of
    # the endpoint is that both numbers are real and different.
    assert stats["total_registered"] == 3
    assert stats["profile_complete"] == 2
    assert stats["profile_incomplete"] == 1


def test_funnel_counts(setup_data):
    stats = client.get("/participants/statistics", headers={
        "Authorization": f"Bearer {setup_data['sa_token']}"
    }).json()

    assert stats["mess_registered"] == 2
    assert stats["mess_allotted"] == 1
    assert stats["hostel_registered"] == 2
    assert stats["hostel_allotted"] == 1
    assert stats["hostel_pending"] == 1
    assert stats["currently_on_campus"] == 1
    assert stats["with_event_registrations"] == 1
    assert stats["with_workshop_registrations"] == 1


def test_demographic_splits_only_count_completed_profiles(setup_data):
    stats = client.get("/participants/statistics", headers={
        "Authorization": f"Bearer {setup_data['sa_token']}"
    }).json()

    assert stats["by_house"] == {"Ganga": 1, "Kaveri": 1}
    assert stats["by_program"] == {"DS": 1, "ES": 1}
    assert stats["by_course_stage"] == {"diploma": 1, "foundational": 1}
    assert stats["by_gender"] == {"Male": 1, "Female": 1}
    # The bare account contributes to no split, so every split totals 2, not 3.
    assert sum(stats["by_house"].values()) == 2


def test_signups_by_day_is_chronological(setup_data):
    stats = client.get("/participants/statistics", headers={
        "Authorization": f"Bearer {setup_data['sa_token']}"
    }).json()

    days = list(stats["signups_by_day"].keys())
    assert days == sorted(days)
    assert sum(stats["signups_by_day"].values()) == 3


def test_response_carries_no_identifying_field(setup_data):
    resp = client.get("/participants/statistics", headers={
        "Authorization": f"Bearer {setup_data['sa_token']}"
    })
    body = json.dumps(resp.json())

    for email in setup_data["emails"].values():
        assert email not in body
    for leaked in ("full_name", "participant_id", "phone", "password", "private_key"):
        assert leaked not in body
