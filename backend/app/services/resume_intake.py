"""Durable V2 intake. Requests store originals; workers parse; people confirm."""
from __future__ import annotations
import asyncio
import hashlib
import json
import uuid
from pathlib import Path
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from ..config import settings
from ..models.hiring import AuditLogRepository, JobRepository
from ..models.jobs import BackgroundJobRepository
from ..models.resume_intake import IntakeRepository, fenced_claim, now
from ..schemas.resume_intake import CandidateProfile, IntakeSettings, SOURCES
from ..security.job_permissions import require_job_access, job_access
from .job_intake import intake_error
from .storage import new_storage_key, resolve_storage_key, validate_client_filename


async def get_limits(db, org):
    doc = await db["resume_intake_settings"].find_one({"_id": org})
    limits = IntakeSettings.model_validate((doc or {}).get("settings", {}))
    if settings.free_tier_guard_enabled:
        limits = limits.model_copy(update={'zipMaxFiles': min(limits.zipMaxFiles, 1000),
            'excelMaxRows': min(limits.excelMaxRows, 1000)})
    return limits


async def job_for(db, user, job_id, *, write=False):
    job = await JobRepository(db, owner_id=None if user.role in {"super_admin", "admin"} else user.user_id).get_by_id(job_id, user.org_id)
    if not job:
        raise HTTPException(404, "Job not found or access denied.")
    await require_job_access(db, user, "upload" if write else "view", job)
    if write and intake_error(job):
        raise HTTPException(409, intake_error(job))
    if write and user.impersonating:
        raise HTTPException(403, "View-as sessions cannot modify resume intake.")
    return job


async def item_for(db, user, item_id, *, write=False, existing_write=False):
    item = await IntakeRepository(db).get_item(item_id, user.org_id)
    if not item:
        raise HTTPException(404, "Resume not found.")
    from datetime import timezone
    expiry = item.get("retentionUntil")
    if expiry and expiry.replace(tzinfo=timezone.utc) <= now():
        raise HTTPException(410, "This resume has expired under the retention policy.")
    job = await job_for(db, user, item["jobId"], write=write)
    if existing_write:
        if user.impersonating or "resumes.upload" not in user.permissions:
            raise HTTPException(403, "Resume editing access is required.")
        if user.role not in {"super_admin", "admin"} and job.get("assigneeAccess") is not None and "upload" not in job["assigneeAccess"]:
            raise HTTPException(403, "Resume editing access was removed for this job.")
        actor = await db['users'].find_one({'userId': user.user_id, 'orgId': user.org_id}, {'jobAccess': 1})
        if 'upload' not in job_access(user.role, (actor or {}).get('jobAccess')):
            raise HTTPException(403, "Resume editing access was removed for this account.")
    return item, job


async def audit(db, user, action, item_id, details=None):
    await AuditLogRepository(db).log(org_id=user.org_id, actor_user_id=user.user_id,
        action=f"resume_intake.{action}", resource_type="resume_intake", resource_id=item_id,
        details=details or {})


async def spool(upload, org, limit_mb, extensions):
    try:
        name = validate_client_filename(upload.filename or "")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    ext = Path(name).suffix.lower()
    if ext not in extensions:
        raise HTTPException(422, "Unsupported file format for this upload mode.")
    dest, key = new_storage_key(org, ext)
    total, content_hash = 0, hashlib.sha256()
    try:
        with dest.open("xb") as output:
            while True:
                chunk = await upload.read(256 * 1024)
                if not chunk:
                    break
                if settings.free_tier_guard_enabled:
                    from .capacity_guard import require_capacity
                    require_capacity(required_bytes=len(chunk))
                total += len(chunk)
                if total > limit_mb * 1024 * 1024:
                    raise HTTPException(413, f"File exceeds the {limit_mb} MB limit.")
                content_hash.update(chunk)
                await asyncio.to_thread(output.write, chunk)
        if not total:
            raise HTTPException(422, "Empty files cannot be uploaded.")
        return {"fileName": name, "storageKey": key, "sizeBytes": total,
            "contentHash": content_hash.hexdigest(), "mimeType": upload.content_type or "application/octet-stream"}
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


async def enqueue_item(db, item):
    generation = item.get("generation", 0)
    await BackgroundJobRepository(db).enqueue(org_id=item["orgId"], kind="resume_intake_parse",
        entity_type="resume_intake_item", entity_key=item["_id"], payload={"itemId": item["_id"]},
        dedupe_key=f"{item['orgId']}:resume_intake_parse:{item['_id']}:{generation}")


async def add_item(db, batch, row, *, profile=None, source_file=None, error=None, warnings=None):
    item_id = hashlib.sha256(f"{batch['_id']}:{row}".encode()).hexdigest()
    doc = {"_id": item_id, "orgId": batch["orgId"], "batchId": batch["_id"], "jobId": batch["jobId"],
        "rowNumber": row, "fileName": (source_file or {}).get("fileName", f"Excel row {row}"),
        "status": error[0] if error else "queued" if source_file else "review_required",
        "error": error[1] if error else None, "profile": profile or CandidateProfile().model_dump(mode="json"),
        "warnings": warnings or [], "confidence": {}, "revision": batch.get("retryGeneration", 0) + 1, "generation": 0,
        "createdAt": now(), "updatedAt": now(), "source": batch["source"],
        "createdBy": batch["createdBy"], "retentionUntil": batch["retentionUntil"]}
    if source_file:
        doc.update(source_file)
        doc["fileId"] = item_id
    await db["resume_intake_items"].update_one({"_id": item_id}, {"$setOnInsert": doc}, upsert=True)
    item = await IntakeRepository(db).get_item(item_id, batch["orgId"])
    if source_file and not error:
        # Legacy attachment endpoints must block originals until they are scanned.
        await db["resume_files"].update_one({"fileId": item_id, "orgId": batch["orgId"]},
            {"$setOnInsert": {"fileId": item_id, "batchId": batch["_id"], "orgId": batch["orgId"],
                "jobId": batch["jobId"], **source_file, "status": "quarantined", "createdAt": now()}}, upsert=True)
        if item["status"] == "queued":
            await enqueue_item(db, item)
    return item


async def accept_upload(db, user, *, job_id, mode, source, consent, uploads, archive=None, request_key=None):
    from datetime import timedelta
    if mode not in {"single", "files", "zip", "excel"} or source not in SOURCES:
        raise HTTPException(422, "Choose a valid upload mode and source.")
    if not consent:
        raise HTTPException(422, "Candidate consent is required.")
    job = await job_for(db, user, job_id)
    existing_key = hashlib.sha256(f"{user.org_id}:{user.user_id}:{request_key}".encode()).hexdigest() if request_key else None
    prior = await IntakeRepository(db).get_batch(existing_key, user.org_id) if existing_key else None
    if not prior:
        job = await job_for(db, user, job_id, write=True)
    limits = IntakeSettings.model_validate(prior["limits"]) if prior else await get_limits(db, user.org_id)
    max_files = min(10, 125 // limits.resumeMaxMb)
    if not uploads or (mode != "files" and len(uploads) != 1) or len(uploads) > max_files:
        raise HTTPException(422, f"Choose one file for single/ZIP/Excel mode or up to {max_files} individual resumes.")
    if archive and mode != "excel":
        raise HTTPException(422, "An accompanying resume ZIP is supported only in Excel mode.")
    if await db["resume_intake_items"].count_documents({"orgId": user.org_id, "status": {"$in": ["queued", "processing"]}}) >= 20000:
        raise HTTPException(429, "Your organization's processing queue is full. Retry later.", headers={"Retry-After": "30"})
    if settings.free_tier_guard_enabled:
        from .capacity_guard import require_capacity
        require_capacity(required_bytes=(limits.zipMaxMb + limits.expandedMaxMb + limits.excelMaxMb) * 1024**2)
    staged = []
    accepted = False
    try:
        for upload in uploads:
            max_mb = limits.zipMaxMb if mode == "zip" else limits.excelMaxMb if mode == "excel" else limits.resumeMaxMb
            extensions = {".zip"} if mode == "zip" else {".xlsx"} if mode == "excel" else {".pdf", ".doc", ".docx"}
            staged.append(await spool(upload, user.org_id, max_mb, extensions))
        companion = await spool(archive, user.org_id, limits.zipMaxMb, {".zip"}) if archive else None
        if companion:
            staged.append(companion)
        fingerprint = hashlib.sha256(json.dumps({"job": job_id, "mode": mode, "source": source,
            "files": [{k: f[k] for k in ["fileName", "contentHash", "sizeBytes", "mimeType"]} for f in staged]}, sort_keys=True).encode()).hexdigest()
        request_key = request_key or fingerprint
        batch_id = hashlib.sha256(f"{user.org_id}:{user.user_id}:{request_key}".encode()).hexdigest()
        repo = IntakeRepository(db)
        admission_org = '__free_host__' if settings.free_tier_guard_enabled else user.org_id
        async with fenced_claim(db, admission_org, [f"upload:{batch_id}", "upload-admission"]):
            existing = await repo.get_batch(batch_id, user.org_id)
            if existing:
                if existing.get("fingerprint") != fingerprint:
                    raise HTTPException(409, "Idempotency key was already used with different files or job.")
                return await repo.summary(existing)
            # Recheck immediately before accepting new work; a job may have
            # closed while its body was streaming. Replays create no new work.
            job = await job_for(db, user, job_id, write=True)
            # Reserve worst-case import size under one tenant lease. Imports
            # release reservations only after their bounded items are durable.
            scope = {} if settings.free_tier_guard_enabled else {"orgId": user.org_id}
            reserved = sum([int(b.get("reservedItems", 0)) async for b in repo.batches.find({**scope, "imported": False}, {"reservedItems": 1})])
            active = await repo.items.count_documents({**scope, "status": {"$in": ["queued", "processing", "review_required", "duplicate_suspected", "confirming"]}})
            units = limits.excelMaxRows + (limits.zipMaxFiles if archive else 0) if mode == "excel" else limits.zipMaxFiles if mode == "zip" else len(uploads)
            if settings.free_tier_guard_enabled:
                from .capacity_guard import require_capacity
                require_capacity(required_bytes=(limits.expandedMaxMb + limits.zipMaxMb) * 1024**2)
            capacity = settings.free_tier_active_resume_limit if settings.free_tier_guard_enabled else 20000
            if active + reserved + units > capacity:
                raise HTTPException(429, "Processing/review capacity is full. Complete existing batches and retry.", headers={"Retry-After": "30"})
            batch = {"_id": batch_id, "orgId": user.org_id, "jobId": job_id, "jobKey": job["jobKey"],
                "jobTitle": job["title"], "mode": mode, "source": source, "fingerprint": fingerprint,
                "originals": staged[:len(uploads)], "resumeArchive": companion,
                "limits": limits.model_dump(), "createdBy": user.user_id, "imported": False, "reservedItems": units,
                "consent": True, "createdAt": now(), "updatedAt": now(),
                "retentionUntil": now() + timedelta(days=settings.retention_days)}
            await repo.batches.insert_one(batch)
            accepted = True  # Durable batch owns these originals even if enqueue fails.
            await BackgroundJobRepository(db).enqueue(org_id=user.org_id, kind="resume_intake_import",
                entity_type="resume_intake_batch", entity_key=batch_id, payload={"batchId": batch_id},
                dedupe_key=f"{user.org_id}:resume_intake_import:{batch_id}")
            await audit(db, user, "upload", batch_id, {"mode": mode, "files": len(uploads), "jobId": job_id})
            return await repo.summary(batch)
    finally:
        if not accepted:
            for file in staged:
                resolve_storage_key(file["storageKey"]).unlink(missing_ok=True)


async def matches(db, org, profile):
    choices = []
    email, phone = profile.get("email", ""), profile.get("phone", "")
    filters = []
    if email:
        filters.append({"email": email.lower()})
    if phone:
        from .pii import phone_digits_variants
        filters.append({"phoneDigits": {"$in": phone_digits_variants(phone)}})
    if filters:
        choices = [doc async for doc in db["applicants"].find({"orgId": org, "$or": filters}).limit(20)]
    return choices
