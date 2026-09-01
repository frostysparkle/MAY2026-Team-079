"""
Server-side embedding generation for workshops, events, and participant
preferences. Talks to whichever OpenAI-compatible provider
`routers.embeddings` is configured for (EMBEDDINGS_* / OPENAI_* env vars),
so there is exactly one place that owns provider configuration.
"""
import logging
import os
import time

import log_config
from routers.embeddings import get_client, EMBEDDINGS_DEFAULT_MODEL

# Was `logging.getLogger(__name__)` — the one logger the backend had before this
# layer existed, writing to whatever handler happened to be installed. Routed
# through `log_config` now so its records land in the same files as everything
# else and carry the correlation id of the request that triggered them, which is
# what ties a silently-zeroed embedding to the workshop or profile save that
# caused it.
logger = log_config.get_logger("paradox.embeddings")

# Native size of nvidia/nemotron-3-embed-1b (OpenRouter). That model rejects
# the `dimensions` pin; omit it and store the full vector.
EMBEDDING_DIMENSIONS = 2048


def zero_embedding() -> list[float]:
    return [0.0] * EMBEDDING_DIMENSIONS


def generate_embedding(text: str) -> list[float]:
    """
    Best-effort: on any failure (provider unreachable, misconfigured, wrong
    response shape) this logs and returns a zero vector rather than raising,
    so a flaky/unconfigured embeddings provider never blocks creating or
    editing a workshop, event, or participant profile.

    Short-circuits to a zero vector under TESTING=1 so the test suite never
    depends on a real embeddings provider being reachable; the embeddings
    wiring itself is covered by tests that monkeypatch this function.
    """
    text = (text or "").strip()
    if not text:
        log_config.debug(
            logger, "no text to embed; using a zero vector", {"reason": "empty_text"}
        )
        return zero_embedding()
    if os.getenv("TESTING") == "1":
        return zero_embedding()

    started = time.perf_counter()
    try:
        response = get_client().embeddings.create(
            input=text,
            model=EMBEDDINGS_DEFAULT_MODEL,
            encoding_format="float",
        )
        vector = list(response.data[0].embedding)
    except Exception:
        # The fail-soft behaviour is unchanged and correct — an unreachable provider
        # must not stop a workshop being created. But the *consequence* is silent
        # and lasting: the stored zero vector makes this workshop, event, or profile
        # match nothing in every recommendation from now on, and nothing ever
        # revisits it. So the record carries what was being embedded (its length and
        # the model, never the text) and how long the attempt took, which is what
        # separates a provider that is down from one that is timing out.
        log_config.error(
            logger,
            "embedding generation failed; storing a zero vector instead",
            {
                "reason": "provider_error",
                "model": EMBEDDINGS_DEFAULT_MODEL,
                "text_length": len(text),
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "degraded": True,
            },
            exc_info=True,
        )
        return zero_embedding()

    if len(vector) != EMBEDDING_DIMENSIONS:
        log_config.warning(
            logger,
            f"embeddings provider returned a {len(vector)}-dim vector, expected "
            f"{EMBEDDING_DIMENSIONS}; storing a zero vector instead",
            {
                "reason": "dimension_mismatch",
                "model": EMBEDDINGS_DEFAULT_MODEL,
                "returned_dimensions": len(vector),
                "expected_dimensions": EMBEDDING_DIMENSIONS,
                "text_length": len(text),
                "degraded": True,
            },
        )
        return zero_embedding()

    log_config.debug(
        logger,
        "embedding generated",
        {
            "model": EMBEDDINGS_DEFAULT_MODEL,
            "dimensions": len(vector),
            "text_length": len(text),
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        },
    )
    return vector
