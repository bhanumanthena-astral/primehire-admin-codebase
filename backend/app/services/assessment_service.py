"""Business logic for assessments (routes stay thin; DB lives in models/)."""

from __future__ import annotations

from typing import Any

from ..models.assessment import AssessmentRepository
from ..schemas.assessment import AssessmentIn


class AssessmentService:
    def __init__(self, db: Any) -> None:
        self._repo = AssessmentRepository(db)

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = AssessmentIn.model_validate(payload)
        return await self._repo.create(data.to_doc())

    async def get_by_job_id(self, job_id: str) -> dict[str, Any] | None:
        return await self._repo.get_by_job_id(job_id)

    async def list(self, *, limit: int = 50, skip: int = 0) -> list[dict[str, Any]]:
        return await self._repo.list(limit=limit, skip=skip)
