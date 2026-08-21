"""
``backfill_staff_names.py`` — giving pre-existing staff accounts a name.

Staff accounts had no name field until the audit trail needed one, so the trail
shows a fallback for every account created before it: the ``designation``, then the
local part of the email. This script fills in the real name where the database
already knows it, from the ``admin_id`` link first and a matching participant email
second.

What is being pinned down here is mostly what the script refuses to do. It does not
write a ``designation`` into ``name``, because that would turn a fallback into what
reads as a recorded fact. It does not overwrite a name somebody set deliberately.
And a second run does nothing, since a migration that is not safe to re-run is one
nobody can run confidently the first time.
"""
import os
import sys

import pytest
from bson import ObjectId

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from backfill_staff_names import backfill_staff_names
from database import backend_teams_collection, participants_collection


@pytest.fixture
def roster():
    """One staff account per case the backfill has to distinguish."""
    backend_teams_collection.delete_many({})
    participants_collection.delete_many({})

    linked_oid = ObjectId()
    participants_collection.insert_many([
        {"_id": linked_oid, "participant_id": "DS111111",
         "email": "111111@ds.study.iitm.ac.in", "profile": {"full_name": "Priya Raman"}},
        {"_id": ObjectId(), "participant_id": "DS222222",
         "email": "222222@ds.study.iitm.ac.in", "profile": {"full_name": "Arjun Kumar"}},
    ])

    backend_teams_collection.insert_many([
        # Linked through admin_id — the deliberate link, so the preferred source.
        {"paradox_id": "BT_LINKED", "email": "111111@ds.study.iitm.ac.in",
         "admin_id": linked_oid, "role": "super_admin", "designation": "Fest Head"},
        # No link, but a participant registered under the same email.
        {"paradox_id": "BT_EMAIL", "email": "222222@ds.study.iitm.ac.in",
         "role": "admin", "designation": "Mess Head"},
        # Staff only, never a participant: nothing in the database to draw on.
        {"paradox_id": "BT_NEITHER", "email": "ops@ds.study.iitm.ac.in",
         "role": "volunteer", "designation": "Block Volunteer"},
        # Named deliberately already.
        {"paradox_id": "BT_NAMED", "email": "sana@ds.study.iitm.ac.in",
         "name": "Sana M", "role": "admin", "designation": "Desk"},
    ])

    yield {"linked_oid": linked_oid}

    backend_teams_collection.delete_many({})
    participants_collection.delete_many({})


def name_of(paradox_id: str):
    return backend_teams_collection.find_one({"paradox_id": paradox_id}).get("name")


def test_prefers_the_admin_id_link(roster):
    backfill_staff_names(log=lambda *_: None)
    assert name_of("BT_LINKED") == "Priya Raman"


def test_falls_back_to_a_participant_with_the_same_email(roster):
    """Recovers the answer `POST /backend_teams` would derive, for older accounts."""
    backfill_staff_names(log=lambda *_: None)
    assert name_of("BT_EMAIL") == "Arjun Kumar"


def test_leaves_an_account_with_no_name_on_record_alone(roster):
    """
    The refusal that matters.

    "Block Volunteer" is a designation. Writing it into `name` would make the trail
    claim a person is called that, and the read path already shows it honestly as a
    fallback.
    """
    tally = backfill_staff_names(log=lambda *_: None)

    assert name_of("BT_NEITHER") is None
    assert tally["no_source"] == 1


def test_never_overwrites_a_name_somebody_set(roster):
    backfill_staff_names(log=lambda *_: None)
    assert name_of("BT_NAMED") == "Sana M"


def test_treats_a_blank_name_as_missing(roster):
    backend_teams_collection.insert_one({
        "paradox_id": "BT_BLANK", "email": "222222@ds.study.iitm.ac.in",
        "name": "   ", "role": "volunteer",
    })

    backfill_staff_names(log=lambda *_: None)
    assert name_of("BT_BLANK") == "Arjun Kumar"


def test_a_dry_run_reports_without_writing(roster):
    tally = backfill_staff_names(dry_run=True, log=lambda *_: None)

    assert tally == {"from_link": 1, "from_email": 1, "already_named": 1, "no_source": 1}
    assert name_of("BT_LINKED") is None
    assert name_of("BT_EMAIL") is None


def test_running_twice_changes_nothing_the_second_time(roster):
    first = backfill_staff_names(log=lambda *_: None)
    assert (first["from_link"], first["from_email"]) == (1, 1)

    second = backfill_staff_names(log=lambda *_: None)
    assert (second["from_link"], second["from_email"]) == (0, 0)
    # The two it named are now among the already-named, alongside the one that
    # arrived named.
    assert second["already_named"] == 3
    assert second["no_source"] == 1


def test_the_names_it_writes_are_what_the_trail_then_shows(roster):
    """
    The point of the exercise: `GET /audit-logs` resolves a staff actor by
    `name` first, so an account named here stops showing a designation.
    """
    from routers.audit import _display_names

    backfill_staff_names(log=lambda *_: None)

    resolved = _display_names(["BT_LINKED", "BT_EMAIL", "BT_NEITHER", "BT_NAMED"])
    assert resolved["BT_LINKED"] == "Priya Raman"
    assert resolved["BT_EMAIL"] == "Arjun Kumar"
    assert resolved["BT_NAMED"] == "Sana M"
    # Unchanged, and still readable rather than blank.
    assert resolved["BT_NEITHER"] == "Block Volunteer"
