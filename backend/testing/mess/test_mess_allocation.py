"""
``POST /mess/allocate`` — who is eligible for a seat.

The bug this pins down: the route selected participants on nothing but a missing
``mess.mess_id``, which is true of everybody who never asked for a meal plan. So a
single click seated non-registrants, and ``/participants/statistics`` then reported
``mess_allotted`` **above** ``mess_registered`` — a total that cannot happen, which
the dashboard's pipeline rendered as more people fed than signed up.

``POST /hostels/allocate`` had always filtered on ``accommodation.registered``. The
asymmetry was the whole defect, so the first test below is the invariant the two
routes now share.

A second, quieter bug is covered here too. Preference was read with
``.get("mess_preference", "veg")``, and a default like that does not fire when the
key exists holding ``None`` — which is exactly what a profile that never chose a
preference stores. Those registrants fell through to an empty hall list and were
skipped silently on every run, forever.
"""
import os
import random
import sys
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import security
from database import (
    backend_teams_collection,
    mess_collection,
    participants_collection,
)
from main import app

client = TestClient(app)


def make_super_admin() -> str:
    rand = random.randint(100000, 999999)
    email = f"messalloc{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"BT{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "operations",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    resp = client.post(
        "/auth/admin/login", json={"email": email, "password": "secure_password"}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def add_participant(pid: str, *, registered: bool, preference="veg", omit_preference=False):
    """
    One participant, with precise control over the two fields allocation reads.

    `omit_preference` drops the key entirely; passing `preference=None` keeps the
    key with a null value. Those are different documents and they took different
    paths through the old code, so the distinction has to be expressible here.
    """
    profile = {"full_name": pid}
    if not omit_preference:
        profile["mess_preference"] = preference

    participants_collection.insert_one({
        "participant_id": pid,
        "email": f"{pid.lower()}@ds.study.iitm.ac.in",
        "profile": profile,
        "mess": {"registered": registered, "mess_id": None},
        "accommodation": {"registered": False, "hostel_id": None},
    })


@pytest.fixture
def halls():
    """Three halls, one per preference, with room to spare."""
    participants_collection.delete_many({})
    mess_collection.delete_many({})
    backend_teams_collection.delete_many({})

    token = make_super_admin()
    mess_collection.insert_many([
        {"mess_id": "MS01", "name": "Himalaya", "preference": "veg", "capacity": 100,
         "mess_team": [], "menu": []},
        {"mess_id": "MS02", "name": "Vindhya", "preference": "non_veg", "capacity": 100,
         "mess_team": [], "menu": []},
        {"mess_id": "MS03", "name": "Nilgiri", "preference": "jain", "capacity": 100,
         "mess_team": [], "menu": []},
    ])
    return {"Authorization": f"Bearer {token}"}


def allocate(headers):
    resp = client.post("/mess/allocate", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def seated(pid: str):
    return participants_collection.find_one({"participant_id": pid})["mess"]["mess_id"]


def counts():
    """The two figures whose relationship the bug inverted."""
    return (
        participants_collection.count_documents({"mess.registered": True}),
        participants_collection.count_documents({"mess.mess_id": {"$ne": None}}),
    )


def test_only_registered_participants_are_seated(halls):
    """
    The headline regression.

    Before the fix this seated all four and reported "Allocated 4".
    """
    add_participant("P_YES_1", registered=True)
    add_participant("P_YES_2", registered=True, preference="non_veg")
    add_participant("P_NO_1", registered=False)
    add_participant("P_NO_2", registered=False, preference="jain")

    body = allocate(halls)

    assert body["message"] == "Allocated 2 participants to messes"
    assert seated("P_YES_1") is not None
    assert seated("P_YES_2") is not None
    assert seated("P_NO_1") is None
    assert seated("P_NO_2") is None


def test_allotted_can_never_exceed_registered(halls):
    """
    The invariant the dashboard rendered. `mess_allotted` counts `mess.mess_id`;
    `mess_registered` counts the opt-in flag. Seating a non-registrant pushes the
    first above the second, which is what put "527 of 524" on the board.
    """
    for i in range(5):
        add_participant(f"P_IN_{i}", registered=True)
    for i in range(20):
        add_participant(f"P_OUT_{i}", registered=False)

    allocate(halls)

    registered, allotted = counts()
    assert allotted <= registered
    assert (registered, allotted) == (5, 5)


def test_an_unregistered_participant_is_untouched_even_with_a_preference(halls):
    """
    Stating a dietary preference is not the same as asking for a meal plan. The
    real account that exposed this bug had `mess_preference: 'veg'` set and
    `registered: False`, and was seated anyway.
    """
    add_participant("P_PREF_ONLY", registered=False, preference="veg")

    assert allocate(halls)["message"] == "Allocated 0 participants to messes"
    assert seated("P_PREF_ONLY") is None
    # The opt-in flag itself must not be rewritten either.
    assert participants_collection.find_one(
        {"participant_id": "P_PREF_ONLY"}
    )["mess"]["registered"] is False


def test_a_registrant_with_a_null_preference_is_still_seated(halls):
    """
    `.get("mess_preference", "veg")` returns `None`, not `"veg"`, when the key
    exists holding null — so these registrants matched no preference group and
    were skipped on every run with nothing to show they had been.
    """
    add_participant("P_NULL", registered=True, preference=None)

    assert allocate(halls)["message"] == "Allocated 1 participants to messes"
    hall = mess_collection.find_one({"_id": seated("P_NULL")})
    assert hall["preference"] == "veg"


def test_a_registrant_with_no_preference_key_is_seated_as_veg(halls):
    add_participant("P_MISSING", registered=True, omit_preference=True)

    assert allocate(halls)["message"] == "Allocated 1 participants to messes"
    hall = mess_collection.find_one({"_id": seated("P_MISSING")})
    assert hall["preference"] == "veg"


def test_a_seat_matches_the_diner_s_preference(halls):
    add_participant("P_VEG", registered=True, preference="veg")
    add_participant("P_NONVEG", registered=True, preference="non_veg")
    add_participant("P_JAIN", registered=True, preference="jain")

    allocate(halls)

    for pid, expected in (("P_VEG", "veg"), ("P_NONVEG", "non_veg"), ("P_JAIN", "jain")):
        hall = mess_collection.find_one({"_id": seated(pid)})
        assert hall["preference"] == expected, pid


def test_capacity_is_respected(halls):
    """
    The seat tally is now kept in memory rather than re-queried per candidate, so
    this also guards against that tally drifting from the collection.
    """
    mess_collection.update_one({"mess_id": "MS01"}, {"$set": {"capacity": 3}})
    for i in range(6):
        add_participant(f"P_VEG_{i}", registered=True, preference="veg")

    allocate(halls)

    veg_hall = mess_collection.find_one({"mess_id": "MS01"})
    assert participants_collection.count_documents({"mess.mess_id": veg_hall["_id"]}) == 3
    # The other three stay queued rather than overflowing into a hall that does
    # not serve what they eat.
    assert participants_collection.count_documents(
        {"mess.registered": True, "mess.mess_id": None}
    ) == 3


def test_running_allocation_twice_seats_nobody_new(halls):
    """
    Idempotent, which is what makes the button safe to press twice. The old route
    was not: each run re-seated every non-registrant it had already seated.
    """
    for i in range(4):
        add_participant(f"P_{i}", registered=True)

    assert allocate(halls)["message"] == "Allocated 4 participants to messes"
    before = counts()

    assert allocate(halls)["message"] == "Allocated 0 participants to messes"
    assert counts() == before


def test_allocation_leaves_an_already_seated_diner_where_they_are(halls):
    add_participant("P_SEATED", registered=True)
    allocate(halls)
    first = seated("P_SEATED")

    add_participant("P_LATE", registered=True)
    allocate(halls)

    assert seated("P_SEATED") == first


def test_only_super_admins_may_allocate(halls):
    rand = random.randint(100000, 999999)
    email = f"messhead{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"BT{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "mess_head",
        "department": "operations",
        "designation": "Head",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    token = client.post(
        "/auth/admin/login", json={"email": email, "password": "secure_password"}
    ).json()["access_token"]

    resp = client.post("/mess/allocate", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
