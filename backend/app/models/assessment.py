"""Assessments collection: document helpers + repository (no route logic here)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_document(payload: dict[str, Any]) -> dict[str, Any]:
    """Build a Mongo document from a validated assessment payload."""
    now = utcnow()
    doc = dict(payload)
    doc.setdefault("createdAt", now)
    doc["updatedAt"] = now
    return doc


def to_public(doc: dict[str, Any]) -> dict[str, Any]:
    """Serialize a Mongo document for API responses (ObjectId -> str)."""
    out = dict(doc)
    oid = out.pop("_id", None)
    out["id"] = str(oid) if oid is not None else out.get("id", "")
    for key in ("createdAt", "updatedAt"):
        value = out.get(key)
        if isinstance(value, datetime):
            out[key] = value.isoformat()
    return out


class AssessmentRepository:
    def __init__(self, db: Any) -> None:
        self._col = db["assessments"]

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = await self._col.insert_one(to_document(payload))
        doc = await self._col.find_one({"_id": result.inserted_id})
        assert doc is not None
        return to_public(doc)

    async def get_by_job_id(self, job_id: str) -> dict[str, Any] | None:
        doc = await self._col.find_one({"jobId": job_id})
        return to_public(doc) if doc else None

    async def list(self, *, limit: int = 50, skip: int = 0) -> list[dict[str, Any]]:
        cursor = self._col.find({}).skip(skip).limit(limit)
        return [to_public(d) async for d in cursor]
