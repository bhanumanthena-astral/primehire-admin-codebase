"""V2-only intake ledger and persistent fencing/identity claims."""
from __future__ import annotations
import hashlib
import hmac
import uuid
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from fastapi import HTTPException
from ..config import settings


def now():
    return datetime.now(timezone.utc)


def digest(org: str, value: str):
    return hmac.new((settings.resume_identity_secret or settings.jwt_secret).encode(), f"{org}:{value}".encode(), hashlib.sha256).hexdigest()


INDEXES = {
    "resume_intake_batches": [([("orgId", 1), ("createdAt", -1)], {}),
        ([("orgId", 1), ("jobId", 1), ("createdAt", -1)], {})],
    "resume_intake_items": [([("orgId", 1), ("batchId", 1), ("rowNumber", 1)], {"unique": True}),
        ([("orgId", 1), ("batchId", 1), ("status", 1), ("rowNumber", 1)], {}),
        ([("orgId", 1), ("applicantId", 1), ("createdAt", -1)], {}),
        ([("orgId", 1), ("jobId", 1), ("contentHash", 1)], {})],
    "resume_intake_claims": [],
    "resume_intake_notes": [([("orgId", 1), ("itemId", 1), ("createdAt", -1)], {})],
    "resume_intake_settings": [],
    "resume_intake_limits": [([("expiresAt", 1)], {"expireAfterSeconds": 0})],
}


async def ensure_intake_indexes(db):
    for collection, specifications in INDEXES.items():
        for keys, options in specifications:
            await db[collection].create_index(keys, **options)


class IntakeRepository:
    def __init__(self, db):
        self.db = db
        self.batches = db["resume_intake_batches"]
        self.items = db["resume_intake_items"]

    async def get_batch(self, batch_id, org):
        return await self.batches.find_one({"_id": batch_id, "orgId": org})

    async def get_item(self, item_id, org):
        return await self.items.find_one({"_id": item_id, "orgId": org})

    async def patch_item(self, item_id, org, changes, revision=None):
        query = {"_id": item_id, "orgId": org}
        if revision is not None:
            query["revision"] = revision
        result = await self.items.find_one_and_update(query, {"$set": {**changes, "updatedAt": now()},
            "$inc": {"revision": 1}}, return_document=ReturnDocument.AFTER)
        if not result:
            raise HTTPException(409, "This resume changed. Refresh before trying again.")
        return result

    async def summary(self, batch):
        counts = {}
        async for row in self.items.aggregate([
            {"$match": {"orgId": batch["orgId"], "batchId": batch["_id"]}},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ]):
            counts[row["_id"]] = row["count"]
        total = sum(counts.values())
        failures = sum(counts.get(s, 0) for s in ["failed", "rejected", "virus_detected", "unsupported_format", "password_protected", "scan_required", "ocr_required", "conversion_required", "confirmation_paused"])
        ats_pending=await self.items.count_documents({'orgId':batch['orgId'],'batchId':batch['_id'],'status':{'$in':['review_required','duplicate_suspected','confirmation_paused']},'atsState':{'$in':['queued','scoring']}})
        stats={'within':0,'below':0,'above':0,'pending':0}
        policy=batch.get('atsRange')
        if policy:
            from ..services.resume_intake_ats import job_fingerprint
            job=await self.db['jobs'].find_one({'orgId':batch['orgId'],'jobId':batch['jobId']})
            fresh={'$and':[{'$eq':['$atsState','done']},{'$eq':['$atsPreviewJobHash',job_fingerprint(job or {})]},{'$ne':['$atsStale',True]}]}
            async for group in self.items.aggregate([{'$match':{'orgId':batch['orgId'],'batchId':batch['_id'],'status':{'$in':['review_required','duplicate_suspected','confirmation_paused']}}},
                {'$group':{'_id':{'$cond':[fresh,{'$cond':[{'$lt':['$ats.overall',policy['minimum']]},'below',{'$cond':[{'$gt':['$ats.overall',policy['maximum']]},'above','within']}]},'pending']},'count':{'$sum':1}}}]):
                stats[group['_id']]=group['count']
        status = "processing" if not batch.get("imported") or batch.get("bulkApprovalRunning") or batch.get('atsScoringRequested') or ats_pending or any(counts.get(s) for s in ["uploaded", "queued", "processing", "confirming"]) else "review_required" if any(counts.get(s) for s in ["review_required", "duplicate_suspected"]) else "partial" if failures and failures < total else "failed" if failures else "completed"
        return {"batchId": batch["_id"], "jobId": batch["jobId"], "jobKey": batch["jobKey"], "importComplete": bool(batch.get("imported")),
            "jobTitle": batch.get("jobTitle", ""), "mode": batch["mode"], "source": batch["source"],
            "status": status, "counts": {"total": total, **counts}, "createdAt": batch["createdAt"],
            "bulkApprovalRunning": bool(batch.get("bulkApprovalRunning")), "bulkApprovalResult": batch.get("bulkApprovalResult"), "error": batch.get("error"),
            'atsRange':policy,'atsRangeRevision':batch.get('atsRangeRevision',0),'atsStats':stats,'atsPending':ats_pending,
            "updatedAt": batch.get("updatedAt", batch["createdAt"])}

    async def refresh_summary(self, batch_id, org):
        batch = await self.get_batch(batch_id, org)
        if batch:
            summary = await self.summary(batch)
            await self.batches.update_one({"_id": batch_id, "orgId": org}, {"$set": {"cachedSummary": summary}})
            return summary


@asynccontextmanager
async def fenced_claim(db, org, keys: list[str], ttl=120):
    """Atomic sorted leases; collisions return retryable 409, never merge blindly."""
    owner = uuid.uuid4().hex
    held = []
    heartbeat = None
    try:
        for key in sorted(set(keys)):
            claim_id = digest(org, key)
            try:
                doc = await db["resume_intake_claims"].find_one_and_update(
                    {"_id": claim_id, "$or": [{"leaseUntil": {"$lte": now()}}, {"leaseUntil": None}]},
                    {"$set": {"orgId": org, "owner": owner, "leaseUntil": now() + timedelta(seconds=ttl)}},
                    upsert=True, return_document=ReturnDocument.AFTER)
            except DuplicateKeyError:
                raise HTTPException(409, "Another request is processing this candidate. Retry shortly.") from None
            held.append(claim_id)
        async def renew():
            while True:
                await asyncio.sleep(max(5, ttl // 3))
                for claim_id in held:
                    await db["resume_intake_claims"].update_one({"_id": claim_id, "owner": owner},
                        {"$set": {"leaseUntil": now() + timedelta(seconds=ttl)}})
        heartbeat = asyncio.create_task(renew())
        yield owner
    finally:
        if heartbeat:
            heartbeat.cancel()
            try:
                await heartbeat
            except asyncio.CancelledError:
                pass
        for claim_id in held:
            await db["resume_intake_claims"].update_one({"_id": claim_id, "owner": owner},
                {"$set": {"leaseUntil": now()}})
