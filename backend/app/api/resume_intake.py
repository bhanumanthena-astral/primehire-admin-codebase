"""Module 2 V2 API; every read/write is permission and job scoped."""
from __future__ import annotations
import asyncio
import csv
import hashlib
import io
import re
import uuid
from typing import Literal
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, Response, StreamingResponse
from ..config import settings
from ..models.resume_intake import IntakeRepository, fenced_claim, now
from ..models.jobs import BackgroundJobRepository
from ..schemas.resume_intake import IntakeSettings, ReviewRequest, RevisionRequest, NoteRequest, AssignRequest, DeleteRequest, AssociateRequest, BulkConfirmRequest, SettingsUpdate, AtsRangeRequest, STATUSES, RETRYABLE
from ..security.deps import CurrentUser, get_db, require_permission
from ..security.job_permissions import require_job_admin, job_access
from ..services import resume_intake as intake
from ..services.resume_intake_review import confirm, save_review
from ..services.resume_intake_ats import score, job_fingerprint, profile_fingerprint
from ..services.resume_intake_llm import evaluate
from ..services.resume_intake_excel import build_template, COLUMNS
from ..services.pii import mask_email, mask_phone
from ..services.resume_intake_projection import project_profile, redact_contacts
from ..services.storage import resolve_storage_key
from ..services import resume_intake_selection as ats_selection

router = APIRouter(prefix="/api/resume-intake", tags=["resume-intake-v2"])


def module_permission(permission):
    async def guard(user: CurrentUser = Depends(require_permission(permission)), db=Depends(get_db)):
        if settings.resume_module_v2_enabled and db is not None:
            actor = await db["users"].find_one({"orgId": user.org_id, "userId": user.user_id})
            if not actor or actor.get("role") != user.role or not actor.get("isActive", True):
                raise HTTPException(401, "Your account changed. Sign in again.")
            if permission != 'jobs.view' and user.impersonating:
                raise HTTPException(403, "View-as sessions are read-only.")
        return user
    return guard


def available(db):
    if not settings.resume_module_v2_enabled:
        raise HTTPException(404, "Module 2 is not enabled on this backend.")
    if db is None:
        raise HTTPException(503, "Resume intake database is unavailable.")


def public_item(item, *, detail=False, reveal=False):
    fields = ["batchId", "rowNumber", "fileName", "sizeBytes", "status", "error", "revision", "source",
        "createdAt", "updatedAt", "warnings", "scanStatus", "applicantId", "applicationId", "confirmedAt", "assignedUserId", "atsStale",'atsState','atsError']
    output = {key: item[key] for key in fields if key in item}
    output["itemId"] = item["_id"]
    output["profile"] = project_profile(item.get('profile'), detail=detail, reveal=reveal)
    output["ats"] = item.get("ats")
    if detail:
        output["confidence"] = item.get("confidence", {})
        output["hasResume"] = bool(item.get("fileId") and item.get("storageKey"))
    if reveal:
        output["rawText"] = item.get("rawText", "")
    return jsonable_encoder(output)


async def batch_for(db, user, batch_id):
    batch = await IntakeRepository(db).get_batch(batch_id, user.org_id)
    if not batch:
        raise HTTPException(404, "Batch not found.")
    await intake.job_for(db, user, batch["jobId"])
    return batch


@router.get("/capabilities")
async def capabilities(user: CurrentUser = Depends(module_permission("jobs.view")), db=Depends(get_db)):
    if not settings.resume_module_v2_enabled:
        return {"enabled": False}
    available(db)
    limits = await intake.get_limits(db, user.org_id)
    config = await db["resume_intake_settings"].find_one({"_id": user.org_id})
    pending = await db["background_jobs"].count_documents({"orgId": user.org_id, "kind": {"$in": ["resume_intake_import", "resume_intake_parse", "resume_intake_score_batch", "resume_intake_score", "resume_intake_confirm", "resume_intake_bulk_confirm"]}, "status": {"$in": ["pending", "running", "deferred"]}})
    worker = await db["resume_intake_limits"].find_one({"kind": "worker", "expiresAt": {"$gt": now()}})
    actor = await db['users'].find_one({'orgId': user.org_id, 'userId': user.user_id}, {'jobAccess': 1})
    can_upload = "resumes.upload" in user.permissions and 'upload' in job_access(user.role, (actor or {}).get('jobAccess')) and not user.impersonating
    return {"enabled": True, "limits": limits.model_dump(), "settingsRevision": (config or {}).get("revision", 0), "canUpload": can_upload,
        "canAdmin": user.role in {"super_admin", "admin"} and not user.impersonating, "queuePending": pending,
        "scannerRequired": True, "workerReady": bool(worker), "scannerReady": bool(worker and worker.get("scannerReady")),
        "ocrConfigured": bool(settings.resume_ocr_tessdata and Path(settings.resume_ocr_tessdata, "eng.traineddata").is_file()),
        "docConversionConfigured": bool(settings.resume_doc_converter and Path(settings.resume_doc_converter).is_file()),
        "canAssign": "applications.assign" in user.permissions and "resumes.upload" in user.permissions and not user.impersonating,
        "canDownload": "resumes.upload" in user.permissions or user.role == "viewer" and limits.viewerDownloads}


@router.put("/settings")
async def update_settings(payload: SettingsUpdate, user: CurrentUser = Depends(module_permission("users.manage")), db=Depends(get_db)):
    available(db)
    require_job_admin(user)
    if user.impersonating:
        raise HTTPException(403, "View-as sessions are read-only.")
    from pymongo.errors import DuplicateKeyError
    query = {"_id": user.org_id, "revision": payload.expectedRevision}
    if payload.expectedRevision == 0:
        query = {"_id": user.org_id, "$or": [{"revision": 0}, {"revision": None}]}
    try:
        result = await db["resume_intake_settings"].update_one(query, {"$set": {"settings": payload.settings.model_dump(), "updatedAt": now()}, "$inc": {"revision": 1}}, upsert=payload.expectedRevision == 0)
    except DuplicateKeyError:
        raise HTTPException(409, "Settings changed. Refresh before saving.") from None
    if not result.matched_count and result.upserted_id is None:
        raise HTTPException(409, "Settings changed. Refresh before saving.")
    await intake.audit(db, user, "settings", user.org_id, {"settings": payload.settings.model_dump()})
    return {"settings": payload.settings, "revision": payload.expectedRevision + 1}


@router.get("/template")
async def excel_template(user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    return Response(await asyncio.to_thread(build_template), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="primehire-candidate-template.xlsx"', "Cache-Control": "no-store"})


@router.post("/upload", status_code=202)
async def upload(jobId: str = Form(...), mode: str = Form("single"), source: str = Form("local"), consent: bool = Form(False),
    files: list[UploadFile] = File(...), resumeArchive: UploadFile | None = File(None),
    idempotency_key: str | None = Header(None), user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    if idempotency_key and not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", idempotency_key):
        raise HTTPException(422, "Invalid idempotency key.")
    try:
        return await intake.accept_upload(db, user, job_id=jobId, mode=mode, source=source, consent=consent,
            uploads=files, archive=resumeArchive, request_key=idempotency_key)
    except HTTPException as exc:
        if exc.status_code == 409 and exc.detail == 'Another request is processing this candidate. Retry shortly.':
            raise HTTPException(429,'Upload admission is busy. Your files remain selected; retry shortly.',headers={'Retry-After':'2'}) from None
        raise


@router.get("/batches")
async def batches(skip: int = Query(0, ge=0), limit: int = Query(10, ge=1, le=50), jobId: str | None = None,
    user: CurrentUser = Depends(module_permission("jobs.view")), db=Depends(get_db)):
    available(db)
    if jobId:
        await intake.job_for(db, user, jobId)
    stages = [{"$match": {"orgId": user.org_id, **({"jobId": jobId} if jobId else {})}}]
    if user.role not in {"super_admin", "admin"}:
        stages += [{"$lookup": {"from": "jobs", "localField": "jobId", "foreignField": "jobId", "as": "visibleJob"}},
            {"$unwind": "$visibleJob"}, {"$match": {"visibleJob.orgId": user.org_id,
                "visibleJob.assigneeUserId": user.user_id, "$or": [{"visibleJob.assigneeAccess": None}, {"visibleJob.assigneeAccess": "view"}]}}]
    stages += [{"$sort": {"createdAt": -1}}, {"$skip": skip}, {"$limit": limit},
        {"$project": {"originals": 0, "resumeArchive": 0, "fingerprint": 0, "visibleJob": 0}}]
    output = []
    async for batch in db["resume_intake_batches"].aggregate(stages):
        output.append(batch.get("cachedSummary") or await IntakeRepository(db).summary(batch))
    return jsonable_encoder({"items": output, "skip": skip, "hasMore": len(output) == limit})


@router.get("/batches/{batch_id}")
async def batch_items(batch_id: str, skip: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100),
    status: str | None = None, q: str = Query("", max_length=100),
    scoreBand:Literal['within','below','above','pending']|None=None,
    user: CurrentUser = Depends(module_permission("jobs.view")), db=Depends(get_db)):
    available(db)
    if status and status not in STATUSES:
        raise HTTPException(422, "Unknown processing status.")
    batch = await batch_for(db, user, batch_id)
    query = {"orgId": user.org_id, "batchId": batch_id}
    if status:
        query["status"] = status
    else:
        query["status"] = {"$ne": "deleted"}
    if q:
        query["$or"] = [{"fileName": {"$regex": re.escape(q), "$options": "i"}}, {"profile.name": {"$regex": re.escape(q), "$options": "i"}}]
    repo = IntakeRepository(db)
    target=await intake.job_for(db,user,batch['jobId'])
    if scoreBand:
        policy=batch.get('atsRange')
        if not policy:raise HTTPException(409,'Select an ATS score range first.')
        fresh={'atsState':'done','atsPreviewJobHash':job_fingerprint(target),'atsStale':{'$ne':True}}
        query['status']={'$in':list(ats_selection.SCOREABLE)} if not status else status
        if scoreBand=='pending':query['$nor']=[fresh]
        else:
            query.update(fresh)
            query['ats.overall']={'$gte':policy['minimum'],'$lte':policy['maximum']} if scoreBand=='within' else {'$lt':policy['minimum']} if scoreBand=='below' else {'$gt':policy['maximum']}
    projection = {"rawText": 0, "storageKey": 0, "confirmation": 0}
    items = [{**public_item(item),'atsSelection':ats_selection.selection(item,batch,target)} async for item in repo.items.find(query, projection).sort("rowNumber", 1).skip(skip).limit(limit)]
    summary=await repo.summary(batch)
    summary['canSetAtsRange']='resumes.upload' in user.permissions and not user.impersonating and (batch.get('createdBy')==user.user_id or user.role in {'super_admin','admin'})
    if summary['canSetAtsRange']:
        try:
            await intake.job_for(db,user,batch['jobId'],write=True)
        except HTTPException:
            summary['canSetAtsRange']=False
    return jsonable_encoder({"batch": summary, "items": items, "total": await repo.items.count_documents(query), "skip": skip})


@router.put('/batches/{batch_id}/ats-range')
async def save_ats_range(batch_id:str,payload:AtsRangeRequest,user:CurrentUser=Depends(module_permission('resumes.upload')),db=Depends(get_db)):
    available(db);batch=await batch_for(db,user,batch_id)
    await intake.job_for(db,user,batch['jobId'],write=True)
    if batch.get('createdBy')!=user.user_id and user.role not in {'super_admin','admin'}:
        raise HTTPException(403,'Only the uploader or an administrator can change this batch ATS range.')
    from ..security.rate_limit import limiter
    if not limiter.check(f'ats-range:{user.org_id}:{user.user_id}',30,60).allowed:raise HTTPException(429,'Too many ATS range changes. Retry shortly.')
    async with fenced_claim(db,user.org_id,['ats-range:'+batch_id]):
        batch=await IntakeRepository(db).get_batch(batch_id,user.org_id)
        if batch.get('atsRangeRevision',0)!=payload.expectedRevision:raise HTTPException(409,'The ATS range changed. Refresh before saving.')
        revision=payload.expectedRevision+1
        policy={'minimum':payload.minimum,'maximum':payload.maximum}
        await db['resume_intake_batches'].update_one({'_id':batch_id,'orgId':user.org_id},{'$set':{
            'atsRange':policy,'atsRangeRevision':revision,'atsRangeSelectedBy':user.user_id,'atsRangeSelectedAt':now(),'atsScoringRequested':True}})
        await BackgroundJobRepository(db).enqueue(org_id=user.org_id,kind='resume_intake_score_batch',entity_type='resume_intake_batch',entity_key=batch_id,
            payload={'batchId':batch_id},dedupe_key=f'{user.org_id}:resume_intake_score_batch:{batch_id}:{revision}')
        await intake.audit(db,user,'ats_range_selected',batch_id,{'minimum':payload.minimum,'maximum':payload.maximum,'revision':revision})
    await IntakeRepository(db).refresh_summary(batch_id,user.org_id)
    return {'range':policy,'revision':revision}


@router.post('/items/{item_id}/score')
async def preview_score(item_id:str,payload:RevisionRequest,user:CurrentUser=Depends(module_permission('resumes.upload')),db=Depends(get_db)):
    available(db);item,target=await intake.item_for(db,user,item_id,existing_write=True)
    if item['revision']!=payload.expectedRevision:raise HTTPException(409,'Resume changed. Refresh before scoring.')
    batch=await IntakeRepository(db).get_batch(item['batchId'],user.org_id)
    if not batch.get('atsRange'):raise HTTPException(409,'Select the batch ATS range before scoring.')
    if item['status'] not in ats_selection.SCOREABLE:raise HTTPException(409,'Finish parsing and scanning before scoring.')
    from ..security.rate_limit import limiter
    if not limiter.check(f'ats-preview:{user.org_id}:{user.user_id}',30,60).allowed:raise HTTPException(429,'Too many scoring requests. Retry shortly.')
    async with fenced_claim(db,user.org_id,['item:'+item_id]):
        item,target=await intake.item_for(db,user,item_id,existing_write=True)
        if item['revision']!=payload.expectedRevision:raise HTTPException(409,'Resume changed. Refresh before scoring.')
        await ats_selection.enqueue_score(db,item,target,retry=True)
    await IntakeRepository(db).refresh_summary(item['batchId'],user.org_id)
    return {'atsState':'queued'}


@router.post("/batches/{batch_id}/confirm", status_code=202)
async def confirm_batch(batch_id: str, payload: BulkConfirmRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    batch = await batch_for(db, user, batch_id)
    await intake.job_for(db, user, batch["jobId"], write=True)
    if not payload.reviewed or not batch.get("imported"):
        raise HTTPException(422, "Finish importing and explicitly confirm that you reviewed the profiles.")
    if not batch.get('atsRange'):raise HTTPException(409,'Select and save an ATS range before confirming profiles.')
    if payload.atsRangeRevision is not None and payload.atsRangeRevision!=batch.get('atsRangeRevision',0):raise HTTPException(409,'The ATS range changed; review it before confirming.')
    async with fenced_claim(db, user.org_id, [f"bulk:{batch_id}", "ats-range:"+batch_id]):
        current = await IntakeRepository(db).get_batch(batch_id, user.org_id)
        if current.get("atsRangeRevision",0)!=batch.get("atsRangeRevision",0):
            raise HTTPException(409,"The ATS range changed; review it before confirming.")
        if current.get("bulkApprovalRunning"):
            return {"status": "queued"}
        approval_id, approved_at = uuid.uuid4().hex, now()
        await db["resume_intake_batches"].update_one({"_id": batch_id, "orgId": user.org_id}, {"$set": {
            "bulkApprovalRunning": True, "bulkApproval": {"id": approval_id, "actorUserId": user.user_id, "approvedAt": approved_at,'atsRangeRevision':batch.get('atsRangeRevision',0)}}})
        await BackgroundJobRepository(db).enqueue(org_id=user.org_id, kind="resume_intake_bulk_confirm",
            entity_type="resume_intake_batch", entity_key=batch_id,
            payload={"batchId": batch_id, "actorUserId": user.user_id, "approvedAt": approved_at,'atsRangeRevision':batch.get('atsRangeRevision',0)},
            dedupe_key=f"{user.org_id}:resume_intake_bulk_confirm:{approval_id}")
        await intake.audit(db, user, "bulk_approval", batch_id)
    return {"status": "queued"}


@router.get("/candidates")
async def candidates(jobId: str, skip: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(module_permission("jobs.view")), db=Depends(get_db)):
    available(db)
    await intake.job_for(db, user, jobId)
    rows = [row async for row in db["applications"].find({"orgId": user.org_id, "jobId": jobId}).sort("createdAt", -1).skip(skip).limit(limit)]
    people = {p["applicantId"]: p async for p in db["applicants"].find({"orgId": user.org_id, "applicantId": {"$in": [r["applicantId"] for r in rows]}}, {"resume": 0})}
    output = []
    for application in rows:
        person = people.get(application["applicantId"])
        if not person:
            continue
        output.append({"candidateId": person["applicantId"], "applicationId": application["applicationId"],
            "name": person.get("name", ""), "email": mask_email(person.get("profile", {}).get("email", person.get("email", ""))),
            "phone": mask_phone(person.get("phone", "")), "stage": application["currentStage"],
            "ats": application.get("scoreBreakdown", {}).get("ats"), "score": application.get("matchScore"),
            "itemId": application.get("intakeItemId"), "applicationDate": application["createdAt"]})
    return jsonable_encoder({"items": output, "hasMore": len(rows) == limit})


@router.post("/items/{item_id}/associate", status_code=202)
async def associate(item_id: str, payload: AssociateRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    original, _ = await intake.item_for(db, user, item_id)
    if not original.get("applicantId") or original["status"] not in {"completed", "duplicate"}:
        raise HTTPException(409, "Confirm the candidate before associating another job.")
    target = await intake.job_for(db, user, payload.jobId, write=True)
    clone_id = hashlib.sha256(f"{user.org_id}:{item_id}:{payload.jobId}".encode()).hexdigest()
    async with fenced_claim(db, user.org_id, [f"associate:{clone_id}"]):
        cloned = await IntakeRepository(db).get_item(clone_id, user.org_id)
        if not cloned:
            batch = {"_id": clone_id, "orgId": user.org_id, "jobId": target["jobId"], "jobKey": target["jobKey"],
                "jobTitle": target["title"], "mode": "association", "source": original["source"], "createdBy": user.user_id,
                "createdAt": now(), "updatedAt": now(), "imported": True, "retentionUntil": original["retentionUntil"]}
            await db["resume_intake_batches"].update_one({"_id": clone_id}, {"$setOnInsert": batch}, upsert=True)
            copied = {key: original[key] for key in ["profile", "rawText", "fileName", "fileId", "storageKey", "sizeBytes", "scanStatus", "mimeType", "contentHash"] if key in original}
            cloned = {"_id": clone_id, "orgId": user.org_id, "batchId": clone_id, "jobId": target["jobId"],
                "rowNumber": 1, **copied, "knownCandidateId": original["applicantId"], "status": "review_required", "revision": 1,
                "source": original["source"], "createdBy": user.user_id, "createdAt": now(), "updatedAt": now(),
                "retentionUntil": original["retentionUntil"], "warnings": [], "confidence": {}}
            await db["resume_intake_items"].insert_one(cloned)
    result = cloned  # The new job needs its own human-selected ATS band before association.
    await intake.audit(db, user, "associate", clone_id, {"jobId": payload.jobId})
    return public_item(result, detail=True)


@router.get("/items/{item_id}")
async def item_detail(item_id: str, user: CurrentUser = Depends(module_permission("jobs.view")), db=Depends(get_db)):
    available(db)
    item, job = await intake.item_for(db, user, item_id)
    output = public_item(item, detail=True)
    batch = await IntakeRepository(db).get_batch(item["batchId"], user.org_id)
    output["atsSelection"] = ats_selection.selection(item, batch, job)
    try:
        await intake.item_for(db, user, item_id, existing_write=True)
        output['canEdit'] = item['status'] in {'completed', 'duplicate'} or job.get('lifecycleStatus') == 'OPEN'
    except HTTPException:
        output['canEdit'] = False
    if item.get("applicationId"):
        application = await db["applications"].find_one({"orgId": user.org_id, "applicationId": item["applicationId"]})
        output["ats"] = (application or {}).get("scoreBreakdown", {}).get("ats") or item.get("ats")
    ats = output.get("ats")
    output["atsStale"] = bool(item.get("atsStale") or ats and (ats.get("jobSnapshotHash") != job_fingerprint(job)
        or ats.get("profileSnapshotHash") != profile_fingerprint(item.get("profile", {}))))
    output["matches"] = [{"candidateId": candidate["applicantId"], "name": candidate.get("name", ""),
        "email": mask_email(candidate.get("email", "")), "phone": mask_phone(candidate.get("phone", ""))}
        for candidate in await intake.matches(db, user.org_id, item.get("profile", {}))] if output['canEdit'] else []
    output["notes"] = jsonable_encoder([{"text": redact_contacts(note['text']), **{key: note[key] for key in ["createdAt", "actorUserId"]}}
        async for note in db["resume_intake_notes"].find({"orgId": user.org_id, "itemId": item_id}).sort("createdAt", -1).limit(20)])
    return output


async def review_output(db, user, item, job):
    batch = await IntakeRepository(db).get_batch(item['batchId'], user.org_id)
    return {**public_item(item, detail=True, reveal=True), 'atsSelection': ats_selection.selection(item, batch, job)}


@router.post("/items/{item_id}/reveal")
async def reveal(item_id: str, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    item, job = await intake.item_for(db, user, item_id, existing_write=True)
    await intake.audit(db, user, "profile_reveal", item_id)
    return await review_output(db, user, item, job)


@router.put("/items/{item_id}/review")
async def review(item_id: str, payload: ReviewRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    item = await save_review(db, user, item_id, payload)
    job = await intake.job_for(db, user, item["jobId"])
    return await review_output(db, user, item, job)


@router.post("/items/{item_id}/confirm", status_code=202)
async def confirm_item(item_id: str, payload: ReviewRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    item = await confirm(db, user, item_id, payload, enqueue_only=True)
    job = await intake.job_for(db, user, item["jobId"])
    return await review_output(db, user, item, job)


@router.post("/items/{item_id}/retry")
async def retry(item_id: str, payload: RevisionRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    item, _ = await intake.item_for(db, user, item_id, existing_write=True)
    keys = [f"item:{item_id}", "ats-range:"+item["batchId"]] + ([f"import:{item['batchId']}"] if item.get("rowNumber") == 0 else [])
    async with fenced_claim(db, user.org_id, keys):
        return await retry_locked(db, user, item_id, payload)


async def retry_locked(db, user, item_id, payload):
    item, target = await intake.item_for(db, user, item_id, existing_write=True)
    repo = IntakeRepository(db)
    if item["revision"] != payload.expectedRevision:
        raise HTTPException(409, "Resume changed. Refresh before retrying.")
    if item["status"] in {"confirming", "confirmation_paused"}:
        context = dict(item['confirmation'])
        if context.get('atsRangeRevision') is not None or not item.get('applicationId'):
            batch = await repo.get_batch(item['batchId'], user.org_id)
            decision = ats_selection.require_selection(item, batch, target, context['profile'])
            context.update(ats=item['ats'], atsRangeRevision=decision['rangeRevision'])
        item = await repo.patch_item(item_id, user.org_id, {"error": None, "status": "confirming",
            "confirmation": {**context, "actorUserId": user.user_id}}, payload.expectedRevision)
        await BackgroundJobRepository(db).enqueue(org_id=user.org_id, kind="resume_intake_confirm", entity_type="resume_intake_item",
            entity_key=item_id, payload={"itemId": item_id}, dedupe_key=f"{user.org_id}:resume_intake_confirm:{item_id}:retry:{item['revision']}")
        return public_item(item)
    if item["status"] not in RETRYABLE:
        raise HTTPException(409, "This file cannot be retried in its current state.")
    if not item.get("storageKey"):
        batch = await repo.get_batch(item["batchId"], user.org_id)
        if item.get("rowNumber") != 0:
            raise HTTPException(409, "This row has no stored resume to retry. Upload a replacement.")
        await repo.batches.update_one({"_id": batch["_id"], "orgId": user.org_id}, {"$set": {"imported": False, "retryRowZero": True}, "$inc": {"retryGeneration": 1}})
        await BackgroundJobRepository(db).enqueue(org_id=user.org_id, kind="resume_intake_import", entity_type="resume_intake_batch",
            entity_key=batch["_id"], payload={"batchId": batch["_id"]}, dedupe_key=f"{user.org_id}:resume_intake_import:{batch['_id']}:retry:{batch.get('retryGeneration', 0) + 1}")
        await intake.audit(db, user, "retry_import", item_id)
        return {"status": "queued"}
    updated = await repo.patch_item(item_id, user.org_id, {"status": "queued", "error": None, "generation": item.get("generation", 0) + 1}, payload.expectedRevision)
    await intake.enqueue_item(db, updated)
    await intake.audit(db, user, "retry", item_id)
    return public_item(updated)


@router.post("/items/{item_id}/notes", status_code=201)
async def add_note(item_id: str, payload: NoteRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    await intake.item_for(db, user, item_id, existing_write=True)
    await db["resume_intake_notes"].insert_one({"orgId": user.org_id, "itemId": item_id, "text": payload.text,
        "actorUserId": user.user_id, "createdAt": now()})
    await intake.audit(db, user, "comment", item_id)
    return {"saved": True}


@router.get("/items/{item_id}/download")
async def download(item_id: str, user: CurrentUser = Depends(module_permission("jobs.view")), db=Depends(get_db)):
    available(db)
    item, _ = await intake.item_for(db, user, item_id)
    if "resumes.upload" not in user.permissions and not (user.role == "viewer" and (await intake.get_limits(db, user.org_id)).viewerDownloads):
        raise HTTPException(403, "Original resume download permission is required.")
    if item.get("scanStatus") != "clean" or item["status"] == "deleted" or not item.get("storageKey"):
        raise HTTPException(409, "Original resume is unavailable or has not passed security scanning.")
    try:
        path = resolve_storage_key(item["storageKey"])
        if not path.is_file():
            raise ValueError
    except ValueError:
        raise HTTPException(404, "Original resume is unavailable.") from None
    await intake.audit(db, user, "download", item_id)
    return FileResponse(path, filename=item["fileName"], media_type="application/octet-stream", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def safe_cell(value):
    text = "" if value is None else ", ".join(map(str, value)) if isinstance(value, list) else str(value)
    text = re.sub(r"[\x00-\x08\x0b-\x1f\ufeff]", "", text)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


@router.get("/batches/{batch_id}/export")
async def export_candidates(batch_id: str, format: str = Query("csv", pattern="^(csv|xlsx)$"), user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    await batch_for(db, user, batch_id)
    await intake.audit(db, user, "export_candidates", batch_id, {"format": format})
    query = {"orgId": user.org_id, "batchId": batch_id}
    if format == "xlsx":
        from ..services.resume_intake_exports import export_xlsx
        async with fenced_claim(db, user.org_id, ["heavy-export"]):
            items = [item async for item in db["resume_intake_items"].find(query, {"rawText": 0, "confirmation": 0, "storageKey": 0}).sort("rowNumber", 1).limit(6000)]
            output = await asyncio.to_thread(export_xlsx, items, safe_cell)
        return Response(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="candidate-export.xlsx"', "Cache-Control": "no-store"})
    async def lines():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["File Name", "Status", "ATS Score", *COLUMNS.keys()])
        yield "\ufeff" + buffer.getvalue()
        buffer.seek(0); buffer.truncate(0)
        async for item in db["resume_intake_items"].find(query, {"rawText": 0, "storageKey": 0, "confirmation": 0}).sort("rowNumber", 1).limit(6000):
            profile = item.get("profile", {})
            writer.writerow([safe_cell(v) for v in [item["fileName"], item["status"], (item.get("ats") or {}).get("overall", ""), *[profile.get(k) for k in COLUMNS.values()]]])
            yield buffer.getvalue()
            buffer.seek(0); buffer.truncate(0)
    return StreamingResponse(lines(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="candidate-export.csv"', "Cache-Control": "no-store"})


@router.get("/items/{item_id}/profile.pdf")
async def generated_profile(item_id: str, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    item, job = await intake.item_for(db, user, item_id)
    from ..services.resume_intake_exports import profile_pdf
    await intake.audit(db, user, "download_profile", item_id)
    async with fenced_claim(db, user.org_id, ["heavy-export"]):
        output = await asyncio.to_thread(profile_pdf, item.get("profile", {}), job["title"], item.get("ats"))
    return Response(output, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="candidate-profile.pdf"', "Cache-Control": "no-store"})


@router.get("/items/{item_id}/versions")
async def resume_versions(item_id: str, skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50), user: CurrentUser = Depends(module_permission("jobs.view")), db=Depends(get_db)):
    available(db)
    item, _ = await intake.item_for(db, user, item_id)
    if not item.get("applicantId"):
        return {"items": [], "hasMore": False}
    # Apply job access before pagination so inaccessible versions cannot consume
    # the page or leak their existence through counts.
    pipeline = [{"$match": {"orgId": user.org_id, "applicantId": item["applicantId"]}}]
    if user.role not in {"super_admin", "admin"}:
        pipeline += [{"$lookup": {"from": "jobs", "localField": "jobId", "foreignField": "jobId", "as": "visibleJob"}},
            {"$unwind": "$visibleJob"}, {"$match": {"visibleJob.orgId": user.org_id,
                "visibleJob.assigneeUserId": user.user_id,
                "$or": [{"visibleJob.assigneeAccess": None}, {"visibleJob.assigneeAccess": "view"}]}}]
    pipeline += [{"$sort": {"createdAt": -1, "_id": 1}}, {"$skip": skip}, {"$limit": limit + 1},
        {"$project": {"rawText": 0, "confirmation": 0, "storageKey": 0, "visibleJob": 0}}]
    rows = await db["resume_intake_items"].aggregate(pipeline).to_list(limit + 1)
    return {"items": [public_item(version) for version in rows[:limit]], "hasMore": len(rows) > limit}


@router.post("/items/{item_id}/recalculate")
async def recalculate(item_id: str, payload: RevisionRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    item, job = await intake.item_for(db, user, item_id, existing_write=True)
    if not item.get("applicationId") or item["status"] not in {"completed", "duplicate"}:
        raise HTTPException(409, "Confirm the candidate/application before recalculating ATS.")
    async with fenced_claim(db, user.org_id, [f"item:{item_id}", f"application:{item['applicationId']}"]):
        fresh = await IntakeRepository(db).get_item(item_id, user.org_id)
        if fresh["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Resume changed. Refresh before recalculating.")
        try:
            ats = await evaluate(db, user.org_id, fresh["profile"], fresh.get("rawText", ""), job,
                await intake.get_limits(db, user.org_id), fresh['applicationId'], local_score=score)
        except Exception:
            await IntakeRepository(db).patch_item(item_id, user.org_id, {"error": "ATS recalculation failed. Candidate and application are retained; retry."}, payload.expectedRevision)
            raise HTTPException(503, "ATS unavailable. Candidate/application were retained.") from None
        ats["evaluatedAt"] = now().isoformat()
        await db["applications"].update_one({"applicationId": fresh["applicationId"], "orgId": user.org_id},
            {"$set": {"matchScore": ats["overall"], "scoreBreakdown.ats": ats, "scoreBreakdown.final": ats["overall"], "updatedAt": now()}})
        updated = await IntakeRepository(db).patch_item(item_id, user.org_id, {"ats": ats, "atsStale": False, "error": None}, payload.expectedRevision)
        await intake.audit(db, user, "ats_recalculate", item_id, {"applicationId": fresh["applicationId"]})
        return public_item(updated, detail=True)


@router.put("/items/{item_id}/profile")
async def edit_candidate(item_id: str, payload: ReviewRequest, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    item, _ = await intake.item_for(db, user, item_id, existing_write=True)
    if not item.get("applicantId") or item["status"] not in {"completed", "duplicate"}:
        raise HTTPException(409, "Confirm the candidate before editing the stored profile.")
    profile = payload.profile.model_dump(mode="json")
    if len(profile["name"]) < 2 or not (profile["email"] or profile["phone"]):
        raise HTTPException(422, "A name and email or phone are required.")
    from ..services.pii import phone_digits_variants
    contacts = [profile, item.get("profile", {})]
    keys = [f"item:{item_id}", f"candidate:{item['applicantId']}"]
    for contact in contacts:
        keys += [f"email:{contact['email']}"] if contact.get("email") else []
        keys += [f"phone:{digits}" for digits in phone_digits_variants(contact.get("phone", ""))]
    async with fenced_claim(db, user.org_id, keys):
        fresh = await IntakeRepository(db).get_item(item_id, user.org_id)
        if fresh["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Profile changed. Refresh before editing.")
        conflicts = await intake.matches(db, user.org_id, profile)
        if any(c["applicantId"] != item["applicantId"] for c in conflicts):
            raise HTTPException(409, "Changed contact information matches another candidate. Resolve the identity first.")
        from ..services.pii import phone_digits_variants
        await db["applicants"].update_one({"orgId": user.org_id, "applicantId": item["applicantId"]}, {"$set": {
            "name": profile["name"], "email": profile["email"] or f"phone-only-{item['applicantId']}@placeholder.local",
            "phone": profile["phone"], "phoneDigits": phone_digits_variants(profile["phone"]), "profile": profile, "updatedAt": now()}})
        stale = profile_fingerprint(profile) != profile_fingerprint(fresh.get("profile", {})) or bool(fresh.get("atsStale"))
        updated = await IntakeRepository(db).patch_item(item_id, user.org_id, {"profile": profile, "atsStale": stale}, payload.expectedRevision)
        await intake.audit(db, user, "candidate_edit", item_id, {"applicantId": item["applicantId"], "revision": updated["revision"]})
        return public_item(updated, detail=True, reveal=True)


@router.get("/assignees")
async def assignees(skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), q: str = Query("", max_length=100),
    user: CurrentUser = Depends(module_permission("applications.assign")), db=Depends(get_db)):
    available(db)
    query = {"orgId": user.org_id, "isActive": True, "role": {"$in": ["hr", "recruiter", "technical_interviewer", "managerial_interviewer"]}}
    if q:
        query["name"] = {"$regex": re.escape(q), "$options": "i"}
    actors = [{"userId": actor["userId"], "name": actor["name"], "role": actor["role"]}
        async for actor in db["users"].find(query, {"userId": 1, "name": 1, "role": 1}).sort("name", 1).skip(skip).limit(limit)]
    return {"items": actors, "hasMore": len(actors) == limit}


@router.post("/items/{item_id}/assign")
async def assign(item_id: str, payload: AssignRequest, user: CurrentUser = Depends(module_permission("applications.assign")), db=Depends(get_db)):
    available(db)
    item, _ = await intake.item_for(db, user, item_id, existing_write=True)
    target = await db["users"].find_one({"orgId": user.org_id, "userId": payload.userId, "isActive": True})
    if not target or target["role"] not in {"hr", "recruiter", "technical_interviewer", "managerial_interviewer"}:
        raise HTTPException(422, "Choose an active reviewer from this organization.")
    if not item.get("applicationId"):
        raise HTTPException(409, "Confirm the application before assigning a reviewer.")
    if user.impersonating:
        raise HTTPException(403, "View-as sessions are read-only.")
    async with fenced_claim(db, user.org_id, [f"item:{item_id}"]):
        fresh = await IntakeRepository(db).get_item(item_id, user.org_id)
        if fresh["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Resume changed. Refresh before assigning.")
        await db["applications"].update_one({"orgId": user.org_id, "applicationId": item["applicationId"]}, {"$set": {"assignedReviewers": [target["userId"]], "updatedAt": now()}})
        updated = await IntakeRepository(db).patch_item(item_id, user.org_id, {"assignedUserId": target["userId"]}, payload.expectedRevision)
    await intake.audit(db, user, "assign", item_id, {"userId": target["userId"]})
    return public_item(updated, detail=True)


@router.delete("/items/{item_id}")
async def delete_resume(item_id: str, payload: DeleteRequest, user: CurrentUser = Depends(module_permission("users.manage")), db=Depends(get_db)):
    available(db)
    require_job_admin(user)
    item, _ = await intake.item_for(db, user, item_id)
    async with fenced_claim(db, user.org_id, [f"item:{item_id}"]):
        fresh = await IntakeRepository(db).get_item(item_id, user.org_id)
        if fresh["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Resume changed. Refresh before deleting.")
        key = fresh.get("storageKey")
        await IntakeRepository(db).patch_item(item_id, user.org_id, {"status": "deleted", "deletedAt": now(),
            "deletedBy": user.user_id, "deletedStorageKey": key, "rawText": "", "storageKey": ""}, payload.expectedRevision)
        if fresh.get("fileId"):
            await db["resume_intake_items"].update_many({"orgId": user.org_id, "fileId": fresh["fileId"], "_id": {"$ne": item_id}},
                {"$set": {"status": "deleted", "storageKey": "", "rawText": "", "deletedAt": now()}, "$inc": {"revision": 1}})
            await db["resume_files"].update_one({"orgId": user.org_id, "fileId": fresh["fileId"]}, {"$set": {"status": "quarantined", "storageKey": ""}})
        if key:
            try:
                await asyncio.to_thread(resolve_storage_key(key).unlink, missing_ok=True)
            except OSError:
                pass  # Private tombstone keeps the path for the retention sweep.
        await intake.audit(db, user, "delete", item_id, {"reason": payload.reason, "keptCandidateApplication": True})
        await IntakeRepository(db).refresh_summary(item["batchId"], user.org_id)
        return {"deleted": True}


@router.get("/batches/{batch_id}/report")
async def report(batch_id: str, errorsOnly: bool = False, user: CurrentUser = Depends(module_permission("resumes.upload")), db=Depends(get_db)):
    available(db)
    batch = await batch_for(db, user, batch_id)
    await intake.audit(db, user, "export_report", batch_id)
    async def lines():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["File Name", "Candidate Name", "Status", "Error Reason", "Job", "ATS Score"])
        yield "\ufeff" + buffer.getvalue()
        buffer.seek(0); buffer.truncate(0)
        async for item in db["resume_intake_items"].find({"orgId": user.org_id, "batchId": batch_id}).sort("rowNumber", 1).limit(6000):
            if errorsOnly and item["status"] in {"completed", "review_required"} and not item.get("warnings"):
                continue
            values = [item["fileName"], item.get("profile", {}).get("name", ""), item["status"],
                item.get("error") or "; ".join(item.get("warnings", [])), batch["jobKey"], (item.get("ats") or {}).get("overall", "")]
            writer.writerow([safe_cell(v) for v in values])
            yield buffer.getvalue()
            buffer.seek(0); buffer.truncate(0)
    return StreamingResponse(lines(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="resume-processing-report.csv"', "Cache-Control": "no-store"})
