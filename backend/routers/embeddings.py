import os
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Depends
from openai import OpenAI, APIConnectionError, APIStatusError

from models import EmbeddingRequest
from dependencies import get_current_user

router = APIRouter(prefix="/embeddings", tags=["Embeddings"])

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
def create_embedding(request: EmbeddingRequest, current_user: dict = Depends(get_current_user)):
    """
    Text -> embedding vector(s), proxied to whatever OpenAI-compatible
    provider this deployment is configured for (see the EMBEDDINGS_* /
    OPENAI_* env vars above). Request and response shapes match the openai
    library's `client.embeddings.create(...)` exactly.

    Optional fields are only forwarded when set, rather than as explicit
    nulls, since some local OpenAI-compatible servers reject unrecognised
    null fields.
    """
    kwargs = {"input": request.input, "model": request.model or EMBEDDINGS_DEFAULT_MODEL}
    if request.encoding_format is not None:
        kwargs["encoding_format"] = request.encoding_format
    if request.dimensions is not None:
        kwargs["dimensions"] = request.dimensions
    if request.user is not None:
        kwargs["user"] = request.user

    try:
        response = get_client().embeddings.create(**kwargs)
    except APIConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach the embeddings provider")
    except APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    return response.model_dump()
