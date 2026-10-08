"""Report retrieval API (Phase 3B): MongoDB-first, no PrimeHire fallback.

GET /api/reports/{interviewId} serves the persisted normalized report.
Upstream fetching lives in the backfill service, never in this route —
a Mongo hit therefore performs zero PrimeHire calls by construction.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_admin_auth
from ..config import settings
from ..db.mongodb import get_database
from ..models.candidate import CandidateRepository
from ..models.report import ReportRepository
from ..services.primehire_client import PrimehireError, fetch_interview_report

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_admin_auth)])

_MOCK_PREFIX = "int-"

# Path identifiers are app-generated keys (CAND-*, job ids, hex interview
# ids). Restrict the charset so the upstream URL can never be influenced
# beyond a single path segment (no slashes, dots, or scheme tricks).
_ID_PATTERN = re.compile(r"^[A-Za-z0-9_\-.]+$")
_MAX_ID_LEN = 200
_INTERVIEW_ID_PATTERN = re.compile(r"^[A-Za-z0-9_\-]+$")


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


@router.get("/reports/jobs/{job_id}/candidates/{candidate_id}")
async def get_live_report(
    job_id: str, candidate_id: str, db: Any = Depends(_db)
) -> Any:
    """Live View Report proxy (secure backend-to-backend flow).

    The browser calls ONLY this endpoint with the Job ID + Candidate ID it
    already knows (existing app session auth via ``require_admin_auth``).
    The server resolves the PrimeHire ``interviewId`` from its own MongoDB
    candidate record, injects ``x-access-key`` / ``x-secret-key`` from the
    backend environment, and relays the upstream report verbatim.

    The PrimeHire key is never sent to, stored in, or returned to the
    browser. Only this specific report operation is allowed — this is not
    a generic proxy: the upstream URL is fixed and only the interview-id
    path segment varies.
    """
    job = (job_id or "").strip()
    candidate_key = (candidate_id or "").strip()
    for label, value in (("jobId", job), ("candidateId", candidate_key)):
        if (
            not value
            or len(value) > _MAX_ID_LEN
            or not _ID_PATTERN.fullmatch(value)
            or value in (".", "..")
        ):
            raise HTTPException(status_code=400, detail={
                "code": "INVALID_ID",
                "message": f"{label} is missing or malformed."})

    try:
        candidate = await CandidateRepository(db).get_by_key(candidate_key)
    except Exception:  # noqa: BLE001 — controlled 5xx, never a stack trace
        raise HTTPException(status_code=500, detail="Report lookup failed.") from None
    if candidate is None:
        raise HTTPException(status_code=404, detail={
            "code": "CANDIDATE_NOT_FOUND",
            "message": "No candidate was found for this identifier."})

    # Job scoping = authorization boundary: a candidate's report is only
    # retrievable through the job it belongs to. Cross-job (cross-tenant)
    # access and blind ID-guessing are rejected here.
    if candidate.get("assessmentId") != job:
        raise HTTPException(status_code=403, detail={
            "code": "FORBIDDEN",
            "message": "You are not authorized to view this candidate's report."})

    interview_id = ((candidate.get("primehire") or {}).get("interviewId") or "").strip()
    if not interview_id:
        raise HTTPException(status_code=404, detail={
            "code": "REPORT_NOT_READY",
            "message": "No interview has been scheduled for this candidate yet."})
    if interview_id.startswith(_MOCK_PREFIX):
        raise HTTPException(status_code=400, detail={
            "code": "MOCK_ID",
            "message": "Mock interview IDs are not retrievable."})
    if len(interview_id) > _MAX_ID_LEN or not _INTERVIEW_ID_PATTERN.fullmatch(interview_id):
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_ID",
            "message": "The stored interview identifier is malformed."})

    if not settings.has_primehire_credentials:
        logger.warning("Live report refused: PrimeHire credentials missing (presence-only log).")
        raise HTTPException(status_code=500, detail={
            "code": "CONFIGURATION_ERROR",
            "message": "PrimeHire credentials are not configured on the server "
                       "(PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY). Add them and retry."})

    try:
        return await fetch_interview_report(interview_id)
    except PrimehireError as exc:
        status = exc.status
        if status == 401:
            logger.warning("Live report: upstream rejected server credentials (401, presence-only log).")
            raise HTTPException(status_code=502, detail={
                "code": "UPSTREAM_AUTH_FAILED",
                "message": "The report service rejected the server credentials. "
                           "Contact an administrator."}) from None
        if status == 404:
            raise HTTPException(status_code=404, detail={
                "code": "REPORT_NOT_READY",
                "message": "The report is not available yet for this candidate."}) from None
        if status == 504:
            raise HTTPException(status_code=504, detail={
                "code": "UPSTREAM_TIMEOUT",
                "message": "The report service timed out. Retry in a moment."}) from None
        raise HTTPException(status_code=502, detail={
            "code": "UPSTREAM_ERROR",
            "message": "The report service is unavailable. Retry in a moment."}) from None


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
