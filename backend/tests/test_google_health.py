from dataclasses import replace

from fastapi.testclient import TestClient

from app.api import health
from app.core.config import get_settings
from app.main import create_app


def configured_settings():
    return replace(
        get_settings(),
        google_client_id="test-client.apps.googleusercontent.com",
        jwt_secret="test-jwt-secret-that-is-longer-than-32-characters",
    )


def test_google_health_is_ready_when_configuration_and_provider_are_available(
    monkeypatch,
) -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = configured_settings
    monkeypatch.setattr(health, "_google_provider_reachable", lambda: True)

    with TestClient(app) as client:
        response = client.get("/api/v1/health/google")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "google_client_configured": True,
        "jwt_signing_configured": True,
        "provider_reachable": True,
    }
    assert "client.apps.googleusercontent.com" not in response.text


def test_google_health_reports_missing_local_configuration(monkeypatch) -> None:
    settings = replace(
        get_settings(),
        google_client_id=None,
        jwt_secret=None,
    )
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings

    def fail_provider_probe() -> bool:
        raise AssertionError("provider should not be called")

    monkeypatch.setattr(health, "_google_provider_reachable", fail_provider_probe)

    with TestClient(app) as client:
        response = client.get("/api/v1/health/google")

    assert response.status_code == 503
    assert response.json()["status"] == "not_configured"
    assert response.json()["provider_reachable"] is None


def test_google_health_reports_provider_failure(monkeypatch) -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = configured_settings
    monkeypatch.setattr(health, "_google_provider_reachable", lambda: False)

    with TestClient(app) as client:
        response = client.get("/api/v1/health/google")

    assert response.status_code == 503
    assert response.json()["status"] == "provider_unavailable"
    assert response.json()["provider_reachable"] is False
