"""Repositories for resume_batches and resume_files (org-scoped)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ResumeBatchRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["resume_batches"]

    async def create(self, doc: dict[str, Any]) -> dict[str, Any]:
        record = dict(doc)
        record.setdefault("batchId", uuid.uuid4().hex)
        now = _utcnow()
        record.setdefault("createdAt", now)
        record.setdefault("updatedAt", now)
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def get(self, batch_id: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"batchId": batch_id, "orgId": org_id})
        if doc:
            doc.pop("_id", None)
        return doc

    async def update(self, batch_id: str, org_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        upd = dict(updates)
        upd["updatedAt"] = _utcnow()
        await self.coll.update_one({"batchId": batch_id, "orgId": org_id}, {"$set": upd})
        return await self.get(batch_id, org_id)

    async def list_by_org(self, org_id: str, skip: int = 0, limit: int = 50) -> list[dict[str, Any]]:
        cursor = self.coll.find({"orgId": org_id}).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs


class ResumeFileRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["resume_files"]

    async def create(self, doc: dict[str, Any]) -> dict[str, Any]:
        record = dict(doc)
        record.setdefault("fileId", uuid.uuid4().hex)
        record.setdefault("createdAt", _utcnow())
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def get(self, file_id: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"fileId": file_id, "orgId": org_id})
        if doc:
            doc.pop("_id", None)
        return doc

    async def list_for_batch(self, batch_id: str, org_id: str) -> list[dict[str, Any]]:
        cursor = self.coll.find({"batchId": batch_id, "orgId": org_id}).sort("createdAt", 1)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def update(self, file_id: str, org_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        await self.coll.update_one({"fileId": file_id, "orgId": org_id}, {"$set": updates})
        return await self.get(file_id, org_id)
