"""
`POST /mess/allocate` after `profile.mess_preference` grew a combined
"{cuisine}__{diet}" vocabulary (`north_indian__veg`, `jain`, ...) instead of a
bare diet (`veg` / `non_veg` / `jain`).

`allocate_messes` groups halls by diet alone (a hall's own `type` is also
combined, e.g. `north_indian__veg`) and used to compare that diet directly
against whatever was stored in `profile.mess_preference`. Once a participant's
preference itself became a combined value, that direct comparison stopped
matching — `_diet_of()` now normalises both sides before comparing, and this
file is the regression test for that fix. It covers three shapes a stored
preference can take: the legacy bare diet, the new combined value, and a
`None`/missing preference (never chosen).
"""
import os
import random
import sys
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from database import backend_teams_collection, mess_collection, participants_collection
from main import app

client = TestClient(app)


def make_super_admin() -> dict:
    rand = random.randint(100000, 999999)
    email = f"messcombo{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"BT{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "mess",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    token = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def add_registered_participant(pid: str, mess_preference) -> None:
    profile = {"full_name": pid}
    # Distinguish "never set the key" from "set it to None" the same way the
    # existing mess-allocation suite does — both are real states a stored
    # document can be in.
    if mess_preference is not _OMIT:
        profile["mess_preference"] = mess_preference
    participants_collection.insert_one({
        "participant_id": pid,
        "email": f"{pid.lower()}@ds.study.iitm.ac.in",
        "profile": profile,
        "mess": {"registered": True, "mess_id": None},
        "accommodation": {"registered": False, "hostel_id": None},
    })


_OMIT = object()


@pytest.fixture
def veg_hall():
    """One hall whose `type` is a combined value, matching the schema
    `MessCreateRequest.type` now validates against."""
    participants_collection.delete_many({})
    mess_collection.delete_many({})
    backend_teams_collection.delete_many({})

    headers = make_super_admin()
    mess_collection.insert_one({
        "mess_id": "MSVEG", "name": "Test Veg Hall", "capacity": 100,
        "type": "north_indian__veg", "menu": {}, "mess_team": [],
        "created_at": datetime.utcnow(),
    })
    hall_id = mess_collection.find_one({"mess_id": "MSVEG"})["_id"]
    return headers, hall_id


def test_a_legacy_bare_diet_preference_is_still_seated(veg_hall):
    headers, hall_id = veg_hall
    add_registered_participant("P_BARE", "veg")

    resp = client.post("/mess/allocate", headers=headers)
    assert resp.status_code == 200, resp.text

    doc = participants_collection.find_one({"participant_id": "P_BARE"})
    assert doc["mess"]["mess_id"] == hall_id


def test_a_combined_cuisine_diet_preference_is_seated_in_the_matching_diet_hall(veg_hall):
    headers, hall_id = veg_hall
    add_registered_participant("P_COMBINED", "south_indian__veg")

    resp = client.post("/mess/allocate", headers=headers)
    assert resp.status_code == 200, resp.text

    doc = participants_collection.find_one({"participant_id": "P_COMBINED"})
    assert doc["mess"]["mess_id"] == hall_id


def test_a_combined_preference_of_the_wrong_diet_is_not_seated_in_a_veg_hall(veg_hall):
    headers, hall_id = veg_hall
    add_registered_participant("P_NONVEG", "north_indian__non_veg")

    resp = client.post("/mess/allocate", headers=headers)
    assert resp.status_code == 200, resp.text

    doc = participants_collection.find_one({"participant_id": "P_NONVEG"})
    assert doc["mess"]["mess_id"] is None


def test_a_null_preference_still_defaults_to_veg(veg_hall):
    headers, hall_id = veg_hall
    add_registered_participant("P_NULL", None)

    resp = client.post("/mess/allocate", headers=headers)
    assert resp.status_code == 200, resp.text

    doc = participants_collection.find_one({"participant_id": "P_NULL"})
    assert doc["mess"]["mess_id"] == hall_id


def test_a_missing_preference_key_also_defaults_to_veg(veg_hall):
    headers, hall_id = veg_hall
    add_registered_participant("P_MISSING", _OMIT)

    resp = client.post("/mess/allocate", headers=headers)
    assert resp.status_code == 200, resp.text

    doc = participants_collection.find_one({"participant_id": "P_MISSING"})
    assert doc["mess"]["mess_id"] == hall_id


def test_jain_is_its_own_bucket_regardless_of_shape(veg_hall):
    headers, veg_hall_id = veg_hall
    mess_collection.insert_one({
        "mess_id": "MSJAIN", "name": "Test Jain Hall", "capacity": 100,
        "type": "jain", "menu": {}, "mess_team": [],
        "created_at": datetime.utcnow(),
    })
    jain_hall_id = mess_collection.find_one({"mess_id": "MSJAIN"})["_id"]

    add_registered_participant("P_JAIN", "jain")

    resp = client.post("/mess/allocate", headers=headers)
    assert resp.status_code == 200, resp.text

    doc = participants_collection.find_one({"participant_id": "P_JAIN"})
    assert doc["mess"]["mess_id"] == jain_hall_id
    assert doc["mess"]["mess_id"] != veg_hall_id
