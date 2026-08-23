"""
Unit tests for backend/dependencies.py — the authorization foundation.

The three `get_current_*` functions are called directly with
`HTTPAuthorizationCredentials`, rather than through a route, so a failure here
points at the dependency itself and not at whichever endpoint happened to be
used as a vehicle. The missing-header case is the exception: it is enforced by
`HTTPBearer` before any of this code runs, so it is only observable over HTTP.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import database
import dependencies
from dependencies import (
    get_current_participant,
    get_current_staff,
    get_current_user,
    verify_qr,
)
from models import ScanQRRequest
from testing.helpers import fake_datetime, make_qr, raw_token, token_for

ALL_DEPENDENCIES = (get_current_user, get_current_staff, get_current_participant)


def creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------

def test_get_current_user_accepts_a_participant_token(participant):
    assert get_current_user(creds(token_for(participant)))["_id"] == participant["_id"]


def test_get_current_user_accepts_a_staff_token(super_admin):
    assert get_current_user(creds(token_for(super_admin)))["_id"] == super_admin["_id"]


def test_get_current_participant_accepts_a_participant_token(participant):
    assert get_current_participant(creds(token_for(participant)))["participant_id"] == \
        participant["participant_id"]


def test_get_current_staff_accepts_a_staff_token(super_admin):
    assert get_current_staff(creds(token_for(super_admin)))["paradox_id"] == \
        super_admin["paradox_id"]


def test_the_returned_document_is_the_whole_record(participant):
    """Routes read `_id`, `profile`, `events`, `workshops`, `mess` and
    `accommodation` straight off this, so it must not be a projection."""
    resolved = get_current_user(creds(token_for(participant)))
    for key in ("_id", "profile", "events", "workshops", "mess", "accommodation", "qr_secrets"):
        assert key in resolved


# ---------------------------------------------------------------------------
# Token type separation
# ---------------------------------------------------------------------------

def test_a_staff_token_is_refused_by_the_participant_dependency(super_admin):
    with pytest.raises(HTTPException) as excinfo:
        get_current_participant(creds(token_for(super_admin)))
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Participant credentials required. Use /auth/login."


def test_a_participant_token_is_refused_by_the_staff_dependency(participant):
    with pytest.raises(HTTPException) as excinfo:
        get_current_staff(creds(token_for(participant)))
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Staff credentials required. Use /auth/admin/login."


def test_type_separation_is_enforced_before_any_lookup():
    """No document exists at all here, and the answer is still 403 rather than
    401 — the token's own claim decides."""
    with pytest.raises(HTTPException) as excinfo:
        get_current_staff(creds(raw_token("DS23F000001", "participant")))
    assert excinfo.value.status_code == 403


def test_a_token_with_no_type_claim_defaults_to_participant(participant):
    """`payload.get("type", "participant")` — an older token without the claim is
    still honoured as a participant."""
    from datetime import timedelta as _td

    from security import create_access_token

    token = create_access_token(
        {"sub": participant["participant_id"]}, expires_delta=_td(minutes=30)
    )
    assert get_current_participant(creds(token))["_id"] == participant["_id"]
    with pytest.raises(HTTPException) as excinfo:
        get_current_staff(creds(token))
    assert excinfo.value.status_code == 403


def test_an_unrecognised_type_is_treated_as_a_participant_by_get_current_user(participant):
    """`get_current_user` branches on `== "staff"`, so anything else reads the
    participants collection."""
    token = raw_token(participant["participant_id"], "robot")
    assert get_current_user(creds(token))["_id"] == participant["_id"]


# ---------------------------------------------------------------------------
# Malformed and expired tokens
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("dependency", ALL_DEPENDENCIES)
@pytest.mark.parametrize("token", ["", "not.a.jwt", "abc", "a.b.c"])
def test_a_malformed_token_is_401(dependency, token):
    with pytest.raises(HTTPException) as excinfo:
        dependency(creds(token))
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Invalid authentication credentials"


@pytest.mark.parametrize("dependency", ALL_DEPENDENCIES)
def test_an_expired_token_is_401(dependency, participant):
    with pytest.raises(HTTPException) as excinfo:
        dependency(creds(token_for(participant, expires_minutes=-5)))
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Invalid authentication credentials"


@pytest.mark.parametrize("dependency", ALL_DEPENDENCIES)
def test_a_token_signed_with_a_foreign_key_is_401(dependency):
    from jose import jwt

    foreign = jwt.encode(
        {"sub": "DS23F000001", "type": "participant",
         "exp": datetime.utcnow() + timedelta(minutes=5)},
        "some-other-secret", algorithm="HS256",
    )
    with pytest.raises(HTTPException) as excinfo:
        dependency(creds(foreign))
    assert excinfo.value.status_code == 401


@pytest.mark.parametrize("dependency", ALL_DEPENDENCIES)
def test_a_token_with_no_subject_is_401(dependency):
    with pytest.raises(HTTPException) as excinfo:
        dependency(creds(raw_token(None, "participant")))
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Invalid authentication credentials"


# ---------------------------------------------------------------------------
# Valid token, missing document
# ---------------------------------------------------------------------------

def test_get_current_user_401s_when_the_subject_no_longer_exists():
    with pytest.raises(HTTPException) as excinfo:
        get_current_user(creds(raw_token("DS23F999999", "participant")))
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "User not found"


def test_get_current_participant_401s_with_its_own_message():
    with pytest.raises(HTTPException) as excinfo:
        get_current_participant(creds(raw_token("DS23F999999", "participant")))
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Participant not found"


def test_get_current_staff_401s_with_its_own_message():
    with pytest.raises(HTTPException) as excinfo:
        get_current_staff(creds(raw_token("SAWO9999", "staff")))
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Staff member not found"


def test_a_deleted_participant_cannot_keep_using_a_live_token(participant):
    token = token_for(participant)
    assert get_current_participant(creds(token))
    database.participants_collection.delete_one({"_id": participant["_id"]})
    with pytest.raises(HTTPException) as excinfo:
        get_current_participant(creds(token))
    assert excinfo.value.status_code == 401


def test_a_staff_token_cannot_resolve_against_the_participants_collection(participant):
    """The two id namespaces are looked up in different collections, so a staff
    token naming a participant id finds nothing."""
    with pytest.raises(HTTPException) as excinfo:
        get_current_user(creds(raw_token(participant["participant_id"], "staff")))
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "User not found"


def test_role_is_read_from_the_document_not_the_token(make_staff):
    """
    A forged `role` claim is inert: the dependency returns the stored document,
    and every route re-reads `role` from `backend_teams`. This is the property the
    whole authorization model rests on.
    """
    staff = make_staff(paradox_id="ADTE2222", role="admin", email="a@x.com")
    from datetime import timedelta as _td

    from security import create_access_token

    forged = create_access_token(
        {"sub": "ADTE2222", "type": "staff", "role": "super_admin"}, expires_delta=_td(minutes=5)
    )
    assert get_current_staff(creds(forged))["role"] == "admin"


# ---------------------------------------------------------------------------
# Missing header — enforced by HTTPBearer, observable only over HTTP
# ---------------------------------------------------------------------------

def test_a_missing_authorization_header_is_rejected_before_the_dependency_runs(client):
    response = client.get("/participants/statistics")
    assert response.status_code in (401, 403)
    assert response.json()["detail"] == "Not authenticated"


def test_a_non_bearer_scheme_is_rejected(client):
    response = client.get("/participants/statistics", headers={"Authorization": "Basic abc"})
    assert response.status_code in (401, 403)


# ---------------------------------------------------------------------------
# verify_qr
# ---------------------------------------------------------------------------

def scan_request(**kwargs) -> ScanQRRequest:
    return ScanQRRequest(**kwargs)


@pytest.mark.slow
def test_verify_qr_resolves_by_participant_id_and_returns_the_payload(participant):
    request = scan_request(**make_qr(participant, payload={"nonce": 7}))
    target, payload = verify_qr(request)
    assert target["_id"] == participant["_id"]
    assert payload == {"nonce": 7}


@pytest.mark.slow
def test_verify_qr_falls_back_to_the_email(participant):
    body = make_qr(participant)
    body["participant_id"] = participant["email"]
    target, _ = verify_qr(scan_request(**body))
    assert target["_id"] == participant["_id"]


def test_verify_qr_404s_for_an_unknown_person():
    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(participant_id="NOBODY", data="AAAA",
                               timestamp=datetime.utcnow().isoformat() + "Z"))
    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "Scanned user not found"


def test_verify_qr_400s_when_the_participant_has_no_private_key(make_participant):
    person = make_participant(qr_secrets={"private_key": None, "public_key": None})
    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(participant_id=person["participant_id"], data="AAAA",
                               timestamp=datetime.utcnow().isoformat() + "Z"))
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "User missing private key"


@pytest.mark.slow
def test_verify_qr_rejects_a_code_older_than_sixty_seconds(participant):
    """No clock is patched: the timestamp is genuinely 90 seconds old."""
    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(**make_qr(participant, age_seconds=90)))
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "QR Code expired"


@pytest.mark.slow
def test_verify_qr_accepts_a_code_just_inside_the_window(participant):
    target, _ = verify_qr(scan_request(**make_qr(participant, age_seconds=30)))
    assert target["_id"] == participant["_id"]


@pytest.mark.slow
def test_the_expiry_boundary_is_exactly_sixty_seconds(participant, monkeypatch):
    """
    The one place in this file where the clock is pinned, because the boundary is
    the assertion. `dependencies` reads `datetime` as a module-level name and does
    no isinstance checks, so substituting a subclass is safe here.
    """
    issued = datetime(2026, 6, 13, 10, 0, 0)
    body = make_qr(participant, timestamp=issued.isoformat() + "Z")

    monkeypatch.setattr(dependencies, "datetime", fake_datetime(issued + timedelta(seconds=60)))
    assert verify_qr(scan_request(**body))[0]["_id"] == participant["_id"]

    monkeypatch.setattr(dependencies, "datetime",
                        fake_datetime(issued + timedelta(seconds=60, microseconds=1)))
    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(**body))
    assert excinfo.value.detail == "QR Code expired"


@pytest.mark.slow
def test_a_future_timestamp_is_accepted(participant):
    """The guard is one-sided — `utcnow() - qr_timestamp > 60s` — so a clock-skewed
    client running ahead is tolerated rather than refused."""
    body = make_qr(participant, age_seconds=-300)
    assert verify_qr(scan_request(**body))[0]["_id"] == participant["_id"]


@pytest.mark.parametrize("timestamp", ["yesterday", "", "2026-13-45T99:00:00", "13/06/2026"])
def test_verify_qr_400s_on_an_unparseable_timestamp(participant, timestamp):
    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(participant_id=participant["participant_id"],
                               data="AAAA", timestamp=timestamp))
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Invalid timestamp format"


def test_the_expiry_check_is_not_swallowed_by_the_format_handler(participant):
    """`except HTTPException: raise` sits before the broad handler, so an expired
    code reports expiry rather than being relabelled a format error."""
    old = (datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z"
    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(participant_id=participant["participant_id"],
                               data="AAAA", timestamp=old))
    assert excinfo.value.detail == "QR Code expired"


def test_verify_qr_400s_on_undecryptable_data(participant):
    from testing.helpers import corrupt_qr

    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(**corrupt_qr(participant)))
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Invalid or corrupted QR code"


@pytest.mark.slow
def test_verify_qr_400s_when_the_code_was_encrypted_for_someone_else(participant, alt_keypair):
    body = make_qr(participant, public_key_pem=alt_keypair[1])
    with pytest.raises(HTTPException) as excinfo:
        verify_qr(scan_request(**body))
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Invalid or corrupted QR code"


@pytest.mark.slow
def test_verify_qr_does_not_check_that_the_payload_names_the_same_person(participant, keypair):
    """
    Pinned, not endorsed: the decrypted payload is returned to the caller and no
    route compares it against `request.participant_id`. Possession of a valid
    ciphertext for the named participant is the whole check.
    """
    body = make_qr(participant, payload={"participant_id": "SOMEONE-ELSE"})
    target, payload = verify_qr(scan_request(**body))
    assert target["participant_id"] == participant["participant_id"]
    assert payload["participant_id"] == "SOMEONE-ELSE"
