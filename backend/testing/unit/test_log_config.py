"""
Unit tests for backend/log_config.py.

Two behaviours here are load-bearing for the whole test suite and are asserted
explicitly: `file_logging_enabled()` returns False under `TESTING=1` (so the suite
never leaves a growing `logs/app.log` behind), and `log_call` never raises (so
instrumentation added to diagnose failures cannot become one).
"""
import json
import logging
from datetime import datetime, timezone

import pytest

import log_config
from log_config import (
    ConsoleFormatter,
    ContextFilter,
    JsonFormatter,
    describe,
    file_logging_enabled,
    get_logger,
    log_call,
    log_directory,
    safe_extra,
)


def record(**kwargs) -> logging.LogRecord:
    base = {
        "name": "paradox.test",
        "level": logging.INFO,
        "pathname": __file__,
        "lineno": 42,
        "msg": "hello",
        "args": (),
        "exc_info": None,
    }
    extras = kwargs.pop("extras", {})
    base.update(kwargs)
    made = logging.LogRecord(**base)
    for key, value in extras.items():
        setattr(made, key, value)
    return made


@pytest.fixture()
def reconfigure():
    """Reconfigure inside a test and put the original settings back afterwards."""
    yield
    log_config._configured = False
    log_config.configure_logging(force=True)


# ---------------------------------------------------------------------------
# safe_extra
# ---------------------------------------------------------------------------

def test_ordinary_fields_pass_through():
    assert safe_extra({"mess_id": "MESS1", "day": 2}) == {"mess_id": "MESS1", "day": 2}


@pytest.mark.parametrize("reserved", ["module", "filename", "args", "message", "name",
                                      "process", "lineno", "levelname", "taskName"])
def test_a_field_that_would_shadow_a_record_attribute_is_renamed(reserved):
    """`Logger.makeRecord` raises KeyError on a collision, and `module` /
    `filename` are exactly the names this codebase reaches for."""
    assert safe_extra({reserved: "x"}) == {f"field_{reserved}": "x"}


def test_none_valued_fields_are_dropped():
    assert safe_extra({"a": 1, "b": None}) == {"a": 1}


def test_falsy_but_present_values_are_kept():
    assert safe_extra({"applied": False, "count": 0, "note": ""}) == {
        "applied": False, "count": 0, "note": "",
    }


def test_non_string_keys_are_stringified():
    assert safe_extra({1: "a"}) == {"1": "a"}


def test_none_and_empty_inputs_are_accepted():
    assert safe_extra(None) == {}
    assert safe_extra({}) == {}


def test_a_renamed_field_is_actually_accepted_by_logging():
    logger = get_logger("paradox.test.rename")
    logger.info("x", extra=safe_extra({"module": "mess"}))  # would raise unrenamed


# ---------------------------------------------------------------------------
# ContextFilter
# ---------------------------------------------------------------------------

def test_the_filter_stamps_ambient_context_onto_a_record():
    import log_context

    log_context.bind(request_id="abc123", actor_id="SAWO1111")
    made = record()
    assert ContextFilter().filter(made) is True
    assert made.request_id == "abc123"
    assert made.actor_id == "SAWO1111"


def test_an_explicit_field_wins_over_the_ambient_context():
    """A line about the participant being scanned must not be relabelled with the
    scanning volunteer's id."""
    import log_context

    log_context.bind(actor_id="SAWO1111")
    made = record(extras={"actor_id": "DS23F000001"})
    ContextFilter().filter(made)
    assert made.actor_id == "DS23F000001"


def test_the_filter_always_admits_the_record():
    assert ContextFilter().filter(record()) is True


# ---------------------------------------------------------------------------
# JsonFormatter
# ---------------------------------------------------------------------------

def test_a_json_line_carries_the_standard_envelope():
    payload = json.loads(JsonFormatter().format(record()))
    assert payload["level"] == "INFO"
    assert payload["logger"] == "paradox.test"
    assert payload["message"] == "hello"
    assert payload["timestamp"].endswith("Z")
    assert payload["source"].endswith(":42")


def test_the_timestamp_is_utc_iso_with_a_zulu_marker():
    made = record()
    payload = json.loads(JsonFormatter().format(made))
    expected = (
        datetime.fromtimestamp(made.created, timezone.utc).isoformat().replace("+00:00", "Z")
    )
    assert payload["timestamp"] == expected


def test_caller_fields_are_included_and_redacted():
    payload = json.loads(JsonFormatter().format(
        record(extras={"mess_id": "MESS1", "password": "hunter2"})
    ))
    assert payload["mess_id"] == "MESS1"
    assert payload["password"] == "[redacted]"


def test_an_exception_is_rendered_as_a_structured_object():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        made = record(exc_info=sys.exc_info())
    payload = json.loads(JsonFormatter().format(made))
    assert payload["exception"]["type"] == "ValueError"
    assert payload["exception"]["message"] == "boom"
    assert "Traceback" in payload["exception"]["traceback"]


def test_mongo_types_are_serialised_rather_than_crashing_the_line():
    from bson import ObjectId

    payload = json.loads(JsonFormatter().format(
        record(extras={"oid": ObjectId(), "at": datetime(2026, 6, 13)})
    ))
    assert isinstance(payload["oid"], str)
    assert payload["at"].startswith("2026-06-13")


def test_a_caller_field_named_source_is_overwritten_by_the_real_one():
    payload = json.loads(JsonFormatter().format(record(extras={"source": "mine"})))
    assert payload["source"] != "mine"


def test_non_ascii_survives_unescaped():
    # `actor_name` rather than `name`: `name` is a reserved LogRecord attribute
    # and is deliberately excluded from the emitted extras — which is exactly why
    # `safe_extra` renames it. See test_a_field_that_would_shadow... above.
    payload = json.loads(JsonFormatter().format(record(extras={"actor_name": "Sørën"})))
    assert payload["actor_name"] == "Sørën"


def test_reserved_attributes_are_never_emitted_as_caller_fields():
    """
    A reserved name is excluded from the extras the formatter renders — it only
    ever reaches the record by shadowing the real attribute, which is what
    `safe_extra` renames to prevent.
    """
    payload = json.loads(JsonFormatter().format(record(extras={"lineno": 999})))
    assert "lineno" not in payload
    assert "levelname" not in payload


def test_private_attributes_are_not_emitted():
    payload = json.loads(JsonFormatter().format(record(extras={"_internal": "x"})))
    assert "_internal" not in payload


# ---------------------------------------------------------------------------
# ConsoleFormatter
# ---------------------------------------------------------------------------

def test_a_console_line_leads_with_time_level_and_logger():
    line = ConsoleFormatter().format(record())
    assert "INFO" in line
    assert "paradox.test" in line
    assert line.rstrip().endswith("hello")


def test_a_short_correlation_id_is_shown_when_present():
    line = ConsoleFormatter().format(record(extras={"request_id": "abcdef1234567890"}))
    assert "[abcdef12]" in line
    assert "abcdef1234567890" not in line


def test_extra_fields_render_as_key_values_after_a_pipe():
    line = ConsoleFormatter().format(record(extras={"mess_id": "MESS1", "day": 2}))
    assert "| " in line
    assert "mess_id=MESS1" in line
    assert "day=2" in line


def test_routing_noise_is_hidden_from_the_console_tail():
    line = ConsoleFormatter().format(record(extras={
        "path": "/mess/MESS1/scan", "method": "POST", "client_ip": "1.2.3.4",
        "actor_type": "staff", "route": "/mess/{mess_id}/scan", "mess_id": "MESS1",
    }))
    assert "mess_id=MESS1" in line
    for hidden in ("path=", "method=", "client_ip=", "actor_type=", "route="):
        assert hidden not in line


def test_a_console_line_still_redacts():
    assert "hunter2" not in ConsoleFormatter().format(record(extras={"password": "hunter2"}))


def test_a_traceback_is_printed_in_full():
    import sys

    try:
        raise ValueError("boom")
    except ValueError:
        line = ConsoleFormatter().format(record(exc_info=sys.exc_info()))
    assert "Traceback" in line and "ValueError: boom" in line


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def test_file_logging_is_off_during_tests():
    """The property that keeps this suite from writing backend/logs/app.log."""
    assert file_logging_enabled() is False


def test_testing_beats_an_explicit_request_for_file_logging(monkeypatch):
    monkeypatch.setenv("LOG_TO_FILE", "1")
    assert file_logging_enabled() is False


def test_file_logging_defaults_on_outside_a_test_run(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    assert file_logging_enabled() is True


@pytest.mark.parametrize("value,expected", [
    ("0", False), ("false", False), ("no", False), ("off", False),
    ("1", True), ("true", True), ("YES", True), ("On", True),
])
def test_the_flag_parser_accepts_the_usual_spellings(monkeypatch, value, expected):
    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.setenv("LOG_TO_FILE", value)
    assert file_logging_enabled() is expected


def test_the_log_directory_defaults_beside_the_module():
    assert log_directory().name == "logs"


def test_the_log_directory_is_overridable(monkeypatch, tmp_path):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    assert log_directory() == tmp_path


def test_describe_reports_the_settings_in_force():
    settings = describe()
    assert settings["testing_mode"] is True
    assert settings["file_logging"] is False
    assert settings["log_dir"] is None
    assert settings["log_level"] in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def test_configure_is_idempotent_and_does_not_duplicate_handlers(reconfigure):
    log_config.configure_logging()
    before = list(logging.getLogger().handlers)
    log_config.configure_logging()
    assert list(logging.getLogger().handlers) == before


def test_a_forced_reconfigure_replaces_rather_than_appends(reconfigure):
    log_config.configure_logging(force=True)
    count = len(logging.getLogger().handlers)
    log_config.configure_logging(force=True)
    assert len(logging.getLogger().handlers) == count


def test_an_invalid_level_falls_back_to_info(monkeypatch, reconfigure):
    monkeypatch.setenv("LOG_LEVEL", "VERBOSE")
    assert log_config.configure_logging(force=True)["log_level"] == "INFO"


@pytest.mark.parametrize("level", ["DEBUG", "WARNING", "ERROR", "CRITICAL"])
def test_a_valid_level_is_honoured(monkeypatch, reconfigure, level):
    monkeypatch.setenv("LOG_LEVEL", level)
    assert log_config.configure_logging(force=True)["log_level"] == level


def test_the_level_is_read_at_configure_time_not_import_time(monkeypatch, reconfigure):
    monkeypatch.setenv("LOG_LEVEL", "debug")
    assert log_config.configure_logging(force=True)["log_level"] == "DEBUG"


def test_no_file_handlers_are_installed_during_tests(reconfigure):
    log_config.configure_logging(force=True)
    kinds = {type(h).__name__ for h in logging.getLogger().handlers}
    assert "RotatingFileHandler" not in kinds


def test_get_logger_configures_on_first_use(reconfigure):
    log_config._configured = False
    get_logger("paradox.test.lazy")
    assert log_config._configured is True


def test_noisy_third_party_loggers_are_pinned(reconfigure):
    log_config.configure_logging(force=True)
    for name in ("pymongo", "httpx", "httpcore", "openai", "uvicorn.access"):
        assert logging.getLogger(name).level >= logging.WARNING


def test_existing_loggers_are_not_disabled(reconfigure):
    """`embedding_service` builds its logger at import time, before configure
    runs; disabling it would discard the only logging the backend already had."""
    log_config.configure_logging(force=True)
    assert logging.getLogger("embedding_service").disabled is False


# ---------------------------------------------------------------------------
# log_call and the level shorthands
# ---------------------------------------------------------------------------

def test_log_call_emits_the_record(caplog):
    logger = get_logger("paradox.test.emit")
    with caplog.at_level(logging.INFO, logger="paradox.test.emit"):
        log_call(logger, logging.INFO, "a message", {"mess_id": "MESS1"})
    assert caplog.records[-1].getMessage() == "a message"
    assert caplog.records[-1].mess_id == "MESS1"


def test_log_call_never_raises_on_a_reserved_field_name():
    log_call(get_logger("paradox.test.safe"), logging.INFO, "m", {"module": "x", "args": (1,)})


def test_log_call_never_raises_when_the_logger_itself_is_broken():
    class Broken:
        def log(self, *_args, **_kwargs):
            raise RuntimeError("handler exploded")

    log_call(Broken(), logging.ERROR, "m", {"a": 1})


def test_log_call_accepts_no_fields_at_all():
    log_call(get_logger("paradox.test.bare"), logging.INFO, "m")


def test_exc_info_is_forwarded(caplog):
    logger = get_logger("paradox.test.exc")
    with caplog.at_level(logging.ERROR, logger="paradox.test.exc"):
        try:
            raise ValueError("boom")
        except ValueError:
            log_call(logger, logging.ERROR, "failed", {}, exc_info=True)
    assert caplog.records[-1].exc_info is not None


@pytest.mark.parametrize("name,level", [
    ("debug", logging.DEBUG), ("info", logging.INFO), ("warning", logging.WARNING),
    ("error", logging.ERROR), ("critical", logging.CRITICAL),
])
def test_each_shorthand_logs_at_its_level(caplog, name, level):
    logger = get_logger("paradox.test.levels")
    with caplog.at_level(logging.DEBUG, logger="paradox.test.levels"):
        getattr(log_config, name)(logger, "m", {"k": "v"})
    assert caplog.records[-1].levelno == level


def test_the_shorthands_exist_so_call_sites_need_no_logging_import():
    """`routers/mess.py` has a local variable named `logging`, which would shadow
    the module inside exactly the functions that need to log."""
    for name in ("debug", "info", "warning", "error", "critical"):
        assert callable(getattr(log_config, name))
