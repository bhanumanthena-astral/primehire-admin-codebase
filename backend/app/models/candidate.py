"""Candidates collection: document helpers + repository.

Security policy (from investigation): the PrimeHire candidate-portal
``password`` is NEVER persisted. Credentials are regenerated on demand via
POST /interview, so there is no legitimate read path that needs a stored
password. Import pipelines must strip it (see services/candidate_service).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Fields that must never reach MongoDB or API responses.
FORBIDDEN_FIELDS = {"password", "rowLoading"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def sanitize(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove forbidden/UI-only fields. Never raises; never logs values."""
    return {k: v for k, v in payload.items() if k not in FORBIDDEN_FIELDS}


def to_document(payload: dict[str, Any]) -> dict[str, Any]:
    now = utcnow()
    doc = sanitize(payload)
    doc.setdefault("isMock", False)
    doc.setdefault("origin", "primehire")
    doc.setdefault("createdAt", now)
    doc["updatedAt"] = now
    return doc


def to_public(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    oid = out.pop("_id", None)
    out["id"] = str(oid) if oid is not None else out.get("id", "")
    for key in ("createdAt", "updatedAt"):
        value = out.get(key)
        if isinstance(value, datetime):
            out[key] = value.isoformat()
    return out


class CandidateRepository:
    def __init__(self, db: Any) -> None:
        self._col = db["candidates"]

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = await self._col.insert_one(to_document(payload))
        doc = await self._col.find_one({"_id": result.inserted_id})
        assert doc is not None
        return to_public(doc)

    async def get_by_interview_id(self, interview_id: str) -> dict[str, Any] | None:
        doc = await self._col.find_one({"primehire.interviewId": interview_id})
        return to_public(doc) if doc else None

    async def get_raw_by_interview_id(self, interview_id: str) -> dict[str, Any] | None:
        """Raw document (ObjectId intact) for internal service use."""
        return await self._col.find_one({"primehire.interviewId": interview_id})

    async def set_uuid_if_absent(self, mongo_id: Any, uuid: str) -> bool:
        """Fill primehire.candidateUUID only when currently null/absent.

        Never overwrites an existing UUID (conflict must be resolved by a human).
        Returns True when the update was applied.
        """
        result = await self._col.update_one(
            {"_id": mongo_id, "primehire.candidateUUID": {"$in": [None, ""]}},
            {"$set": {"primehire.candidateUUID": uuid, "updatedAt": utcnow()}},
        )
        return result.modified_count == 1

    async def list_by_assessment(
        self, assessment_id: str, *, limit: int = 50, skip: int = 0
    ) -> list[dict[str, Any]]:
        cursor = self._col.find({"assessmentId": assessment_id}).skip(skip).limit(limit)
        return [to_public(d) async for d in cursor]
