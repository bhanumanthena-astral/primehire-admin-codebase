"""Templates collection: mail template documents + repository."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_document(payload: dict[str, Any]) -> dict[str, Any]:
    now = utcnow()
    doc = dict(payload)
    doc.setdefault("createdAt", now)
    doc["updatedAt"] = now
    return doc


def to_public(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    oid = out.pop("_id", None)
    out["mongoId"] = str(oid) if oid is not None else ""
    for key in ("createdAt", "updatedAt"):
        value = out.get(key)
        if isinstance(value, datetime):
            out[key] = value.isoformat()
    return out


class TemplateRepository:
    def __init__(self, db: Any) -> None:
        self._col = db["templates"]

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = await self._col.insert_one(to_document(payload))
        doc = await self._col.find_one({"_id": result.inserted_id})
        assert doc is not None
        return to_public(doc)

    async def get_by_template_id(self, template_id: str) -> dict[str, Any] | None:
        doc = await self._col.find_one({"id": template_id})
        return to_public(doc) if doc else None
