"""
Endpoint tests for /auth.

Registration is the most expensive call in the application — one bcrypt hash plus
one RSA-2048 keypair — and it is exercised for real here rather than stubbed,
which is why several tests carry the `slow` marker. Everything that only needs an
*existing* account uses the seeded fixtures instead, whose crypto material is
generated once per session.
"""
import pytest
from jose import jwt

import database
import security
from routers.auth import generate_participant_id
from testing.helpers import auth_headers

REGISTRATION = {"email": "23f100001@ds.study.iitm.ac.in", "password": "longenough1"}


# ---------------------------------------------------------------------------
# generate_participant_id
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "email,expected",
    [
        ("23f3001726@ds.study.iitm.ac.in", "DS23F3001726"),
        ("23F3001726@DS.study.iitm.ac.in", "DS23F3001726"),
        ("21f1000999@ms.study.iitm.ac.in", "MS21F1000999"),
        ("22f2000111@ae.study.iitm.ac.in", "AE22F2000111"),
        ("24f4000222@es.study.iitm.ac.in", "ES24F4000222"),
    ],
)
def test_the_id_is_program_then_roll_number(email, expected):
    assert generate_participant_id(email) == expected


@pytest.mark.parametrize(
    "email,expected",
    [
        ("someone@gmail.com", "SOMEONE"),
        ("a.b+tag@example.org", "A.B+TAG"),
        ("nested@a.b.study.iitm.ac.in", "NESTED"),
    ],
)
def test_a_non_matching_address_falls_back_to_the_local_part(email, expected):
    """Unreachable through `POST /auth/register`, which rejects the domain first,
    but the branch exists and is directly testable."""
    assert generate_participant_id(email) == expected


# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_registration_returns_the_derived_id(client):
    response = client.post("/auth/register", json=REGISTRATION)
    assert response.status_code == 200
    assert response.json() == {
        "message": "Registration successful",
        "participant_id": "DS23F100001",
    }


@pytest.mark.slow
def test_registration_writes_the_documented_document(client):
    client.post("/auth/register", json=REGISTRATION)
    document = database.participants_collection.find_one({"email": REGISTRATION["email"]})

    assert document["profile"] == {}
    assert document["mess"] == {
        "registered": False, "mess_id": None, "scans": {}, "payment": None,
    }
    assert document["accommodation"] == {
        "registered": False, "hostel_id": None, "room": None, "arrival": None,
        "inside": False, "departure": None, "payment": None,
    }
    assert document["events"] == [] and document["workshops"] == []
    assert document["photo"] is None
    assert len(document["embedding"]["workshop"]) == 768
    assert len(document["embedding"]["event"]) == 768
    assert document["created_at"] and document["updated_at"]


@pytest.mark.slow
def test_registration_stores_a_bcrypt_hash_and_never_the_password(client):
    client.post("/auth/register", json=REGISTRATION)
    document = database.participants_collection.find_one({"email": REGISTRATION["email"]})
    assert document["password_hash"].startswith("$2b$")
    assert REGISTRATION["password"] not in str(document)
    assert security.verify_password(REGISTRATION["password"], document["password_hash"])


@pytest.mark.slow
def test_registration_generates_a_usable_keypair(client):
    client.post("/auth/register", json=REGISTRATION)
    document = database.participants_collection.find_one({"email": REGISTRATION["email"]})
    secrets = document["qr_secrets"]
    assert secrets["private_key"].startswith("-----BEGIN PRIVATE KEY-----")
    assert secrets["public_key"].startswith("-----BEGIN PUBLIC KEY-----")

    from testing.helpers import encrypt_for

    assert security.decrypt_qr_data(
        secrets["private_key"], encrypt_for(secrets["public_key"], {"ok": True})
    ) == {"ok": True}


@pytest.mark.slow
def test_two_registrations_get_different_keypairs(client):
    client.post("/auth/register", json=REGISTRATION)
    client.post("/auth/register", json={**REGISTRATION, "email": "23f100002@ds.study.iitm.ac.in"})
    keys = {
        d["qr_secrets"]["private_key"]
        for d in database.participants_collection.find({})
    }
    assert len(keys) == 2


@pytest.mark.parametrize(
    "email",
    [
        "someone@gmail.com",
        "someone@iitm.ac.in",
        "someone@ds.study.iitm.ac.in.evil.com",
        "someone@DS.STUDY.IITM.AC.IN.co",
        "someone@a.b.study.iitm.ac.in",
    ],
)
def test_a_non_iitm_address_is_refused(client, email):
    response = client.post("/auth/register", json={**REGISTRATION, "email": email})
    assert response.status_code == 400
    assert response.json()["detail"] == "Must be an @*.study.iitm.ac.in email"
    assert database.participants_collection.count_documents({}) == 0


def test_an_uppercase_domain_is_accepted_because_the_check_lowercases(client):
    """`re.match` runs against `email.lower()`, so casing in the domain is fine."""
    response = client.post("/auth/register", json={
        "email": "23f100003@DS.Study.Iitm.Ac.In", "password": "longenough1",
    })
    assert response.status_code == 200


@pytest.mark.parametrize("password", ["", "short", "1234567"])
def test_a_short_password_is_a_422(client, password):
    assert client.post("/auth/register", json={**REGISTRATION, "password": password}).status_code == 422


@pytest.mark.parametrize("email", ["not-an-email", "", "a@"])
def test_a_malformed_email_is_a_422(client, email):
    assert client.post("/auth/register", json={**REGISTRATION, "email": email}).status_code == 422


def test_a_missing_field_is_a_422(client):
    assert client.post("/auth/register", json={"email": REGISTRATION["email"]}).status_code == 422


def test_an_email_already_in_participants_is_refused(client, participant):
    response = client.post("/auth/register", json={
        "email": participant["email"], "password": "longenough1",
    })
    assert response.status_code == 400
    assert response.json()["detail"] == "Email already registered"


def test_an_email_already_in_backend_teams_is_refused(client, make_staff):
    """The two collections share one email namespace, so a staff address cannot
    be re-used to open a participant account."""
    staff = make_staff(email="23f100001@ds.study.iitm.ac.in", paradox_id="OTHO1111", role="other")
    response = client.post("/auth/register", json={
        "email": staff["email"], "password": "longenough1",
    })
    assert response.status_code == 400
    assert response.json()["detail"] == "Email already registered"


@pytest.mark.slow
@pytest.mark.xfail(
    strict=False,
    reason="KNOWN DEFECT: the domain check lowercases but the duplicate check "
           "compares `request.email` verbatim, so two accounts can be created for "
           "the same address in different cases. Both derive the same "
           "participant_id, and there is no unique index on either field, so every "
           "subsequent lookup by participant_id is ambiguous.",
)
def test_the_same_address_in_a_different_case_is_a_duplicate(client):
    assert client.post("/auth/register", json=REGISTRATION).status_code == 200
    second = client.post("/auth/register", json={
        **REGISTRATION, "email": REGISTRATION["email"].upper().replace("@DS", "@ds"),
    })
    assert second.status_code == 400


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------

def test_login_returns_a_flattened_profile_and_a_working_token(client, participant, password):
    response = client.post("/auth/login", json={
        "email": participant["email"], "password": password,
    })
    assert response.status_code == 200
    body = response.json()

    assert body["id"] == participant["participant_id"]
    assert body["email"] == participant["email"]
    assert body["token_type"] == "participant"
    assert body["full_name"] == participant["profile"]["full_name"]
    assert body["house"] == participant["profile"]["house"]
    assert body["public_key"] == participant["qr_secrets"]["public_key"]

    claims = jwt.decode(body["access_token"], security.SECRET_KEY,
                        algorithms=[security.ALGORITHM])
    assert claims == {"sub": participant["participant_id"], "type": "participant",
                      "exp": claims["exp"]}


def test_login_never_returns_a_credential(client, participant, password):
    body = client.post("/auth/login", json={
        "email": participant["email"], "password": password,
    }).json()
    assert "password_hash" not in body
    assert "private_key" not in str(body)


def test_login_response_carries_exactly_the_documented_keys(client, participant, password):
    body = client.post("/auth/login", json={
        "email": participant["email"], "password": password,
    }).json()
    assert set(body) == {
        "id", "email", "access_token", "token_type", "full_name", "dob", "house",
        "gender", "phone", "country", "state", "city", "address", "program",
        "course_stage", "photo", "public_key",
    }


def test_login_stamps_updated_at(client, participant, password):
    before = participant["updated_at"]
    client.post("/auth/login", json={"email": participant["email"], "password": password})
    after = database.participants_collection.find_one({"_id": participant["_id"]})["updated_at"]
    assert after >= before


def test_login_with_the_wrong_password_is_401(client, participant):
    response = client.post("/auth/login", json={
        "email": participant["email"], "password": "not-the-password",
    })
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_login_for_an_unknown_email_is_401_with_the_same_message(client):
    """Identical to the wrong-password message, so the endpoint does not
    enumerate registered addresses."""
    response = client.post("/auth/login", json={
        "email": "nobody@ds.study.iitm.ac.in", "password": "longenough1",
    })
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_login_is_case_sensitive_on_the_email(client, participant, password):
    response = client.post("/auth/login", json={
        "email": participant["email"].upper(), "password": password,
    })
    assert response.status_code == 401


def test_a_staff_address_cannot_log_in_as_a_participant(client, super_admin, password):
    response = client.post("/auth/login", json={
        "email": super_admin["email"], "password": password,
    })
    assert response.status_code == 401


def test_a_profile_less_account_logs_in_with_null_profile_fields(client, make_participant, password):
    """A freshly registered account has `profile: {}` until
    `PATCH /profile/complete` runs; login must still work."""
    person = make_participant(email="23f100009@ds.study.iitm.ac.in",
                             participant_id="DS23F100009", profile={})
    body = client.post("/auth/login", json={"email": person["email"], "password": password}).json()
    assert body["full_name"] is None
    assert body["program"] is None


def test_an_account_with_no_password_hash_is_401_not_500(client, make_participant):
    """
    Reachable for any account whose document was written by something other than
    `POST /auth/register`. Such an account cannot log in — but it must fail on
    credentials, not crash.
    """
    person = make_participant(email="23f100010@ds.study.iitm.ac.in",
                              participant_id="DS23F100010")
    database.participants_collection.update_one(
        {"_id": person["_id"]}, {"$unset": {"password_hash": ""}}
    )
    response = client.post("/auth/login", json={
        "email": person["email"], "password": "longenough1",
    })
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_a_staff_account_with_no_password_hash_is_also_401(client, make_staff):
    staff = make_staff(paradox_id="OTHO1111", email="broken@ds.study.iitm.ac.in", role="other")
    database.backend_teams_collection.update_one(
        {"_id": staff["_id"]}, {"$unset": {"password_hash": ""}}
    )
    response = client.post("/auth/admin/login", json={
        "email": staff["email"], "password": "longenough1",
    })
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_changing_the_password_of_a_hashless_account_is_400_not_500(
    client, make_participant
):
    """The third caller of `verify_password`, and the same reasoning applies."""
    person = make_participant(email="23f100011@ds.study.iitm.ac.in",
                              participant_id="DS23F100011")
    database.participants_collection.update_one(
        {"_id": person["_id"]}, {"$unset": {"password_hash": ""}}
    )
    response = client.post("/auth/password/change",
                           json={"current_password": "anything",
                                 "new_password": "a-brand-new-password"},
                           headers=auth_headers(person))
    assert response.status_code == 400
    assert response.json()["detail"] == "Incorrect current password"


# ---------------------------------------------------------------------------
# POST /auth/admin/login
# ---------------------------------------------------------------------------

def test_admin_login_returns_the_staff_shape(client, super_admin, password):
    response = client.post("/auth/admin/login", json={
        "email": super_admin["email"], "password": password,
    })
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "id", "email", "access_token", "token_type", "role", "department", "designation",
    }
    assert body["id"] == super_admin["paradox_id"]
    assert body["token_type"] == "staff"
    assert body["role"] == "super_admin"
    assert body["department"] == "workshops"


def test_admin_login_mints_a_staff_token(client, super_admin, password):
    body = client.post("/auth/admin/login", json={
        "email": super_admin["email"], "password": password,
    }).json()
    claims = jwt.decode(body["access_token"], security.SECRET_KEY,
                        algorithms=[security.ALGORITHM])
    assert claims["type"] == "staff"
    assert claims["sub"] == super_admin["paradox_id"]


def test_the_staff_token_actually_opens_a_staff_route(client, super_admin, password):
    token = client.post("/auth/admin/login", json={
        "email": super_admin["email"], "password": password,
    }).json()["access_token"]
    assert client.get("/participants/statistics",
                      headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_admin_login_stamps_updated_at(client, super_admin, password):
    client.post("/auth/admin/login", json={"email": super_admin["email"], "password": password})
    after = database.backend_teams_collection.find_one({"_id": super_admin["_id"]})
    assert after["updated_at"] >= super_admin["updated_at"]


def test_a_participant_cannot_use_the_admin_login(client, participant, password):
    response = client.post("/auth/admin/login", json={
        "email": participant["email"], "password": password,
    })
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_admin_login_with_the_wrong_password_is_401(client, super_admin):
    response = client.post("/auth/admin/login", json={
        "email": super_admin["email"], "password": "wrong-password",
    })
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Password reset stubs
# ---------------------------------------------------------------------------

def test_forgot_password_is_a_non_enumerating_stub(client, participant):
    known = client.post("/auth/password/forgot", json={"email": participant["email"]})
    unknown = client.post("/auth/password/forgot", json={"email": "nobody@ds.study.iitm.ac.in"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert known.json()["message"] == "If the account exists, a reset link has been sent."
    assert "dev_reset_url" in known.json()


def test_forgot_password_writes_nothing(client, participant):
    client.post("/auth/password/forgot", json={"email": participant["email"]})
    assert database.participants_collection.find_one({"_id": participant["_id"]})["password_hash"] \
        == participant["password_hash"]


def test_forgot_password_still_validates_the_email(client):
    assert client.post("/auth/password/forgot", json={"email": "nope"}).status_code == 422


def test_reset_password_is_a_stub_that_changes_nothing(client, participant):
    response = client.post("/auth/password/reset", json={
        "token": "mock_token_123", "new_password": "brand-new-password",
    })
    assert response.status_code == 200
    assert response.json() == {"message": "Password reset successfully."}
    assert database.participants_collection.find_one({"_id": participant["_id"]})["password_hash"] \
        == participant["password_hash"]


def test_reset_password_accepts_any_token_today(client):
    """Pinned so the absence of token validation is visible rather than assumed."""
    assert client.post("/auth/password/reset", json={
        "token": "obviously-not-a-real-token", "new_password": "longenough1",
    }).status_code == 200


def test_reset_password_still_enforces_the_password_minimum(client):
    assert client.post("/auth/password/reset", json={
        "token": "t", "new_password": "short",
    }).status_code == 422


# ---------------------------------------------------------------------------
# POST /auth/password/change
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_a_participant_can_change_their_password(client, participant, password):
    response = client.post("/auth/password/change",
                           json={"current_password": password,
                                 "new_password": "a-brand-new-password"},
                           headers=auth_headers(participant))
    assert response.status_code == 200
    assert response.json()["message"] == "Password changed successfully."

    stored = database.participants_collection.find_one({"_id": participant["_id"]})
    assert security.verify_password("a-brand-new-password", stored["password_hash"])
    assert not security.verify_password(password, stored["password_hash"])


@pytest.mark.slow
def test_the_old_password_stops_working_and_the_new_one_starts(client, participant, password):
    client.post("/auth/password/change",
                json={"current_password": password, "new_password": "a-brand-new-password"},
                headers=auth_headers(participant))

    assert client.post("/auth/login", json={
        "email": participant["email"], "password": password,
    }).status_code == 401
    assert client.post("/auth/login", json={
        "email": participant["email"], "password": "a-brand-new-password",
    }).status_code == 200


@pytest.mark.slow
def test_the_reissued_token_works(client, participant, password):
    token = client.post("/auth/password/change",
                        json={"current_password": password, "new_password": "a-brand-new-password"},
                        headers=auth_headers(participant)).json()["access_token"]
    claims = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
    assert claims["type"] == "participant"
    assert client.get("/workshops/my_registrations",
                      headers={"Authorization": f"Bearer {token}"}).status_code == 200


@pytest.mark.slow
def test_a_staff_member_can_change_their_password_and_gets_a_staff_token(
    client, super_admin, password
):
    """The staff/participant decision is made from the *document*
    (`"paradox_id" in current_user`), not from the token type."""
    response = client.post("/auth/password/change",
                           json={"current_password": password, "new_password": "new-staff-password"},
                           headers=auth_headers(super_admin))
    assert response.status_code == 200
    claims = jwt.decode(response.json()["access_token"], security.SECRET_KEY,
                        algorithms=[security.ALGORITHM])
    assert claims["type"] == "staff"
    assert claims["sub"] == super_admin["paradox_id"]

    stored = database.backend_teams_collection.find_one({"_id": super_admin["_id"]})
    assert security.verify_password("new-staff-password", stored["password_hash"])


def test_the_wrong_current_password_is_refused(client, participant):
    response = client.post("/auth/password/change",
                           json={"current_password": "not-it", "new_password": "longenough1"},
                           headers=auth_headers(participant))
    assert response.status_code == 400
    assert response.json()["detail"] == "Incorrect current password"


def test_a_refused_change_leaves_the_stored_hash_alone(client, participant):
    client.post("/auth/password/change",
                json={"current_password": "not-it", "new_password": "longenough1"},
                headers=auth_headers(participant))
    assert database.participants_collection.find_one({"_id": participant["_id"]})["password_hash"] \
        == participant["password_hash"]


def test_changing_a_password_requires_a_token(client):
    response = client.post("/auth/password/change",
                           json={"current_password": "x", "new_password": "longenough1"})
    assert response.status_code in (401, 403)


def test_the_new_password_minimum_is_enforced(client, participant, password):
    assert client.post("/auth/password/change",
                       json={"current_password": password, "new_password": "short"},
                       headers=auth_headers(participant)).status_code == 422
