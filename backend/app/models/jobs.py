"""Durable background-job repository (claim/lease, backoff, dead-letter).

- `enqueue()` is idempotent on `dedupeKey` (unique index): re-enqueueing the
  same logical job returns the existing record instead of duplicating work.
- `claim_next()` atomically moves one due job pending→running with a lease;
  expired leases are reclaimable so a crashed worker never loses a job.
- `fail()` schedules a retry with exponential backoff + jitter, or parks the
  job as `dead` after `maxAttempts` (dead-letter, visible in diagnostics).
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from pymongo.errors import DuplicateKeyError

RETRY_BASE_S = 30
RETRY_MAX_S = 3600


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def compute_backoff(attempts: int) -> datetime:
    """runAfter for the next attempt: 30s * 2^attempts + jitter, capped 1h."""
    delay = min(RETRY_BASE_S * (2 ** max(0, attempts - 1)), RETRY_MAX_S)
    delay += random.uniform(0, min(30, delay))
    return _utcnow() + timedelta(seconds=delay)


class BackgroundJobRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["background_jobs"]

    async def enqueue(
        self,
        *,
        org_id: str,
        kind: str,
        entity_type: str,
        entity_key: str,
        payload: dict[str, Any] | None = None,
        run_after: datetime | None = None,
        max_attempts: int = 5,
        dedupe_key: str | None = None,
    ) -> dict[str, Any]:
        effective_key = dedupe_key or f"{kind}:{entity_type}:{entity_key}"
        # Pre-check for idempotency (works even where the unique index is
        # absent, e.g. mock DBs); the DuplicateKeyError catch below covers
        # the race under concurrency on real MongoDB.
        pre = await self.coll.find_one({"dedupeKey": effective_key, "orgId": org_id})
        if pre is not None:
            pre.pop("_id", None)
            return pre
        record = {
            "jobId": uuid.uuid4().hex,
            "orgId": org_id,
            "kind": kind,
            "entityType": entity_type,
            "entityKey": entity_key,
            "payload": payload or {},
            "status": "pending",
            "attempts": 0,
            "maxAttempts": max_attempts,
            "runAfter": run_after or _utcnow(),
            "leaseUntil": None,
            "dedupeKey": effective_key,
            "lastError": None,
            "result": None,
            "createdAt": _utcnow(),
            "updatedAt": _utcnow(),
        }
        try:
            await self.coll.insert_one(record)
        except DuplicateKeyError:
            existing = await self.coll.find_one(
                {"dedupeKey": record["dedupeKey"], "orgId": org_id}
            )
            if existing:
                existing.pop("_id", None)
                return existing
            raise
        record.pop("_id", None)
        return record

    async def claim_next(self, kinds: list[str] | None = None, lease_s: int = 300) -> dict[str, Any] | None:
        """Atomically claim one due job (pending, or running with expired lease)."""
        now = _utcnow()
        query: dict[str, Any] = {
            "$or": [
                {"status": "pending", "runAfter": {"$lte": now}},
                {"status": "running", "leaseUntil": {"$lte": now}},
            ]
        }
        if kinds:
            query["kind"] = {"$in": kinds}
        # mongomock-motor supports find_one_and_update; fall back if needed.
        try:
            doc = await self.coll.find_one_and_update(
                query,
                {"$set": {"status": "running", "leaseUntil": now + timedelta(seconds=lease_s),
                          "updatedAt": now}, "$inc": {"attempts": 1}},
                sort=[("runAfter", 1)],
                return_document=True,
            )
        except (AttributeError, TypeError, NotImplementedError):
            doc = await self.coll.find_one(query)
            if doc is None:
                return None
            await self.coll.update_one(
                {"_id": doc["_id"]},
                {"$set": {"status": "running", "leaseUntil": now + timedelta(seconds=lease_s),
                          "updatedAt": now}, "$inc": {"attempts": 1}},
            )
            doc = await self.coll.find_one({"_id": doc["_id"]})
        if doc:
            doc.pop("_id", None)
        return doc

    async def complete(self, job_id: str, result: dict[str, Any] | None = None) -> None:
        await self.coll.update_one(
            {"jobId": job_id},
            {"$set": {"status": "done", "result": result or {}, "leaseUntil": None,
                      "updatedAt": _utcnow()}},
        )

    async def fail(self, job_id: str, error: str, *, retryable: bool = True) -> str:
        """Record failure; retry with backoff or park as dead. Returns new status."""
        doc = await self.coll.find_one({"jobId": job_id})
        if not doc:
            return "missing"
        attempts = int(doc.get("attempts", 1))
        max_attempts = int(doc.get("maxAttempts", 5))
        if retryable and attempts < max_attempts:
            await self.coll.update_one(
                {"jobId": job_id},
                {"$set": {"status": "pending", "runAfter": compute_backoff(attempts),
                          "leaseUntil": None, "lastError": error[:500],
                          "updatedAt": _utcnow()}},
            )
            return "pending"
        await self.coll.update_one(
            {"jobId": job_id},
            {"$set": {"status": "dead", "leaseUntil": None, "lastError": error[:500],
                      "updatedAt": _utcnow()}},
        )
        return "dead"

    async def requeue(self, job_id: str, org_id: str) -> bool:
        """Reset a dead/failed job to pending for a manual retry."""
        res = await self.coll.update_one(
            {"jobId": job_id, "orgId": org_id, "status": {"$in": ["dead", "failed"]}},
            {"$set": {"status": "pending", "runAfter": _utcnow(), "leaseUntil": None,
                      "lastError": None, "updatedAt": _utcnow()}},
        )
        return res.modified_count == 1

    async def list_by_org(
        self, org_id: str, status: str | None = None, skip: int = 0, limit: int = 50
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"orgId": org_id}
        if status:
            query["status"] = status
        cursor = self.coll.find(query).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs
