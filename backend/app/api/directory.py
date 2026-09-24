"""List APIs for assessments/candidates (Phase 3C read cutover).

Paginated reads over MongoDB. No PrimeHire calls, no writes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import settings
from ..db.mongodb import get_database
from ..models.assessment import AssessmentRepository
from ..models.candidate import CandidateRepository

router = APIRouter()


def _db() -> Any:
    if not settings.has_mongo:
        raise HTTPException(status_code=503, detail="MongoDB is not configured")
    return get_database(settings.mongodb_uri, settings.mongodb_database)


def _page(limit: int, skip: int) -> tuple[int, int]:
    return max(1, min(limit, 200)), max(0, skip)


@router.get("/assessments")
async def list_assessments(
    limit: int = Query(default=50), skip: int = Query(default=0), db: Any = Depends(_db)
) -> dict[str, Any]:
    limit, skip = _page(limit, skip)
    try:
        items = await AssessmentRepository(db).list(limit=limit, skip=skip)
        total = await db["assessments"].count_documents({})
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
        if assessment_id:
            items = await repo.list_by_assessment(assessment_id, limit=limit, skip=skip)
            total = await db["candidates"].count_documents({"assessmentId": assessment_id})
        else:
            items = await repo.list_all(limit=limit, skip=skip)
            total = await db["candidates"].count_documents({})
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=500, detail="Candidate lookup failed.") from None
    return {"items": items, "total": total, "limit": limit, "skip": skip}
