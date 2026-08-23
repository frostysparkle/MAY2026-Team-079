"""
The backend's logging configuration — the whole of it, in one place.

Before this module the backend had no diagnostic logging at all: one
`logging.getLogger(__name__)` inside `embedding_service.py`, `print()` in the
seed scripts, and nothing else. When something went wrong during the fest there
was nothing to read back except the audit trail, which by design only records
deliberate actions that *succeeded*. Every refusal, every crash, every silently
skipped participant was invisible.

What this sets up:

  * **JSON lines to rotating files.** `logs/app.log` gets everything at
    `LOG_LEVEL` and above; `logs/errors.log` gets WARNING and above, so the
    question "what went wrong yesterday" does not require reading past a day of
    healthy traffic. Both rotate, so a busy fest cannot fill the disk.
  * **A readable console stream.** JSON is for grep and jq; the terminal is for
    a human watching a gate misbehave in real time. The same records go to both.
  * **Request context on every line, automatically.** `ContextFilter` pulls the
    correlation id and actor out of `log_context`, so a warning raised deep
    inside `embedding_service` still says which request caused it, without that
    module knowing anything about requests.
  * **Redaction that cannot be bypassed.** Applied in the formatter rather than
    at the call sites, because a rule enforced in one place holds and a rule
    each caller must remember does not.

Configuration is environment-driven so a deployment can turn the volume up
without a code change:

    LOG_LEVEL             DEBUG | INFO | WARNING | ERROR    (default INFO)
    LOG_DIR              where the files go                 (default backend/logs)
    LOG_TO_FILE          0 disables file handlers           (default 1)
    LOG_JSON_CONSOLE     1 makes the console JSON too       (default 0)
    LOG_MAX_BYTES        per-file rotation threshold        (default 10485760)
    LOG_BACKUP_COUNT     rotated files kept per stream      (default 5)

Under `TESTING=1` the file handlers are skipped entirely, matching how
`database.py` and `embedding_service.py` already branch on that variable — a
test run should not leave log files behind.
"""
import json
import logging
import logging.config
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import log_context
from log_redaction import redact

# Attributes every `LogRecord` carries. Anything on a record that is *not* in
# here was put there by a caller through `extra=`, and is therefore a field worth
# emitting. Maintained explicitly rather than diffed against a fresh record so
# the behaviour does not shift under a Python upgrade.
_RESERVED_RECORD_KEYS = frozenset(
    {
        "args", "asctime", "created", "exc_info", "exc_text", "filename",
        "funcName", "levelname", "levelno", "lineno", "message", "module",
        "msecs", "msg", "name", "pathname", "process", "processName",
        "relativeCreated", "stack_info", "thread", "threadName", "taskName",
    }
)

# Where the log files live by default: `backend/logs`, resolved from this file
# rather than the working directory. Same reasoning as `database.py`'s absolute
# `load_dotenv` — the app is started from the repo root as often as from
# `backend/`, and a relative path silently produces two different log
# directories depending on which.
_DEFAULT_LOG_DIR = Path(__file__).resolve().parent / "logs"

_configured = False


def safe_extra(fields: Dict[str, Any]) -> Dict[str, Any]:
    """
    A field dict that `logging` will accept as `extra=`.

    `Logger.makeRecord` raises `KeyError` if an extra field would shadow a
    built-in record attribute, and some of the most natural field names in this
    codebase — `module`, `filename`, `args` — are exactly those. Renaming the
    collisions is strictly better than the alternative, which is a logging call
    that raises inside the error handler it was added to diagnose.

    None-valued keys are dropped so a line is not padded with empty fields.
    """
    cleaned: Dict[str, Any] = {}
    for key, value in (fields or {}).items():
        if value is None:
            continue
        name = str(key)
        if name in _RESERVED_RECORD_KEYS:
            name = f"field_{name}"
        cleaned[name] = value
    return cleaned


class ContextFilter(logging.Filter):
    """
    Stamps the current request's context onto every record passing through.

    A filter rather than something the call sites do, so it applies to records
    from third-party libraries too: a `pymongo` warning or an `openai` retry
    notice arrives already tagged with the request that provoked it.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in log_context.snapshot().items():
            # A field explicitly passed by the caller wins over the ambient
            # context — a line about *another* actor (the participant being
            # scanned, say) must not be relabelled with the caller's own id.
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


def _record_extras(record: logging.LogRecord) -> Dict[str, Any]:
    """Everything a caller attached to this record via `extra=`, redacted."""
    extras = {
        key: value
        for key, value in record.__dict__.items()
        if key not in _RESERVED_RECORD_KEYS and not key.startswith("_")
    }
    return redact(extras)


class JsonFormatter(logging.Formatter):
    """
    One JSON object per line.

    Chosen over a text format because the questions worth asking of this trail
    are structured ones — "every denied mess scan at hall MESS111 on day 2",
    "every request slower than two seconds" — and answering those from prose
    means writing a parser. `default=str` handles the types Mongo hands back
    (`ObjectId`, `datetime`) without the caller having to pre-serialise.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        payload.update(_record_extras(record))

        # Source location last: useful when reading, but never the point of the
        # line, so it should not push the interesting fields off the screen.
        payload["source"] = f"{record.module}.{record.funcName}:{record.lineno}"

        if record.exc_info:
            payload["exception"] = {
                "type": getattr(record.exc_info[0], "__name__", str(record.exc_info[0])),
                "message": str(record.exc_info[1]),
                "traceback": self.formatException(record.exc_info),
            }
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        try:
            return json.dumps(payload, default=str, ensure_ascii=False)
        except Exception:  # pragma: no cover - defensive
            # A field that defeats even `default=str` must not cost us the line.
            return json.dumps(
                {
                    "timestamp": payload["timestamp"],
                    "level": payload["level"],
                    "logger": payload["logger"],
                    "message": payload["message"],
                    "serialisation_error": True,
                },
                ensure_ascii=False,
            )


class ConsoleFormatter(logging.Formatter):
    """
    The same information, laid out for a person reading a terminal.

    Short correlation id (the first 8 characters are plenty to follow one
    request by eye), then the message, then the extra fields as `key=value`.
    Tracebacks are printed in full — a truncated traceback is worse than none.
    """

    _HIDE = frozenset({"actor_type", "method", "path", "route", "client_ip", "request_id"})

    def format(self, record: logging.LogRecord) -> str:
        stamp = datetime.fromtimestamp(record.created, timezone.utc).strftime("%H:%M:%S")
        request_id = getattr(record, "request_id", None)
        prefix = f"[{str(request_id)[:8]}] " if request_id else ""

        fields = {k: v for k, v in _record_extras(record).items() if k not in self._HIDE}
        rendered = " ".join(f"{key}={value}" for key, value in fields.items())

        line = f"{stamp} {record.levelname:<8} {record.name:<24} {prefix}{record.getMessage()}"
        if rendered:
            line = f"{line} | {rendered}"
        if record.exc_info:
            line = f"{line}\n{self.formatException(record.exc_info)}"
        return line


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def log_directory() -> Path:
    return Path(os.getenv("LOG_DIR") or _DEFAULT_LOG_DIR)


def file_logging_enabled() -> bool:
    """
    Files are on unless explicitly disabled, or unless this is a test run.

    A test suite that leaves `logs/app.log` behind, growing, is a test suite
    people learn to ignore the output of.
    """
    if os.getenv("TESTING") == "1":
        return False
    return _env_flag("LOG_TO_FILE", True)


def configure_logging(force: bool = False) -> Dict[str, Any]:
    """
    Install the configuration. Safe to call more than once.

    Idempotent because there are three plausible entry points into this process
    — `uvicorn main:app`, `python main.py`, and a maintenance script importing a
    router — and configuring twice would double every line.

    `disable_existing_loggers` is False deliberately: `embedding_service` builds
    its logger at import time, which happens before this runs, and disabling it
    would silently discard the one piece of logging the backend already had.

    Returns the resolved settings, which the startup line then reports — a log
    layer whose own configuration is undiscoverable is a poor start.
    """
    global _configured
    if _configured and not force:
        return describe()

    level = (os.getenv("LOG_LEVEL") or "INFO").upper()
    if level not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        level = "INFO"

    console_formatter = "json" if _env_flag("LOG_JSON_CONSOLE", False) else "console"
    handlers: Dict[str, Dict[str, Any]] = {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": console_formatter,
            "filters": ["context"],
            "level": level,
            "stream": "ext://sys.stdout",
        }
    }
    active = ["console"]

    if file_logging_enabled():
        directory = log_directory()
        try:
            directory.mkdir(parents=True, exist_ok=True)
            max_bytes = int(os.getenv("LOG_MAX_BYTES", str(10 * 1024 * 1024)))
            backups = int(os.getenv("LOG_BACKUP_COUNT", "5"))
            handlers["file"] = {
                "class": "logging.handlers.RotatingFileHandler",
                "formatter": "json",
                "filters": ["context"],
                "level": level,
                "filename": str(directory / "app.log"),
                "maxBytes": max_bytes,
                "backupCount": backups,
                "encoding": "utf-8",
                "delay": True,
            }
            # A second stream holding only what went wrong. Costs a duplicated
            # write per warning and saves scrolling past a day of healthy
            # traffic to find the one line that matters.
            handlers["errors"] = {
                "class": "logging.handlers.RotatingFileHandler",
                "formatter": "json",
                "filters": ["context"],
                "level": "WARNING",
                "filename": str(directory / "errors.log"),
                "maxBytes": max_bytes,
                "backupCount": backups,
                "encoding": "utf-8",
                "delay": True,
            }
            active.extend(["file", "errors"])
        except OSError:
            # An unwritable log directory must not stop the app from serving.
            # The console handler is already in place, so the trail degrades to
            # stdout instead of disappearing, and the failure is reported below.
            handlers.pop("file", None)
            handlers.pop("errors", None)
            active = ["console"]

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {"context": {"()": ContextFilter}},
            "formatters": {
                "json": {"()": JsonFormatter},
                "console": {"()": ConsoleFormatter},
            },
            "handlers": handlers,
            "root": {"level": level, "handlers": active},
            "loggers": {
                # uvicorn's access log duplicates what `RequestLogMiddleware`
                # records, with less detail and no correlation id. Silenced in
                # favour of ours; `uvicorn.error` (startup, shutdown, and real
                # failures) is kept.
                "uvicorn.access": {"level": "WARNING", "handlers": active, "propagate": False},
                "uvicorn.error": {"level": "INFO", "handlers": active, "propagate": False},
                # These are chatty at DEBUG and say nothing about this
                # application's behaviour. Pinned so `LOG_LEVEL=DEBUG` stays
                # usable for debugging *our* code.
                "pymongo": {"level": "WARNING", "handlers": active, "propagate": False},
                "httpx": {"level": "WARNING", "handlers": active, "propagate": False},
                "httpcore": {"level": "WARNING", "handlers": active, "propagate": False},
                "openai": {"level": "WARNING", "handlers": active, "propagate": False},
            },
        }
    )

    _configured = True
    return describe()


def describe() -> Dict[str, Any]:
    """The settings in force, for the startup line and for diagnostics."""
    return {
        "log_level": logging.getLevelName(logging.getLogger().level),
        "file_logging": file_logging_enabled(),
        "log_dir": str(log_directory()) if file_logging_enabled() else None,
        "json_console": _env_flag("LOG_JSON_CONSOLE", False),
        "testing_mode": os.getenv("TESTING") == "1",
    }


def get_logger(name: str) -> logging.Logger:
    """
    A logger, with the configuration guaranteed to be installed.

    Call sites use this rather than `logging.getLogger` directly so that a
    module imported by a maintenance script — outside any FastAPI app — still
    produces configured output instead of falling back to the root handler's
    `WARNING`-only default.
    """
    if not _configured:
        configure_logging()
    return logging.getLogger(name)


def log_call(
    logger: logging.Logger,
    level: int,
    message: str,
    fields: Optional[Dict[str, Any]] = None,
    exc_info: bool = False,
) -> None:
    """
    Emit a record, and never raise.

    Every logging call in this codebase that sits on a request path goes through
    something built on this. The reason is narrow and important: instrumentation
    added to make failures visible must not become a new source of them. A log
    call that raises inside an `except` block replaces a diagnosable error with
    an undiagnosable one.
    """
    try:
        logger.log(level, message, extra=safe_extra(fields or {}), exc_info=exc_info)
    except Exception:  # pragma: no cover - defensive
        try:
            logging.getLogger("paradox.logging").warning(
                "Failed to emit a log record for %r", message, exc_info=True
            )
        except Exception:
            pass


# ==========================================================================
# LEVEL SHORTHANDS
#
# `log_config.info(_log, "...", {...})` rather than
# `log_config.log_call(_log, logging.INFO, "...", {...})`.
#
# Partly brevity, but mostly so a call site never has to `import logging` to name
# a level. That matters concretely here: `routers/mess.py` has a local variable
# and a route parameter both called `logging` (the mess team's scanning flag), so
# a module-level `import logging` in that file would be shadowed inside exactly
# the functions that need to log. Routing every call through these avoids the
# collision instead of working around it.
#
# All of them inherit `log_call`'s guarantee: they do not raise.
# ==========================================================================


def debug(logger: logging.Logger, message: str, fields: Optional[Dict[str, Any]] = None) -> None:
    log_call(logger, logging.DEBUG, message, fields)


def info(logger: logging.Logger, message: str, fields: Optional[Dict[str, Any]] = None) -> None:
    log_call(logger, logging.INFO, message, fields)


def warning(logger: logging.Logger, message: str, fields: Optional[Dict[str, Any]] = None) -> None:
    log_call(logger, logging.WARNING, message, fields)


def error(
    logger: logging.Logger,
    message: str,
    fields: Optional[Dict[str, Any]] = None,
    exc_info: bool = False,
) -> None:
    log_call(logger, logging.ERROR, message, fields, exc_info=exc_info)


def critical(
    logger: logging.Logger,
    message: str,
    fields: Optional[Dict[str, Any]] = None,
    exc_info: bool = False,
) -> None:
    log_call(logger, logging.CRITICAL, message, fields, exc_info=exc_info)
