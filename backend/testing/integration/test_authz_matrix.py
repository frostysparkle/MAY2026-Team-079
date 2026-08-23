"""
Authorization matrix: every protected route, against every wrong caller.

Where the per-router tests assert one refusal in context, this asserts the *shape* of
the whole surface at once — that no protected endpoint is reachable without a token,
that participant and staff namespaces do not cross, and that a valid staff token is
not by itself authority over anything.

A route added without a dependency shows up here as a passing request that should
have been refused.
"""
import pytest

import database
from testing import factories
from testing.helpers import auth_headers

pytestmark = pytest.mark.integration

# (method, path, body) for every route that requires a *participant* token.
PARTICIPANT_ROUTES = [
    ("patch", "/profile/complete", {}),
    ("get", "/workshops/my_registrations", None),
    ("post", "/workshops/WKSP111/register", None),
    ("get", "/events/my_registrations", None),
    ("post", "/events/EVTEC1111/register", None),
    ("put", "/events/EVTEC1111/register", {"registration_data": {}}),
    ("delete", "/events/EVTEC1111/register", None),
    ("post", "/mess/pay", {"method": "upi"}),
    ("get", "/mess/my_mess", None),
    ("post", "/hostels/pay", {"method": "upi"}),
    ("post", "/hostels/register", None),
    ("delete", "/hostels/register", None),
    ("get", "/hostels/my_hostel", None),
    ("post", "/queries", {"category": "general", "subject": "s", "body": "b"}),
    ("get", "/queries/mine", None),
    ("post", "/issues", {"facility_type": "hostel", "facility_id": "HSTL111",
                         "category": "water", "subject": "abc", "body": "abc"}),
    ("get", "/issues/mine", None),
]

# (method, path, body) for every route that requires a *staff* token.
STAFF_ROUTES = [
    ("post", "/backend_teams", {"email": "a@ds.study.iitm.ac.in", "password": "longenough1",
                                "role": "other", "department": "hostels", "designation": "d"}),
    ("get", "/backend_teams", None),
    ("put", "/backend_teams/OTHO1111", {"designation": "d"}),
    ("delete", "/backend_teams/OTHO1111", None),
    ("get", "/participants", None),
    ("get", "/participants/statistics", None),
    ("patch", "/participants/DS23F000001", {"phone": "9"}),
    ("post", "/workshop-slots", {"slot_id": "D1S1", "start_time": "2026-06-13T10:00:00Z",
                                 "end_time": "2026-06-13T12:00:00Z"}),
    ("put", "/workshop-slots/D1S1", {"start_time": "2026-06-13T10:00:00Z"}),
    ("delete", "/workshop-slots/D1S1", None),
    ("post", "/workshops", {"slot_id": "D1S1", "name": "n", "description": "d", "venue": "v",
                            "capacity": 1, "instructions": "i",
                            "registration_start": "2026-06-01T10:00:00Z",
                            "registration_end": "2026-06-10T10:00:00Z"}),
    ("put", "/workshops/WKSP111", {"venue": "v"}),
    ("delete", "/workshops/WKSP111", None),
    ("post", "/workshops/WKSP111/volunteers", {"user_id": "OTWO1111"}),
    ("get", "/workshops/WKSP111/logs", None),
    ("get", "/workshops/WKSP111/participation", None),
    ("patch", "/workshops/WKSP111/participants/DS23F000001", {"attended": True}),
    ("delete", "/workshops/WKSP111/volunteers/OTWO1111", None),
    ("post", "/events", {"event_type": "technical", "name": "n", "description": "d",
                         "team": {"min": 1, "max": 1},
                         "registration": {"start_time": "2026-06-01T10:00:00Z",
                                          "end_time": "2026-06-10T10:00:00Z"}}),
    ("put", "/events/EVTEC1111", {"name": "n"}),
    ("delete", "/events/EVTEC1111", None),
    ("post", "/events/EVTEC1111/team", {"user_id": "ADTE2222", "role": "member"}),
    ("patch", "/events/EVTEC1111/team/ADTE2222", {"role": "member"}),
    ("delete", "/events/EVTEC1111/team/ADTE2222", None),
    ("get", "/events/EVTEC1111/participation", None),
    ("post", "/events/EVTEC1111/allocate_teams", None),
    ("get", "/events/EVTEC1111/my_daily_scans", None),
    ("get", "/events/EVTEC1111/logs", None),
    ("put", "/events/EVTEC1111/participant_teams/DS23F000001", {"team_id": "TM1"}),
    ("post", "/events/EVTEC1111/announcements", {"message": "m"}),
    ("post", "/mess", {"mess_id": "MESS1", "name": "n", "capacity": 1, "type": "jain"}),
    ("put", "/mess/MESS1", {"capacity": 2}),
    ("delete", "/mess/MESS1", None),
    ("put", "/mess/MESS1/menu", {"menu": {}}),
    ("post", "/mess/MESS1/team", {"role": "volunteer"}),
    ("post", "/mess/allocate", None),
    ("get", "/mess/MESS1/statistics", None),
    ("post", "/hostels", {"name": "n", "capacity": 1, "gender": "male", "sharing": 1,
                          "num_rooms": 1}),
    ("post", "/hostels/HSTL111/team", {"user_id": "OTHO1111", "role": "guard"}),
    ("post", "/hostels/allocate", None),
    ("delete", "/hostels/HSTL111", None),
    ("get", "/hostels/HSTL111/statistics", None),
    ("get", "/audit-logs", None),
    ("get", "/audit-logs/summary", None),
    ("get", "/queries", None),
    ("patch", "/queries/QRY1", {"status": "open"}),
    ("post", "/queries/team", {"user_id": "OTHO1111"}),
    ("get", "/queries/team", None),
    ("delete", "/queries/team/OTHO1111", None),
    ("get", "/issues", None),
    ("patch", "/issues/ISS1", {"status": "open"}),
]

# Routes deliberately readable without any credentials at all.
PUBLIC_ROUTES = [
    ("get", "/workshops/public"),
    ("get", "/events/public"),
    ("get", "/workshop-slots"),
]

# Routes that accept either token type.
EITHER_TOKEN_ROUTES = [
    ("get", "/workshops", None),
    ("get", "/events", None),
    ("get", "/mess", None),
    ("get", "/hostels", None),
    ("get", "/events/EVTEC1111/capacity", None),
    ("get", "/events/EVTEC1111/announcements", None),
    ("post", "/auth/password/change", {"current_password": "x", "new_password": "longenough1"}),
]


def call(client, method, path, body, headers=None):
    kwargs = {"headers": headers} if headers else {}
    if body is not None:
        kwargs["json"] = body
    return getattr(client, method)(path, **kwargs)


def ids(routes):
    return [f"{method.upper()} {path}" for method, path, *_ in routes]


# ---------------------------------------------------------------------------
# No credentials at all
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path,body", PARTICIPANT_ROUTES + STAFF_ROUTES,
                         ids=ids(PARTICIPANT_ROUTES + STAFF_ROUTES))
def test_no_token_is_always_refused(client, method, path, body):
    response = call(client, method, path, body)
    assert response.status_code in (401, 403), (
        f"{method.upper()} {path} answered {response.status_code} with no credentials"
    )


@pytest.mark.parametrize("method,path,body", PARTICIPANT_ROUTES + STAFF_ROUTES,
                         ids=ids(PARTICIPANT_ROUTES + STAFF_ROUTES))
def test_a_garbage_token_is_always_refused(client, method, path, body):
    response = call(client, method, path, body,
                    headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code in (401, 403)


@pytest.mark.parametrize("method,path,body", PARTICIPANT_ROUTES + STAFF_ROUTES,
                         ids=ids(PARTICIPANT_ROUTES + STAFF_ROUTES))
def test_an_expired_token_is_always_refused(client, participant, method, path, body):
    response = call(client, method, path, body,
                    headers=auth_headers(participant, expires_minutes=-10))
    assert response.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Wrong namespace
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path,body", STAFF_ROUTES, ids=ids(STAFF_ROUTES))
def test_a_participant_token_never_opens_a_staff_route(client, participant, method, path, body):
    response = call(client, method, path, body, headers=auth_headers(participant))
    assert response.status_code == 403
    assert response.json()["detail"] == "Staff credentials required. Use /auth/admin/login."


@pytest.mark.parametrize("method,path,body", PARTICIPANT_ROUTES, ids=ids(PARTICIPANT_ROUTES))
def test_a_staff_token_never_opens_a_participant_route(client, admin, method, path, body):
    response = call(client, method, path, body, headers=admin)
    assert response.status_code == 403
    assert response.json()["detail"] == "Participant credentials required. Use /auth/login."


# ---------------------------------------------------------------------------
# Valid staff token, no authority
# ---------------------------------------------------------------------------

# Everything a plain (non-super-admin, no-duty) staff account must not reach.
# Excludes the routes whose authority comes from team membership rather than
# seniority — those are covered per-router — and the ones that answer 404 first.
PRIVILEGED_ROUTES = [
    ("post", "/backend_teams", {"email": "a@ds.study.iitm.ac.in", "password": "longenough1",
                                "role": "other", "department": "hostels", "designation": "d"}),
    ("get", "/backend_teams", None),
    ("get", "/participants", None),
    ("get", "/participants/statistics", None),
    ("patch", "/participants/DS23F000001", {"phone": "9"}),
    ("post", "/workshop-slots", {"slot_id": "D2S2", "start_time": "2026-06-13T10:00:00Z",
                                 "end_time": "2026-06-13T12:00:00Z"}),
    ("post", "/workshops", {"slot_id": "D1S1", "name": "n", "description": "d", "venue": "v",
                            "capacity": 1, "instructions": "i",
                            "registration_start": "2026-06-01T10:00:00Z",
                            "registration_end": "2026-06-10T10:00:00Z"}),
    ("put", "/workshops/WKSP111", {"venue": "v"}),
    ("delete", "/workshops/WKSP111", None),
    ("post", "/workshops/WKSP111/volunteers", {"user_id": "OTWO1111"}),
    ("get", "/workshops/WKSP111/logs", None),
    ("post", "/events", {"event_type": "technical", "name": "n", "description": "d",
                         "team": {"min": 1, "max": 1},
                         "registration": {"start_time": "2026-06-01T10:00:00Z",
                                          "end_time": "2026-06-10T10:00:00Z"}}),
    ("delete", "/events/EVTEC1111", None),
    ("post", "/events/EVTEC1111/team", {"user_id": "ADTE2222", "role": "member"}),
    ("get", "/events/EVTEC1111/logs", None),
    ("post", "/mess", {"mess_id": "MESS2", "name": "n", "capacity": 1, "type": "jain"}),
    ("put", "/mess/MESS1", {"capacity": 2}),
    ("delete", "/mess/MESS1", None),
    ("post", "/mess/MESS1/team", {"role": "volunteer"}),
    ("post", "/mess/allocate", None),
    ("get", "/mess/MESS1/statistics", None),
    ("post", "/hostels", {"name": "n", "capacity": 1, "gender": "male", "sharing": 1,
                          "num_rooms": 1}),
    ("post", "/hostels/HSTL111/team", {"user_id": "OTHO1111", "role": "guard"}),
    ("post", "/hostels/allocate", None),
    ("delete", "/hostels/HSTL111", None),
    ("get", "/hostels/HSTL111/statistics", None),
    ("get", "/audit-logs", None),
    ("get", "/audit-logs/summary", None),
    ("get", "/queries", None),
    ("get", "/queries/team", None),
]


@pytest.fixture()
def populated(founder, make_participant):
    """Enough state that a refusal is a genuine refusal rather than a 404."""
    database.workshop_slots_collection.insert_one(factories.slot_doc("D1S1"))
    database.workshops_collection.insert_one(factories.workshop_doc("WKSP111", slot_id="D1S1"))
    database.event_collection.insert_one(factories.event_doc("EVTEC1111"))
    database.mess_collection.insert_one(factories.mess_doc("MESS1"))
    database.hostel_collection.insert_one(factories.hostel_doc("HSTL111"))
    make_participant(participant_id="DS23F000001")


@pytest.mark.parametrize("method,path,body", PRIVILEGED_ROUTES, ids=ids(PRIVILEGED_ROUTES))
def test_a_valid_staff_token_is_not_authority(client, populated, plain_staff, method, path, body):
    """
    An `admin` in one department, on nobody's team, must reach none of this. Being
    staff somewhere is not being staff here.
    """
    response = call(client, method, path, body, headers=auth_headers(plain_staff))
    assert response.status_code == 403, (
        f"{method.upper()} {path} answered {response.status_code} for a plain staff account"
    )


def test_every_privileged_refusal_is_recorded(client, populated, plain_staff):
    """A Super Admin reviewing access can see who was turned away and from what."""
    for method, path, body in PRIVILEGED_ROUTES:
        call(client, method, path, body, headers=auth_headers(plain_staff))

    denials = list(database.system_logs_collection.find({"action": "AUTHZ_DENIED"}))
    resources = {row["details"].get("resource") for row in denials}
    assert {"mess", "hostels", "participants", "backend_teams", "workshops"} <= resources


# ---------------------------------------------------------------------------
# Public and dual-token routes
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", PUBLIC_ROUTES, ids=ids(PUBLIC_ROUTES))
def test_public_routes_need_no_credentials(client, method, path):
    assert getattr(client, method)(path).status_code == 200


@pytest.mark.parametrize("method,path,body", EITHER_TOKEN_ROUTES, ids=ids(EITHER_TOKEN_ROUTES))
def test_dual_token_routes_accept_both_namespaces(client, populated, participant, plain_staff,
                                                  method, path, body):
    """
    These must not 403 on the *token type*. Some still refuse for another reason
    (a wrong password, an unauthorised reader), which is not what this asserts.
    """
    for headers in (auth_headers(participant), auth_headers(plain_staff)):
        response = call(client, method, path, body, headers=headers)
        assert response.status_code != 403 or response.json()["detail"] not in (
            "Staff credentials required. Use /auth/admin/login.",
            "Participant credentials required. Use /auth/login.",
        ), f"{method.upper()} {path} rejected a valid token on type grounds"


# ---------------------------------------------------------------------------
# Token forgery
# ---------------------------------------------------------------------------

def test_a_forged_role_claim_grants_nothing(client, populated, plain_staff):
    """
    Every gate re-reads the role from `backend_teams`, so the token's own claims are
    inert. This is the property the whole authorization model rests on.
    """
    from datetime import timedelta

    from security import create_access_token

    forged = create_access_token(
        {"sub": plain_staff["paradox_id"], "type": "staff", "role": "super_admin"},
        expires_delta=timedelta(minutes=5),
    )
    headers = {"Authorization": f"Bearer {forged}"}
    for method, path, body in PRIVILEGED_ROUTES[:8]:
        assert call(client, method, path, body, headers=headers).status_code == 403


def test_a_token_signed_with_another_key_is_refused(client):
    from datetime import datetime, timedelta

    from jose import jwt

    foreign = jwt.encode(
        {"sub": "SAWO1111", "type": "staff", "exp": datetime.utcnow() + timedelta(minutes=5)},
        "not-the-real-secret", algorithm="HS256",
    )
    response = client.get("/participants", headers={"Authorization": f"Bearer {foreign}"})
    assert response.status_code == 401


def test_a_participant_id_presented_as_staff_resolves_to_nobody(client, participant):
    from datetime import timedelta

    from security import create_access_token

    token = create_access_token({"sub": participant["participant_id"], "type": "staff"},
                                expires_delta=timedelta(minutes=5))
    response = client.get("/participants", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Staff member not found"


def test_a_deleted_account_loses_access_immediately(client, admin, make_staff):
    """Even though its week-long token is still cryptographically valid."""
    staff = make_staff(paradox_id="OTHO1111", email="gone@ds.study.iitm.ac.in", role="other")
    headers = auth_headers(staff)
    assert client.get("/hostels", headers=headers).status_code == 200

    client.delete("/backend_teams/OTHO1111", headers=admin)
    assert client.get("/hostels", headers=headers).status_code == 401
