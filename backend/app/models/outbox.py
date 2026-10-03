"""Encrypted email-outbox repository (Slice C).

- Bodies are Fernet-encrypted at rest; `payloadEncrypted=None, wiped=True`
  after a real send (passwords live only in the encrypted body, briefly).
- Dedupe on `dedupeKey` (kind+entity+due): a second enqueue returns the
  existing message — rapid double-clicks send once.
- Retry with backoff; `failed` after maxAttempts. Bodies are NEVER returned
  by list queries (metadata only); single-message read is explicit.
"""

from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from pymongo.errors import DuplicateKeyError


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def recipient_hash(email: str) -> str:
    return hashlib.sha256((email or "").strip().lower().encode()).hexdigest()


def mask_recipient(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    if not local or not domain:
        return "***"
    return f"{local[0]}***@{domain}"


class EmailOutboxRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["email_outbox"]

    async def enqueue(
        self,
        *,
        org_id: str,
        kind: str,
        entity_type: str,
        entity_key: str,
        to_email: str,
        to_name: str,
        subject: str,
        payload_encrypted: str,
        dedupe_key: str | None = None,
        max_attempts: int = 5,
    ) -> dict[str, Any]:
        key = dedupe_key or f"{kind}:{entity_type}:{entity_key}"
        record = {
            "messageId": uuid.uuid4().hex,
            "orgId": org_id,
            "kind": kind,
            "entityType": entity_type,
            "entityKey": entity_key,
            "dedupeKey": key,
            "toHash": recipient_hash(to_email),
            "toMasked": mask_recipient(to_email),
            "toName": to_name,
            "subject": subject,  # subjects never contain passwords/links
            "payloadEncrypted": payload_encrypted,
            "wiped": False,
            "status": "pending",
            "sentVia": None,
            "attempts": 0,
            "maxAttempts": max_attempts,
            "nextRetryAt": _utcnow(),
            "lastError": None,
            "sentAt": None,
            "createdAt": _utcnow(),
            "updatedAt": _utcnow(),
        }
        pre = await self.coll.find_one({"dedupeKey": key, "orgId": org_id})
        if pre is not None:
            pre.pop("_id", None)
            return pre
        try:
            await self.coll.insert_one(record)
        except DuplicateKeyError:
            existing = await self.coll.find_one({"dedupeKey": key, "orgId": org_id})
            if existing:
                existing.pop("_id", None)
                return existing
            raise
        record.pop("_id", None)
        return record

    async def get(self, message_id: str, org_id: str, *, include_body: bool = False) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"messageId": message_id, "orgId": org_id})
        if not doc:
            return None
        doc.pop("_id", None)
        if not include_body:
            doc.pop("payloadEncrypted", None)
        return doc

    async def list_meta(
        self, org_id: str, status: str | None = None, skip: int = 0, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Metadata only — bodies never leave the server in lists."""
        query: dict[str, Any] = {"orgId": org_id}
        if status:
            query["status"] = status
        cursor = self.coll.find(query, {"payloadEncrypted": 0}).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def mark_sending(self, message_id: str, org_id: str) -> None:
        await self.coll.update_one(
            {"messageId": message_id, "orgId": org_id},
            {"$set": {"status": "sending", "updatedAt": _utcnow()}, "$inc": {"attempts": 1}},
        )

    async def mark_sent(self, message_id: str, org_id: str, *, via: str, wipe: bool) -> None:
        update: dict[str, Any] = {"status": "sent", "sentVia": via, "sentAt": _utcnow(),
                                  "lastError": None, "updatedAt": _utcnow()}
        if wipe:
            update["payloadEncrypted"] = None
            update["wiped"] = True
        await self.coll.update_one({"messageId": message_id, "orgId": org_id}, {"$set": update})

    async def mark_failed(self, message_id: str, org_id: str, error: str, *, retryable: bool,
                          max_attempts: int = 5) -> str:
        doc = await self.coll.find_one({"messageId": message_id, "orgId": org_id})
        if not doc:
            return "missing"
        if retryable and int(doc.get("attempts", 1)) < max_attempts:
            delay = min(300 * (2 ** max(0, int(doc.get("attempts", 1)) - 1)), 3600)
            delay += random.uniform(0, min(60, delay))
            await self.coll.update_one(
                {"messageId": message_id, "orgId": org_id},
                {"$set": {"status": "pending",
                          "nextRetryAt": _utcnow() + timedelta(seconds=delay),
                          "lastError": error[:300], "updatedAt": _utcnow()}},
            )
            return "pending"
        await self.coll.update_one(
            {"messageId": message_id, "orgId": org_id},
            {"$set": {"status": "failed", "lastError": error[:300], "updatedAt": _utcnow()}},
        )
        return "failed"

    async def requeue(self, message_id: str, org_id: str) -> bool:
        res = await self.coll.update_one(
            {"messageId": message_id, "orgId": org_id, "status": "failed"},
            {"$set": {"status": "pending", "nextRetryAt": _utcnow(), "lastError": None,
                      "updatedAt": _utcnow()}},
        )
        return res.modified_count == 1

    async def counts_by_status(self, org_id: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        async for row in self.coll.aggregate(
            [{"$match": {"orgId": org_id}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]
        ):
            counts[str(row["_id"])] = int(row["n"])
        return counts
