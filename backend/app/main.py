"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.health import router as health_router
from .api.migration import router as migration_router
from .api.templates import router as templates_router
from .api.reports import router as reports_router
from .api.assessments import router as assessments_router
from .api.directory import router as directory_router
from .api.candidates import router as candidates_router
from .config import settings
from .db.mongodb import ensure_idempotency_indexes, ensure_indexes, get_database
from .models.audit import ensure_audit_indexes

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Degraded boot: a bad/unreachable URI must not prevent the app (and
    # /api/health, which reports the mongo state) from serving.
    # Credential presence is always logged at boot (presence only, never values).
    # Canonical home: backend/.env (or $BACKEND_ENV_FILE for isolated testing).
    if settings.has_primehire_credentials:
        logger.info("PrimeHire credentials: configured (keys held server-side only, never logged).")
    else:
        logger.warning(
            "PrimeHire credentials: MISSING — assessment/interview sync will stay "
            "'failed' until PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY are set "
            "in backend/.env (the single canonical place)."
        )
    if not settings.has_mongo:
        logger.warning("MONGODB_URI not set — running without database (health only).")
    else:
        try:
            logger.info("Connecting to MongoDB database: '%s'", settings.mongodb_database)
            db = get_database(settings.mongodb_uri, settings.mongodb_database)
            created = await ensure_indexes(db)
            logger.info("MongoDB indexes ensured on database '%s': %s", settings.mongodb_database, created)
            try:
                idem = await ensure_idempotency_indexes(db)
                logger.info("Idempotency indexes ensured: %s", idem)
            except Exception as exc:  # noqa: BLE001 — degraded, writes still work
                logger.warning("Idempotency indexes not ensured: %s", type(exc).__name__)
            try:
                audit_indexes = await ensure_audit_indexes(db)
                logger.info("Audit indexes ensured: %s", audit_indexes)
            except Exception as exc:  # noqa: BLE001 — degraded, audit is best-effort
                logger.warning("Audit indexes not ensured: %s", type(exc).__name__)
        except Exception as exc:  # noqa: BLE001 — boot degraded, health reports it
            logger.warning("MongoDB unavailable at startup: %s", type(exc).__name__)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

_DEFAULT_LOCAL_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

_allow_origins = list(dict.fromkeys(_DEFAULT_LOCAL_ORIGINS + settings.extra_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        # Write-path headers used by the admin UI / API.
        "Idempotency-Key",
        "X-Admin-Key",
        "Cf-Access-Jwt-Assertion",
    ],
    max_age=86400,
)

app.include_router(health_router, prefix="/api")
app.include_router(migration_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(templates_router, prefix="/api")
app.include_router(assessments_router, prefix="/api")
app.include_router(directory_router, prefix="/api")
app.include_router(candidates_router, prefix="/api")
