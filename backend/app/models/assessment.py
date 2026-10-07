"""Assessments collection: document helpers + repository (no route logic here)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_dt(value: Any) -> datetime | None:
    """Parse an ISO string (or passthrough datetime). None stays None."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def to_document(payload: dict[str, Any], *, created_by: str = "unknown") -> dict[str, Any]:
    """Build a Mongo document from a validated assessment payload.

    Timestamps are BSON datetimes. startDate/endDate keep their ISO-string
    readability via the paired startDateIso/endDateIso legacy fields.
    """
    now = utcnow()
    doc = dict(payload)
    start = parse_dt(doc.get("startDate"))
    end = parse_dt(doc.get("endDate"))
    if start is not None:
        doc["startDate"] = start
        doc["startDateIso"] = start.isoformat()
    else:
        doc.pop("startDate", None)
        doc.pop("startDateIso", None)
    if end is not None:
        doc["endDate"] = end
        doc["endDateIso"] = end.isoformat()
    else:
        doc.pop("endDate", None)
        doc.pop("endDateIso", None)
    created = parse_dt(doc.get("createdAt")) or now
    doc["createdAt"] = created
    doc["updatedAt"] = now
    doc.setdefault("isActive", True)
    if doc.get("isActive") is False:
        doc.setdefault("deactivatedAt", now)
    else:
        doc["deactivatedAt"] = parse_dt(doc.get("deactivatedAt"))
    doc.setdefault("version", 1)
    doc.setdefault("createdBy", created_by)
    doc.setdefault("updatedBy", created_by)
    doc.setdefault("syncState", {"state": "pending", "attemptedAt": now})
    doc.setdefault("primehire", {})
    doc.setdefault("origin", "portal")
    return doc


def to_public(doc: dict[str, Any]) -> dict[str, Any]:
    """Serialize a Mongo document for API responses (ObjectId -> str)."""
    out = dict(doc)
    oid = out.pop("_id", None)
    out["id"] = str(oid) if oid is not None else out.get("id", "")
    for key in ("createdAt", "updatedAt", "deactivatedAt", "startDate", "endDate"):
        value = out.get(key)
        if isinstance(value, datetime):
            out[key] = value.isoformat()
    sync = out.get("syncState")
    if isinstance(sync, dict):
        synced = dict(sync)
        for key in ("attemptedAt", "syncedAt", "failedAt"):
            if isinstance(synced.get(key), datetime):
                synced[key] = synced[key].isoformat()
        out["syncState"] = synced
    return out


class AssessmentConflict(Exception):
    """Uniqueness violated (jobId + roundType) or stale version write."""

    def __init__(self, message: str, *, current: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.current = current


class AssessmentRepository:
    def __init__(self, db: Any) -> None:
        self._col = db["assessments"]

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = await self._col.insert_one(payload)
        doc = await self._col.find_one({"_id": result.inserted_id})
        assert doc is not None
        return to_public(doc)

    async def get_by_job_id(self, job_id: str) -> dict[str, Any] | None:
        doc = await self._col.find_one({"jobId": job_id})
        return to_public(doc) if doc else None

    async def get_raw_by_job_id(self, job_id: str) -> dict[str, Any] | None:
        """Raw document (datetimes/ObjectId intact) for internal service use."""
        return await self._col.find_one({"jobId": job_id})

    async def find_duplicates(self) -> list[dict[str, Any]]:
        """Groups sharing (jobId, roundType) — blocks the unique index build.

        Dry-run helper: report these and resolve before creating the index.
        Grouped in Python (not $group) so it also runs on mongomock.
        """
        counts: dict[tuple[Any, Any], int] = {}
        cursor = self._col.find({}, {"jobId": 1, "roundType": 1})
        async for doc in cursor:
            key = (doc.get("jobId"), doc.get("roundType"))
            counts[key] = counts.get(key, 0) + 1
        return [
            {"_id": {"jobId": job_id, "roundType": round_type}, "count": count}
            for (job_id, round_type), count in sorted(
                counts.items(), key=lambda item: (str(item[0][0]), str(item[0][1]))
            )
            if count > 1
        ]

    async def list(
        self,
        *,
        limit: int = 50,
        skip: int = 0,
        search: str | None = None,
        round_type: str | None = None,
        is_active: bool | None = None,
        since: datetime | None = None,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {}
        if search:
            query["$or"] = [
                {"jobTitle": {"$regex": search, "$options": "i"}},
                {"jobId": {"$regex": search, "$options": "i"}},
            ]
        if round_type:
            query["roundType"] = round_type
        if is_active is not None:
            query["isActive"] = is_active
        if since is not None:
            query["updatedAt"] = {"$gt": since}
        cursor = self._col.find(query).sort("updatedAt", -1).skip(skip).limit(limit)
        return [to_public(d) async for d in cursor]

    async def count(
        self,
        *,
        search: str | None = None,
        round_type: str | None = None,
        is_active: bool | None = None,
        since: datetime | None = None,
    ) -> int:
        query: dict[str, Any] = {}
        if search:
            query["$or"] = [
                {"jobTitle": {"$regex": search, "$options": "i"}},
                {"jobId": {"$regex": search, "$options": "i"}},
            ]
        if round_type:
            query["roundType"] = round_type
        if is_active is not None:
            query["isActive"] = is_active
        if since is not None:
            query["updatedAt"] = {"$gt": since}
        return await self._col.count_documents(query)

    async def update_versioned(
        self, job_id: str, expected_version: int, changes: dict[str, Any]
    ) -> dict[str, Any]:
        """Atomic version-checked $set. Stale writes raise AssessmentConflict
        carrying the current document (HTTP 409)."""
        safe = dict(changes)
        safe["updatedAt"] = utcnow()
        result = await self._col.update_one(
            {"jobId": job_id, "version": expected_version},
            {"$set": safe, "$inc": {"version": 1}},
        )
        if result.matched_count == 0:
            current = await self._col.find_one({"jobId": job_id})
            if current is None:
                raise KeyError(job_id)
            raise AssessmentConflict(
                "This was changed by someone else, reload to see the latest version.",
                current=to_public(current),
            )
        doc = await self._col.find_one({"jobId": job_id})
        assert doc is not None
        return to_public(doc)

    async def set_sync_state(self, job_id: str, sync_state: dict[str, Any]) -> dict[str, Any]:
        """Unconditional sync-state transition (no version bump for sync)."""
        await self._col.update_one(
            {"jobId": job_id},
            {"$set": {"syncState": sync_state, "updatedAt": utcnow()}},
        )
        doc = await self._col.find_one({"jobId": job_id})
        assert doc is not None
        return to_public(doc)
