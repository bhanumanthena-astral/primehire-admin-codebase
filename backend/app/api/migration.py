"""One-time localStorage import endpoint (Phase 2).

Protected by a server-side MIGRATION_SECRET (X-Migration-Secret header).
Empty/missing secret => 403 disabled. The secret is never logged.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from ..config import settings
from ..db.mongodb import get_database
from ..services import migration_service

router = APIRouter()


from ..auth import require_admin_auth


def require_migration_secret(request: Request) -> None:
    # 1. Check admin auth first (Cloudflare Access JWT or Admin API Key)
    try:
        if settings.cloudflare_access_aud or settings.admin_api_key or settings.disable_auth:
            admin_claims = require_admin_auth(request)
            if admin_claims.get("role") == "admin":
                return
    except HTTPException:
        pass

    # 2. Check legacy migration secret if configured
    if not settings.migration_secret:
        raise HTTPException(status_code=403, detail="Migration endpoint is disabled")
    provided = request.headers.get("x-migration-secret", "")
    if provided != settings.migration_secret:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/migration/import")
async def import_local_data(
    payload: dict[str, Any], dryRun: bool = False, _guard: None = Depends(require_migration_secret)
) -> dict[str, Any]:
    if not settings.has_mongo:
        raise HTTPException(status_code=503, detail="MongoDB is not configured")
    db = get_database(settings.mongodb_uri, settings.mongodb_database)
    if dryRun:
        return await migration_service.dry_run(db, payload)
    return await migration_service.run_import(db, payload)
