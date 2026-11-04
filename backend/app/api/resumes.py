"""Resume upload + batch + download routes (Phase 2 Slice B).

- POST /api/resumes/upload — validates, stores, and ENQUEUES one
  `resume_process` job per file, then returns immediately. The worker
  (claim/lease/backoff, per-file isolation) extracts and stores resume data.
  The batch table polls GET batch until all files are terminal.
- GET /api/resumes/batches — paginated batch list.
- GET /api/resumes/batches/{batchId} — batch + per-file statuses (live).
- GET /api/resumes/files/{fileId}/download — authed attachment download.
  Quarantined files are blocked (403).
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from ..config import settings
from ..models.hiring import AuditLogRepository, JobRepository
from ..security.job_permissions import require_job_access
from ..models.jobs import BackgroundJobRepository
from ..models.resume import ResumeBatchRepository, ResumeFileRepository
from ..schemas.resume import BatchStatus, FileStatus, ResumeBatchPublic, ResumeFilePublic
from ..security.deps import CurrentUser, require_permission, get_db
from ..services import clamav
from ..services.storage import new_storage_key, resolve_storage_key, validate_client_filename, write_bytes
from ..services.upload_validate import validate_upload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resumes", tags=["resumes"])


def _redacted(name: str) -> str:
    return f"{name[:2]}***" if len(name) > 2 else "***"


def _public_file(doc: dict[str, Any]) -> dict[str, Any]:
    """Project internal file docs to the public schema (never leak storageKey)."""
    allowed = set(ResumeFilePublic.model_fields)
    return {k: v for k, v in doc.items() if k in allowed}


def _public_batch(doc: dict[str, Any]) -> dict[str, Any]:
    allowed = set(ResumeBatchPublic.model_fields)
    return {k: v for k, v in doc.items() if k in allowed}


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_resumes(
    jobKey: str = Form(...),
    consent: str = Form(default=""),
    files: list[UploadFile] = File(...),
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if settings.resume_module_v2_enabled:
        raise HTTPException(status_code=409, detail="Use the V2 resume intake workflow for upload and human review.")
    if consent.strip().lower() not in ("true", "1", "yes", "on"):
        raise HTTPException(status_code=400, detail="Candidate consent is required to upload resumes.")
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")
    if len(files) > settings.upload_batch_max:
        raise HTTPException(
            status_code=400,
            detail=f"Batch exceeds the {settings.upload_batch_max}-file limit.",
        )

    job_repo = JobRepository(db, owner_id=None if current_user.role in {"super_admin","admin"} else current_user.user_id)
    job = await job_repo.get_by_key(jobKey.strip(), current_user.org_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    await require_job_access(db, current_user, 'upload', job)

    from ..services.job_intake import intake_error
    error = intake_error(job)
    if error:
        raise HTTPException(status_code=409, detail=error)

    batch_repo = ResumeBatchRepository(db)
    file_repo = ResumeFileRepository(db)
    jobs_queue = BackgroundJobRepository(db)
    batch = await batch_repo.create({
        "orgId": current_user.org_id,
        "jobKey": job["jobKey"],
        "jobId": job["jobId"],
        "fileIds": [],
        "status": BatchStatus.PROCESSING.value,
        "counts": {"total": len(files), "parsed": 0, "failed": 0, "quarantined": 0},
        "failures": [],
        "consent": {"given": True, "source": "hr_upload", "textVersion": "v1"},
        "createdBy": current_user.user_id,
    })

    file_ids: list[str] = []
    failures: list[dict[str, Any]] = []
    failed = 0
    quarantined = 0

    for index, upload in enumerate(files):
        client_name = upload.filename or f"file-{index}"
        try:
            safe_name = validate_client_filename(client_name)
            data = await upload.read()
            total_cap = settings.upload_max_mb * settings.upload_batch_max * 1024 * 1024
            if len(data) > total_cap:
                raise ValueError("Batch exceeds the total size limit.")
            validated = validate_upload(safe_name, data)
            verdict = clamav.scan_bytes(data, safe_name)
            if verdict == clamav.SCAN_UNAVAILABLE:
                raise ValueError(clamav.UNAVAILABLE_MESSAGE)
            dest, storage_key = new_storage_key(current_user.org_id, validated.ext)
            write_bytes(dest, data)
            content_hash = hashlib.sha256(data).hexdigest()
            record = await file_repo.create({
                "orgId": current_user.org_id,
                "batchId": batch["batchId"],
                "jobId": job["jobId"],
                "fileName": safe_name,
                "mimeType": upload.content_type or "application/octet-stream",
                "sizeBytes": validated.size_bytes,
                "contentHash": content_hash,
                "storageKey": storage_key,
                "kind": validated.kind,
                "processingMode": "parse_only",
                "status": FileStatus.QUARANTINED.value if verdict == clamav.QUARANTINED else FileStatus.UPLOADED.value,
            })
            file_ids.append(record["fileId"])
            if verdict == clamav.QUARANTINED:
                quarantined += 1
                logger.info("Resume file quarantined batch=%s file=%s", batch["batchId"], record["fileId"])
                continue
            # Extract locally off-request; matching is a later operation.
            await jobs_queue.enqueue(
                org_id=current_user.org_id,
                kind="resume_process",
                entity_type="resume_file",
                entity_key=record["fileId"],
                payload={"fileId": record["fileId"], "batchId": batch["batchId"],
                         "jobId": job["jobId"]},
            )
        except ValueError as exc:
            failed += 1
            failures.append({"index": index, "fileName": _redacted(client_name),
                             "code": "REJECTED", "message": str(exc)})
        except Exception:  # noqa: BLE001 — one row must not abort the batch
            logger.exception("Resume upload row %d failed", index)
            failed += 1
            failures.append({"index": index, "fileName": _redacted(client_name),
                             "code": "UPLOAD_FAILED", "message": "File could not be stored."})

    updated = await batch_repo.update(batch["batchId"], current_user.org_id, {
        "fileIds": file_ids,
        "status": BatchStatus.PARTIAL.value if len(file_ids) == quarantined else BatchStatus.PROCESSING.value,
        "counts": {"total": len(files), "parsed": 0, "failed": failed, "quarantined": quarantined},
        "failures": failures,
    })

    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="resume_batch.upload",
        resource_type="resume_batch",
        resource_id=batch["batchId"],
        details={"jobKey": job["jobKey"], "total": len(files), "accepted": len(file_ids),
                 "rejected": failed},
        ip_address="",
    )

    files_docs = await file_repo.list_for_batch(batch["batchId"], current_user.org_id)
    return {
        "batch": ResumeBatchPublic(**_public_batch(updated)).model_dump(),
        "files": [ResumeFilePublic(**_public_file(f)).model_dump() for f in files_docs],
    }


@router.get("/batches", response_model=list[ResumeBatchPublic])
async def list_batches(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> list[ResumeBatchPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    query = {"orgId":current_user.org_id}
    if current_user.role not in {"super_admin", "admin"}:
        owned_ids = [d['jobId'] async for d in db['jobs'].find({'orgId':current_user.org_id, 'assigneeUserId':current_user.user_id}, {'jobId':1})]
        query['jobId'] = {'$in':owned_ids}
    docs = [d async for d in db['resume_batches'].find(query).sort('createdAt', -1).skip(skip).limit(limit)]
    return [ResumeBatchPublic(**_public_batch(d)) for d in docs]


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: str,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    batch_repo = ResumeBatchRepository(db)
    batch = await batch_repo.get(batch_id, current_user.org_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    if current_user.role not in {"super_admin", "admin"} and not await JobRepository(db, owner_id=current_user.user_id).get_by_key(batch.get("jobKey", ""), current_user.org_id):
        raise HTTPException(status_code=404, detail="Batch not found.")
    file_repo = ResumeFileRepository(db)
    files_docs = await file_repo.list_for_batch(batch_id, current_user.org_id)
    return {
        "batch": ResumeBatchPublic(**_public_batch(batch)).model_dump(),
        "files": [ResumeFilePublic(**_public_file(f)).model_dump() for f in files_docs],
    }


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> FileResponse:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    file_repo = ResumeFileRepository(db)
    doc = await file_repo.get(file_id, current_user.org_id)
    if not doc:
        raise HTTPException(status_code=404, detail="File not found.")
    if current_user.role not in {"super_admin", "admin"} and not await JobRepository(db, owner_id=current_user.user_id).get_by_id(doc.get("jobId", ""), current_user.org_id):
        raise HTTPException(status_code=404, detail="File not found.")
    if doc.get("status") == FileStatus.QUARANTINED.value:
        raise HTTPException(status_code=403, detail="File is quarantined and cannot be downloaded.")
    try:
        path = resolve_storage_key(doc["storageKey"])
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found.") from None
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(
        path=str(path),
        filename=doc.get("fileName", "resume"),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{doc.get("fileName", "resume")}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
