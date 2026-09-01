import os
import threading
import time
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Depends
from openai import OpenAI, APIConnectionError, APIStatusError

import log_config
from models import EmbeddingRequest
from dependencies import get_current_user
from logger import log_denied

router = APIRouter(prefix="/embeddings", tags=["Embeddings"])

_log = log_config.get_logger("paradox.embeddings.api")

# In-memory, per-process rate limit: at most one call per RATE_LIMIT_SECONDS
# per authenticated user, keyed on the same id (paradox_id for staff,
# participant_id for participants) the rest of the app uses for
# authorization. This is process-local — there's no shared cache (e.g.
# Redis) in this app yet, so running multiple worker processes would give
# each its own limit; revisit if that changes.
RATE_LIMIT_SECONDS = 60
_last_request_at: dict[str, float] = {}
_rate_limit_lock = threading.Lock()


def _rate_limit_key(current_user: dict) -> str:
    return current_user.get("paradox_id") or current_user.get("participant_id") or str(current_user["_id"])


def rate_limited_user(current_user: dict = Depends(get_current_user)) -> dict:
    """
    Auth dependency wrapping get_current_user with the rate limit above.
    Swap-in replacement for get_current_user wherever the limit should apply.
    """
    key = _rate_limit_key(current_user)
    now = time.monotonic()
    with _rate_limit_lock:
        last = _last_request_at.get(key)
        if last is not None and now - last < RATE_LIMIT_SECONDS:
            retry_after = int(RATE_LIMIT_SECONDS - (now - last)) + 1
            # Audited rather than file-only: this endpoint is the one place a
            # participant's token can drive an outbound call to a paid provider, so
            # somebody hitting the limit repeatedly is worth being able to query.
            log_denied(
                current_user,
                "EMBEDDINGS_RATE_LIMITED",
                None,
                reason="rate_limit_exceeded",
                details={
                    "retry_after_seconds": retry_after,
                    "limit_seconds": RATE_LIMIT_SECONDS,
                    "seconds_since_last": round(now - last, 2),
                },
            )
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: at most 1 request per {RATE_LIMIT_SECONDS}s.",
                headers={"Retry-After": str(retry_after)},
            )
        _last_request_at[key] = now
    return current_user

# openai-library-style configuration: these are exactly the parameters the
# `openai.OpenAI` client itself takes, read from the environment so this
# endpoint can point at OpenAI's cloud API or any OpenAI-compatible server
# (Ollama, LM Studio, vLLM, text-embeddings-inference, ...) purely by
# changing env vars, no code change. EMBEDDINGS_* is checked first so this
# can be configured independently of an OPENAI_API_KEY used elsewhere;
# OPENAI_* is the fallback since it's what the openai SDK itself reads.
EMBEDDINGS_API_KEY = os.getenv("EMBEDDINGS_API_KEY") or os.getenv("OPENAI_API_KEY") or "not-needed"
EMBEDDINGS_BASE_URL = os.getenv("EMBEDDINGS_BASE_URL") or os.getenv("OPENAI_BASE_URL") or None
EMBEDDINGS_ORGANIZATION = os.getenv("EMBEDDINGS_ORGANIZATION") or None
EMBEDDINGS_PROJECT = os.getenv("EMBEDDINGS_PROJECT") or None
EMBEDDINGS_TIMEOUT = float(os.getenv("EMBEDDINGS_TIMEOUT", "60"))
EMBEDDINGS_MAX_RETRIES = int(os.getenv("EMBEDDINGS_MAX_RETRIES", "2"))
EMBEDDINGS_DEFAULT_MODEL = os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")


@lru_cache
def get_client() -> OpenAI:
    """
    One client per process, built lazily so importing this module never
    requires a real API key to be set. Cached (rather than built at import
    time) so tests can monkeypatch this function directly to inject a fake
    client instead of hitting a real provider.
    """
    return OpenAI(
        api_key=EMBEDDINGS_API_KEY,
        base_url=EMBEDDINGS_BASE_URL,
        organization=EMBEDDINGS_ORGANIZATION,
        project=EMBEDDINGS_PROJECT,
        timeout=EMBEDDINGS_TIMEOUT,
        max_retries=EMBEDDINGS_MAX_RETRIES,
    )


@router.post("")
def create_embedding(request: EmbeddingRequest, current_user: dict = Depends(rate_limited_user)):
    """
    Text -> embedding vector(s), proxied to whatever OpenAI-compatible
    provider this deployment is configured for (see the EMBEDDINGS_* /
    OPENAI_* env vars above). Request and response shapes match the openai
    library's `client.embeddings.create(...)` exactly.

    Requires authentication (participant or staff), and is rate limited to
    one call per user per RATE_LIMIT_SECONDS to keep it from being used as a
    free-standing embeddings proxy.

    Optional fields are only forwarded when set, rather than as explicit
    nulls, since some local OpenAI-compatible servers reject unrecognised
    null fields.
    """
    kwargs = {
        "input": request.input,
        "model": request.model or EMBEDDINGS_DEFAULT_MODEL,
        # Nvidia/OpenRouter reject the SDK's base64 default.
        "encoding_format": request.encoding_format or "float",
    }
    if request.dimensions is not None:
        kwargs["dimensions"] = request.dimensions
    if request.user is not None:
        kwargs["user"] = request.user

    started = time.perf_counter()
    try:
        response = get_client().embeddings.create(**kwargs)
    except APIConnectionError as exc:
        # The provider host is recorded because this is the failure that looks like
        # an application bug and never is: a wrong `EMBEDDINGS_BASE_URL`, a provider
        # that is down, or a timeout (`APITimeoutError` is a subclass of this) all
        # arrive here and produce the same 502.
        log_config.error(
            _log,
            "embeddings provider unreachable",
            {
                "reason": "provider_unreachable",
                "base_url": EMBEDDINGS_BASE_URL or "default",
                "model": kwargs.get("model"),
                "timeout_seconds": EMBEDDINGS_TIMEOUT,
                "max_retries": EMBEDDINGS_MAX_RETRIES,
                "error": type(exc).__name__,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "status": 502,
            },
            exc_info=True,
        )
        raise HTTPException(status_code=502, detail="Could not reach the embeddings provider")
    except APIStatusError as e:
        # The provider's own status code is passed through to the caller, so it is
        # worth being explicit in the log about whose failure this is: a 401 here
        # means *our* API key is wrong, not the caller's token.
        log_config.error(
            _log,
            f"embeddings provider returned {e.status_code}",
            {
                "reason": "provider_error_status",
                "provider_status": e.status_code,
                "base_url": EMBEDDINGS_BASE_URL or "default",
                "model": kwargs.get("model"),
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        raise HTTPException(status_code=e.status_code, detail=e.message)

    log_config.info(
        _log,
        "embeddings request proxied",
        {
            "model": kwargs.get("model"),
            "dimensions": kwargs.get("dimensions"),
            # A count and a length, never the text: `input` is arbitrary
            # caller-supplied content.
            "inputs": len(request.input) if isinstance(request.input, list) else 1,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        },
    )
    return response.model_dump()
