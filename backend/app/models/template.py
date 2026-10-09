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
    doc.setdefault("deletedAt", None)
    return doc


def to_public(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    oid = out.pop("_id", None)
    out["mongoId"] = str(oid) if oid is not None else ""
    for key in ("createdAt", "updatedAt", "deletedAt"):
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

    async def get_by_template_id(
        self, template_id: str, *, include_deleted: bool = False
    ) -> dict[str, Any] | None:
        query: dict[str, Any] = {"id": template_id}
        if not include_deleted:
            query["deletedAt"] = None
        doc = await self._col.find_one(query)
        return to_public(doc) if doc else None

    async def _find_by_key(self, key: str) -> dict[str, Any] | None:
        """Resolve by public template ``id`` first, then by Mongo ``_id``.

        Callers (manual API tests, sync jobs) sometimes pass the ``mongoId``
        from a create response as the path key. The canonical contract stays
        the public ``id``; the ``_id`` fallback only normalizes that mix-up
        at the boundary instead of returning TEMPLATE_NOT_FOUND.
        """
        doc = await self._col.find_one({"id": key})
        if doc is None and ObjectId.is_valid(key):
            doc = await self._col.find_one({"_id": ObjectId(key)})
        return doc

    async def get_by_key(self, key: str) -> dict[str, Any] | None:
        doc = await self._find_by_key(key)
        return to_public(doc) if doc and doc.get("deletedAt") is None else None

    async def list_all(self) -> list[dict[str, Any]]:
        docs = await self._col.find({"deletedAt": None}).to_list(length=500)
        return [to_public(d) for d in docs]

    async def delete_by_template_id(self, template_id: str) -> bool:
        """Keep a tombstone so old browser caches cannot recreate this id."""
        now = utcnow()
        result = await self._col.update_one(
            {"id": template_id, "deletedAt": None},
            {"$set": {"deletedAt": now, "updatedAt": now}},
        )
        if result.matched_count:
            return True
        # Repeated deletes are successful while preserving the original marker.
        return await self.get_by_template_id(template_id, include_deleted=True) is not None

    async def update_by_template_id(
        self, template_id: str, changes: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Partial update by app template id. Returns the updated public
        doc, or None when no such template exists."""
        changes = {k: v for k, v in changes.items() if k not in ("id", "deletedAt")}
        if not changes:
            return await self.get_by_template_id(template_id)
        changes["updatedAt"] = utcnow()
        result = await self._col.update_one(
            {"id": template_id, "deletedAt": None}, {"$set": changes}
        )
        if result.matched_count == 0:
            return None
        return await self.get_by_template_id(template_id)

    async def update_by_key(
        self, key: str, changes: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update by public ``id`` or Mongo ``_id`` (see ``get_by_key``).

        The document's public ``id`` is never changed; the response always
        carries the canonical public id plus ``mongoId``.
        """
        changes = {k: v for k, v in changes.items() if k not in ("id", "deletedAt")}
        if not changes:
            return await self.get_by_key(key)
        doc = await self._find_by_key(key)
        if doc is None or doc.get("deletedAt") is not None:
            return None
        changes["updatedAt"] = utcnow()
        result = await self._col.update_one(
            {"_id": doc["_id"], "deletedAt": None}, {"$set": changes}
        )
        if result.matched_count == 0:
            return None
        return await self.get_by_key(key)
