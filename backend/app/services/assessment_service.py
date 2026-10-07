"""Business logic for assessments (routes stay thin; DB lives in models/).

Write order (Slice 2A): validate -> insert in MongoDB with syncState
"pending" -> call PrimeHire server-side -> "synced" with the returned ids,
or "failed" with the error. The record is never lost and a failure never
looks like a success.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pymongo.errors import DuplicateKeyError

from ..models.assessment import AssessmentConflict, AssessmentRepository, utcnow
from ..models import audit as audit_log
from ..schemas.assessment import AssessmentIn
from . import primehire_client as remote
from .primehire_payload import PayloadError, map_assessment


class AssessmentNotFound(Exception):
    """jobId does not exist."""


class AssessmentService:
    def __init__(self, db: Any, fetch: remote.FetchFn | None = None) -> None:
        self._repo = AssessmentRepository(db)
        self._db = db
        self._fetch = fetch

    async def create(self, payload: dict[str, Any], *, created_by: str = "unknown") -> dict[str, Any]:
        data = AssessmentIn.model_validate(payload)
        from ..models.assessment import to_document

        doc = to_document(data.to_doc(), created_by=created_by)
        existing = await self._db["assessments"].find_one(
            {"jobId": doc["jobId"], "roundType": doc["roundType"]}
        )
        if existing is not None:
            raise AssessmentConflict(
                "An assessment with this Job ID and round already exists."
            )
        try:
            stored = await self._repo.create(doc)
        except DuplicateKeyError as exc:
            raise AssessmentConflict(
                "An assessment with this Job ID and round already exists."
            ) from exc
        # Best-effort PrimeHire sync: the record already exists as "pending".
        await self._sync(stored["jobId"])
        refreshed = await self._repo.get_by_job_id(stored["jobId"])
        assert refreshed is not None
        await audit_log.log(self._db, action="assessment.created", entity="assessment",
                            entity_id=stored["jobId"], by=created_by,
                            details={"roundType": stored.get("roundType")})
        return refreshed

    async def _sync(self, job_id: str) -> dict[str, Any]:
        """Attempt the PrimeHire call for a pending/failed record.

        Never raises: transitions syncState to synced or failed.
        """
        raw = await self._repo.get_raw_by_job_id(job_id)
        if raw is None:
            raise AssessmentNotFound(job_id)
        try:
            prime_payload = map_assessment({
                "jobId": raw.get("jobId"),
                "jobTitle": raw.get("jobTitle"),
                "jobDescription": raw.get("jobDescription"),
                "roundType": raw.get("roundType"),
                "questions": raw.get("questions") or [],
                "startDate": raw.get("startDateIso") or raw.get("startDate"),
                "endDate": raw.get("endDateIso") or raw.get("endDate"),
            })
        except PayloadError as exc:
            return await self._repo.set_sync_state(job_id, {
                "state": "failed",
                "error": str(exc),
                "failedAt": utcnow(),
            })
        try:
            result = await remote.create_assessment_remote(prime_payload, fetch=self._fetch)
        except remote.PrimehireError as exc:
            return await self._repo.set_sync_state(job_id, {
                "state": "failed",
                "error": str(exc),
                "failedAt": utcnow(),
            })
        prime_ids: dict[str, Any] = {}
        if isinstance(result, dict):
            for key in ("assessment_id", "assessmentId", "id", "job_id", "jobId"):
                if result.get(key) is not None:
                    prime_ids["assessmentId"] = result[key]
                    break
            data = result.get("data") if isinstance(result.get("data"), dict) else None
            if not prime_ids and data:
                for key in ("assessment_id", "assessmentId", "id", "job_id", "jobId"):
                    if data.get(key) is not None:
                        prime_ids["assessmentId"] = data[key]
                        break
        await self._db["assessments"].update_one(
            {"jobId": job_id},
            {"$set": {
                "primehire": prime_ids,
                "syncState": {"state": "synced", "syncedAt": utcnow()},
                "updatedAt": utcnow(),
            }},
        )
        stored = await self._repo.get_by_job_id(job_id)
        assert stored is not None
        return stored

    async def retry_sync(self, job_id: str) -> dict[str, Any]:
        current = await self._repo.get_by_job_id(job_id)
        if current is None:
            raise AssessmentNotFound(job_id)
        if (current.get("syncState") or {}).get("state") == "synced":
            return current
        return await self._sync(job_id)

    async def get_by_job_id(self, job_id: str) -> dict[str, Any]:
        doc = await self._repo.get_by_job_id(job_id)
        if doc is None:
            raise AssessmentNotFound(job_id)
        return doc

    async def list(
        self,
        *,
        limit: int = 50,
        skip: int = 0,
        search: str | None = None,
        round_type: str | None = None,
        is_active: bool | None = None,
        since: datetime | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        items = await self._repo.list(
            limit=limit, skip=skip, search=search, round_type=round_type,
            is_active=is_active, since=since,
        )
        total = await self._repo.count(
            search=search, round_type=round_type, is_active=is_active, since=since
        )
        return items, total

    async def put(self, job_id: str, payload: dict[str, Any], *, updated_by: str = "unknown") -> dict[str, Any]:
        from ..schemas.assessment import AssessmentPut

        data = AssessmentPut.model_validate(payload)
        if data.jobId is not None and data.jobId != job_id:
            raise ValueError("jobId in body does not match the path.")
        current = await self._repo.get_by_job_id(job_id)
        if current is None:
            raise AssessmentNotFound(job_id)
        if data.roundType is not None and data.roundType != current.get("roundType"):
            raise ValueError("roundType cannot be changed by PUT.")
        changes = data.to_set_paths()
        changes["updatedBy"] = updated_by
        try:
            return await self._repo.update_versioned(job_id, data.version, changes)
        except KeyError:
            raise AssessmentNotFound(job_id) from None

    async def patch(self, job_id: str, payload: dict[str, Any], *, updated_by: str = "unknown") -> dict[str, Any]:
        from ..schemas.assessment import AssessmentUpdate

        data = AssessmentUpdate.model_validate(payload)
        changes = data.to_set_paths()
        changes["updatedBy"] = updated_by
        if data.isActive is False:
            changes["deactivatedAt"] = utcnow()
        elif data.isActive is True:
            changes["deactivatedAt"] = None
        try:
            return await self._repo.update_versioned(job_id, data.version, changes)
        except KeyError:
            raise AssessmentNotFound(job_id) from None

    async def set_active(self, job_id: str, active: bool, version: int, *, updated_by: str = "unknown") -> dict[str, Any]:
        changes: dict[str, Any] = {
            "isActive": active,
            "deactivatedAt": None if active else utcnow(),
            "updatedBy": updated_by,
        }
        try:
            return await self._repo.update_versioned(job_id, version, changes)
        except KeyError:
            raise AssessmentNotFound(job_id) from None

    async def find_duplicates(self) -> list[dict[str, Any]]:
        """Dry-run helper: (jobId, roundType) groups blocking the unique index."""
        return await self._repo.find_duplicates()

    async def soft_delete(self, job_id: str, version: int, *, deleted_by: str = "unknown") -> dict[str, Any]:
        """Soft delete: stamps deletedAt/deletedBy, hides from reads, audits.

        No endpoint may hard-delete assessment data. Repeat deletes 404.
        """
        raw = await self._repo.get_raw_by_job_id(job_id)
        if raw is None or raw.get("deletedAt"):
            raise AssessmentNotFound(job_id)
        try:
            updated = await self._repo.update_versioned(job_id, version, {
                "deletedAt": utcnow(),
                "deletedBy": deleted_by,
                "isActive": False,
                "updatedBy": deleted_by,
            })
        except KeyError:
            raise AssessmentNotFound(job_id) from None
        await audit_log.log(self._db, action="assessment.soft_deleted", entity="assessment",
                            entity_id=job_id, by=deleted_by,
                            details={"version": updated.get("version")})
        return updated
