"""Background import/parse handlers, durable replay and bounded local work."""
from __future__ import annotations
import asyncio
import hashlib
import io
import zipfile
import uuid
from datetime import timedelta
from pathlib import PurePosixPath
from ..config import settings
from ..models.resume_intake import IntakeRepository, fenced_claim, now
from ..models.jobs import BackgroundJobRepository
from ..schemas.resume_intake import CandidateProfile, IntakeSettings
from . import resume_intake_security as security
from .resume_intake_parse import isolated
from .resume_intake import add_item, enqueue_item, matches
from .storage import read_bytes, new_storage_key, write_bytes, resolve_storage_key


async def source_from_entry(archive, info, limits, org):
    from .capacity_guard import wait_for_capacity
    await wait_for_capacity()
    name, data = await asyncio.to_thread(security.read_zip_entry, archive, info, limits)
    security.validate_resume(name, data, limits.resumeMaxMb)
    path, key = new_storage_key(org, PurePosixPath(name).suffix)
    await asyncio.to_thread(write_bytes, path, data)
    return {"fileName": name, "storageKey": key, "sizeBytes": len(data),
        "mimeType": security.MIMES[PurePosixPath(name).suffix[1:].lower()], "contentHash": hashlib.sha256(data).hexdigest()}


async def import_batch(db, job):
    if not settings.resume_module_v2_enabled:
        return {"skipped": "module disabled"}
    org = job["orgId"]
    batch_id = job["payload"]["batchId"]
    repo = IntakeRepository(db)
    async with fenced_claim(db, org, [f"import:{batch_id}"], ttl=900):
        batch = await repo.get_batch(batch_id, org)
        if not batch or batch.get("imported") or batch.get("retentionUntil", now()).replace(tzinfo=now().tzinfo) <= now():
            return {"skipped": "already imported"}
        limits = IntakeSettings.model_validate(batch["limits"])
        if batch.get("retryRowZero"):
            await repo.items.delete_one({"orgId": org, "batchId": batch_id, "rowNumber": 0})
            await repo.batches.update_one({"_id": batch_id, "orgId": org}, {"$set": {"retryRowZero": False}})
        try:
            if batch["mode"] in {"single", "files"}:
                for number, original in enumerate(batch["originals"], 1):
                    await add_item(db, batch, number, source_file=original)
            elif batch["mode"] == "zip":
                original = batch["originals"][0]
                with zipfile.ZipFile(resolve_storage_key(original["storageKey"])) as archive:
                    entries = security.inspect_zip(archive, limits)
                    for number, info in enumerate(entries, 1):
                        existing = await repo.items.find_one({"orgId": org, "batchId": batch_id, "rowNumber": number})
                        if existing:
                            if existing["status"] == "queued":
                                await enqueue_item(db, existing)
                            continue
                        try:
                            source = await source_from_entry(archive, info, limits, org)
                            await add_item(db, batch, number, source_file=source)
                        except security.IntakeError as exc:
                            await add_item(db, batch, number, source_file={"fileName": info.filename[:255]}, error=(exc.code, exc.message))
            else:
                data = await asyncio.to_thread(read_bytes, batch["originals"][0]["storageKey"])
                verdict = await asyncio.to_thread(security.scan, data)
                if verdict != "clean":
                    raise security.IntakeError(verdict, "Excel security scan could not be completed." if verdict == "scan_required" else "Malware detected in the Excel upload.")
                result = await asyncio.to_thread(isolated, data, "xlsx", options={"maxRows": limits.excelMaxRows, "requireResume": bool(batch.get("resumeArchive"))})
                companion = batch.get("resumeArchive")
                archive = zipfile.ZipFile(resolve_storage_key(companion["storageKey"])) if companion else None
                try:
                    entries = security.inspect_zip(archive, limits) if archive else []
                    by_name = {}
                    for info in entries:
                        by_name.setdefault(PurePosixPath(info.filename.replace("\\", "/")).name.casefold(), []).append(info)
                    referenced = set()
                    for row in result["rows"]:
                        number = row["rowNumber"]
                        if await repo.items.find_one({"orgId": org, "batchId": batch_id, "rowNumber": number}):
                            continue
                        warnings = row.get("warnings", [])
                        resume_name = row.get("resumeFileName", "")
                        selected = by_name.get(resume_name.casefold(), []) if resume_name else []
                        source = None
                        error = (row["status"], row["error"]) if row.get("error") else None
                        if resume_name:
                            if len(selected) != 1:
                                warnings.append("Resume reference is missing or ambiguous. Review the profile before confirmation.")
                            else:
                                info = selected[0]
                                referenced.add(info.filename)
                                try:
                                    source = await source_from_entry(archive, info, limits, org)
                                except security.IntakeError as exc:
                                    error = (exc.code, exc.message)
                        item = await add_item(db, batch, number, profile=row.get("profile"), source_file=source, warnings=warnings, error=error)
                        if not source and not error:
                            duplicates = await matches(db,org,row.get('profile',{}))
                            await repo.items.update_one({"_id": item["_id"], "orgId": org}, {"$set": {"scanStatus": "clean", "profileOnly": True,
                                "status": "duplicate_suspected" if duplicates or row.get('status')=='duplicate_suspected' else 'review_required'}})
                    for number, info in enumerate(entries, 100000):
                        if info.filename not in referenced:
                            await add_item(db, batch, number, source_file={"fileName": info.filename[:255]},
                                error=("rejected", "Resume was not associated with a valid Excel row."))
                finally:
                    if archive:
                        archive.close()
        except security.IntakeError as exc:
            await add_item(db, batch, 0, source_file={"fileName": batch["originals"][0]["fileName"]}, error=(exc.code, exc.message))
        except OSError:
            await add_item(db, batch, 0, source_file={"fileName": batch["originals"][0]["fileName"]}, error=("failed", "Storage is unavailable. Restore private storage and retry this import."))
        except (zipfile.BadZipFile, RuntimeError):
            await add_item(db, batch, 0, source_file={"fileName": batch["originals"][0]["fileName"]}, error=("rejected", "Container is corrupt, encrypted or unreadable."))
        await repo.batches.update_one({"_id": batch_id, "orgId": org}, {"$set": {"imported": True, "updatedAt": now()}})
        current = await repo.get_batch(batch_id, org)
        if current.get('atsRange'):
            from .resume_intake_selection import score_batch
            await score_batch(db, {'orgId':org,'payload':{'batchId':batch_id}})
        return {"imported": True, "batchId": batch_id}


async def parse_item(db, job):
    if not settings.resume_module_v2_enabled:
        return {"skipped": "module disabled"}
    org, item_id = job["orgId"], job["payload"]["itemId"]
    repo = IntakeRepository(db)
    async with fenced_claim(db, org, [f"item:{item_id}"], ttl=120):
        item = await repo.get_item(item_id, org)
        if not item or item["status"] not in {"queued", "processing"} or item.get("retentionUntil", now()).replace(tzinfo=now().tzinfo) <= now():
            return {"skipped": "item no longer queued"}
        item = await repo.patch_item(item_id, org, {"status": "processing"}, revision=item["revision"])
        batch = await repo.get_batch(item["batchId"], org)
        limits = IntakeSettings.model_validate(batch["limits"])
        try:
            data = await asyncio.to_thread(read_bytes, item["storageKey"])
            kind = security.validate_resume(item["fileName"], data, limits.resumeMaxMb, item.get("mimeType", ""))
            verdict = await asyncio.to_thread(security.scan, data)
            await repo.items.update_one({"_id": item_id, "orgId": org}, {"$set": {"scanStatus": verdict}})
            if verdict != "clean":
                raise security.IntakeError(verdict, "Malware detected; this resume is blocked." if verdict == "virus_detected" else "Malware scanner unavailable. Retry when the scanner is ready.")
            parsed = await asyncio.to_thread(isolated, data, kind,
                options={"tessdata": settings.resume_ocr_tessdata, "converter": settings.resume_doc_converter})
            extracted = parsed["profile"]
            # A spreadsheet's explicitly supplied values take precedence over
            # extracted suggestions; blanks can be filled from its resume.
            incoming = item.get("profile", {})
            profile = CandidateProfile.model_validate({key: incoming.get(key) if incoming.get(key) not in (None, "", []) else value for key, value in extracted.items()}).model_dump(mode="json")
            duplicates = await matches(db, org, profile)
            duplicate_file = await repo.items.find_one({"orgId": org, "jobId": item["jobId"],
                "contentHash": item["contentHash"], "_id": {"$ne": item_id}, "status": {"$in": ["review_required", "duplicate_suspected", "completed", "duplicate"]}})
            warnings = list(dict.fromkeys(item.get("warnings", []) + parsed.get("warnings", []) + (["This file was already uploaded for the job."] if duplicate_file else [])))
            if not profile.get("email") and not profile.get("phone"):
                warnings.append("A valid email or phone is required before confirmation.")
            ready=await repo.patch_item(item_id, org, {"status": "duplicate_suspected" if duplicates or duplicate_file else "review_required",
                "profile": profile, "rawText": parsed["rawText"], "confidence": parsed["confidence"], "warnings": warnings, "error": None}, revision=item["revision"])
            if batch.get('atsRange'):
                from .resume_intake_selection import enqueue_score
                target=await db['jobs'].find_one({'orgId':org,'jobId':item['jobId']})
                if target:await enqueue_score(db,{**ready,'scanStatus':'clean'},target)
            await db["resume_files"].update_one({"fileId": item_id, "orgId": org},
                {"$set": {"status": "parsed", "kind": kind, "parsedJson": profile, "rawTextChars": len(parsed["rawText"])}})
            return {"reviewRequired": True}
        except security.IntakeError as exc:
            await repo.patch_item(item_id, org, {"status": exc.code, "error": exc.message}, revision=item["revision"])
            return {"status": exc.code}
        except (OSError, ValueError):
            await repo.patch_item(item_id, org, {"status": "failed", "error": "Stored resume or parsed data could not be processed. Retry or upload a replacement."}, revision=item["revision"])
            return {"status": "failed"}


async def reconcile(db, limit=100):
    """Repair store/enqueue crash windows, bounded per worker sweep."""
    if not settings.resume_module_v2_enabled:
        return 0
    repaired = 0
    async for item in db["resume_intake_items"].find({"status": "confirming"}).limit(limit):
        await BackgroundJobRepository(db).enqueue(org_id=item["orgId"], kind="resume_intake_confirm",
            entity_type="resume_intake_item", entity_key=item["_id"], payload={"itemId": item["_id"]},
            dedupe_key=f"{item['orgId']}:resume_intake_confirm:{item['_id']}:{item['revision']}")
        repaired += 1
    async for batch in db["resume_intake_batches"].find({"bulkApprovalRunning": True}).limit(limit):
        approval = batch.get("bulkApproval", {})
        if approval:
            await BackgroundJobRepository(db).enqueue(org_id=batch["orgId"], kind="resume_intake_bulk_confirm",
                entity_type="resume_intake_batch", entity_key=batch["_id"],
                payload={"batchId": batch["_id"], "actorUserId": approval["actorUserId"], "approvedAt": approval["approvedAt"],'atsRangeRevision':approval.get('atsRangeRevision')},
                dedupe_key=f"{batch['orgId']}:resume_intake_bulk_confirm:{approval['id']}")
            repaired += 1
    async for batch in db['resume_intake_batches'].find({'atsScoringRequested':True}).limit(limit):
        await BackgroundJobRepository(db).enqueue(org_id=batch['orgId'],kind='resume_intake_score_batch',entity_type='resume_intake_batch',entity_key=batch['_id'],
            payload={'batchId':batch['_id']},dedupe_key=f"{batch['orgId']}:resume_intake_score_batch:{batch['_id']}:{batch.get('atsRangeRevision',0)}")
        repaired+=1
    async for item in db['resume_intake_items'].find({'atsState':{'$in':['queued','scoring']},'status':{'$in':['review_required','duplicate_suspected','confirmation_paused']}}).limit(limit):
        target=await db['jobs'].find_one({'orgId':item['orgId'],'jobId':item['jobId']})
        if target:
            from .resume_intake_selection import enqueue_score
            await enqueue_score(db,item,target)
            repaired+=1
    async for batch in db["resume_intake_batches"].find({"imported": False}).limit(limit):
        suffix = f":retry:{batch['retryGeneration']}" if batch.get("retryGeneration") else ""
        await BackgroundJobRepository(db).enqueue(org_id=batch["orgId"], kind="resume_intake_import",
            entity_type="resume_intake_batch", entity_key=batch["_id"], payload={"batchId": batch["_id"]},
            dedupe_key=f"{batch['orgId']}:resume_intake_import:{batch['_id']}{suffix}")
        repaired += 1
    async for item in db["resume_intake_items"].find({"status": {"$in": ["queued", "processing"]}}).limit(limit):
        await enqueue_item(db, item)
        repaired += 1
    return repaired


async def run_intake_workers(db, concurrency=2, poll_seconds=2):
    """A bounded pool; multiple hosts share Mongo claims and private storage."""
    from .worker import run_once
    if not settings.resume_module_v2_enabled or settings.mongodb_database != "primehire_admin_v2":
        raise RuntimeError("Resume intake workers must run against the explicitly enabled V2 database.")
    if not 1 <= concurrency <= 8:
        raise ValueError("Resume worker concurrency must be between 1 and 8")
    async def lane():
        while True:
            from .capacity_guard import wait_for_capacity
            await wait_for_capacity()
            result = await run_once(db, kinds=["resume_intake_import", "resume_intake_parse", "resume_intake_score_batch", "resume_intake_score", "resume_intake_confirm", "resume_intake_bulk_confirm"])
            if not result:
                await asyncio.sleep(poll_seconds)
    async def maintain():
        from .resume_intake_retention import sweep
        worker_id = f"intake-worker:{uuid.uuid4().hex}"
        while True:
            await db["resume_intake_limits"].update_one({"_id": worker_id}, {"$set": {
                "kind": "worker", "expiresAt": now() + timedelta(seconds=90), "updatedAt": now(),
                "scannerReady": await asyncio.to_thread(security.scanner_ready), "concurrency": concurrency}}, upsert=True)
            await reconcile(db)
            await sweep(db)
            await asyncio.sleep(30)
    tasks = [asyncio.create_task(lane()) for _ in range(concurrency)] + [asyncio.create_task(maintain())]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def supervise_intake_workers(db, concurrency=2, poll_seconds=2, retry_seconds=5):
    """Restart the bounded pool after transient Mongo failures; keep queued intents."""
    import logging
    from pymongo.errors import PyMongoError
    logger = logging.getLogger(__name__)
    while True:
        try:
            return await run_intake_workers(db, concurrency=concurrency, poll_seconds=poll_seconds)
        except PyMongoError as error:
            # Never log connection strings, credentials or candidate information.
            logger.warning('Resume worker reconnecting after %s', type(error).__name__)
            await asyncio.sleep(retry_seconds)
