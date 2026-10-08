"""List APIs for assessments/candidates (Phase 3C read cutover).

Paginated reads over MongoDB. No PrimeHire calls, no writes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import require_admin_auth
from ..config import settings
from ..db.mongodb import get_database
from ..models.assessment import AssessmentRepository, parse_dt
from ..models.candidate import CandidateRepository

router = APIRouter(dependencies=[Depends(require_admin_auth)])


def _db() -> Any:
    if not settings.has_mongo:
        raise HTTPException(status_code=503, detail="MongoDB is not configured")
    return get_database(settings.mongodb_uri, settings.mongodb_database)


def _page(limit: int, skip: int) -> tuple[int, int]:
    return max(1, min(limit, 200)), max(0, skip)


@router.get("/assessments")
async def list_assessments(
    limit: int = Query(default=50),
    skip: int = Query(default=0),
    search: str | None = Query(default=None),
    round_type: str | None = Query(default=None, alias="roundType"),
    is_active: bool | None = Query(default=None, alias="isActive"),
    since: str | None = Query(default=None),
    db: Any = Depends(_db),
) -> dict[str, Any]:
    limit, skip = _page(limit, skip)
    if round_type is not None and round_type not in ("TECHNICAL", "BASIC", "HR"):
        raise HTTPException(status_code=422, detail="roundType must be TECHNICAL, BASIC, or HR.")
    since_dt: datetime | None = parse_dt(since) if since else None
    if since and since_dt is None:
        raise HTTPException(status_code=422, detail="since must be an ISO timestamp.")
    try:
        repo = AssessmentRepository(db)
        items = await repo.list(
            limit=limit, skip=skip,
            search=(search or "").strip() or None,
            round_type=round_type, is_active=is_active, since=since_dt,
        )
        total = await repo.count(
            search=(search or "").strip() or None,
            round_type=round_type, is_active=is_active, since=since_dt,
        )
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=500, detail="Assessment lookup failed.") from None
    return {"items": items, "total": total, "limit": limit, "skip": skip}


@router.get("/candidates")
async def list_candidates(
    assessment_id: str | None = Query(default=None),
    limit: int = Query(default=50),
    skip: int = Query(default=0),
    db: Any = Depends(_db),
) -> dict[str, Any]:
    limit, skip = _page(limit, skip)
    try:
        repo = CandidateRepository(db)
        not_deleted: dict[str, Any] = {"deletedAt": None}
        if assessment_id:
            items = await repo.list_by_assessment(assessment_id, limit=limit, skip=skip)
            total = await db["candidates"].count_documents(
                {"assessmentId": assessment_id, **not_deleted}
            )
        else:
            items = await repo.list_all(limit=limit, skip=skip)
            total = await db["candidates"].count_documents(not_deleted)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=500, detail="Candidate lookup failed.") from None
    return {"items": items, "total": total, "limit": limit, "skip": skip}
