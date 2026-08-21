"""
`PUT /mess/{mess_id}/menu` — story 4.1's write half.

The route exists because a hall document had nowhere to keep a menu, so a mess
team's corrections could not leave the device that made them. Its authorization
is deliberately wider than every other write in `routers/mess.py`: a volunteer on
the hall's own team may edit that hall's menu, which is the same check
`scan_mess` makes. These assert that the door is exactly that wide and no wider.
"""
import pytest
from fastapi.testclient import TestClient
from datetime import datetime
import random
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from main import app
from database import mess_collection, backend_teams_collection
import security

client = TestClient(app)


def _staff(role="volunteer"):
    """A backend team member, signed in. Returns (paradox_id, auth headers)."""
    rand = random.randint(100000, 999999)
    email = f"bt{rand}@ds.study.iitm.ac.in"
    paradox_id = f"BT{rand}"
    backend_teams_collection.insert_one({
        "paradox_id": paradox_id,
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": role,
        "department": "mess",
        "designation": "Mess Volunteer",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    login = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"})
    return paradox_id, {"Authorization": f"Bearer {login.json()['access_token']}"}


MENU = {
    "days": [
        {
            "day": 1,
            "slots": [
                {"slot": "breakfast", "start_time": "07:00", "end_time": "09:00",
                 "dishes": ["Idli", "Vada"]},
                {"slot": "lunch", "start_time": "12:00", "end_time": "14:00",
                 "dishes": ["Phulka", "Tomato Rice"]},
                {"slot": "dinner", "start_time": "19:30", "end_time": "21:30",
                 "dishes": ["Biryani", "Raita"]},
            ],
        }
    ],
    "note": "Dinner runs late on day 1.",
}


@pytest.fixture()
def hall():
    """A hall with one volunteer on its team, plus a super admin who is not."""
    mess_collection.delete_many({})
    volunteer_id, volunteer_headers = _staff()
    admin_id, admin_headers = _staff(role="super_admin")

    mess_id = f"MESS_MENU_{random.randint(1000, 9999)}"
    mess_collection.insert_one({
        "mess_id": mess_id,
        "name": "Nilgiri Mess",
        "capacity": 400,
        "preference": "veg",
        "cuisines": ["south_indian"],
        "mess_team": [{"user_id": volunteer_id, "role": "volunteer", "logging": True}],
        "created_at": datetime.utcnow(),
    })
    return {
        "mess_id": mess_id,
        "volunteer_id": volunteer_id,
        "volunteer_headers": volunteer_headers,
        "admin_headers": admin_headers,
    }


def test_a_volunteer_on_the_team_can_write_the_menu(hall):
    resp = client.put(f"/mess/{hall['mess_id']}/menu", json=MENU,
                      headers=hall["volunteer_headers"])
    assert resp.status_code == 200
    assert resp.json() == {"message": "Menu updated"}

    stored = mess_collection.find_one({"mess_id": hall["mess_id"]})["menu"]
    assert stored["note"] == "Dinner runs late on day 1."
    assert stored["updated_by"] == hall["volunteer_id"]
    assert stored["updated_at"] is not None
    assert [s["dishes"] for s in stored["days"][0]["slots"]] == [
        ["Idli", "Vada"], ["Phulka", "Tomato Rice"], ["Biryani", "Raita"],
    ]
    # The window travels with the sitting, which is what lets a hall move a meal.
    assert stored["days"][0]["slots"][2]["start_time"] == "19:30"


def test_a_super_admin_can_write_a_menu_for_a_hall_they_are_not_on(hall):
    resp = client.put(f"/mess/{hall['mess_id']}/menu", json=MENU,
                      headers=hall["admin_headers"])
    assert resp.status_code == 200


def test_a_staffer_on_no_team_is_refused(hall):
    _, outsider_headers = _staff()
    resp = client.put(f"/mess/{hall['mess_id']}/menu", json=MENU, headers=outsider_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Not authorized to edit this menu"
    assert "menu" not in mess_collection.find_one({"mess_id": hall["mess_id"]})


def test_an_unknown_hall_is_a_404_not_a_silent_no_op(hall):
    resp = client.put("/mess/NO_SUCH_HALL/menu", json=MENU, headers=hall["admin_headers"])
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Mess not found"


def test_it_requires_a_signed_in_staffer(hall):
    assert client.put(f"/mess/{hall['mess_id']}/menu", json=MENU).status_code in (401, 403)


def test_a_second_write_replaces_the_first_rather_than_accumulating(hall):
    client.put(f"/mess/{hall['mess_id']}/menu", json=MENU, headers=hall["volunteer_headers"])
    client.put(f"/mess/{hall['mess_id']}/menu",
               json={"days": [{"day": 2, "slots": []}], "note": None},
               headers=hall["volunteer_headers"])

    stored = mess_collection.find_one({"mess_id": hall["mess_id"]})["menu"]
    assert [d["day"] for d in stored["days"]] == [2]
    assert stored["note"] is None


def test_an_empty_body_is_accepted_as_clearing_the_menu(hall):
    client.put(f"/mess/{hall['mess_id']}/menu", json=MENU, headers=hall["volunteer_headers"])
    resp = client.put(f"/mess/{hall['mess_id']}/menu", json={}, headers=hall["volunteer_headers"])
    assert resp.status_code == 200
    assert mess_collection.find_one({"mess_id": hall["mess_id"]})["menu"]["days"] == []


def test_the_menu_comes_back_on_the_list_every_signed_in_user_can_read(hall):
    client.put(f"/mess/{hall['mess_id']}/menu", json=MENU, headers=hall["volunteer_headers"])
    resp = client.get("/mess", headers=hall["volunteer_headers"])
    assert resp.status_code == 200

    hall_row = next(m for m in resp.json() if m["mess_id"] == hall["mess_id"])
    assert hall_row["menu"]["days"][0]["slots"][0]["dishes"] == ["Idli", "Vada"]


def test_a_hall_with_no_menu_written_simply_has_no_menu_key(hall):
    resp = client.get("/mess", headers=hall["volunteer_headers"])
    hall_row = next(m for m in resp.json() if m["mess_id"] == hall["mess_id"])
    # Additive: existing consumers see the response they always saw.
    assert "menu" not in hall_row


def test_both_mess_roles_can_scan_from_the_moment_they_are_assigned(hall):
    """
    `POST /mess/{id}/team` used to grant scanning to role `other` only, so a member
    created as a `volunteer` landed with `logging: False` and could not log a meal
    until an admin switched them on. Story 4.1 asks that a staff member *or
    volunteer* created for the mess have scanning access, so both roles now get it.
    """
    _, admin_headers = _staff(role="super_admin")
    mess_id = hall["mess_id"]

    granted = {}
    for role in ("volunteer", "other"):
        uid = f"BT{random.randint(100000, 999999)}"
        resp = client.post(
            f"/mess/{mess_id}/team",
            json={"user_id": uid, "role": role, "name": f"{role} person"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        team = mess_collection.find_one({"mess_id": mess_id})["mess_team"]
        granted[role] = next(m for m in team if m.get("user_id") == uid)["logging"]

    assert granted == {"volunteer": True, "other": True}


def test_an_unrecognised_role_still_gets_no_scanning(hall):
    """
    `role` is an unvalidated string on the request model, so the grant stays a
    whitelist. A typo or a role this build has never heard of must not inherit
    scanning by accident.
    """
    _, admin_headers = _staff(role="super_admin")
    uid = f"BT{random.randint(100000, 999999)}"
    client.post(
        f"/mess/{hall['mess_id']}/team",
        json={"user_id": uid, "role": "chef", "name": "Typo Role"},
        headers=admin_headers,
    )
    team = mess_collection.find_one({"mess_id": hall["mess_id"]})["mess_team"]
    assert next(m for m in team if m.get("user_id") == uid)["logging"] is False


def test_scanning_can_still_be_revoked_after_assignment(hall):
    """Granting on assignment must not remove an admin's ability to switch it off."""
    _, admin_headers = _staff(role="super_admin")
    uid = f"BT{random.randint(100000, 999999)}"
    client.post(
        f"/mess/{hall['mess_id']}/team",
        json={"user_id": uid, "role": "volunteer"},
        headers=admin_headers,
    )

    def logging_of():
        team = mess_collection.find_one({"mess_id": hall["mess_id"]})["mess_team"]
        return next(m for m in team if m.get("user_id") == uid)["logging"]

    assert logging_of() is True
    resp = client.put(
        f"/mess/{hall['mess_id']}/team/{uid}/toggle_scan?logging=false", headers=admin_headers
    )
    assert resp.status_code == 200
    assert logging_of() is False


def test_a_newly_assigned_volunteer_is_let_through_the_scan_permission_check(hall):
    """
    The flag is only worth anything if `POST /mess/{id}/scan` honours it, so this
    drives the real endpoint rather than reading the stored document.

    `scan_mess` rejects a member without `logging` as 403 "Scanning disabled for
    you" *before* it looks at the QR at all. So the two states are told apart by
    which failure a deliberately junk QR produces: 403 with that message means the
    permission check refused them, and anything else means it let them through and
    the QR itself was the problem. Both halves are asserted, because a test that
    only checked the granted case would still pass if the check never ran.
    """
    _, admin_headers = _staff(role="super_admin")
    volunteer_id, volunteer_headers = _staff()
    mess_id = hall["mess_id"]
    client.post(
        f"/mess/{mess_id}/team",
        json={"user_id": volunteer_id, "role": "volunteer"},
        headers=admin_headers,
    )

    body = {
        "participant_id": "DS23F1000001",
        "data": "not-a-real-qr",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    scan = lambda: client.post(
        f"/mess/{mess_id}/scan?slot=breakfast&day=1", json=body, headers=volunteer_headers
    )

    # Granted on assignment: past the permission check, so it fails on the QR.
    allowed = scan()
    assert allowed.status_code != 403, allowed.json()

    # Revoked: refused before the QR is examined.
    client.put(f"/mess/{mess_id}/team/{volunteer_id}/toggle_scan?logging=false", headers=admin_headers)
    refused = scan()
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Scanning disabled for you"
