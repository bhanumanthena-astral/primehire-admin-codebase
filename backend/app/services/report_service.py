"""Business logic for reports (fetch/normalize/sync land in Phase 4-6)."""

from __future__ import annotations

from typing import Any

from ..models.report import ReportRepository, to_document
from ..schemas.report import ReportIn


class ReportService:
    def __init__(self, db: Any) -> None:
        self._repo = ReportRepository(db)

    async def store(
        self,
        interview_id: str,
        raw: Any,
        *,
        candidate_id: str | None = None,
        assessment_id: str | None = None,
        response_id: str | None = None,
        status: str = "GENERATED",
        normalized: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = ReportIn.model_validate(
            {
                "interviewId": interview_id,
                "raw": raw,
                "candidateId": candidate_id,
                "assessmentId": assessment_id,
                "responseId": response_id,
                "status": status,
                "normalized": normalized,
            }
        )
        return await self._repo.upsert_by_interview_id(
            to_document(
                interview_id=data.interviewId,
                raw=data.raw,  # stored verbatim — never filtered
                candidate_id=data.candidateId,
                assessment_id=data.assessmentId,
                response_id=data.responseId,
                status=data.status,
                schema_version=data.schemaVersion,
                normalized=data.normalized,
            )
        )

    async def get_by_interview_id(self, interview_id: str) -> dict[str, Any] | None:
        return await self._repo.get_by_interview_id(interview_id)
