"""
The request lifecycle: correlation ids, timing, and the handlers that catch what
nothing was catching before.

Three gaps this closes, all of them things the app simply did not have:

1. **No correlation id.** Any two log lines were unrelatable. A participant
   reporting "it failed at about half four" could not be tied to a stack trace,
   and one request's five log lines could not be told apart from another's five
   interleaved with them. Every response now carries `X-Request-ID`, and every
   line and every audit row carries the same value.

2. **No exception handlers at all.** An unhandled error fell through to
   Starlette's default 500 and a traceback on stderr that nobody was capturing.
   The failure existed for as long as the terminal scrollback lasted.

3. **No timing.** "The dashboard is slow" was unfalsifiable. Every request now
   records its duration, and anything over `LOG_SLOW_REQUEST_MS` is a warning —
   which is how a degrading database announces itself before it becomes an
   outage.

Implemented as raw ASGI rather than `BaseHTTPMiddleware` on purpose. This app
serves two Server-Sent Events streams (`GET /workshops/{id}/seats/stream` and the
event announcement stream), and `BaseHTTPMiddleware` wraps the response in an
extra task with a queue, which interferes with long-lived streaming responses and
their cancellation. A plain ASGI callable adds nothing between the server and the
stream.
"""
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI, Request
from fastapi.exception_handlers import (
    http_exception_handler as default_http_exception_handler,
    request_validation_exception_handler as default_validation_handler,
)
from fastapi.exceptions import RequestValidationError
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import PlainTextResponse

import log_config
import log_context
from log_redaction import fingerprint

_log = log_config.get_logger("paradox.request")

REQUEST_ID_HEADER = "X-Request-ID"

# Above this, a request is reported as slow. One second is generous for an API
# whose heaviest endpoint is an allocation sweep; the point is to catch the
# request that took eleven seconds, not to police the one that took eighty
# milliseconds.
SLOW_REQUEST_MS = float(os.getenv("LOG_SLOW_REQUEST_MS", "1000"))

# Query parameters whose *values* are safe and useful to record. Everything else
# is logged as a bare key, because a query string is exactly where a search term,
# an email address, or a token ends up. These are the operational parameters that
# decide what an endpoint did — the slot and day a meal scan was filed under, the
# entry/exit action at a hostel door — and a refusal cannot be reconstructed
# without them.
_LOGGABLE_QUERY_PARAMS = frozenset(
    {
        "action", "slot", "day", "scan_type", "status", "target_id", "limit",
        "since", "until", "category", "facility_type", "participant_id",
        "mess_id", "hostel_id", "workshop_id", "event_id", "user_id",
        "paradox_id", "slot_id", "role", "department", "gender",
    }
)

# Paths that are noise at INFO: polled constantly and interesting only in
# aggregate. They are still recorded at DEBUG, and their failures are still
# recorded at WARNING or above like anything else.
_LOW_VALUE_PATHS = ("/docs", "/redoc", "/openapi.json", "/favicon.ico")


def _client_ip(scope: Dict[str, Any]) -> Optional[str]:
    """
    The caller's address, preferring the proxy's forwarded header.

    Worth recording because the questions it answers are otherwise unanswerable:
    whether a burst of failed logins came from one machine, and which handheld
    device at which gate is producing malformed scans.
    """
    for name, value in scope.get("headers") or []:
        if name == b"x-forwarded-for":
            # First hop is the original client; the rest are proxies.
            return value.decode("latin-1").split(",")[0].strip() or None
    client = scope.get("client")
    return client[0] if client else None


def _header(scope: Dict[str, Any], wanted: bytes) -> Optional[str]:
    for name, value in scope.get("headers") or []:
        if name == wanted:
            return value.decode("latin-1")
    return None


def _actor_hint(scope: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Who is calling, for labelling purposes only: `(actor_id, actor_type, token_fingerprint)`.

    The token's claims are read **without verification** and without touching the
    database. That is safe precisely because nothing here is a security decision —
    authorization remains entirely `dependencies.py`'s job, which does verify the
    signature and does load the user. This exists so that a line reads "VLME1111
    was scanning" rather than leaving that to be joined by hand later, and so a
    request that is rejected *by* the auth layer still says who presented the
    token.

    An unverifiable or forged token therefore still produces a label. That is the
    correct behaviour for a log: the claim of identity is itself the interesting
    fact when a request is refused.
    """
    header = _header(scope, b"authorization")
    if not header or not header.lower().startswith("bearer "):
        return None, None, None

    token = header.split(" ", 1)[1].strip()
    token_fp = fingerprint(token)
    try:
        from jose import jwt

        claims = jwt.get_unverified_claims(token)
        return claims.get("sub"), claims.get("type"), token_fp
    except Exception:
        # A malformed token is not an error here — `dependencies.py` will refuse
        # it and log the refusal with its reason. All that is lost is the label.
        return None, None, token_fp


def _route_template(scope: Dict[str, Any]) -> Optional[str]:
    """
    The matched route's path template, e.g. `/mess/{mess_id}/scan`.

    Only available after routing, so this is read from the scope *after* the
    application has run — the scope dict is mutated in place by the router, so
    the value is there by the time the response is being logged. The template
    rather than the concrete path, so lines aggregate per endpoint instead of
    fragmenting into one bucket per hall.
    """
    route = scope.get("route")
    path = getattr(route, "path", None)
    if path:
        return path
    endpoint = scope.get("endpoint")
    return getattr(endpoint, "__name__", None)


def _query_fields(scope: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Query parameters, with values kept only for the allowlisted names."""
    raw = scope.get("query_string") or b""
    if not raw:
        return None
    from urllib.parse import parse_qsl

    recorded: Dict[str, Any] = {}
    withheld = []
    try:
        for key, value in parse_qsl(raw.decode("latin-1"), keep_blank_values=True):
            if key in _LOGGABLE_QUERY_PARAMS:
                recorded[key] = value
            else:
                withheld.append(key)
    except Exception:
        return {"query_unparseable": True}
    if withheld:
        recorded["withheld_params"] = sorted(set(withheld))
    return recorded or None


class RequestLogMiddleware:
    """
    Binds a correlation id to every request, then records how it went.

    Sits outermost among the application's middleware so that it sees everything
    below it, including anything CORS handling itself would reject, and so that
    the `X-Request-ID` header is attached to every response the app produces.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            # Lifespan and WebSocket traffic. Nothing to correlate.
            await self.app(scope, receive, send)
            return

        # An inbound id is honoured rather than replaced, so a correlation id
        # generated by the frontend or by a proxy survives into this trail and
        # one identifier spans the whole stack.
        request_id = _header(scope, b"x-request-id") or log_context.new_request_id()
        actor_id, actor_type, token_fp = _actor_hint(scope)
        method = scope.get("method")
        path = scope.get("path", "")

        # Not reset afterwards, deliberately. Each request is served in its own
        # task with its own copy of the context, so these values are discarded
        # when the task ends. Resetting here would instead unbind them *before*
        # `ServerErrorMiddleware` — which sits outside this middleware — gets to
        # run the 500 handler, and that response would lose its correlation id.
        log_context.bind(
            request_id=request_id,
            actor_id=actor_id,
            actor_type=actor_type,
            method=method,
            path=path,
        )

        quiet = path.startswith(_LOW_VALUE_PATHS)
        base: Dict[str, Any] = {
            "http_method": method,
            "http_path": path,
            "client_ip": _client_ip(scope),
            # The credential itself is never written down. Its fingerprint is,
            # because "the same token was presented from two different addresses"
            # and "this one device keeps sending a token we reject" are questions
            # that cannot be answered without something stable to group by.
            "token_fp": token_fp,
        }
        query = _query_fields(scope)
        if query:
            base["query"] = query

        log_config.log_call(
            _log,
            logging.DEBUG,
            f"--> {method} {path}",
            {**base, "user_agent": _header(scope, b"user-agent")},
        )

        started = time.perf_counter()
        status_code: Optional[int] = None

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message).append(REQUEST_ID_HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            route = _route_template(scope)
            log_config.log_call(
                _log,
                logging.ERROR,
                f"!!! {method} {path} raised {type(exc).__name__}",
                {**base, "route": route, "duration_ms": duration_ms, "status": 500},
                exc_info=True,
            )
            _audit_request_failure(exc, actor_id, route or path, base, duration_ms)
            raise
        finally:
            # A crashing request never reaches `send`, so no status was observed.
            # It still gets a finish line, reported as the 500 that
            # `ServerErrorMiddleware` is about to produce above us — without this,
            # every start line had a matching finish line *except* the ones that
            # failed, which is precisely the wrong way round for reading a trail
            # back. `--> ... <-- ...` pairing up for every request is what makes a
            # missing pair mean something (a request still in flight, or a process
            # killed mid-request).
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            route = _route_template(scope)
            slow = duration_ms >= SLOW_REQUEST_MS
            final_status = status_code if status_code is not None else 500

            if final_status >= 500:
                level = logging.ERROR
            elif final_status >= 400 or slow:
                level = logging.WARNING
            elif quiet:
                level = logging.DEBUG
            else:
                level = logging.INFO

            log_config.log_call(
                _log,
                level,
                f"<-- {final_status} {method} {path} ({duration_ms}ms)",
                {
                    **base,
                    "route": route,
                    "status": final_status,
                    "duration_ms": duration_ms,
                    "slow_request": True if slow else None,
                    "response_started": status_code is not None,
                },
            )


def _audit_request_failure(
    exc: Exception,
    actor_id: Optional[str],
    route: str,
    base: Dict[str, Any],
    duration_ms: float,
) -> None:
    """
    Record a crash in the durable trail as well as the file log.

    Skipped when the failure *is* the database, for a practical reason: writing
    an audit row at that moment means waiting out the server-selection timeout on
    every failing request, turning a Mongo outage into a much slower Mongo
    outage. The file log has already captured it with a full traceback, which is
    exactly the situation that trail exists for.
    """
    try:
        from pymongo.errors import PyMongoError

        if isinstance(exc, PyMongoError):
            return
    except Exception:
        pass

    try:
        from logger import log_audit

        log_audit(
            actor_id,
            "REQUEST_FAILED",
            route,
            {
                "reason": "unhandled_exception",
                "exception": type(exc).__name__,
                "message": str(exc)[:500],
                "http_method": base.get("http_method"),
                "http_path": base.get("http_path"),
                "client_ip": base.get("client_ip"),
                "duration_ms": duration_ms,
            },
        )
    except Exception:  # pragma: no cover - defensive
        log_config.log_call(
            _log, logging.ERROR, "could not record REQUEST_FAILED audit row", {}, exc_info=True
        )


# ==========================================================================
# EXCEPTION HANDLERS
#
# The application had none. Each of these logs and then delegates to FastAPI's
# own handler, so response bodies and status codes are unchanged — the only
# difference on the wire is the `X-Request-ID` header, which the middleware adds
# to every response anyway.
# ==========================================================================


async def log_http_exception(request: Request, exc: StarletteHTTPException):
    """
    Every deliberate refusal, with the reasoning attached.

    This is the single highest-value handler in the file. Every `raise
    HTTPException(...)` in the codebase — and there are well over a hundred, most
    of them the guards on the scan and allocation routes — passes through here.
    Before this, the `detail` string went to the client and was then gone.

    A 401 or 403 is logged at WARNING rather than INFO: an authorization refusal
    is the kind of thing that needs to be countable after the fact, whether the
    question is a locked-out volunteer or someone probing the staff endpoints.
    """
    status = exc.status_code
    if status >= 500:
        level = logging.ERROR
    elif status in (401, 403, 409, 429):
        level = logging.WARNING
    else:
        level = logging.INFO

    log_config.log_call(
        _log,
        level,
        f"refused {status} {request.method} {request.url.path}: {exc.detail}",
        {
            "status": status,
            "detail": str(exc.detail)[:500],
            "route": _route_template(request.scope),
            "http_method": request.method,
            "http_path": request.url.path,
            "refusal": True,
        },
    )
    return await default_http_exception_handler(request, exc)


async def log_validation_error(request: Request, exc: RequestValidationError):
    """
    A rejected payload, described by *where* it was wrong rather than what it said.

    Field locations and error types only — never the submitted values. A 422 on
    `/auth/register` or `/profile/complete` carries an email address, a date of
    birth, a phone number and an address, and none of that belongs in a log file.
    The field path is what makes the failure diagnosable, and it is enough.
    """
    problems = []
    for error in exc.errors():
        problems.append(
            {
                "field": ".".join(str(part) for part in error.get("loc", ())),
                "type": error.get("type"),
            }
        )

    log_config.log_call(
        _log,
        logging.WARNING,
        f"invalid payload for {request.method} {request.url.path} ({len(problems)} problem(s))",
        {
            "status": 422,
            "route": _route_template(request.scope),
            "http_method": request.method,
            "http_path": request.url.path,
            "invalid_fields": problems,
            "refusal": True,
        },
    )
    return await default_validation_handler(request, exc)


async def log_unhandled_exception(request: Request, exc: Exception):
    """
    The last line of defence.

    The traceback has already been recorded by the middleware, which holds more
    context than this handler does, so this does not log it a second time. Its
    job is the response: the same `Internal Server Error` body Starlette would
    have produced, with the correlation id attached so that a screenshot of the
    failure leads directly to the traceback behind it.
    """
    request_id = log_context.get_request_id()
    headers = {REQUEST_ID_HEADER: request_id} if request_id else None
    return PlainTextResponse("Internal Server Error", status_code=500, headers=headers)


def install_request_logging(app: FastAPI) -> None:
    """
    Wire the middleware and handlers into an app.

    Called from `main.py` after the CORS middleware is added, which — because
    `add_middleware` inserts at the front of the stack — makes this the
    outermost layer.
    """
    app.add_middleware(RequestLogMiddleware)
    app.add_exception_handler(StarletteHTTPException, log_http_exception)
    app.add_exception_handler(RequestValidationError, log_validation_error)
    app.add_exception_handler(Exception, log_unhandled_exception)


def _count_endpoints(router: Any, _depth: int = 0) -> int:
    """
    How many HTTP endpoints are actually mounted.

    Walked recursively rather than read off `len(app.routes)`: this FastAPI
    version represents each `include_router` call as a single entry in that list,
    so the naive length reports 17 for an app serving well over a hundred
    endpoints. A startup line whose figures are wrong is worse than one with no
    figures at all.
    """
    if _depth > 5:
        return 0
    total = 0
    for route in getattr(router, "routes", []) or []:
        # An `include_router` entry wraps the real router rather than exposing its
        # routes directly, so the actual endpoints hang off `original_router`.
        inner = getattr(route, "original_router", None) or (
            route if getattr(route, "routes", None) else None
        )
        if inner is not None:
            total += _count_endpoints(inner, _depth + 1)
        elif getattr(route, "methods", None) or getattr(route, "endpoint", None):
            total += 1
    return total


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup and shutdown, on the record.

    The app had no lifecycle hooks, so a log file began mid-conversation with no
    statement of what was running or how it was configured. That matters more
    than it sounds: half of reading a trail back is knowing whether the process
    that wrote it was pointed at the right database, and at what log level — a
    trail that is missing DEBUG lines because the level was INFO looks exactly
    like a trail of a request that never happened.

    The database ping happens here rather than at first use so an outage is
    announced at boot instead of being discovered by whichever participant
    happened to press a button first.
    """
    settings = log_config.configure_logging()
    log_config.log_call(
        _log,
        logging.INFO,
        f"Paradox Connect API starting ({app.title})",
        {
            "event": "startup",
            "pid": os.getpid(),
            "log_level": settings.get("log_level"),
            "file_logging": settings.get("file_logging"),
            "log_dir": settings.get("log_dir"),
            "testing_mode": settings.get("testing_mode"),
            "slow_request_ms": SLOW_REQUEST_MS,
            "endpoints": _count_endpoints(app),
        },
    )

    try:
        from database import check_connection

        check_connection()
    except Exception:
        log_config.log_call(
            _log, logging.CRITICAL, "database check could not be run at startup", {}, exc_info=True
        )

    try:
        yield
    finally:
        log_config.log_call(
            _log, logging.INFO, "Paradox Connect API shutting down", {"event": "shutdown", "pid": os.getpid()}
        )
        logging.shutdown()
