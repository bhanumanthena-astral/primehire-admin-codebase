"""Liveness + readiness probes (no secrets or connection details exposed)."""

from __future__ import annotations

import os
import uuid

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..config import settings
from ..db.mongodb import get_database, ping

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, object]:
    """Liveness: always 200 while the process is alive (never checks writability)."""
    mongo: str = "not_configured"
    if settings.has_mongo:
        try:
            db = get_database(settings.mongodb_uri, settings.mongodb_database)
            mongo = "connected" if await ping(db) else "unreachable"
        except Exception:  # noqa: BLE001 — health must not raise
            mongo = "unreachable"
    return {"status": "ok", "app": settings.app_name, "mongo": mongo}


def _storage_writable() -> bool:
    """True when the storage dir exists (created if needed) and accepts a temp file."""
    try:
        target = settings.resolved_storage_dir
        target.mkdir(parents=True, exist_ok=True)
        probe = target / f".ready-{uuid.uuid4().hex}"
        probe.write_bytes(b"ok")
        probe.unlink(missing_ok=True)  # type: ignore[arg-type]
        return os.access(str(target), os.W_OK)
    except Exception:  # noqa: BLE001 — readiness reports, never raises
        return False


@router.get("/ready")
async def ready() -> JSONResponse:
    """Readiness: 200 only when Mongo answers AND storage is writable; else 503."""
    mongo_ok = False
    if settings.has_mongo:
        try:
            db = get_database(settings.mongodb_uri, settings.mongodb_database)
            mongo_ok = await ping(db)
        except Exception:  # noqa: BLE001
            mongo_ok = False
    storage_ok = _storage_writable()
    checks = {
        "mongo": "ok" if mongo_ok else "unavailable",
        "storage": "ok" if storage_ok else "unavailable",
    }
    if mongo_ok and storage_ok:
        return JSONResponse(status_code=200, content={"status": "ready", "checks": checks})
    return JSONResponse(status_code=503, content={"status": "not_ready", "checks": checks})
