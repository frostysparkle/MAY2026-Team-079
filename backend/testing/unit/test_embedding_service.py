"""
Unit tests for backend/embedding_service.py.

`generate_embedding` is best-effort by design: it never raises, so a flaky
provider cannot block creating a workshop. That means every failure mode returns
the same zero vector, and the only way to tell them apart is to drive each branch
deliberately.

`TESTING=1` (set by conftest before any import) is itself one of the branches, so
the tests that exercise the live path delete the variable first. Deleting it does
*not* re-point the database — `database.py` bound mongomock at import time — so
this is safe.

The service imports `get_client` *by value* from `routers.embeddings`, so it must
be patched on `embedding_service`, not on the router.
"""
import logging

import pytest

import embedding_service
from embedding_service import EMBEDDING_DIMENSIONS, generate_embedding, zero_embedding


class _FakeEmbeddings:
    def __init__(self, vector=None, error=None):
        self._vector = vector
        self._error = error
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return type("Response", (), {
            "data": [type("Item", (), {"embedding": self._vector})()]
        })()


class _FakeClient:
    def __init__(self, vector=None, error=None):
        self.embeddings = _FakeEmbeddings(vector=vector, error=error)


@pytest.fixture()
def live(monkeypatch):
    """Remove the TESTING short-circuit so the provider path is reachable."""
    monkeypatch.delenv("TESTING", raising=False)


def _install(monkeypatch, client):
    monkeypatch.setattr(embedding_service, "get_client", lambda: client)
    return client


# ---------------------------------------------------------------------------
# zero_embedding
# ---------------------------------------------------------------------------

def test_zero_embedding_is_768_floats():
    vector = zero_embedding()
    assert EMBEDDING_DIMENSIONS == 768
    assert len(vector) == 768
    assert set(vector) == {0.0}


def test_zero_embedding_returns_a_fresh_list_each_time():
    first = zero_embedding()
    first[0] = 1.0
    assert zero_embedding()[0] == 0.0


# ---------------------------------------------------------------------------
# Branch: TESTING=1 short-circuit
# ---------------------------------------------------------------------------

def test_testing_flag_short_circuits_without_touching_the_provider(monkeypatch):
    client = _install(monkeypatch, _FakeClient(vector=[0.5] * 768))
    assert generate_embedding("a real description") == zero_embedding()
    assert client.embeddings.calls == [], "the provider was called under TESTING=1"


def test_the_flag_is_read_per_call_not_at_import(monkeypatch, live):
    client = _install(monkeypatch, _FakeClient(vector=[0.25] * 768))
    assert generate_embedding("text")[0] == 0.25
    monkeypatch.setenv("TESTING", "1")
    assert generate_embedding("text") == zero_embedding()


# ---------------------------------------------------------------------------
# Branch: empty text
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text", ["", "   ", "\n\t", None])
def test_blank_text_short_circuits_even_when_live(monkeypatch, live, text):
    client = _install(monkeypatch, _FakeClient(vector=[0.5] * 768))
    assert generate_embedding(text) == zero_embedding()
    assert client.embeddings.calls == []


# ---------------------------------------------------------------------------
# Branch: happy path
# ---------------------------------------------------------------------------

def test_a_well_formed_vector_is_returned_verbatim(monkeypatch, live):
    vector = [i / 1000 for i in range(768)]
    _install(monkeypatch, _FakeClient(vector=vector))
    assert generate_embedding("a description") == vector


def test_the_request_pins_model_and_dimensions(monkeypatch, live):
    client = _install(monkeypatch, _FakeClient(vector=[0.0] * 768))
    generate_embedding("  a description  ")
    call = client.embeddings.calls[0]
    assert call["dimensions"] == 768
    assert call["model"] == embedding_service.EMBEDDINGS_DEFAULT_MODEL
    assert call["input"] == "a description", "text should be stripped before sending"


def test_the_returned_vector_is_a_new_list(monkeypatch, live):
    """`list(...)` copies, so mutating the stored vector cannot reach back into
    the provider's response object."""
    source = [0.1] * 768
    _install(monkeypatch, _FakeClient(vector=source))
    result = generate_embedding("text")
    result[0] = 9.9
    assert source[0] == 0.1


# ---------------------------------------------------------------------------
# Branch: provider raises
# ---------------------------------------------------------------------------

def test_a_provider_error_yields_zeros_rather_than_raising(monkeypatch, live):
    _install(monkeypatch, _FakeClient(error=RuntimeError("connection reset")))
    assert generate_embedding("text") == zero_embedding()


def test_a_provider_error_is_logged_with_a_traceback(monkeypatch, live, caplog):
    _install(monkeypatch, _FakeClient(error=RuntimeError("connection reset")))
    with caplog.at_level(logging.ERROR, logger="embedding_service"):
        generate_embedding("text")
    assert any(record.exc_info for record in caplog.records)


def test_a_client_that_cannot_even_be_built_yields_zeros(monkeypatch, live):
    def explode():
        raise RuntimeError("no api key")

    monkeypatch.setattr(embedding_service, "get_client", explode)
    assert generate_embedding("text") == zero_embedding()


# ---------------------------------------------------------------------------
# Branch: wrong dimensionality
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("length", [0, 1, 767, 769, 1536])
def test_a_wrongly_sized_vector_is_rejected(monkeypatch, live, length):
    _install(monkeypatch, _FakeClient(vector=[0.1] * length))
    assert generate_embedding("text") == zero_embedding()


def test_a_wrongly_sized_vector_is_logged_as_a_warning(monkeypatch, live, caplog):
    _install(monkeypatch, _FakeClient(vector=[0.1] * 1536))
    with caplog.at_level(logging.WARNING, logger="embedding_service"):
        generate_embedding("text")
    assert any("1536" in record.getMessage() for record in caplog.records)


def test_a_malformed_response_shape_yields_zeros(monkeypatch, live):
    """`response.data[0].embedding` missing is caught by the same blanket
    `except Exception`."""
    class Broken:
        embeddings = type("E", (), {"create": staticmethod(lambda **_: object())})()

    monkeypatch.setattr(embedding_service, "get_client", lambda: Broken())
    assert generate_embedding("text") == zero_embedding()
