"""Business logic for candidates, incl. mock/real separation and password stripping."""

from __future__ import annotations

import re
from typing import Any

from ..models.candidate import CandidateRepository
from ..schemas.candidate import CandidateIn

_MOCK_INTERVIEW_PREFIX = "int-"
_MOCK_RESPONSE_PREFIX = "res-"

# Synthetic fallback UUID stamp used by the frontend when no genuine PrimeHire
# UUID exists (mockData.ts). Must never be treated as a genuine identifier.
_SYNTHETIC_UUID_PREFIX = "c3a7db8e-0f2c-473d-82ba-"
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def is_real_interview_id(value: str | None) -> bool:
    return bool(value) and not str(value).startswith(_MOCK_INTERVIEW_PREFIX)


def is_real_response_id(value: str | None) -> bool:
    return bool(value) and not str(value).startswith(_MOCK_RESPONSE_PREFIX)


def is_genuine_uuid(value: str | None) -> bool:
    """UUID-format AND not the frontend's synthetic fallback stamp."""
    if not value or not _UUID_RE.match(str(value)):
        return False
    return not str(value).startswith(_SYNTHETIC_UUID_PREFIX)


def has_real_linkage(
    interview_id: str | None,
    response_id: str | None = None,
    candidate_uuid: str | None = None,
) -> bool:
    """Any genuine PrimeHire linkage (approved rule 2 converse)."""
    return (
        is_real_interview_id(interview_id)
        or is_real_response_id(response_id)
        or is_genuine_uuid(candidate_uuid)
    )


def looks_mock(
    interview_id: str | None,
    response_id: str | None = None,
    candidate_uuid: str | None = None,
    has_demo_payload: bool = False,
) -> bool:
    """Approved mock rule (Phase 2B refinement).

    MOCK only when: int- interviewId, OR no genuine PrimeHire linkage,
    OR explicit demo/simulator payload. A real interviewId with a res-
    fallback responseId is REAL (responseId treated as unresolved).
    """
    if (interview_id or "").startswith(_MOCK_INTERVIEW_PREFIX):
        return True
    if has_demo_payload:
        return True
    return not has_real_linkage(interview_id, response_id, candidate_uuid)


class CandidateService:
    def __init__(self, db: Any) -> None:
        self._repo = CandidateRepository(db)

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = CandidateIn.model_validate(payload)  # rejects password/rowLoading
        doc = data.to_doc()
        prime = doc.get("primehire") or {}
        if doc.get("isMock") is False and looks_mock(
            prime.get("interviewId"),
            prime.get("responseId"),
            prime.get("candidateUUID"),
            has_demo_payload=bool(payload.get("simulatedReport") or payload.get("answers")),
        ):
            doc["isMock"] = True  # auto-quarantine records with no real linkage
        return await self._repo.create(doc)

    async def get_by_interview_id(self, interview_id: str) -> dict[str, Any] | None:
        return await self._repo.get_by_interview_id(interview_id)

    async def list_by_assessment(
        self, assessment_id: str, *, limit: int = 50, skip: int = 0
    ) -> list[dict[str, Any]]:
        return await self._repo.list_by_assessment(assessment_id, limit=limit, skip=skip)
