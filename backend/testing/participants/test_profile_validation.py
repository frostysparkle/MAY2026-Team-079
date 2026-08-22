"""
Closed-vocabulary validation on `PATCH /profile/complete` and
`PATCH /participants/{id}`.

`house`, `gender`, `program`, `course_stage`, and `mess_preference` used to be
unvalidated free strings. These are now checked against fixed vocabularies
defined once in `models.py` (`HOUSES`, `GENDERS`, `PROGRAMS`, `COURSE_STAGES`,
`MESS_PREFERENCE_TYPES`), so a participant — or an admin editing somebody
else's profile — cannot write a value outside the set the rest of the app
(seed data, statistics, allocation) actually understands.
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

client = TestClient(app)

VALID_PROFILE = {
    "full_name": "Test Participant",
    "dob": "2003-05-01",
    "house": "Wayanad",
    "gender": "female",
    "phone": "9876500011",
    "mess_preference": "north_indian__veg",
    "country": "India",
    "state": "TN",
    "city": "Chennai",
    "address": "IITM",
    "program": "DS",
    "course_stage": "degree",
}


@pytest.fixture
def participant():
    rand = random.randint(100000, 999999)
    email = f"23f{rand}@ds.study.iitm.ac.in"
    client.post("/auth/register", json={"email": email, "password": "secure_password"})
    login = client.post("/auth/login", json={"email": email, "password": "secure_password"}).json()
    return login["id"], {"Authorization": f"Bearer {login['access_token']}"}


@pytest.fixture
def super_admin():
    rand = random.randint(100000, 999999)
    email = f"sa{rand}@ds.study.iitm.ac.in"
    backend_teams_collection.insert_one({
        "paradox_id": f"SA{rand}",
        "email": email,
        "password_hash": security.get_password_hash("secure_password"),
        "role": "super_admin",
        "department": "uhc",
        "designation": "Super Admin",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    token = client.post("/auth/admin/login", json={"email": email, "password": "secure_password"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# PATCH /profile/complete
# ---------------------------------------------------------------------------

def test_a_fully_conforming_profile_is_accepted(participant):
    _, headers = participant
    resp = client.patch("/profile/complete", json=VALID_PROFILE, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["house"] == "Wayanad"
    assert resp.json()["mess_preference"] == "north_indian__veg"


def test_house_is_stored_bare_not_suffixed(participant):
    """The 12 houses are validated without a trailing 'House' — the old
    suffixed form is no longer a valid submission."""
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, house="Wayanad House"), headers=headers)
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_house", ["Ganga", "wayanad", "Wayanad House", ""])
def test_house_outside_the_twelve_is_rejected(participant, bad_house):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, house=bad_house), headers=headers)
    assert resp.status_code == 422


@pytest.mark.parametrize("house", [
    "Bandipur", "Corbett", "Gir", "Kanha", "Kaziranga", "Nallamala",
    "Namdapha", "Nilgiri", "Pichavaram", "Saranda", "Sundarbans", "Wayanad",
])
def test_every_one_of_the_twelve_houses_is_accepted(participant, house):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, house=house), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["house"] == house


@pytest.mark.parametrize("bad_gender", ["Male", "MALE", "other", "unspecified", ""])
def test_gender_outside_the_strict_binary_is_rejected(participant, bad_gender):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, gender=bad_gender), headers=headers)
    assert resp.status_code == 422


@pytest.mark.parametrize("gender", ["male", "female"])
def test_male_and_female_are_both_accepted(participant, gender):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, gender=gender), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["gender"] == gender


@pytest.mark.parametrize("bad_program", ["BS", "ds", "Data Science", ""])
def test_program_outside_the_closed_set_is_rejected(participant, bad_program):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, program=bad_program), headers=headers)
    assert resp.status_code == 422


@pytest.mark.parametrize("program", ["DS", "MS", "AE", "ES"])
def test_every_program_is_accepted(participant, program):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, program=program), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["program"] == program


@pytest.mark.parametrize("bad_stage", ["foundation", "Diploma", "Degree", ""])
def test_course_stage_outside_the_closed_set_is_rejected(participant, bad_stage):
    """'foundation' (singular) is rejected — the real value is 'foundational',
    matching the rest of the app (seed data, statistics, frontend)."""
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, course_stage=bad_stage), headers=headers)
    assert resp.status_code == 422


@pytest.mark.parametrize("stage", ["foundational", "diploma", "degree"])
def test_every_course_stage_is_accepted(participant, stage):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, course_stage=stage), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["course_stage"] == stage


@pytest.mark.parametrize("bad_pref", ["veg", "non_veg", "Jain", "north_indian", ""])
def test_a_bare_diet_word_is_no_longer_a_valid_mess_preference(participant, bad_pref):
    """The vocabulary is the combined cuisine+diet set a mess hall's own
    `type` is validated against — a bare 'veg' is not itself a member."""
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, mess_preference=bad_pref), headers=headers)
    assert resp.status_code == 422


@pytest.mark.parametrize("pref", [
    "north_indian__veg", "north_indian__non_veg",
    "south_indian__veg", "south_indian__non_veg", "jain",
])
def test_every_combined_mess_preference_is_accepted(participant, pref):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, mess_preference=pref), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["mess_preference"] == pref


def test_mess_preference_may_be_omitted_entirely_as_not_yet_chosen(participant):
    _, headers = participant
    body = {k: v for k, v in VALID_PROFILE.items() if k != "mess_preference"}
    resp = client.patch("/profile/complete", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["mess_preference"] is None


def test_mess_preference_explicit_null_is_also_accepted(participant):
    _, headers = participant
    resp = client.patch("/profile/complete", json=dict(VALID_PROFILE, mess_preference=None), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["mess_preference"] is None


# ---------------------------------------------------------------------------
# PATCH /participants/{id} — the admin edit route validates the same way
# ---------------------------------------------------------------------------

def test_admin_edit_rejects_an_invalid_house(participant, super_admin):
    p_id, p_headers = participant
    client.patch("/profile/complete", json=VALID_PROFILE, headers=p_headers)
    resp = client.patch(f"/participants/{p_id}", json={"house": "Ganga"}, headers=super_admin)
    assert resp.status_code == 422


def test_admin_edit_rejects_an_invalid_gender(participant, super_admin):
    p_id, p_headers = participant
    client.patch("/profile/complete", json=VALID_PROFILE, headers=p_headers)
    resp = client.patch(f"/participants/{p_id}", json={"gender": "unspecified"}, headers=super_admin)
    assert resp.status_code == 422


def test_admin_edit_rejects_an_invalid_mess_preference(participant, super_admin):
    p_id, p_headers = participant
    client.patch("/profile/complete", json=VALID_PROFILE, headers=p_headers)
    resp = client.patch(f"/participants/{p_id}", json={"mess_preference": "veg"}, headers=super_admin)
    assert resp.status_code == 422


def test_admin_edit_accepts_a_conforming_house_and_writes_it(participant, super_admin):
    p_id, p_headers = participant
    client.patch("/profile/complete", json=VALID_PROFILE, headers=p_headers)
    resp = client.patch(f"/participants/{p_id}", json={"house": "Corbett"}, headers=super_admin)
    assert resp.status_code == 200, resp.text
    assert resp.json()["profile"]["house"] == "Corbett"
    stored = participants_collection.find_one({"participant_id": p_id})
    assert stored["profile"]["house"] == "Corbett"


def test_admin_edit_leaving_a_field_unset_does_not_touch_it(participant, super_admin):
    p_id, p_headers = participant
    client.patch("/profile/complete", json=VALID_PROFILE, headers=p_headers)
    resp = client.patch(f"/participants/{p_id}", json={"house": "Gir"}, headers=super_admin)
    assert resp.status_code == 200, resp.text
    # gender was never sent in this PATCH, so it must be untouched.
    assert resp.json()["profile"]["gender"] == VALID_PROFILE["gender"]
