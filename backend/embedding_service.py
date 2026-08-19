"""
Server-side embedding generation for workshops, events, and participant
preferences. Talks to whichever OpenAI-compatible provider
`routers.embeddings` is configured for (EMBEDDINGS_* / OPENAI_* env vars),
so there is exactly one place that owns provider configuration.
"""
import logging
import os

from routers.embeddings import get_client, EMBEDDINGS_DEFAULT_MODEL

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 768


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
    if not text or os.getenv("TESTING") == "1":
        return zero_embedding()

    try:
        response = get_client().embeddings.create(
            input=text,
            model=EMBEDDINGS_DEFAULT_MODEL,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        vector = list(response.data[0].embedding)
    except Exception:
        logger.exception("Embedding generation failed; storing a zero vector instead")
        return zero_embedding()

    if len(vector) != EMBEDDING_DIMENSIONS:
        logger.warning(
            "Embeddings provider returned a %d-dim vector, expected %d; storing a zero vector instead",
            len(vector), EMBEDDING_DIMENSIONS,
        )
        return zero_embedding()

    return vector
