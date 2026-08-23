"""
Endpoint tests for /audit-logs and /embeddings.

The audit endpoints are the read side of everything the rest of the suite writes, so
the tests focus on the two properties a trail is useless without: a filtered summary
must count exactly the same rows the table beside it lists, and every person id in a
row must resolve to a name.

/embeddings is a thin proxy with a process-global rate limiter — both halves are
covered against a fake client, so no test needs a reachable provider.
"""
from datetime import datetime, timedelta

import pytest

import database
from testing import factories
from testing.helpers import auth_headers


def rows(*docs):
    database.system_logs_collection.insert_many(list(docs))


# ===========================================================================
# GET /audit-logs
# ===========================================================================

def test_the_trail_is_super_admin_only(client, staff_headers):
    for path in ("/audit-logs", "/audit-logs/summary"):
        response = client.get(path, headers=staff_headers)
        assert response.status_code == 403
        assert response.json()["detail"] == "Only Super Admins can view audit logs"


def test_a_participant_cannot_read_the_trail(client, participant):
    assert client.get("/audit-logs", headers=auth_headers(participant)).status_code == 403


def test_no_token_cannot_read_the_trail(client):
    assert client.get("/audit-logs").status_code in (401, 403)


def test_the_trail_is_newest_first(client, admin_headers):
    now = datetime.utcnow()
    rows(
        factories.audit_row(action="OLDER", timestamp=now - timedelta(minutes=5)),
        factories.audit_row(action="NEWER", timestamp=now),
    )
    actions = [row["action"] for row in client.get("/audit-logs", headers=admin_headers).json()]
    assert actions[:2] == ["NEWER", "OLDER"]


def test_the_internal_id_is_never_returned(client, admin_headers):
    rows(factories.audit_row())
    assert "_id" not in client.get("/audit-logs", headers=admin_headers).json()[0]


def test_timestamps_are_returned_with_an_explicit_zone(client, admin_headers):
    """A browser reads an offset-less string as local time, which shifted every
    displayed time by the reader's offset."""
    rows(factories.audit_row(timestamp=datetime(2026, 6, 13, 10, 30, 0)))
    row = client.get("/audit-logs", headers=admin_headers).json()[0]
    assert row["timestamp"] == "2026-06-13T10:30:00Z"


def test_the_target_filter_narrows_to_one_entity(client, admin_headers):
    rows(
        factories.audit_row(action="CREATE_MESS", target_id="MESS1"),
        factories.audit_row(action="CREATE_MESS", target_id="MESS2"),
    )
    body = client.get("/audit-logs?target_id=MESS1", headers=admin_headers).json()
    assert [row["target_id"] for row in body] == ["MESS1"]


def test_the_action_filter_narrows_to_one_kind(client, admin_headers):
    rows(
        factories.audit_row(action="HOSTEL_ENTRY"),
        factories.audit_row(action="HOSTEL_EXIT"),
    )
    body = client.get("/audit-logs?action=HOSTEL_ENTRY", headers=admin_headers).json()
    assert [row["action"] for row in body] == ["HOSTEL_ENTRY"]


def test_the_window_is_half_open_so_consecutive_days_tile(client, admin_headers):
    """`since` inclusive, `until` exclusive, so the midnight row is counted once."""
    midnight = datetime(2026, 6, 13, 0, 0, 0)
    rows(
        factories.audit_row(action="BEFORE", timestamp=midnight - timedelta(seconds=1)),
        factories.audit_row(action="AT_MIDNIGHT", timestamp=midnight),
        factories.audit_row(action="AFTER", timestamp=midnight + timedelta(hours=1)),
    )
    first_day = client.get("/audit-logs?until=2026-06-13T00:00:00Z", headers=admin_headers).json()
    second_day = client.get("/audit-logs?since=2026-06-13T00:00:00Z", headers=admin_headers).json()

    assert [row["action"] for row in first_day] == ["BEFORE"]
    assert {row["action"] for row in second_day} == {"AT_MIDNIGHT", "AFTER"}


def test_an_offset_bearing_bound_is_normalised(client, admin_headers):
    """+05:30 at 15:30 is 10:00 UTC; treating it as local would shift a whole
    evening into the wrong day."""
    rows(factories.audit_row(action="TARGET", timestamp=datetime(2026, 6, 13, 10, 30, 0)))
    body = client.get("/audit-logs?since=2026-06-13T15:30:00%2B05:30", headers=admin_headers).json()
    assert [row["action"] for row in body] == ["TARGET"]


@pytest.mark.parametrize("bound", ["since", "until"])
def test_an_unparseable_bound_is_a_422_naming_the_field(client, admin_headers, bound):
    response = client.get(f"/audit-logs?{bound}=yesterday", headers=admin_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == \
        f"`{bound}` must be an ISO 8601 datetime, e.g. 2026-08-21T00:00:00Z"


def test_the_limit_caps_the_page(client, admin_headers):
    rows(*[factories.audit_row(action=f"A{index}") for index in range(5)])
    assert len(client.get("/audit-logs?limit=2", headers=admin_headers).json()) == 2


def test_filtering_happens_before_the_limit(client, admin_headers):
    """Otherwise `limit` would silently cut off an entity's older entries."""
    now = datetime.utcnow()
    rows(*[factories.audit_row(action="NOISE", target_id="OTHER",
                               timestamp=now - timedelta(seconds=index))
           for index in range(50)])
    rows(factories.audit_row(action="WANTED", target_id="MESS1",
                             timestamp=now - timedelta(hours=1)))

    body = client.get("/audit-logs?target_id=MESS1&limit=10", headers=admin_headers).json()
    assert [row["action"] for row in body] == ["WANTED"]


def test_a_name_recorded_at_write_time_is_used_as_is(client, admin_headers):
    """That is the name as it was when the action happened."""
    rows(factories.audit_row(actor_id="SAWO1111", actor_name="Priya At The Time"))
    row = client.get("/audit-logs", headers=admin_headers).json()[0]
    assert row["actor_name"] == "Priya At The Time"


def test_an_older_row_with_no_name_is_resolved_from_the_collections(
    client, admin_headers, make_staff
):
    make_staff(paradox_id="OTHO1111", email="a@x.com", role="other", name="Ravi Guard")
    rows(factories.audit_row(actor_id="OTHO1111", actor_name=None))
    row = client.get("/audit-logs", headers=admin_headers).json()[0]
    assert row["actor_name"] == "Ravi Guard"
    assert row["names"]["OTHO1111"] == "Ravi Guard"


def test_a_participant_actor_is_resolved_too(client, admin_headers, make_participant):
    make_participant(participant_id="DS23F000001", profile={"full_name": "Asha Nair"})
    rows(factories.audit_row(actor_id="DS23F000001", actor_name=None, actor_type="participant"))
    assert client.get("/audit-logs", headers=admin_headers).json()[0]["actor_name"] == "Asha Nair"


def test_staff_take_precedence_over_a_participant_sharing_an_id(
    client, admin_headers, make_staff, make_participant
):
    make_staff(paradox_id="DS23F000001", email="a@x.com", role="other", name="Staff Name")
    make_participant(participant_id="DS23F000001", profile={"full_name": "Participant Name"})
    rows(factories.audit_row(actor_id="DS23F000001", actor_name=None))
    assert client.get("/audit-logs", headers=admin_headers).json()[0]["actor_name"] == "Staff Name"


def test_an_unresolvable_actor_stays_nameless(client, admin_headers):
    rows(factories.audit_row(actor_id="GHOST", actor_name=None))
    row = client.get("/audit-logs", headers=admin_headers).json()[0]
    assert row["actor_name"] is None
    assert "GHOST" not in row["names"]


def test_person_ids_mentioned_in_the_details_are_named(
    client, admin_headers, make_participant
):
    """So the client can show a name where it used to show a bare id, without
    knowing which collection the id belongs to."""
    make_participant(participant_id="DS23F000001", profile={"full_name": "Asha Nair"})
    rows(factories.audit_row(action="UPDATE_PARTICIPANT", target_id="DS23F000001",
                             details={"participant_id": "DS23F000001"}))
    row = client.get("/audit-logs", headers=admin_headers).json()[0]
    assert row["names"]["DS23F000001"] == "Asha Nair"


def test_the_details_and_ids_are_returned_unchanged(client, admin_headers):
    """Exports and filters that key on ids still work."""
    rows(factories.audit_row(details={"capacity": 50, "type": "jain"}))
    row = client.get("/audit-logs", headers=admin_headers).json()[0]
    assert row["details"]["capacity"] == 50
    assert row["actor_id"] == "SAWO1111"


def test_an_empty_trail_is_an_empty_list(client, admin_headers):
    assert client.get("/audit-logs", headers=admin_headers).json() == []


# ===========================================================================
# GET /audit-logs/summary
# ===========================================================================

def test_the_summary_counts_without_a_limit(client, admin_headers):
    """The reason it exists: the dashboard was reading `rows.length` off a capped
    page and labelling it "Recorded Actions"."""
    rows(*[factories.audit_row(action="CREATE_MESS") for _ in range(150)])
    body = client.get("/audit-logs/summary", headers=admin_headers).json()
    assert body["total"] == 150
    assert body["by_action"] == {"CREATE_MESS": 150}


def test_the_summary_and_the_table_agree_for_the_same_filters(client, admin_headers):
    rows(
        factories.audit_row(action="CREATE_MESS", target_id="MESS1"),
        factories.audit_row(action="UPDATE_MESS", target_id="MESS1"),
        factories.audit_row(action="CREATE_MESS", target_id="MESS2"),
    )
    table = client.get("/audit-logs?target_id=MESS1", headers=admin_headers).json()
    summary = client.get("/audit-logs/summary?target_id=MESS1", headers=admin_headers).json()
    assert summary["total"] == len(table)


def test_by_action_is_sorted_alphabetically(client, admin_headers):
    rows(
        factories.audit_row(action="ZED"), factories.audit_row(action="ALPHA"),
        factories.audit_row(action="MID"),
    )
    body = client.get("/audit-logs/summary", headers=admin_headers).json()
    assert list(body["by_action"]) == ["ALPHA", "MID", "ZED"]


def test_actor_ids_are_the_distinct_set_not_a_sample(client, admin_headers):
    """Which lets a caller answer "which staff acted in this window" exactly."""
    rows(
        factories.audit_row(actor_id="SAWO1111"), factories.audit_row(actor_id="SAWO1111"),
        factories.audit_row(actor_id="OTHO2222"),
    )
    body = client.get("/audit-logs/summary", headers=admin_headers).json()
    assert body["actor_ids"] == ["OTHO2222", "SAWO1111"]
    assert body["distinct_actors"] == 2


def test_the_window_is_echoed_back(client, admin_headers):
    body = client.get("/audit-logs/summary?since=2026-06-13T00:00:00Z", headers=admin_headers).json()
    assert body["window"] == {"since": "2026-06-13T00:00:00Z", "until": None}


def test_meals_are_counted_per_diner_not_per_swipe(client, admin_headers):
    """A double scan at a busy counter inflated the board's headline."""
    rows(
        factories.mess_scan_row("DS23F000001", day=1, slot="breakfast"),
        factories.mess_scan_row("DS23F000001", day=1, slot="breakfast"),
        factories.mess_scan_row("DS23F000002", day=1, slot="breakfast"),
    )
    meals = client.get("/audit-logs/summary", headers=admin_headers).json()["meals"]
    assert meals["scans"] == 3
    assert meals["meals_served"] == 2
    assert meals["duplicate_scans"] == 1
    assert meals["unique_diners"] == 2


def test_meals_break_down_by_slot_and_day(client, admin_headers):
    rows(
        factories.mess_scan_row("DS23F000001", day=1, slot="breakfast"),
        factories.mess_scan_row("DS23F000001", day=1, slot="lunch"),
        factories.mess_scan_row("DS23F000001", day=2, slot="lunch"),
    )
    meals = client.get("/audit-logs/summary", headers=admin_headers).json()["meals"]
    assert meals["by_slot"] == {"breakfast": 1, "lunch": 2, "dinner": 0}
    assert meals["by_day"] == {"1": 2, "2": 1}


def test_days_are_ordered_numerically(client, admin_headers):
    rows(
        factories.mess_scan_row("DS23F000001", day=10),
        factories.mess_scan_row("DS23F000001", day=2),
    )
    meals = client.get("/audit-logs/summary", headers=admin_headers).json()["meals"]
    assert list(meals["by_day"]) == ["2", "10"]


def test_an_unrecognised_slot_is_still_counted_but_reported_separately(client, admin_headers):
    """Dropping them made the headline quietly smaller than the trail it came from."""
    rows(factories.mess_scan_row("DS23F000001", day=1, slot="brunch"))
    meals = client.get("/audit-logs/summary", headers=admin_headers).json()["meals"]
    assert meals["meals_served"] == 1
    assert meals["unclassified"] == 1
    assert meals["by_slot"] == {"breakfast": 0, "lunch": 0, "dinner": 0}
    assert meals["by_day"] == {}


def test_a_non_numeric_day_is_unclassified(client, admin_headers):
    rows(factories.mess_scan_row("DS23F000001", day="one", slot="lunch"))
    meals = client.get("/audit-logs/summary", headers=admin_headers).json()["meals"]
    assert meals["meals_served"] == 1
    assert meals["unclassified"] == 1


def test_refusals_are_not_counted_as_meals(client, admin_headers):
    """The whole reason refusals get their own action string."""
    rows(
        factories.mess_scan_row("DS23F000001", day=1, slot="lunch"),
        factories.audit_row(action="MESS_SCAN_DENIED",
                            details={"participant_id": "DS23F000001", "day": 1, "slot": "lunch"}),
    )
    body = client.get("/audit-logs/summary", headers=admin_headers).json()
    assert body["meals"]["meals_served"] == 1
    assert body["by_action"]["MESS_SCAN_DENIED"] == 1


def test_meals_are_omitted_when_the_filter_excludes_mess_scans(client, admin_headers):
    """So a caller asking about hostel entries is not handed a meal count."""
    rows(factories.audit_row(action="HOSTEL_ENTRY"))
    body = client.get("/audit-logs/summary?action=HOSTEL_ENTRY", headers=admin_headers).json()
    assert body["meals"] is None


def test_meals_are_present_when_filtering_on_mess_scan(client, admin_headers):
    rows(factories.mess_scan_row("DS23F000001"))
    body = client.get("/audit-logs/summary?action=MESS_SCAN", headers=admin_headers).json()
    assert body["meals"]["meals_served"] == 1


def test_meals_respect_the_window(client, admin_headers):
    yesterday = datetime(2026, 6, 12, 12, 0, 0)
    today = datetime(2026, 6, 13, 12, 0, 0)
    rows(
        factories.mess_scan_row("DS23F000001", day=1, timestamp=yesterday),
        factories.mess_scan_row("DS23F000002", day=2, timestamp=today),
    )
    body = client.get("/audit-logs/summary?since=2026-06-13T00:00:00Z",
                      headers=admin_headers).json()
    assert body["meals"]["meals_served"] == 1


def test_an_empty_trail_summarises_to_zero(client, admin_headers):
    body = client.get("/audit-logs/summary", headers=admin_headers).json()
    assert body["total"] == 0
    assert body["by_action"] == {}
    assert body["actor_ids"] == []
    assert body["meals"]["meals_served"] == 0


def test_a_real_mess_scan_reaches_the_meal_figures(client, admin_headers, make_staff,
                                                   make_participant):
    """
    End to end rather than from seeded rows: the scan endpoint's own audit row is
    what the summary reduces, so a change to either side shows up here.
    """
    from testing.helpers import make_qr

    mess = factories.mess_doc("MESS1", menu=factories.mess_menu({1: ["breakfast"]}),
                              mess_team=[factories.mess_team_member("OTME1111")])
    database.mess_collection.insert_one(mess)
    scanner = make_staff(paradox_id="OTME1111", email="counter@x.com", role="other",
                         department="mess")
    diner = make_participant(mess={"registered": True, "mess_id": mess["_id"], "scans": {}})

    assert client.post("/mess/MESS1/scan?slot=breakfast&day=1", json=make_qr(diner),
                       headers=auth_headers(scanner)).status_code == 200

    meals = client.get("/audit-logs/summary", headers=admin_headers).json()["meals"]
    assert meals["meals_served"] == 1
    assert meals["by_slot"]["breakfast"] == 1
    assert meals["unclassified"] == 0


# ===========================================================================
# POST /embeddings
# ===========================================================================

class FakeEmbeddings:
    def __init__(self, error=None):
        self.calls = []
        self._error = error

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return type("Response", (), {
            "model_dump": lambda _self: {"data": [{"embedding": [0.1, 0.2]}],
                                         "model": kwargs["model"]},
        })()


class FakeClient:
    def __init__(self, error=None):
        self.embeddings = FakeEmbeddings(error=error)


@pytest.fixture()
def provider(monkeypatch):
    """Inject a fake provider; `get_client` is lru_cached so the cache is cleared."""
    from routers import embeddings as module

    client_stub = FakeClient()
    module.get_client.cache_clear()
    monkeypatch.setattr(module, "get_client", lambda: client_stub)
    return client_stub


def test_a_single_string_is_embedded(client, participant, provider):
    response = client.post("/embeddings", json={"input": "hello"},
                           headers=auth_headers(participant))
    assert response.status_code == 200
    assert response.json()["data"][0]["embedding"] == [0.1, 0.2]
    assert provider.embeddings.calls[0]["input"] == "hello"


def test_a_list_of_strings_passes_through_unchanged(client, participant, provider):
    client.post("/embeddings", json={"input": ["a", "b"]}, headers=auth_headers(participant))
    assert provider.embeddings.calls[0]["input"] == ["a", "b"]


def test_the_default_model_is_applied(client, participant, provider):
    from routers.embeddings import EMBEDDINGS_DEFAULT_MODEL

    client.post("/embeddings", json={"input": "hello"}, headers=auth_headers(participant))
    assert provider.embeddings.calls[0]["model"] == EMBEDDINGS_DEFAULT_MODEL


def test_an_explicit_model_wins(client, participant, provider):
    client.post("/embeddings", json={"input": "hello", "model": "text-embedding-3-large"},
                headers=auth_headers(participant))
    assert provider.embeddings.calls[0]["model"] == "text-embedding-3-large"


def test_unset_optional_fields_are_absent_rather_than_null(client, participant, provider):
    """Some local OpenAI-compatible servers reject unrecognised null fields."""
    client.post("/embeddings", json={"input": "hello"}, headers=auth_headers(participant))
    call = provider.embeddings.calls[0]
    assert set(call) == {"input", "model"}


def test_supplied_optional_fields_are_forwarded(client, participant, provider):
    client.post("/embeddings",
                json={"input": "hello", "encoding_format": "base64", "dimensions": 256,
                      "user": "u1"},
                headers=auth_headers(participant))
    call = provider.embeddings.calls[0]
    assert call["encoding_format"] == "base64"
    assert call["dimensions"] == 256
    assert call["user"] == "u1"


def test_a_staff_token_is_also_accepted(client, admin_headers, provider):
    assert client.post("/embeddings", json={"input": "hello"},
                       headers=admin_headers).status_code == 200


def test_no_token_is_refused(client, provider):
    assert client.post("/embeddings", json={"input": "hello"}).status_code in (401, 403)


def test_a_missing_input_is_a_422(client, participant, provider):
    assert client.post("/embeddings", json={}, headers=auth_headers(participant)).status_code == 422


def test_an_unreachable_provider_is_a_502(client, participant, monkeypatch):
    from openai import APIConnectionError

    from routers import embeddings as module

    stub = FakeClient(error=APIConnectionError(request=None))
    module.get_client.cache_clear()
    monkeypatch.setattr(module, "get_client", lambda: stub)

    response = client.post("/embeddings", json={"input": "hello"},
                           headers=auth_headers(participant))
    assert response.status_code == 502
    assert response.json()["detail"] == "Could not reach the embeddings provider"


def test_a_provider_status_error_is_passed_through(client, participant, monkeypatch):
    import httpx
    from openai import APIStatusError

    from routers import embeddings as module

    error = APIStatusError(
        "model not found",
        response=httpx.Response(404, request=httpx.Request("POST", "http://provider")),
        body=None,
    )
    stub = FakeClient(error=error)
    module.get_client.cache_clear()
    monkeypatch.setattr(module, "get_client", lambda: stub)

    response = client.post("/embeddings", json={"input": "hello"},
                           headers=auth_headers(participant))
    assert response.status_code == 404


def test_a_second_call_within_the_window_is_rate_limited(client, participant, provider):
    """One call per user per minute, so this cannot be used as a free-standing
    embeddings proxy."""
    assert client.post("/embeddings", json={"input": "hello"},
                       headers=auth_headers(participant)).status_code == 200
    response = client.post("/embeddings", json={"input": "hello"},
                           headers=auth_headers(participant))
    assert response.status_code == 429
    assert response.json()["detail"] == "Rate limit exceeded: at most 1 request per 60s."


def test_the_refusal_says_when_to_retry(client, participant, provider):
    client.post("/embeddings", json={"input": "hello"}, headers=auth_headers(participant))
    response = client.post("/embeddings", json={"input": "hello"},
                           headers=auth_headers(participant))
    assert 0 < int(response.headers["Retry-After"]) <= 61


def test_the_limit_is_per_user(client, participant, other_participant, provider):
    assert client.post("/embeddings", json={"input": "hello"},
                       headers=auth_headers(participant)).status_code == 200
    assert client.post("/embeddings", json={"input": "hello"},
                       headers=auth_headers(other_participant)).status_code == 200


def test_the_limit_runs_before_the_body_is_validated(client, participant, provider):
    """It is a dependency, so a malformed second request is still a 429."""
    client.post("/embeddings", json={"input": "hello"}, headers=auth_headers(participant))
    assert client.post("/embeddings", json={}, headers=auth_headers(participant)).status_code == 429


def test_the_limit_lapses_once_the_window_passes(client, participant, provider, monkeypatch):
    from routers import embeddings as module

    client.post("/embeddings", json={"input": "hello"}, headers=auth_headers(participant))
    monkeypatch.setattr(module, "RATE_LIMIT_SECONDS", 0)
    assert client.post("/embeddings", json={"input": "hello"},
                       headers=auth_headers(participant)).status_code == 200
