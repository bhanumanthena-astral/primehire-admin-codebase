"""Organizations collection: document helpers + repository."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


DEFAULT_ORG_ID = "default"
DEFAULT_ORG_NAME = "PrimeHire"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def default_settings() -> dict[str, Any]:
    """Default settings for a new organization."""
    return {
        "matchThreshold": 60,
        "retentionDays": 365,
        "llm": {"provider": "", "model": ""},
        "emailFrom": "noreply@nxtagent.ai",
        "reminderLeadMinutes": 15,
        # Human-gated bulk send is the norm; auto-send on SHORTLISTED only
        # when an admin explicitly opts in (audited).
        "autoSendAssessment": False,
        # Score combination weights (normalized on read). Slice B default 70/30.
        "scoring": {"keywordWeight": 0.7, "llmWeight": 0.3},
    }


def to_document(payload: dict[str, Any]) -> dict[str, Any]:
    """Build a Mongo document from a validated organization payload."""
    now = utcnow()
    doc = dict(payload)
    doc.setdefault("settings", default_settings())
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


class OrganizationRepository:
    def __init__(self, db: Any) -> None:
        self._col = db["organizations"]

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = await self._col.insert_one(to_document(payload))
        doc = await self._col.find_one({"_id": result.inserted_id})
        assert doc is not None
        return to_public(doc)

    async def get_by_org_id(self, org_id: str) -> dict[str, Any] | None:
        doc = await self._col.find_one({"orgId": org_id})
        return to_public(doc) if doc else None

    async def update_by_org_id(
        self, org_id: str, changes: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Apply changes via dotted-path $set. Returns updated public doc."""
        if not changes:
            doc = await self._col.find_one({"orgId": org_id})
            return to_public(doc) if doc else None
        changes["updatedAt"] = utcnow()
        result = await self._col.update_one({"orgId": org_id}, {"$set": changes})
        if result.matched_count == 0:
            return None
        doc = await self._col.find_one({"orgId": org_id})
        assert doc is not None
        return to_public(doc)

    async def list_all(self, *, limit: int = 50, skip: int = 0) -> list[dict[str, Any]]:
        cursor = self._col.find({}).skip(skip).limit(limit)
        return [to_public(d) async for d in cursor]

    async def count(self) -> int:
        return await self._col.count_documents({})


async def seed_default_org(db: Any) -> bool:
    """Create the default organization if none exists. Returns True if seeded."""
    repo = OrganizationRepository(db)
    if await repo.count() > 0:
        return False
    await repo.create({
        "orgId": DEFAULT_ORG_ID,
        "name": DEFAULT_ORG_NAME,
    })
    return True
