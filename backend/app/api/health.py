"""Liveness + MongoDB connectivity probe (no connection details exposed)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..db.mongodb import get_database, ping

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, object]:
    mongo: str = "not_configured"
    counts: dict[str, int] = {}
    if settings.has_mongo:
        try:
            db = get_database(settings.mongodb_uri, settings.mongodb_database)
            if await ping(db):
                mongo = "connected"
                for col in ("assessments", "candidates", "reports", "templates"):
                    counts[col] = await db[col].count_documents({})
            else:
                mongo = "unreachable"
        except Exception:  # noqa: BLE001 — health must not raise
            mongo = "unreachable"
    return {
        "status": "ok",
        "app": settings.app_name,
        "mongo": mongo,
        "database": settings.mongodb_database if settings.has_mongo else None,
        "counts": counts,
    }


@router.get("/primehire/status")
async def primehire_status() -> dict[str, object]:
    """Read-only credential presence check (no secrets, no values, no calls).

    200 = keys configured (then PrimeHire decides 200/401 on real calls).
    401 = keys missing — sync will stay 'failed' until backend/.env is fixed.
    """
    if settings.has_primehire_credentials:
        return {"configured": True}
    raise HTTPException(status_code=401, detail={
        "configured": False,
        "hint": "Set PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY in backend/.env "
                "(the single canonical place) and restart the backend.",
    })

