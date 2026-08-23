"""
Unit tests for backend/request_logging.py.

The pure scope helpers are tested directly against plain ASGI scope dicts; the
middleware and exception handlers are tested through the real app, because what
matters about them is observable on the wire (the `X-Request-ID` header, an
unchanged status code and body, a durable `REQUEST_FAILED` row).
"""
import logging

import pytest
from fastapi import HTTPException

import request_logging
from log_redaction import fingerprint
from request_logging import (
    REQUEST_ID_HEADER,
    _actor_hint,
    _client_ip,
    _count_endpoints,
    _header,
    _query_fields,
    _route_template,
)
from testing.helpers import auth_headers, token_for


def scope(headers=None, client=("10.0.0.1", 5000), query=b"", **extra):
    encoded = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    base = {"type": "http", "method": "GET", "path": "/mess", "headers": encoded,
            "client": client, "query_string": query}
    base.update(extra)
    return base


# ---------------------------------------------------------------------------
# _client_ip
# ---------------------------------------------------------------------------

def test_the_direct_peer_is_used_when_there_is_no_proxy():
    assert _client_ip(scope()) == "10.0.0.1"


def test_the_forwarded_header_wins_and_only_its_first_hop_is_taken():
    forwarded = scope(headers={"x-forwarded-for": "203.0.113.7, 10.0.0.2, 10.0.0.3"})
    assert _client_ip(forwarded) == "203.0.113.7"


def test_a_blank_forwarded_header_falls_back_to_none():
    assert _client_ip(scope(headers={"x-forwarded-for": "   "})) is None


def test_a_missing_client_yields_none():
    assert _client_ip(scope(client=None)) is None


def test_headers_are_matched_by_exact_lowercase_name():
    assert _header(scope(headers={"user-agent": "pytest"}), b"user-agent") == "pytest"
    assert _header(scope(), b"absent") is None


# ---------------------------------------------------------------------------
# _actor_hint
# ---------------------------------------------------------------------------

def test_no_authorization_header_yields_no_hint():
    assert _actor_hint(scope()) == (None, None, None)


def test_a_non_bearer_scheme_yields_no_hint():
    assert _actor_hint(scope(headers={"authorization": "Basic abc"})) == (None, None, None)


def test_a_real_token_is_labelled_from_its_claims(participant):
    token = token_for(participant)
    actor_id, actor_type, token_fp = _actor_hint(
        scope(headers={"authorization": f"Bearer {token}"})
    )
    assert actor_id == participant["participant_id"]
    assert actor_type == "participant"
    assert token_fp == fingerprint(token)


def test_a_staff_token_is_labelled_as_staff(super_admin):
    actor_id, actor_type, _ = _actor_hint(
        scope(headers={"authorization": f"Bearer {token_for(super_admin)}"})
    )
    assert (actor_id, actor_type) == (super_admin["paradox_id"], "staff")


def test_claims_are_read_without_verification_which_is_the_point(participant):
    """
    A forged or expired token still produces a label. That is correct for a log —
    the *claim* of identity is the interesting fact when a request is refused —
    and safe, because nothing here is a security decision.
    """
    expired = token_for(participant, expires_minutes=-60)
    actor_id, actor_type, _ = _actor_hint(scope(headers={"authorization": f"Bearer {expired}"}))
    assert actor_id == participant["participant_id"]
    assert actor_type == "participant"


def test_a_malformed_token_still_yields_a_fingerprint():
    actor_id, actor_type, token_fp = _actor_hint(
        scope(headers={"authorization": "Bearer not-a-jwt"})
    )
    assert (actor_id, actor_type) == (None, None)
    assert token_fp == fingerprint("not-a-jwt")


def test_the_token_itself_is_never_returned(participant):
    token = token_for(participant)
    assert token not in str(_actor_hint(scope(headers={"authorization": f"Bearer {token}"})))


# ---------------------------------------------------------------------------
# _query_fields
# ---------------------------------------------------------------------------

def test_no_query_string_yields_none():
    assert _query_fields(scope()) is None


def test_allowlisted_parameter_values_are_kept():
    """The operational parameters a refusal cannot be reconstructed without."""
    assert _query_fields(scope(query=b"slot=lunch&day=2&action=entry")) == {
        "slot": "lunch", "day": "2", "action": "entry",
    }


def test_other_parameters_are_recorded_by_name_only():
    """A query string is exactly where a search term or an email ends up."""
    fields = _query_fields(scope(query=b"q=asha%40x.com&house=Gir"))
    assert "asha" not in str(fields)
    assert fields == {"withheld_params": ["house", "q"]}


def test_a_mixed_query_keeps_the_safe_half():
    fields = _query_fields(scope(query=b"slot=lunch&q=secret"))
    assert fields["slot"] == "lunch"
    assert fields["withheld_params"] == ["q"]


def test_withheld_names_are_sorted_and_deduplicated():
    assert _query_fields(scope(query=b"z=1&a=2&z=3"))["withheld_params"] == ["a", "z"]


def test_a_blank_allowlisted_value_is_kept():
    assert _query_fields(scope(query=b"slot="))["slot"] == ""


# ---------------------------------------------------------------------------
# _route_template and _count_endpoints
# ---------------------------------------------------------------------------

def test_the_route_template_is_preferred_over_the_concrete_path():
    class Route:
        path = "/mess/{mess_id}/scan"

    assert _route_template(scope(route=Route())) == "/mess/{mess_id}/scan"


def test_the_endpoint_name_is_the_fallback():
    def scan_mess():
        pass

    assert _route_template(scope(endpoint=scan_mess)) == "scan_mess"


def test_no_routing_information_yields_none():
    assert _route_template(scope()) is None


def test_the_endpoint_count_walks_included_routers(app):
    """`len(app.routes)` reports ~17 for this app because each `include_router`
    is a single entry; a startup line with wrong figures is worse than none."""
    assert _count_endpoints(app) >= 90


def test_the_recursion_is_depth_capped():
    class SelfReferential:
        @property
        def routes(self):
            return [self]

    assert _count_endpoints(SelfReferential()) == 0


# ---------------------------------------------------------------------------
# The middleware, observed over HTTP
# ---------------------------------------------------------------------------

def test_every_response_carries_a_correlation_id(client):
    response = client.get("/workshop-slots")
    assert response.status_code == 200
    assert len(response.headers[REQUEST_ID_HEADER]) == 32


def test_each_request_gets_a_distinct_id(client):
    first = client.get("/workshop-slots").headers[REQUEST_ID_HEADER]
    second = client.get("/workshop-slots").headers[REQUEST_ID_HEADER]
    assert first != second


def test_an_inbound_id_is_honoured_rather_than_replaced(client):
    """So a correlation id minted by the frontend or a proxy spans the stack."""
    response = client.get("/workshop-slots", headers={REQUEST_ID_HEADER: "frontend-id-123"})
    assert response.headers[REQUEST_ID_HEADER] == "frontend-id-123"


def test_a_refusal_also_carries_the_header(client):
    response = client.get("/participants/statistics")
    assert response.status_code in (401, 403)
    assert REQUEST_ID_HEADER in response.headers


def test_the_id_is_exposed_to_browser_clients(client):
    """Without `expose_headers`, the header is on the wire but hidden from JS."""
    response = client.get("/workshop-slots", headers={"Origin": "http://localhost:5173"})
    exposed = response.headers.get("access-control-expose-headers", "")
    assert REQUEST_ID_HEADER.lower() in exposed.lower()


def test_the_request_id_ties_a_response_to_its_audit_row(client, admin_headers, participant):
    """The whole point of the correlation id: one identifier joins the HTTP
    response a user saw to the durable row the request wrote."""
    import database

    response = client.patch(f"/participants/{participant['participant_id']}",
                            json={"house": "Gir"}, headers=admin_headers)
    assert response.status_code == 200
    row = database.system_logs_collection.find_one({"action": "UPDATE_PARTICIPANT"})
    assert row["details"]["request_id"] == response.headers[REQUEST_ID_HEADER]


def test_the_finish_line_reports_status_route_and_duration(client, caplog):
    with caplog.at_level(logging.INFO, logger="paradox.request"):
        client.get("/workshop-slots")
    finish = [r for r in caplog.records if r.getMessage().startswith("<-- 200 GET /workshop-slots")]
    assert finish
    assert finish[-1].status == 200
    assert finish[-1].route == "/workshop-slots"
    assert finish[-1].duration_ms >= 0
    assert finish[-1].response_started is True


def test_a_refusal_is_logged_at_warning_with_its_detail(client, caplog):
    with caplog.at_level(logging.WARNING, logger="paradox.request"):
        client.get("/participants/statistics")
    refusals = [r for r in caplog.records if getattr(r, "refusal", False)]
    assert refusals
    assert refusals[-1].detail == "Not authenticated"
    assert refusals[-1].levelno == logging.WARNING


def test_a_validation_error_logs_field_paths_but_never_values(client, caplog):
    with caplog.at_level(logging.WARNING, logger="paradox.request"):
        # Both deliberately invalid: an unparseable address and a too-short
        # password, so two field paths are reported.
        response = client.post("/auth/register",
                               json={"email": "asha.private", "password": "sekrit"})
    assert response.status_code == 422
    logged = [r for r in caplog.records if getattr(r, "invalid_fields", None)]
    assert logged
    fields = {problem["field"] for problem in logged[-1].invalid_fields}
    assert fields == {"body.email", "body.password"}
    # The field paths are recorded; the submitted values are not. A 422 on
    # /auth/register or /profile/complete otherwise carries an email address, a
    # date of birth, a phone number and an address.
    for record in logged:
        assert "asha.private" not in str(record.__dict__)
        assert "sekrit" not in str(record.__dict__)


def test_a_slow_request_is_flagged(client, caplog, monkeypatch):
    """The threshold is read at import, so the module attribute is what to patch."""
    monkeypatch.setattr(request_logging, "SLOW_REQUEST_MS", 0.0)
    with caplog.at_level(logging.WARNING, logger="paradox.request"):
        client.get("/workshop-slots")
    assert any(getattr(r, "slow_request", False) for r in caplog.records)


def test_docs_traffic_is_quiet_at_info(client, caplog):
    with caplog.at_level(logging.INFO, logger="paradox.request"):
        client.get("/openapi.json")
    assert not any(r.getMessage().startswith("<-- 200 GET /openapi.json")
                   for r in caplog.records)


# ---------------------------------------------------------------------------
# Unhandled exceptions
# ---------------------------------------------------------------------------

def test_an_unhandled_exception_becomes_a_500_with_a_correlation_id(client, monkeypatch):
    """
    The response body is exactly what Starlette would have produced; the only
    difference on the wire is the header, which is what makes a screenshot of the
    failure lead to the traceback behind it.
    """
    import routers.workshop_slots as slots

    def explode(*_args, **_kwargs):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(slots.workshop_slots_collection, "find", explode)
    response = client.get("/workshop-slots")
    assert response.status_code == 500
    assert response.text == "Internal Server Error"
    assert REQUEST_ID_HEADER in response.headers


def test_a_crash_is_recorded_in_the_durable_trail(client, monkeypatch, audit):
    import routers.workshop_slots as slots

    monkeypatch.setattr(slots.workshop_slots_collection, "find",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("kaboom")))
    client.get("/workshop-slots")

    row = audit.one("REQUEST_FAILED")
    assert row["details"]["reason"] == "unhandled_exception"
    assert row["details"]["exception"] == "RuntimeError"
    assert row["details"]["message"] == "kaboom"
    assert row["details"]["http_path"] == "/workshop-slots"
    assert row["target_id"] == "/workshop-slots"


def test_a_crash_logs_a_traceback_and_a_finish_line(client, monkeypatch, caplog):
    import routers.workshop_slots as slots

    monkeypatch.setattr(slots.workshop_slots_collection, "find",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("kaboom")))
    with caplog.at_level(logging.ERROR, logger="paradox.request"):
        client.get("/workshop-slots")

    messages = [r.getMessage() for r in caplog.records]
    assert any("raised RuntimeError" in m for m in messages)
    # Every start line must have a matching finish line, including the failures —
    # that is what makes a missing pair mean something.
    assert any(m.startswith("<-- 500 GET /workshop-slots") for m in messages)
    assert any(r.exc_info for r in caplog.records)


def test_a_database_failure_is_not_audited(client, monkeypatch, audit):
    """
    Deliberately skipped: writing an audit row at that moment means waiting out
    the server-selection timeout on every failing request, turning a Mongo outage
    into a much slower one.
    """
    from pymongo.errors import ServerSelectionTimeoutError

    import routers.workshop_slots as slots

    monkeypatch.setattr(
        slots.workshop_slots_collection, "find",
        lambda *a, **k: (_ for _ in ()).throw(ServerSelectionTimeoutError("no server")),
    )
    assert client.get("/workshop-slots").status_code == 500
    audit.none("REQUEST_FAILED")


def test_an_http_exception_keeps_its_status_and_body(client, admin_headers):
    """The handlers log and then delegate, so nothing about the contract moves."""
    response = client.get("/mess/NOPE", headers=admin_headers)
    assert response.status_code == 404
    assert response.json() == {"detail": "Mess not found"}


def test_a_deliberate_http_exception_is_not_recorded_as_a_crash(client, admin_headers, audit):
    client.get("/mess/NOPE", headers=admin_headers)
    audit.none("REQUEST_FAILED")


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

def test_startup_reports_the_configuration_and_the_endpoint_count(app, caplog, restore_logging):
    from fastapi.testclient import TestClient

    with caplog.at_level(logging.INFO, logger="paradox.request"):
        with TestClient(app):
            pass
    startup = [r for r in caplog.records if getattr(r, "event", None) == "startup"]
    assert startup
    assert startup[-1].testing_mode is True
    assert startup[-1].file_logging is False
    assert startup[-1].endpoints >= 90


def test_the_database_check_runs_at_startup_and_passes_under_mongomock(caplog, app, restore_logging):
    from fastapi.testclient import TestClient

    with caplog.at_level(logging.INFO, logger="paradox.database"):
        with TestClient(app):
            pass
    assert any(r.getMessage() == "Database reachable" for r in caplog.records)


def test_shutdown_is_announced(app, caplog, restore_logging):
    from fastapi.testclient import TestClient

    with caplog.at_level(logging.INFO, logger="paradox.request"):
        with TestClient(app):
            pass
    assert any(getattr(r, "event", None) == "shutdown" for r in caplog.records)
