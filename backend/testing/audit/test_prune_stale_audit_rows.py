"""
``prune_stale_audit_rows.py`` — clearing probe rows out of the trail.

The trail collects entries from probe scripts and manual API testing: a mess hall
created, staffed, and dropped inside one script run. Those rows can never be made
readable, because the hall and the accounts are all gone and no name was recorded
for any of them.

The tests that matter here are the ones about restraint. The script must not touch
rows whose *actor* is gone but whose *target* still exists — those are the record of
who created the events and workshops now in the catalogue, and they are the large
majority. A prune that took them would delete real provenance to tidy up a display
problem.
"""
import os
import sys
from datetime import datetime

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from database import (
    backend_teams_collection,
    event_collection,
    mess_collection,
    participants_collection,
    system_logs_collection,
    workshops_collection,
)
from prune_stale_audit_rows import find_stale, live_target_ids, prune_stale_audit_rows


@pytest.fixture
def trail():
    """A trail holding one row of each kind the script has to tell apart."""
    for collection in (
        system_logs_collection,
        event_collection,
        workshops_collection,
        mess_collection,
        backend_teams_collection,
        participants_collection,
    ):
        collection.delete_many({})

    # What still exists.
    event_collection.insert_one({"event_id": "EVT_LIVE", "name": "Last1Standing"})
    workshops_collection.insert_one({"workshop_id": "WKS_LIVE", "name": "Intro to ML"})
    mess_collection.insert_one({"mess_id": "MS01", "name": "Himalaya"})
    participants_collection.insert_one({
        "participant_id": "DS_LIVE", "email": "live@ds.study.iitm.ac.in",
        "profile": {"full_name": "Arjun Kumar"},
    })

    base = datetime(2026, 8, 20, 18, 0, 0)
    system_logs_collection.insert_many([
        # 1. Dead actor, live target: real provenance. Must survive.
        {"timestamp": base, "actor_id": "TEMPSEED0001", "action": "CREATE_EVENT",
         "target_id": "EVT_LIVE", "details": {}},
        {"timestamp": base, "actor_id": "TEMPSEED0001", "action": "CREATE_WORKSHOP",
         "target_id": "WKS_LIVE", "details": {}},
        # 2. Dead actor, dead target: a probe run. The rows to remove.
        {"timestamp": base, "actor_id": "BT413179sa", "action": "ASSIGN_MESS_TEAM",
         "target_id": "MESS_PROBE2_413179",
         "details": {"team_user_id": "BT413179v1", "role": "volunteer"}},
        {"timestamp": base, "actor_id": "SA683727", "action": "CREATE_MESS",
         "target_id": "MESS_VOL_683727", "details": {}},
        # 3. Live actor, dead target: still a probe, still removable.
        {"timestamp": base, "actor_id": "SA_LIVE", "action": "CREATE_MESS",
         "target_id": "ZZ_MS", "details": {}},
        # 4. No target at all: never a candidate, nothing to check it against.
        {"timestamp": base, "actor_id": "SA_LIVE", "action": "ALLOCATE_MESSES",
         "target_id": None, "details": {"allocated_count": 412}},
        # 5. A person as the target, which is what UPDATE_PARTICIPANT records.
        {"timestamp": base, "actor_id": "SA_LIVE", "action": "UPDATE_PARTICIPANT",
         "target_id": "DS_LIVE", "details": {"fields_updated": ["house"]}},
    ])
    backend_teams_collection.insert_one({
        "paradox_id": "SA_LIVE", "email": "sa@ds.study.iitm.ac.in", "name": "Priya Raman",
        "role": "super_admin",
    })

    yield

    for collection in (
        system_logs_collection,
        event_collection,
        workshops_collection,
        mess_collection,
        backend_teams_collection,
        participants_collection,
    ):
        collection.delete_many({})


def surviving_targets() -> set:
    return {log.get("target_id") for log in system_logs_collection.find({})}


def test_finds_only_the_rows_whose_target_is_gone(trail):
    stale = find_stale()
    assert {row["target_id"] for row in stale} == {
        "MESS_PROBE2_413179", "MESS_VOL_683727", "ZZ_MS"
    }


def test_spares_a_row_whose_actor_is_gone_but_whose_target_lives(trail):
    """
    The restraint that matters most.

    `TEMPSEED0001` no longer exists, so these rows read as a code — but they are the
    only record of where the event and workshop catalogue came from.
    """
    prune_stale_audit_rows(confirm=True, log=lambda *_: None)

    remaining = surviving_targets()
    assert "EVT_LIVE" in remaining
    assert "WKS_LIVE" in remaining


def test_spares_a_row_with_no_target(trail):
    prune_stale_audit_rows(confirm=True, log=lambda *_: None)
    assert None in surviving_targets()


def test_spares_a_row_whose_target_is_a_person(trail):
    """`UPDATE_PARTICIPANT` targets a participant, not a venue."""
    prune_stale_audit_rows(confirm=True, log=lambda *_: None)
    assert "DS_LIVE" in surviving_targets()


def test_removes_a_probe_row_even_when_the_actor_still_exists(trail):
    prune_stale_audit_rows(confirm=True, log=lambda *_: None)
    assert "ZZ_MS" not in surviving_targets()


def test_reports_without_deleting_unless_confirmed(trail):
    before = system_logs_collection.count_documents({})

    tally = prune_stale_audit_rows(log=lambda *_: None)

    assert tally["stale"] == 3
    assert tally["deleted"] == 0
    assert system_logs_collection.count_documents({}) == before


def test_confirming_deletes_exactly_the_reported_rows(trail):
    before = system_logs_collection.count_documents({})

    tally = prune_stale_audit_rows(confirm=True, log=lambda *_: None)

    assert tally["deleted"] == 3
    assert system_logs_collection.count_documents({}) == before - 3


def test_counts_the_provenance_rows_it_is_leaving_behind(trail):
    """Reported so the operator can see the script chose not to touch them."""
    tally = prune_stale_audit_rows(log=lambda *_: None)
    assert tally["kept_dead_actor"] == 2


def test_running_twice_finds_nothing_the_second_time(trail):
    prune_stale_audit_rows(confirm=True, log=lambda *_: None)

    again = prune_stale_audit_rows(confirm=True, log=lambda *_: None)
    assert again["stale"] == 0
    assert again["deleted"] == 0


def test_a_person_counts_as_a_live_target(trail):
    live = live_target_ids()
    assert "DS_LIVE" in live
    assert "SA_LIVE" in live
    assert "MESS_PROBE2_413179" not in live
