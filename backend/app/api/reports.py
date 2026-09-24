"""Report retrieval API (Phase 3B): MongoDB-first, no PrimeHire fallback.

GET /api/reports/{interviewId} serves the persisted normalized report.
Upstream fetching lives in the backfill service, never in this route —
a Mongo hit therefore performs zero PrimeHire calls by construction.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..db.mongodb import get_database
from ..models.report import ReportRepository

router = APIRouter()

_MOCK_PREFIX = "int-"


def _db() -> Any:
    if not settings.has_mongo:
        raise HTTPException(status_code=503, detail="MongoDB is not configured")
    return get_database(settings.mongodb_uri, settings.mongodb_database)


def to_contract(doc: dict[str, Any]) -> dict[str, Any]:
    """Public response: normalized report + metadata. Internal storage
    details (raw/rawResponse/_id/createdAt/error) stay server-side."""
    return {
        "status": doc.get("status"),
        "source": doc.get("source", "primehire"),
        "schemaVersion": doc.get("schemaVersion", 1),
        "interviewId": doc.get("interviewId"),
        "candidateId": doc.get("candidateId"),
        "assessmentId": doc.get("assessmentId"),
        "responseId": doc.get("responseId"),
        "report": doc.get("normalized"),
        "normalizedScores": doc.get("normalizedScores"),
        "videoRefs": doc.get("videoRefs", []),
        "fetchedAt": doc.get("fetchedAt"),
        "updatedAt": doc.get("updatedAt"),
    }


@router.get("/reports/{interview_id}")
async def get_report(interview_id: str, db: Any = Depends(_db)) -> dict[str, Any]:
    cleaned = (interview_id or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail={"code": "INVALID_ID",
                                                     "message": "interviewId must not be empty."})
    if cleaned.startswith(_MOCK_PREFIX):
        raise HTTPException(status_code=400, detail={"code": "MOCK_ID",
                                                     "message": "Mock interview IDs are not retrievable."})
    try:
        doc = await ReportRepository(db).get_by_interview_id(cleaned)
    except Exception:  # noqa: BLE001 — controlled 5xx, never a stack trace
        raise HTTPException(status_code=500, detail="Report lookup failed.") from None
    if doc is None:
        raise HTTPException(status_code=404, detail={"code": "REPORT_NOT_FOUND",
                                                     "message": "No stored report was found for this interview."})
    return to_contract(doc)
