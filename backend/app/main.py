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
from .api.candidates import router as candidates_router
from .api.auth import router as auth_router
from .api.users import router as users_router
from .api.hiring import router as hiring_router
from .api.resumes import router as resumes_router
from .api.assessments import router as assessments_router
from .api.diagnostics import router as diagnostics_router
from .config import settings, validate_settings
from .db.mongodb import ensure_indexes, get_database

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Fail fast on insecure production config (§2.7). Never caught: boot stops.
    validate_settings()
    # Degraded boot: a bad/unreachable URI must not prevent the app (and
    # /api/health, which reports the mongo state) from serving.
    if not settings.has_mongo:
        logger.warning("MONGODB_URI not set — running without database (health only).")
    else:
        try:
            db = get_database(settings.mongodb_uri, settings.mongodb_database)
            created = await ensure_indexes(db)
            logger.info("MongoDB indexes ensured: %s", created)

            # Seed the default organization on first boot (like ensure_indexes,
            # this is a startup operation, not a migration).
            from .models.organization import seed_default_org

            if await seed_default_org(db):
                logger.info("Default organization seeded.")

            if not settings.is_production:
                from .models.user import seed_default_super_admin
                if await seed_default_super_admin(db):
                    logger.info("Default super admin seeded: admin@primehire.ai")

            # Run any pending schema migrations (§6.2).
            from migrations.runner import run_migrations

            results = await run_migrations(db)
            if results:
                for r in results:
                    logger.info(
                        "Migration %s: %s", r["version"], r["status"]
                    )
        except Exception as exc:  # noqa: BLE001 — boot degraded, health reports it
            logger.warning("MongoDB unavailable at startup: %s", type(exc).__name__)
            if not settings.is_production:
                logger.info("Local/dev mode: activating in-memory database so login and admin operate.")
                try:
                    from .db.mongodb import set_fallback_mock_client
                    fallback_db = set_fallback_mock_client(settings.mongodb_database)
                    await ensure_indexes(fallback_db)
                    from .models.organization import seed_default_org
                    await seed_default_org(fallback_db)
                    from .models.user import seed_default_super_admin
                    await seed_default_super_admin(fallback_db)
                    logger.info("Local fallback database initialized with default super_admin.")
                except Exception as fb_exc:
                    logger.warning("Could not initialize local fallback database: %s", fb_exc)

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
app.include_router(candidates_router, prefix="/api")
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(hiring_router)
app.include_router(resumes_router)
app.include_router(assessments_router)
app.include_router(diagnostics_router)
