"""
Request-scoped context for the log trail.

Every log line the backend emits should be able to answer "which request was
this, and who was making it" without the call site having to thread that
information down through every function signature. `contextvars` is what makes
that possible: the middleware binds the facts once when a request arrives, and
any logger anywhere below it — including one inside `embedding_service` or
`pymongo` — picks them up through the filter in `log_config`.

Deliberately dependency-free. It imports nothing from this project, so it can
be imported from `log_config`, `logger`, `database`, and the routers without any
risk of an import cycle.

`contextvars` (rather than a thread-local) is the right primitive here because
FastAPI serves both `def` endpoints on a threadpool and `async def` endpoints on
the event loop. A thread-local would leak between concurrent async requests
sharing one thread; a ContextVar is isolated per task and per thread both.
"""
from contextvars import ContextVar, Token
from typing import Any, Dict, List, Optional
from uuid import uuid4

# The correlation id. One value per inbound HTTP request, echoed back to the
# client as `X-Request-ID`, stamped on every log line and onto every audit row's
# `details.request_id`. This is the single thread that ties a user's screenshot,
# a stack trace, and a database row to one another.
request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)

# Who is making the request, as far as the *logging* layer is concerned. Filled
# in best-effort from the bearer token's claims without any database lookup and
# without verifying anything security-relevant — authorization remains entirely
# `dependencies.py`'s job. This exists only so a line reads "VLME1111 was
# scanning" instead of leaving that to be joined by hand later.
actor_id_var: ContextVar[Optional[str]] = ContextVar("actor_id", default=None)
actor_type_var: ContextVar[Optional[str]] = ContextVar("actor_type", default=None)

# Where the request was aimed. `route` is the *template* ("/mess/{mess_id}/scan")
# rather than the concrete path, so lines aggregate per endpoint instead of
# fragmenting per id.
method_var: ContextVar[Optional[str]] = ContextVar("method", default=None)
path_var: ContextVar[Optional[str]] = ContextVar("path", default=None)
route_var: ContextVar[Optional[str]] = ContextVar("route", default=None)
client_ip_var: ContextVar[Optional[str]] = ContextVar("client_ip", default=None)

_ALL_VARS = {
    "request_id": request_id_var,
    "actor_id": actor_id_var,
    "actor_type": actor_type_var,
    "method": method_var,
    "path": path_var,
    "route": route_var,
    "client_ip": client_ip_var,
}


def new_request_id() -> str:
    """
    A fresh correlation id.

    32 hex characters rather than a dashed UUID: it travels in an HTTP header
    and gets grepped by hand constantly, and the dashes earn nothing.
    """
    return uuid4().hex


def bind(**fields: Optional[str]) -> List[Token]:
    """
    Set context values, returning the tokens needed to undo them.

    Returns tokens rather than mutating and forgetting, so the middleware can
    restore the previous state on the way out. Under a threadpool-executed `def`
    endpoint the same OS thread is reused across requests, and a context left
    dirty would attribute the next request's log lines to the previous
    request's actor.

    Unknown field names are ignored rather than raising: a logging helper must
    never be the reason a request fails.
    """
    tokens: List[Token] = []
    for name, value in fields.items():
        var = _ALL_VARS.get(name)
        if var is not None:
            tokens.append(var.set(value))
    return tokens


def reset(tokens: List[Token]) -> None:
    """Undo a `bind`, restoring whatever was set before it."""
    for token in reversed(tokens):
        try:
            token.var.reset(token)
        except (ValueError, LookupError, RuntimeError):
            # ValueError / LookupError: the token was created in a different
            # context, which is possible when a request is cancelled mid-flight.
            # RuntimeError: this token has already been reset once. Both mean the
            # same thing here — there is nothing left to restore.
            #
            # RuntimeError used to escape, which contradicted the sentence below it:
            # a helper that must "never be the reason a request fails" cannot raise
            # on a double reset. Reachable the moment any caller resets in both a
            # normal path and a `finally`, which is the obvious way to write it. The
            # middleware happens not to today.
            pass


def clear() -> None:
    """Drop every context value. Used at process boundaries, not per request."""
    for var in _ALL_VARS.values():
        var.set(None)


def get_request_id() -> Optional[str]:
    """The current correlation id, if this code is running under a request."""
    return request_id_var.get()


def snapshot() -> Dict[str, Any]:
    """
    Every context value that is currently set.

    Keys whose value is None are omitted, so a line logged outside a request
    (at startup, or from a maintenance script) is not padded with a row of
    nulls.
    """
    return {name: var.get() for name, var in _ALL_VARS.items() if var.get() is not None}
