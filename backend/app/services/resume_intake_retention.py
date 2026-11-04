"""Bounded V2 ledger retention. Never enumerate or delete unreferenced files."""
import asyncio
from fastapi import HTTPException
from ..config import settings
from ..models.resume_intake import fenced_claim, now, IntakeRepository
from .storage import resolve_storage_key
from .pii import phone_digits_variants


async def unlink_private(key):
    if key:
        await asyncio.to_thread(resolve_storage_key(key).unlink, missing_ok=True)


async def anonymize_expired_person(db, org, candidate_id):
    person = await db['applicants'].find_one({'orgId': org, 'applicantId': candidate_id, 'intakeManaged': True})
    if not person:
        return
    keys = [f'candidate:{candidate_id}']
    if person.get('email'):
        keys.append(f"email:{person['email']}")
    keys += [f'phone:{digits}' for digits in phone_digits_variants(person.get('phone', ''))]
    async with fenced_claim(db, org, keys):
        # A later consented resume, a pending confirmed intent, or a legacy
        # application prevents this Module 2 sweep from erasing a shared person.
        active = await db['resume_intake_items'].count_documents({'orgId': org, 'retentionUntil': {'$gt': now()},
            '$or': [{'applicantId': candidate_id}, {'confirmation.applicantId': candidate_id}]})
        external = await db['applications'].count_documents({'orgId': org, 'applicantId': candidate_id, 'intakeItemId': None})
        if active or external:
            return
        await db['applicants'].update_one({'orgId': org, 'applicantId': candidate_id, 'intakeManaged': True}, {'$set': {
            'name': 'Expired candidate', 'email': f'expired-{candidate_id}@placeholder.local', 'phone': '',
            'phoneDigits': [], 'profile': {}, 'resume': {}, 'tags': [], 'anonymizedAt': now(), 'updatedAt': now()}})


async def sweep(db, limit=100):
    if not settings.resume_module_v2_enabled or settings.mongodb_database != "primehire_admin_v2":
        return 0
    cleaned = 0
    query = {"$or": [{"retentionUntil": {"$lte": now()}, "retentionPurgedAt": None},
        {"status": "deleted", "deletedStorageKey": {"$nin": [None, ""]}}, {'candidateRetentionPending': True}]}
    async for item in db["resume_intake_items"].find(query).limit(limit):
        org, item_id = item["orgId"], item["_id"]
        try:
            async with fenced_claim(db, org, [f"item:{item_id}"]):
                fresh = await IntakeRepository(db).get_item(item_id, org)
                if fresh.get('retentionPurgedAt') and fresh.get('candidateRetentionPending'):
                    await anonymize_expired_person(db,org,fresh['applicantId'])
                    await db['resume_intake_items'].update_one({'_id':item_id,'orgId':org},{'$set':{'candidateRetentionPending':False}})
                    cleaned += 1
                    continue
                key = fresh.get("storageKey") or fresh.get("deletedStorageKey")
                shared = await db["resume_intake_items"].find_one({"orgId": org, "storageKey": key,
                    "_id": {"$ne": item_id}, "retentionUntil": {"$gt": now()}, "status": {"$ne": "deleted"}}) if key else None
                if not shared:
                    await unlink_private(key)
                from datetime import timezone
                expiry = fresh.get("retentionUntil")
                expired = expiry is not None and expiry.replace(tzinfo=timezone.utc) <= now()
                if not expired:
                    await db["resume_intake_items"].update_one({"_id": item_id, "orgId": org}, {"$set": {"deletedStorageKey": ""}})
                    cleaned += 1
                    continue
                await db["resume_intake_items"].update_one({"_id": item_id, "orgId": org}, {"$set": {
                    "status": "deleted", "profile": {}, "rawText": "", "storageKey": "", "deletedStorageKey": "",
                    "confirmation": None, "warnings": [], "confidence": {}, "fileName": "Expired resume",
                    "retentionPurgedAt": now(), "candidateRetentionPending": bool(fresh.get('applicantId')), "updatedAt": now()}, "$inc": {"revision": 1}})
                await db["resume_intake_notes"].delete_many({"orgId": org, "itemId": item_id})
                if fresh.get("fileId") and not shared:
                    await db["resume_files"].update_one({"orgId": org, "fileId": fresh["fileId"]},
                        {"$set": {"status": "quarantined", "storageKey": "", "parsedJson": {}, "fileName": "Expired resume"}})
                await db["audit_log"].insert_one({"orgId": org, "actorUserId": "system:retention",
                    "action": "resume_intake.retention_purge", "resourceType": "resume_intake", "resourceId": item_id,
                    "createdAt": now(), "details": {"originalRemoved": not bool(shared)}})
                if fresh.get('applicantId'):
                    await anonymize_expired_person(db, org, fresh['applicantId'])
                    await db['resume_intake_items'].update_one({'_id':item_id,'orgId':org},{'$set':{'candidateRetentionPending':False}})
                await IntakeRepository(db).refresh_summary(fresh["batchId"], org)
                cleaned += 1
        except (HTTPException, OSError, ValueError):
            continue  # A busy parser or temporarily unavailable disk is retried next sweep.
    async for batch in db["resume_intake_batches"].find({"retentionUntil": {"$lte": now()}, "originalsPurgedAt": None}).limit(10):
        try:
            async with fenced_claim(db, batch["orgId"], [f"import:{batch['_id']}"]):
                pending = await db["resume_intake_items"].count_documents({"orgId": batch["orgId"], "batchId": batch["_id"], "retentionPurgedAt": None})
                if pending:
                    continue
                for original in batch.get("originals", []) + ([batch["resumeArchive"]] if batch.get("resumeArchive") else []):
                    await unlink_private(original.get("storageKey"))
                await db["resume_intake_batches"].update_one({"_id": batch["_id"], "orgId": batch["orgId"]},
                    {"$set": {"originals": [], "resumeArchive": None, "originalsPurgedAt": now(), "imported": True}})
        except (HTTPException, OSError, ValueError):
            continue
    return cleaned
