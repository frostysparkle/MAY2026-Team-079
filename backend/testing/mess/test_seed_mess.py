"""
Verifies the mess catalogue seeder.

Two things are being proved. First, that the shipped dataset really does describe
the three halls the programme expects — Himalaya North Indian, Vindhya South
Indian, Nilgiri both — because that is the fact the dashboard and the mock API
both depend on. Second, that `seed_mess` is safe to run repeatedly: it corrects
drift in the catalogue fields but never touches an assigned team or a hall's
original creation time.
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from database import mess_collection
from seed_mess import DEFAULT_DATASET, load_catalogue, seed_mess

# What the programme expects the shipped catalogue to contain.
EXPECTED = {
    "MS01": ("Himalaya", ["north_indian"]),
    "MS02": ("Vindhya", ["south_indian"]),
    "MS03": ("Nilgiri", ["north_indian", "south_indian"]),
}


@pytest.fixture(autouse=True)
def clean_mess():
    mess_collection.delete_many({})
    yield
    mess_collection.delete_many({})


@pytest.fixture(scope="module")
def catalogue():
    assert DEFAULT_DATASET.is_file(), f"dataset missing at {DEFAULT_DATASET}"
    return load_catalogue()


def quiet(*_args, **_kwargs):
    """Swallow the seeder's progress output."""


def test_dataset_describes_the_three_halls(catalogue):
    assert {hall["mess_id"] for hall in catalogue} == set(EXPECTED)

    for hall in catalogue:
        name, cuisines = EXPECTED[hall["mess_id"]]
        assert hall["name"] == name
        assert hall["cuisines"] == cuisines
        assert hall["capacity"] > 0
        # Every hall must be allocatable: allocation matches this exactly against
        # a participant's profile.mess_preference.
        assert hall["preference"] in ("veg", "non_veg", "jain")


def test_nilgiri_serves_both_menus(catalogue):
    by_id = {hall["mess_id"]: hall for hall in catalogue}

    assert by_id["MS03"]["cuisines"] == ["north_indian", "south_indian"]
    # And the single-menu halls stay single-menu, which is the distinction the
    # "both" designation only means something against.
    assert by_id["MS01"]["cuisines"] == ["north_indian"]
    assert by_id["MS02"]["cuisines"] == ["south_indian"]


def test_seeds_the_catalogue(catalogue):
    tally = seed_mess(catalogue, log=quiet)

    assert tally == {
        "created": len(catalogue),
        "updated": 0,
        "unchanged": 0,
        "conflicts": 0,
    }
    assert mess_collection.count_documents({}) == len(catalogue)

    stored = mess_collection.find_one({"mess_id": "MS03"}, {"_id": 0})
    assert stored["name"] == "Nilgiri"
    assert stored["cuisines"] == ["north_indian", "south_indian"]
    # A fresh hall opens unstaffed.
    assert stored["mess_team"] == []


def test_rerunning_changes_nothing(catalogue):
    seed_mess(catalogue, log=quiet)
    again = seed_mess(catalogue, log=quiet)

    assert again["created"] == 0
    assert again["updated"] == 0
    assert again["unchanged"] == len(catalogue)
    assert mess_collection.count_documents({}) == len(catalogue)


def test_corrects_drift_without_dropping_the_team(catalogue):
    seed_mess(catalogue, log=quiet)

    volunteer = {"user_id": "BT_SEED_TEST", "role": "other", "logging": True}
    mess_collection.update_one(
        {"mess_id": "MS01"},
        {"$set": {"capacity": 1, "cuisines": [], "mess_team": [volunteer]}},
    )

    tally = seed_mess(catalogue, log=quiet)

    assert tally["updated"] == 1
    assert tally["unchanged"] == len(catalogue) - 1

    corrected = mess_collection.find_one({"mess_id": "MS01"})
    assert corrected["cuisines"] == ["north_indian"]
    assert corrected["capacity"] == next(h["capacity"] for h in catalogue if h["mess_id"] == "MS01")
    # The team is not part of the catalogue, so seeding must leave it alone.
    assert corrected["mess_team"] == [volunteer]


def test_dry_run_writes_nothing(catalogue):
    tally = seed_mess(catalogue, dry_run=True, log=quiet)

    assert tally["created"] == len(catalogue)
    assert mess_collection.count_documents({}) == 0


def test_rejects_an_unknown_cuisine(tmp_path):
    dataset = tmp_path / "mess.json"
    dataset.write_text(
        json.dumps(
            [
                {
                    "mess_id": "MS99",
                    "name": "Kaveri",
                    "capacity": 100,
                    "preference": "veg",
                    "cuisines": ["continental"],
                }
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(SystemExit, match="unknown cuisine"):
        load_catalogue(Path(dataset))


def test_rejects_a_preference_allocation_could_never_match(tmp_path):
    dataset = tmp_path / "mess.json"
    dataset.write_text(
        json.dumps(
            [
                {
                    "mess_id": "MS98",
                    "name": "Kaveri",
                    "capacity": 100,
                    "preference": "North Indian",
                    "cuisines": ["north_indian"],
                }
            ]
        ),
        encoding="utf-8",
    )

    # The stale "North Indian" vocabulary in models.py is exactly the mistake
    # this guard exists to catch: it is a cuisine, not a dietary preference.
    with pytest.raises(SystemExit, match="is not one of"):
        load_catalogue(Path(dataset))


def test_seeded_halls_land_in_the_collection_the_api_reads(catalogue):
    seed_mess(catalogue, log=quiet)

    # `GET /mess` is `list(mess_collection.find({}, {"_id": 0}))`, so this is what
    # the endpoint will serve. The auth path itself is covered by test_mess.py.
    served = list(mess_collection.find({}, {"_id": 0}))

    assert {hall["name"] for hall in served} == {"Himalaya", "Vindhya", "Nilgiri"}
    assert all("cuisines" in hall for hall in served)
