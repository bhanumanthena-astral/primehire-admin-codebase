"""Liveness + MongoDB connectivity probe (no connection details exposed)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_admin_auth
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
    """PRESENCE ONLY — reports whether keys exist, NOT whether PrimeHire
    accepts them. A `configured: true` here passed zero upstream checks; use
    GET /api/primehire/check (admin-only, live) or a ZZ TEST reaching
    `synced` as proof that keys work.
    """
    if settings.has_primehire_credentials:
        return {"configured": True, "live": "unknown — use /api/primehire/check"}
    raise HTTPException(status_code=401, detail={
        "configured": False,
        "hint": "Set PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY in backend/.env "
                "(the single canonical place) and restart the backend.",
    })


@router.get("/primehire/check")
async def primehire_check(_auth: object = Depends(require_admin_auth)) -> dict[str, object]:
    """ADMIN-ONLY live credential check. Calls PrimeHire
    GET /response/report-not-generated server-side and relays ONLY the
    upstream HTTP status (200 = keys accepted, 401 = rejected). Response
    bodies and keys are never returned, logged, or stored.
    """
    from ..services import primehire_client as remote

    try:
        upstream = await remote.check_upstream()
    except remote.PrimehireError as exc:
        raise HTTPException(status_code=502, detail={
            "upstream": "unreachable",
            "hint": str(exc)[:200],
        }) from None
    if upstream == 401:
        raise HTTPException(status_code=401, detail={"upstream": 401})
    return {"upstream": upstream}

