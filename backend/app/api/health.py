"""Health endpoints"""

import asyncio
from typing import Annotated, Literal

import requests
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from fastapi.responses import JSONResponse

from app.core.config import Settings, get_settings
from app.db.mongo import MongoService


public_router = APIRouter(tags=["health"])
router = APIRouter(prefix="/health", tags=["health"])

GOOGLE_DISCOVERY_URL = (
    "https://accounts.google.com/.well-known/openid-configuration"
)


class GoogleAuthHealthResponse(BaseModel):
    status: Literal["ready", "not_configured", "provider_unavailable"]
    google_client_configured: bool
    jwt_signing_configured: bool
    provider_reachable: bool | None


def _mongo_service(request: Request) -> MongoService:
    return request.app.state.mongo


@public_router.get("/", summary="Show that the API is running")
async def root() -> dict[str, str]:
    return {"message": "FastAPI + AsyncMongoClient is running. Try GET /ping-db"}


@public_router.get("/ping-db", summary="Check whether MongoDB is reachable")
async def ping_database(request: Request):
    if not await _mongo_service(request).ping():
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"ok": False, "error": "MongoDB is not configured or reachable."},
        )

    return {"ok": True, "message": "MongoDB is reachable"}


@router.get("/live", summary="Check whether the API process is running")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Check whether MongoDB is reachable")
async def readiness(request: Request) -> dict[str, str]:
    if not await _mongo_service(request).ping():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB is not configured or reachable.",
        )

    return {"status": "ready"}


def _google_provider_reachable() -> bool:
    try:
        provider_response = requests.get(GOOGLE_DISCOVERY_URL, timeout=3)
        provider_response.raise_for_status()
        discovery = provider_response.json()
    except (requests.RequestException, ValueError):
        return False

    return (
        discovery.get("issuer") == "https://accounts.google.com"
        and isinstance(discovery.get("jwks_uri"), str)
    )


@router.get(
    "/google",
    response_model=GoogleAuthHealthResponse,
    summary="Check Google authentication readiness",
)
async def google_auth_health(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleAuthHealthResponse:
    client_configured = settings.google_client_id is not None
    jwt_configured = settings.jwt_secret is not None and len(settings.jwt_secret) >= 32

    if not client_configured or not jwt_configured:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return GoogleAuthHealthResponse(
            status="not_configured",
            google_client_configured=client_configured,
            jwt_signing_configured=jwt_configured,
            provider_reachable=None,
        )

    provider_reachable = await asyncio.to_thread(_google_provider_reachable)
    if not provider_reachable:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return GoogleAuthHealthResponse(
            status="provider_unavailable",
            google_client_configured=True,
            jwt_signing_configured=True,
            provider_reachable=False,
        )

    return GoogleAuthHealthResponse(
        status="ready",
        google_client_configured=True,
        jwt_signing_configured=True,
        provider_reachable=True,
    )
