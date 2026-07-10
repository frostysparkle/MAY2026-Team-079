"""Health endpoints"""

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.db.mongo import MongoService


public_router = APIRouter(tags=["health"])
router = APIRouter(prefix="/health", tags=["health"])


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
