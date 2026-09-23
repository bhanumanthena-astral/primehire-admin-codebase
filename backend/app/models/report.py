"""Reports collection: full-fidelity PrimeHire report persistence.

``raw`` is stored EXACTLY as received — unknown/future PrimeHire fields are
preserved (no allowlist filtering). ``normalized`` holds the app-friendly
view consumed by the report UI. Video binaries are never stored; only the
video URLs embedded in ``raw`` are kept.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def upstream_hash(raw: Any) -> str:
    """Stable sha256 of the canonical raw payload (change detection)."""
    canonical = json.dumps(raw, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def to_document(
    *,
    interview_id: str,
    raw: Any,
    candidate_id: str | None = None,
    assessment_id: str | None = None,
    response_id: str | None = None,
    status: str = "GENERATED",
    source: str = "primehire",
    schema_version: int = 1,
    raw_response: Any = None,
    normalized: dict[str, Any] | None = None,
    normalized_scores: dict[str, Any] | None = None,
    video_refs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    now = utcnow()
    return {
        "interviewId": interview_id,
        "candidateId": candidate_id,
        "assessmentId": assessment_id,
        "responseId": response_id,
        "status": status,
        "source": source,
        "schemaVersion": schema_version,
        "rawResponse": raw_response,  # complete upstream envelope, verbatim
        "raw": raw,  # unwrapped data payload, verbatim
        "normalized": normalized,
        "normalizedScores": normalized_scores,
        "videoRefs": video_refs or [],
        "fetchedAt": now,
        "createdAt": now,
        "updatedAt": now,
        "upstreamHash": upstream_hash(raw),
        "error": None,
    }


def to_public(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    oid = out.pop("_id", None)
    out["id"] = str(oid) if oid is not None else out.get("id", "")
    for key in ("fetchedAt", "createdAt", "updatedAt"):
        value = out.get(key)
        if isinstance(value, datetime):
            out[key] = value.isoformat()
    return out


class ReportRepository:
    def __init__(self, db: Any) -> None:
        self._col = db["reports"]

    async def upsert_by_interview_id(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Insert or replace the report for an interview (one report per interview)."""
        doc = dict(doc)
        doc["updatedAt"] = utcnow()
        await self._col.update_one(
            {"interviewId": doc["interviewId"]}, {"$set": doc}, upsert=True
        )
        stored = await self._col.find_one({"interviewId": doc["interviewId"]})
        assert stored is not None
        return to_public(stored)

    async def get_by_interview_id(self, interview_id: str) -> dict[str, Any] | None:
        doc = await self._col.find_one({"interviewId": interview_id})
        return to_public(doc) if doc else None
