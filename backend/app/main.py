from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health import public_router, router as health_router
from app.core.config import get_settings
from app.db.mongo import MongoService


@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo = MongoService(get_settings())
    mongo.connect()
    app.state.mongo = mongo

    try:
        yield
    finally:
        await mongo.close()


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Paradox Connect API",
        version="0.1.0",
        description="Backend API for Paradox Connect.",
        lifespan=lifespan,
    )
    application.include_router(public_router)
    application.include_router(health_router, prefix="/api/v1")
    application.state.environment = settings.app_env
    return application


app = create_app()
