"""
Shared fixtures for the integration suite.

Everything here goes through HTTP with real tokens. Where a unit test may seed a
document directly to reach one branch, an integration test builds state the way a
client would — so a lifecycle test fails if any step in the chain breaks, not only
the one it is nominally about.

The one exception is `mess.registered`: no endpoint in the API sets it, so a
participant cannot opt into a meal plan through HTTP at all. It is set directly, with
a note, rather than papered over.
"""
import pytest

import database
from testing.helpers import auth_headers

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"


@pytest.fixture()
def founder(make_staff):
    """The Super Admin who sets the fest up."""
    return make_staff(paradox_id="SAWO1111", email="super.admin@ds.study.iitm.ac.in",
                      role="super_admin", department="workshops")


@pytest.fixture()
def admin(founder):
    return auth_headers(founder)


@pytest.fixture()
def register_participant(client, password):
    """
    Create an account the way a student would: through `POST /auth/register`, then
    `POST /auth/login`, then `PATCH /profile/complete`.

    Returns the login response body plus the seeded document, so a test has both the
    token and the `_id` it may need to assert against.
    """
    counter = {"next": 1}

    def _register(profile=None, email=None, **profile_overrides):
        index = counter["next"]
        counter["next"] += 1
        address = email or f"23f10000{index}@ds.study.iitm.ac.in"

        assert client.post("/auth/register",
                           json={"email": address, "password": password}).status_code == 200
        login = client.post("/auth/login", json={"email": address, "password": password})
        assert login.status_code == 200
        body = login.json()
        headers = {"Authorization": f"Bearer {body['access_token']}"}

        payload = {
            "full_name": f"Student {index}",
            "dob": "2004-01-01",
            "house": "Bandipur",
            "gender": "male",
            "phone": f"90000000{index:02d}",
            "country": "India",
            "state": "TN",
            "city": "Chennai",
            "address": "1 Test Street",
            "program": "DS",
            "course_stage": "diploma",
            **(profile or {}),
            **profile_overrides,
        }
        assert client.patch("/profile/complete", json=payload,
                            headers=headers).status_code == 200

        document = database.participants_collection.find_one({"email": address})
        return {"headers": headers, "document": document, "login": body,
                "participant_id": body["id"], "email": address}

    return _register


@pytest.fixture()
def make_duty_staff(client, admin, register_participant, password):
    """
    A staff account created through `POST /backend_teams`.

    Roles other than `other` must link to a registered participant, so this
    registers one first when the requested role demands it.
    """
    counter = {"next": 1}

    def _make(role="other", department="hostels", designation="Duty Staff"):
        index = counter["next"]
        counter["next"] += 1
        address = f"staff{index}@ds.study.iitm.ac.in"

        if role in {"super_admin", "admin", "volunteer"}:
            register_participant(email=address)

        response = client.post("/backend_teams", json={
            "email": address, "password": password, "role": role,
            "department": department, "designation": designation,
        }, headers=admin)
        assert response.status_code == 200, response.json()
        paradox_id = response.json()["paradox_id"]

        login = client.post("/auth/admin/login", json={"email": address, "password": password})
        assert login.status_code == 200
        return {
            "paradox_id": paradox_id,
            "headers": {"Authorization": f"Bearer {login.json()['access_token']}"},
            "email": address,
        }

    return _make


@pytest.fixture()
def opt_into_mess():
    """
    Mark a participant as wanting a meal plan.

    Written directly because **no endpoint sets `mess.registered`** — unlike
    accommodation, which has `POST /hostels/register`. Without this, `/mess/allocate`
    can never place anybody, so a mess lifecycle test cannot be built from HTTP calls
    alone.
    """
    def _opt_in(person):
        database.participants_collection.update_one(
            {"_id": person["document"]["_id"]},
            {"$set": {"mess.registered": True}},
        )

    return _opt_in
