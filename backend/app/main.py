from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.analysis import router as analysis_router
from app.api.routes.documents import router as documents_router
from app.api.routes.extraction import router as extraction_router
from app.api.routes.health import router as health_router
from app.api.routes.evidence import router as evidence_router
from app.api.routes.verification import router as verification_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.db.session import engine
from app.core.config import Settings
from sqlalchemy.engine import Engine

configure_logging(get_settings().log_level)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    configured_settings: Settings = application.state.settings
    Path(configured_settings.upload_dir).expanduser().mkdir(parents=True, exist_ok=True)
    if configured_settings.environment.lower() in {"development", "test"}:
        Base.metadata.create_all(bind=application.state.engine)
    yield


def create_app(app_settings: Settings | None = None, db_engine: Engine | None = None) -> FastAPI:
    configured_settings = app_settings or get_settings()
    application = FastAPI(
        title=configured_settings.app_name,
        version=configured_settings.app_version,
        lifespan=lifespan,
    )
    application.state.settings = configured_settings
    application.state.engine = db_engine if db_engine is not None else engine
    application.add_middleware(
        CORSMiddleware,
        allow_origins=configured_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Authorization", "Content-Type"],
    )
    application.include_router(health_router, prefix="/api")
    application.include_router(documents_router, prefix="/api")
    application.include_router(extraction_router, prefix="/api")
    application.include_router(evidence_router, prefix="/api")
    application.include_router(verification_router, prefix="/api")
    application.include_router(analysis_router, prefix="/api")
    return application


app = create_app()

