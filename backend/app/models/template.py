"""Templates collection: mail template documents + repository."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc_iso(value: Any) -> Any:
    """Serialize a datetime as timezone-aware UTC ISO 8601 (+00:00).

    PyMongo/Motor return naive UTC datetimes on read (no tz_aware codec), so
    a raw ``.isoformat()`` emits a suffix-less string that browsers parse as
    *local* time (IST shift of +5:30). Naive values are UTC by contract, so
    attach UTC before serializing. Non-datetimes pass through untouched.
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value


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
        out[key] = as_utc_iso(out.get(key))
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

    async def get_by_key(self, key: str) -> dict[str, Any] | None:
        """Resolve by public template ``id`` first, then by Mongo ``_id``.

        Callers (manual API tests, sync jobs) sometimes pass the ``mongoId``
        from a create response as the path key. The canonical contract stays
        the public ``id``; the ``_id`` fallback only normalizes that mix-up
        at the boundary instead of returning TEMPLATE_NOT_FOUND.
        """
        doc = await self._col.find_one({"id": key})
        if doc is None and ObjectId.is_valid(key):
            doc = await self._col.find_one({"_id": ObjectId(key)})
        return to_public(doc) if doc else None

    async def list_all(self) -> list[dict[str, Any]]:
        docs = await self._col.find({}).to_list(length=500)
        return [to_public(d) for d in docs]

    async def delete_by_template_id(self, template_id: str) -> bool:
        """Hard delete by app template id. Returns True when removed."""
        result = await self._col.delete_one({"id": template_id})
        return result.deleted_count == 1

    async def update_by_template_id(
        self, template_id: str, changes: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Partial update by app template id. Returns the updated public
        doc, or None when no such template exists."""
        changes = {k: v for k, v in changes.items() if k != "id"}
        if not changes:
            return await self.get_by_template_id(template_id)
        changes["updatedAt"] = utcnow()
        result = await self._col.update_one(
            {"id": template_id}, {"$set": changes}
        )
        if result.matched_count == 0:
            return None
        doc = await self._col.find_one({"id": template_id})
        assert doc is not None
        return to_public(doc)

    async def update_by_key(
        self, key: str, changes: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update by public ``id`` or Mongo ``_id`` (see ``get_by_key``).

        The document's public ``id`` is never changed; the response always
        carries the canonical public id plus ``mongoId``.
        """
        changes = {k: v for k, v in changes.items() if k != "id"}
        if not changes:
            return await self.get_by_key(key)
        changes["updatedAt"] = utcnow()
        # Public id wins; _id is only a fallback so a 24-hex public id can
        # never update a different document via its ObjectId.
        result = await self._col.update_one({"id": key}, {"$set": changes})
        if result.matched_count == 0 and ObjectId.is_valid(key):
            result = await self._col.update_one(
                {"_id": ObjectId(key)}, {"$set": changes}
            )
        if result.matched_count == 0:
            return None
        return await self.get_by_key(key)
