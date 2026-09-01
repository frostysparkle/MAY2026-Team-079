"""
Task 1 / Task 2 self-tests: proof the harness itself is sound.

If any of these fail, every other result in the suite is suspect — a test that
passes against a real database, or against state left behind by its predecessor,
is not evidence of anything.
"""
import json

import mongomock
import pytest

import database
import security
from testing import factories
from testing.helpers import auth_headers, encrypt_for, make_qr, token_for


# ---------------------------------------------------------------------------
# The database is mongomock, not a live mongod
# ---------------------------------------------------------------------------

def test_database_client_is_mongomock():
    assert isinstance(database.client, mongomock.MongoClient)


@pytest.fixture(scope="module")
def openapi_paths(app):
    """
    The route table read from the generated schema rather than ``app.routes``.

    This FastAPI version keeps included routers as ``_IncludedRouter`` wrappers
    instead of flattening them onto ``app.routes``, so walking that list finds
    only the endpoint declared in ``main.py``. Generating the schema also proves
    every route's models are serialisable.
    """
    return app.openapi()["paths"]


def test_app_exposes_the_whole_api(openapi_paths):
    paths = set(openapi_paths)
    # Spot-check one path per router plus the endpoint that lives in main.py, so
    # a router silently dropped from `main.include_router` is caught here.
    for path in (
        "/profile/complete",
        "/auth/register",
        "/backend_teams",
        "/participants/statistics",
        "/workshops",
        "/workshop-slots",
        "/events",
        "/mess",
        "/hostels",
        "/audit-logs",
        "/embeddings",
        "/queries",
        "/issues",
    ):
        assert path in paths, f"{path} is not registered"


def test_route_count_is_stable(openapi_paths):
    # A floor, not an exact figure: it catches a whole router going missing
    # without failing every time somebody adds an endpoint.
    operations = sum(len(methods) for methods in openapi_paths.values())
    assert operations >= 90, f"only {operations} operations registered"


# ---------------------------------------------------------------------------
# Isolation between tests
# ---------------------------------------------------------------------------

def test_isolation_first_writes_a_document():
    database.participants_collection.insert_one({"participant_id": "LEAK"})
    assert database.participants_collection.count_documents({}) == 1


def test_isolation_second_sees_an_empty_collection():
    assert database.participants_collection.count_documents({}) == 0


def test_isolation_covers_indexes_not_just_documents():
    """
    `enforce_identity_indexes` creates unique indexes, and mongomock keeps them for
    the life of the client — so a test that ran the migration would otherwise make
    every later test that seeds a deliberate duplicate fail.
    """
    database.participants_collection.create_index("email", unique=True, name="leaky")
    assert "leaky" in database.participants_collection.index_information()


def test_no_index_survives_from_the_previous_test():
    # A freshly wiped collection reports either nothing at all or just `_id_`,
    # depending on whether mongomock has materialised it yet. Neither may contain the
    # index the previous test created.
    assert set(database.participants_collection.index_information()) <= {"_id_"}


def test_generators_are_reset_between_tests():
    from routers import backend_teams, events, hostels, workshops

    assert workshops.generator.current_id == 111
    assert hostels.generator.current_id == 111
    assert events.generator.current_event_id == 1111
    assert backend_teams.generator.current_id == 1111


def test_generators_are_reset_again_after_being_advanced():
    from routers import workshops

    workshops.generator.next_id()
    assert workshops.generator.current_id == 112
    # The autouse fixture puts it back for the next test; the assertion in
    # `test_generators_are_reset_between_tests` above is what proves it.


# ---------------------------------------------------------------------------
# Unauthenticated reads work without a token
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("path", ["/workshop-slots", "/workshops/public", "/events/public"])
def test_public_endpoints_need_no_token(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.json() == []


# ---------------------------------------------------------------------------
# Task 2: factories and helpers
# ---------------------------------------------------------------------------

def test_participant_factory_matches_registration_shape(make_participant):
    doc = make_participant()
    # The keys `POST /auth/register` writes (auth.py:51-101).
    for key in (
        "participant_id", "email", "password_hash", "profile", "mess",
        "accommodation", "photo", "qr_secrets", "embedding", "events",
        "workshops", "created_at", "updated_at",
    ):
        assert key in doc
    assert set(doc["mess"]) == {"registered", "mess_id", "scans", "payment"}
    assert set(doc["accommodation"]) == {
        "registered", "hostel_id", "room", "arrival", "inside", "departure", "payment",
    }
    assert len(doc["embedding"]["workshop"]) == 2048


def test_participant_factory_deep_merges_overrides(make_participant):
    doc = make_participant(profile={"house": "Gir"})
    assert doc["profile"]["house"] == "Gir"
    # Everything else in `profile` survives, which is the point of the merge.
    assert doc["profile"]["full_name"] == "Test Participant"
    assert doc["profile"]["program"] == "DS"


def test_id_type_asymmetry_is_encoded_in_the_factories():
    """
    The trap documented in factories.py: a mess link is an ObjectId, a hostel
    link is a string. Getting this wrong makes every scan and statistics query
    return nothing while the test still looks reasonable.
    """
    mess = factories.mess_doc()
    database.mess_collection.insert_one(mess)
    hostel = factories.hostel_doc()
    database.hostel_collection.insert_one(hostel)

    seated = factories.participant_doc(mess={"mess_id": mess["_id"], "registered": True})
    housed = factories.participant_doc(accommodation={"hostel_id": hostel["hostel_id"]})

    assert not isinstance(seated["mess"]["mess_id"], str)
    assert isinstance(housed["accommodation"]["hostel_id"], str)

    database.participants_collection.insert_many([seated, housed])
    assert database.participants_collection.count_documents({"mess.mess_id": mess["_id"]}) == 1
    assert database.participants_collection.count_documents(
        {"accommodation.hostel_id": "HSTL111"}
    ) == 1


def test_token_for_picks_the_namespace_from_the_document(participant, super_admin):
    from jose import jwt

    participant_claims = jwt.decode(
        token_for(participant), security.SECRET_KEY, algorithms=[security.ALGORITHM]
    )
    staff_claims = jwt.decode(
        token_for(super_admin), security.SECRET_KEY, algorithms=[security.ALGORITHM]
    )
    assert participant_claims["type"] == "participant"
    assert participant_claims["sub"] == participant["participant_id"]
    assert staff_claims["type"] == "staff"
    assert staff_claims["sub"] == super_admin["paradox_id"]


def test_real_token_passes_the_real_dependency_chain(client, participant):
    """No dependency override anywhere: this exercises `get_current_participant`
    against a genuine JWT and a genuine seeded document."""
    response = client.get("/workshops/my_registrations", headers=auth_headers(participant))
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.slow
def test_password_hash_is_real_bcrypt(password, password_hash):
    assert password_hash.startswith("$2b$")
    assert security.verify_password(password, password_hash)
    assert not security.verify_password("wrong-password", password_hash)


@pytest.mark.slow
def test_qr_payload_round_trips_through_real_rsa(participant, keypair):
    """`make_qr` is the client half of `security.decrypt_qr_data`, not a stub."""
    request = make_qr(participant, payload={"participant_id": participant["participant_id"]})
    decrypted = security.decrypt_qr_data(keypair[0], request["data"])
    assert decrypted == {"participant_id": participant["participant_id"]}


@pytest.mark.slow
def test_qr_payload_from_another_keypair_cannot_be_decrypted(keypair, alt_keypair):
    ciphertext = encrypt_for(alt_keypair[1], {"participant_id": "DS23F000001"})
    with pytest.raises(Exception):
        security.decrypt_qr_data(keypair[0], ciphertext)


def test_mess_menu_factory_writes_real_datetimes():
    from datetime import datetime

    menu = factories.mess_menu({1: ["breakfast", "lunch"]})
    slot = menu["day_1"]["breakfast"]
    assert isinstance(slot["start_time"], datetime)
    assert isinstance(slot["end_time"], datetime)
    assert slot["end_time"] > slot["start_time"]
    assert set(menu["day_1"]) == {"breakfast", "lunch"}


def test_announcement_factory_uses_datetime_not_string():
    from datetime import datetime

    assert isinstance(factories.announcement()["created_at"], datetime)


def test_audit_row_factory_matches_logger_shape():
    row = factories.mess_scan_row(day=2, slot="lunch")
    assert set(row) == {
        "timestamp", "actor_id", "actor_name", "actor_type", "actor_role",
        "action", "target_id", "details",
    }
    assert row["action"] == "MESS_SCAN"
    assert row["details"] == {"participant_id": "DS23F000001", "slot": "lunch", "day": 2}
    # Serialisable as JSON once the timestamp is stringified, i.e. no ObjectIds.
    json.dumps({k: v for k, v in row.items() if k != "timestamp"})
