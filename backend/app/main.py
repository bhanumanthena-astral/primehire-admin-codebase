"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.health import router as health_router
from .api.migration import router as migration_router
from .api.reports import router as reports_router
from .api.directory import router as directory_router
from .config import settings
from .db.mongodb import ensure_indexes, get_database

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Degraded boot: a bad/unreachable URI must not prevent the app (and
    # /api/health, which reports the mongo state) from serving.
    if not settings.has_mongo:
        logger.warning("MONGODB_URI not set — running without database (health only).")
    else:
        try:
            db = get_database(settings.mongodb_uri, settings.mongodb_database)
            created = await ensure_indexes(db)
            logger.info("MongoDB indexes ensured: %s", created)
        except Exception as exc:  # noqa: BLE001 — boot degraded, health reports it
            logger.warning("MongoDB unavailable at startup: %s", type(exc).__name__)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

if settings.extra_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.extra_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
        max_age=86400,
    )

app.include_router(health_router, prefix="/api")
app.include_router(migration_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(directory_router, prefix="/api")
