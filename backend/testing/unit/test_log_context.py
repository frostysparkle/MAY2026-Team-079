"""
Unit tests for backend/log_context.py — the per-request correlation context.

The contract that matters: values set for one request must never be attributed to
another. Under a `def` (threadpool) endpoint the same OS thread serves many
requests, so `bind`/`reset` returning and honouring tokens is what keeps one
participant's scan from being logged under the previous caller's id.
"""
import re

import pytest

import log_context
from log_context import bind, clear, get_request_id, new_request_id, reset, snapshot

KNOWN_FIELDS = {"request_id", "actor_id", "actor_type", "method", "path", "route", "client_ip"}


def test_a_request_id_is_32_hex_characters_with_no_dashes():
    value = new_request_id()
    assert re.fullmatch(r"[0-9a-f]{32}", value)
    assert "-" not in value


def test_request_ids_are_unique():
    assert len({new_request_id() for _ in range(200)}) == 200


def test_the_context_starts_empty():
    """Guaranteed by the autouse `reset_process_state` fixture, which is what
    keeps one test's request id out of the next test's audit rows."""
    assert snapshot() == {}
    assert get_request_id() is None


def test_bind_then_read():
    bind(request_id="abc123", actor_id="SAWO1111", actor_type="staff")
    assert get_request_id() == "abc123"
    assert snapshot() == {"request_id": "abc123", "actor_id": "SAWO1111", "actor_type": "staff"}


def test_the_full_field_set_is_bindable():
    bind(**{name: name for name in KNOWN_FIELDS})
    assert set(snapshot()) == KNOWN_FIELDS


def test_unknown_fields_are_ignored_rather_than_raising():
    """A logging helper must never be the reason a request fails."""
    tokens = bind(request_id="abc", nonsense="x", also_unknown=1)
    assert snapshot() == {"request_id": "abc"}
    assert len(tokens) == 1, "only known fields produce tokens"


def test_reset_restores_the_previous_value_not_just_none():
    outer = bind(request_id="outer")
    inner = bind(request_id="inner")
    assert get_request_id() == "inner"
    reset(inner)
    assert get_request_id() == "outer", "nesting must unwind one level, not to empty"
    reset(outer)
    assert get_request_id() is None


def test_reset_unwinds_in_reverse_order():
    tokens = bind(request_id="a", actor_id="b")
    reset(tokens)
    assert snapshot() == {}


def test_reset_tolerates_an_already_used_token():
    """A helper documented as never worth failing a response over cannot raise on a
    double reset — which is what a caller resetting in both a normal path and a
    `finally` does."""
    tokens = bind(request_id="a")
    reset(tokens)
    reset(tokens)
    assert get_request_id() is None


def test_a_double_reset_leaves_the_context_clean():
    """Not merely swallowed: the value stays unset rather than being restored."""
    tokens = bind(request_id="a", actor_id="b")
    reset(tokens)
    reset(tokens)
    assert snapshot() == {}


def test_reset_tolerates_the_errors_it_does_guard_against():
    """A token whose context is gone yields LookupError/ValueError, both caught."""
    import contextvars

    holder = {}

    def inner():
        holder["tokens"] = bind(request_id="from-another-context")

    contextvars.copy_context().run(inner)
    reset(holder["tokens"])
    assert get_request_id() is None


def test_reset_of_an_empty_list_is_a_no_op():
    reset([])
    assert snapshot() == {}


def test_clear_drops_everything():
    bind(request_id="abc", actor_id="X", method="GET", path="/mess")
    clear()
    assert snapshot() == {}
    assert get_request_id() is None


def test_snapshot_omits_unset_values():
    """A line logged outside a request is not padded with a row of nulls."""
    bind(request_id="abc")
    assert snapshot() == {"request_id": "abc"}


def test_binding_none_explicitly_removes_a_field_from_the_snapshot():
    bind(request_id="abc", actor_id="X")
    bind(actor_id=None)
    assert snapshot() == {"request_id": "abc"}


def test_every_var_is_registered_in_the_lookup_table():
    """`bind` silently ignores anything absent from `_ALL_VARS`, so a var added
    without registering it would be permanently unbindable."""
    module_vars = {
        name.removesuffix("_var")
        for name in dir(log_context)
        if name.endswith("_var")
    }
    assert module_vars == set(log_context._ALL_VARS)
    assert set(log_context._ALL_VARS) == KNOWN_FIELDS


def test_the_request_id_reaches_an_audit_row(participant):
    """
    The integration point: `log_audit` stamps `details.request_id` from this
    context, which is what ties a durable row back to the request that caused it.
    """
    import database
    from logger import log_audit

    bind(request_id="deadbeef")
    log_audit(participant, "PING")
    assert database.system_logs_collection.find_one({})["details"]["request_id"] == "deadbeef"


def test_a_caller_supplied_request_id_is_not_overwritten(participant):
    import database
    from logger import log_audit

    bind(request_id="ambient")
    log_audit(participant, "PING", None, {"request_id": "explicit"})
    assert database.system_logs_collection.find_one({})["details"]["request_id"] == "explicit"


def test_no_request_id_means_no_key_rather_than_a_null(participant):
    import database
    from logger import log_audit

    log_audit(participant, "PING", None, {"a": 1})
    assert database.system_logs_collection.find_one({})["details"] == {"a": 1}
