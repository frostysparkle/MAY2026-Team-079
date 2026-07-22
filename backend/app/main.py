from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.admin.routes import router as admin_router
from app.api.health import public_router, router as health_router
from app.auth.routes import router as auth_router
from app.auth.routes import users_router
from app.contacts.routes import router as contacts_router
from app.core.config import get_settings
from app.events.routes import router as events_router
from app.profile.routes import router as profile_router
from app.qr.routes import router as qr_router
from app.queries.routes import router as queries_router
from app.core.errors import ApiError, api_error_handler, validation_error_handler
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
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    application.add_exception_handler(ApiError, api_error_handler)
    application.add_exception_handler(
        RequestValidationError, validation_error_handler
    )
    application.include_router(public_router)
    application.include_router(health_router, prefix="/api/v1")
    application.include_router(auth_router, prefix="/api/v1")
    application.include_router(users_router, prefix="/api/v1")
    application.include_router(profile_router, prefix="/api/v1")
    application.include_router(admin_router, prefix="/api/v1")
    application.include_router(qr_router, prefix="/api/v1")
    application.include_router(events_router, prefix="/api/v1")
    application.include_router(queries_router, prefix="/api/v1")
    application.include_router(contacts_router, prefix="/api/v1")
    application.state.environment = settings.app_env
    return application


app = create_app()
