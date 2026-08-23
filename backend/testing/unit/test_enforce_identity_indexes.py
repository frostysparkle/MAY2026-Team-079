"""
Unit tests for backend/enforce_identity_indexes.py.

The script is the only thing in this codebase that would touch a live database, so it
is tested entirely against mongomock and the report half is asserted to change nothing.
It is never run against a real instance from a test.
"""
import pytest

import database
from enforce_identity_indexes import (
    IDENTITY_FIELDS,
    create_indexes,
    find_duplicates,
    missing_field_count,
    survey,
)
from testing import factories


def insert_participants(*emails, id_prefix="DS23F0000"):
    for index, email in enumerate(emails, start=1):
        database.participants_collection.insert_one(
            factories.participant_doc(participant_id=f"{id_prefix}{index:02d}", email=email)
        )


# ---------------------------------------------------------------------------
# The three fields that are identity
# ---------------------------------------------------------------------------

def test_the_indexed_fields_are_the_ones_every_join_uses():
    covered = {(collection.name, field) for collection, field, _ in IDENTITY_FIELDS}
    assert covered == {
        ("participants", "email"),
        ("participants", "participant_id"),
        ("backend_teams", "paradox_id"),
    }


def test_each_index_has_a_distinct_name():
    names = [name for _, _, name in IDENTITY_FIELDS]
    assert len(names) == len(set(names))


# ---------------------------------------------------------------------------
# find_duplicates
# ---------------------------------------------------------------------------

def test_a_clean_collection_has_no_duplicates():
    insert_participants("a@ds.study.iitm.ac.in", "b@ds.study.iitm.ac.in")
    assert find_duplicates(database.participants_collection, "email") == {}


def test_two_documents_sharing_an_address_are_reported():
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")
    assert find_duplicates(database.participants_collection, "email") == {
        "a@ds.study.iitm.ac.in": 2,
    }


def test_addresses_are_compared_case_insensitively():
    """
    The identity rule the application now applies: two casings are one person, so two
    documents holding them are duplicates even though a naive index on the raw string
    would accept both.
    """
    insert_participants("A@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")
    assert find_duplicates(database.participants_collection, "email") == {
        "a@ds.study.iitm.ac.in": 2,
    }


def test_participant_ids_are_compared_exactly():
    """Unlike email — a participant_id is already canonical, uppercased at derivation."""
    database.participants_collection.insert_many([
        factories.participant_doc(participant_id="DS23F000001", email="a@x.com"),
        factories.participant_doc(participant_id="ds23f000001", email="b@x.com"),
    ])
    assert find_duplicates(database.participants_collection, "participant_id") == {}


def test_duplicate_staff_ids_are_reported():
    database.backend_teams_collection.insert_many([
        factories.staff_doc(paradox_id="SAWO1111", email="a@x.com"),
        factories.staff_doc(paradox_id="SAWO1111", email="b@x.com"),
    ])
    assert find_duplicates(database.backend_teams_collection, "paradox_id") == {"SAWO1111": 2}


def test_three_documents_sharing_a_value_report_a_count_of_three():
    insert_participants(*["a@ds.study.iitm.ac.in"] * 3)
    assert find_duplicates(database.participants_collection, "email")[
        "a@ds.study.iitm.ac.in"
    ] == 3


def test_null_values_are_not_counted_as_duplicates():
    """They are reported separately, because they block an index for a different
    reason."""
    database.participants_collection.insert_many([
        factories.participant_doc(participant_id="DS23F000001", email=None),
        factories.participant_doc(participant_id="DS23F000002", email=None),
    ])
    assert find_duplicates(database.participants_collection, "email") == {}


def test_an_empty_collection_has_no_duplicates():
    assert find_duplicates(database.participants_collection, "email") == {}


# ---------------------------------------------------------------------------
# missing_field_count
# ---------------------------------------------------------------------------

def test_documents_missing_the_field_are_counted():
    """A unique index permits at most one document missing an indexed field, so
    several is its own blocker."""
    database.participants_collection.insert_one({"participant_id": "DS23F000001"})
    database.participants_collection.insert_one({"participant_id": "DS23F000002"})
    assert missing_field_count(database.participants_collection, "email") == 2


def test_explicit_nulls_count_as_missing():
    database.participants_collection.insert_one(
        factories.participant_doc(participant_id="DS23F000001", email=None)
    )
    assert missing_field_count(database.participants_collection, "email") == 1


def test_a_populated_field_counts_as_nothing_missing():
    insert_participants("a@ds.study.iitm.ac.in")
    assert missing_field_count(database.participants_collection, "email") == 0


# ---------------------------------------------------------------------------
# survey — the read-only report
# ---------------------------------------------------------------------------

def test_the_survey_covers_every_identity_field():
    findings = survey()
    assert [(f["collection"], f["field"]) for f in findings] == [
        ("participants", "email"),
        ("participants", "participant_id"),
        ("backend_teams", "paradox_id"),
    ]


def test_the_survey_reports_counts_and_the_offending_values():
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")
    email_finding = next(f for f in survey() if f["field"] == "email")
    assert email_finding["documents"] == 2
    assert email_finding["affected_documents"] == 2
    assert email_finding["duplicates"] == {"a@ds.study.iitm.ac.in": 2}


def test_the_survey_writes_nothing():
    """The whole point of report-by-default: it can be pointed at a real database."""
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")
    before = list(database.participants_collection.find({}))
    survey()
    assert list(database.participants_collection.find({})) == before
    assert "uniq_participants_email" not in database.participants_collection.index_information()


def test_the_survey_reports_a_clean_database_as_clean():
    insert_participants("a@ds.study.iitm.ac.in", "b@ds.study.iitm.ac.in")
    assert all(not f["duplicates"] for f in survey())


# ---------------------------------------------------------------------------
# create_indexes
# ---------------------------------------------------------------------------

def test_indexes_are_created_on_a_clean_database():
    insert_participants("a@ds.study.iitm.ac.in")
    results = create_indexes(log=lambda *_: None)
    assert {r["status"] for r in results} == {"created"}
    assert "uniq_participants_email" in database.participants_collection.index_information()
    assert "uniq_backend_teams_paradox_id" in database.backend_teams_collection.index_information()


def test_a_created_index_actually_refuses_a_duplicate():
    insert_participants("a@ds.study.iitm.ac.in")
    create_indexes(log=lambda *_: None)

    from pymongo.errors import DuplicateKeyError

    with pytest.raises(DuplicateKeyError):
        database.participants_collection.insert_one(
            factories.participant_doc(participant_id="DS23F999999",
                                      email="a@ds.study.iitm.ac.in")
        )


def test_a_duplicate_participant_id_is_refused_once_indexed():
    insert_participants("a@ds.study.iitm.ac.in")
    create_indexes(log=lambda *_: None)

    from pymongo.errors import DuplicateKeyError

    with pytest.raises(DuplicateKeyError):
        database.participants_collection.insert_one(
            factories.participant_doc(participant_id="DS23F000001", email="unique@x.com")
        )


def test_running_twice_is_safe_and_says_so():
    """The same invocation has to serve a local database now and Atlas at deploy
    time, so it must be idempotent."""
    insert_participants("a@ds.study.iitm.ac.in")
    create_indexes(log=lambda *_: None)
    second = create_indexes(log=lambda *_: None)
    assert {r["status"] for r in second} == {"existed"}


def test_existing_duplicates_block_only_the_field_they_affect():
    """
    Each index is attempted independently, so one blocked field must not stop the
    others being enforced.
    """
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")
    results = {r["index"]: r["status"] for r in create_indexes(log=lambda *_: None)}
    assert results["uniq_participants_email"] == "blocked"
    assert results["uniq_backend_teams_paradox_id"] == "created"


def test_a_blocked_index_reports_why():
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")
    blocked = next(r for r in create_indexes(log=lambda *_: None)
                   if r["index"] == "uniq_participants_email")
    assert "error" in blocked
    assert "uniq_participants_email" not in \
        database.participants_collection.index_information()


def test_a_blocked_index_deletes_nothing():
    """It refuses to enforce the constraint; it never resolves it by removing data."""
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")
    create_indexes(log=lambda *_: None)
    assert database.participants_collection.count_documents({}) == 2


# ---------------------------------------------------------------------------
# End to end against the endpoint the index protects
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_registration_still_works_with_the_indexes_in_place(client, password):
    """The constraint must not break the ordinary path it exists to protect."""
    create_indexes(log=lambda *_: None)
    response = client.post("/auth/register", json={
        "email": "23f100001@ds.study.iitm.ac.in", "password": password,
    })
    assert response.status_code == 200


@pytest.mark.slow
def test_the_index_is_the_backstop_behind_the_duplicate_check(client, password):
    """
    The application check answers 400 first, so the index never fires in normal use —
    it is there for the race the application check cannot close, where two
    simultaneous registrations both pass the "is this taken" read.
    """
    create_indexes(log=lambda *_: None)
    payload = {"email": "23f100001@ds.study.iitm.ac.in", "password": password}
    assert client.post("/auth/register", json=payload).status_code == 200

    second = client.post("/auth/register", json=payload)
    assert second.status_code == 400
    assert second.json()["detail"] == "Email already registered"
    assert database.participants_collection.count_documents({}) == 1


# ---------------------------------------------------------------------------
# The command line
#
# Which mode the script runs in is the whole safety story: a `--confirm` that
# was misread as present would write to a database somebody only asked for a
# report on. Both branches are asserted against the indexes actually present
# afterwards rather than against what the script printed.
# ---------------------------------------------------------------------------

def run_cli(monkeypatch, *argv):
    import enforce_identity_indexes as script

    monkeypatch.setattr("sys.argv", ["enforce_identity_indexes.py", *argv])
    return script.main()


def index_names(collection=None):
    collection = collection or database.participants_collection
    return set(collection.index_information())


def test_the_report_is_the_default_and_creates_nothing(monkeypatch, capsys):
    insert_participants("a@ds.study.iitm.ac.in")
    before = index_names()

    assert run_cli(monkeypatch) == 0

    assert index_names() == before
    assert "Nothing was changed." in capsys.readouterr().out


def test_the_report_names_the_duplicates_holding_an_index_back(monkeypatch, capsys):
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")

    assert run_cli(monkeypatch) == 0

    out = capsys.readouterr().out
    assert "a@ds.study.iitm.ac.in" in out
    assert "held by 2 documents" in out
    assert "cannot be indexed until the duplicates above are resolved" in out


def test_a_clean_report_says_what_to_run_next(monkeypatch, capsys):
    insert_participants("a@ds.study.iitm.ac.in")

    run_cli(monkeypatch)

    assert "Re-run with --confirm" in capsys.readouterr().out


def test_confirm_creates_the_indexes(monkeypatch, capsys):
    insert_participants("a@ds.study.iitm.ac.in")

    assert run_cli(monkeypatch, "--confirm") == 0

    assert "uniq_participants_email" in index_names()
    assert "uniq_backend_teams_paradox_id" in index_names(database.backend_teams_collection)
    assert "created" in capsys.readouterr().out


def test_confirm_reports_a_blocked_field_without_failing(monkeypatch, capsys):
    """One field it cannot enforce is not a reason to exit non-zero — the other
    fields were enforced and the operator needs to see which."""
    insert_participants("a@ds.study.iitm.ac.in", "a@ds.study.iitm.ac.in")

    assert run_cli(monkeypatch, "--confirm") == 0

    assert "blocked" in capsys.readouterr().out
    assert "uniq_participants_email" not in index_names()
    assert database.participants_collection.count_documents({}) == 2
