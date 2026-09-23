"""Liveness + MongoDB connectivity probe (no connection details exposed)."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..db.mongodb import get_database, ping

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, object]:
    mongo: str = "not_configured"
    if settings.has_mongo:
        try:
            db = get_database(settings.mongodb_uri, settings.mongodb_database)
            mongo = "connected" if await ping(db) else "unreachable"
        except Exception:  # noqa: BLE001 — health must not raise
            mongo = "unreachable"
    return {"status": "ok", "app": settings.app_name, "mongo": mongo}
