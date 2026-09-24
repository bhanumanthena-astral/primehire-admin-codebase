"""Business logic for candidates, incl. mock/real separation and password stripping."""

from __future__ import annotations

import re
import secrets
from typing import Any

from pydantic import ValidationError

from ..models.candidate import CandidateRepository
from ..schemas.candidate import CandidateIn, CandidateUpdate

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


class CandidateNotFound(Exception):
    """candidateKey does not exist."""


class CandidateConflict(Exception):
    """candidateKey already exists (idempotent retry should read, not recreate)."""

    def __init__(self, candidate_key: str) -> None:
        super().__init__(f"Candidate '{candidate_key}' already exists.")
        self.candidate_key = candidate_key


def generate_candidate_key() -> str:
    """Server-side stable key. UI `id` maps to this; never the Mongo _id."""
    return "CAND-" + secrets.token_hex(4).upper()


class CandidateService:
    def __init__(self, db: Any) -> None:
        self._repo = CandidateRepository(db)

    async def get_by_key(self, candidate_key: str) -> dict[str, Any]:
        doc = await self._repo.get_by_key(candidate_key)
        if doc is None:
            raise CandidateNotFound(candidate_key)
        return doc

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = CandidateIn.model_validate(payload)  # rejects password/rowLoading
        doc = data.to_doc()
        if not doc.get("candidateKey"):
            doc["candidateKey"] = generate_candidate_key()
        else:
            existing = await self._repo.get_by_key(doc["candidateKey"])
            if existing is not None:
                raise CandidateConflict(doc["candidateKey"])
        prime = doc.get("primehire") or {}
        if doc.get("isMock") is False and looks_mock(
            prime.get("interviewId"),
            prime.get("responseId"),
            prime.get("candidateUUID"),
            has_demo_payload=bool(payload.get("simulatedReport") or payload.get("answers")),
        ):
            doc["isMock"] = True  # auto-quarantine records with no real linkage
        return await self._repo.create(doc)

    async def create_many(
        self, items: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Bulk import. Per-item isolation: one bad row never aborts the batch."""
        created: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for index, payload in enumerate(items):
            try:
                created.append(await self.create(payload))
            except CandidateConflict as exc:
                errors.append({"index": index, "code": "DUPLICATE_KEY",
                               "message": str(exc)})
            except (ValidationError, ValueError) as exc:
                errors.append({"index": index, "code": "VALIDATION_ERROR",
                               "message": str(exc).splitlines()[0] if str(exc) else "invalid candidate"})
            except Exception:  # noqa: BLE001 — one row must not abort the batch
                errors.append({"index": index, "code": "CREATE_FAILED",
                               "message": "Candidate could not be created."})
        return created, errors

    async def update(self, candidate_key: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = CandidateUpdate.model_validate(payload)  # rejects password/rowLoading
        doc = await self._repo.update_by_key(candidate_key, data.to_set_paths())
        if doc is None:
            raise CandidateNotFound(candidate_key)
        return doc

    async def delete(self, candidate_key: str) -> None:
        """Delete the Mongo document only. PrimeHire interviews/reports are untouched."""
        if not await self._repo.delete_by_key(candidate_key):
            raise CandidateNotFound(candidate_key)

    async def get_by_interview_id(self, interview_id: str) -> dict[str, Any] | None:
        return await self._repo.get_by_interview_id(interview_id)

    async def list_by_assessment(
        self, assessment_id: str, *, limit: int = 50, skip: int = 0
    ) -> list[dict[str, Any]]:
        return await self._repo.list_by_assessment(assessment_id, limit=limit, skip=skip)
