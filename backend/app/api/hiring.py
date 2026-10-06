"""Hiring model API routes: jobs, applicants, applications, stage transitions, and audit logs."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status

from ..models.hiring import (
    JobRepository,
    ApplicantRepository,
    ApplicationRepository,
    ApplicationStatus,
    StageHistoryRepository,
    AuditLogRepository,
    Stage,
)
from ..models.user import UserRepository
from ..schemas.hiring import (
    JobCreate,
    JobUpdate,
    JobPublic,
    JobCloseIn,
    JobReopenIn,
    JobDuplicateCheckIn,
    JobDuplicateOut,
    JobAssignIn,
    JobDetailPublic,
    JDParseOut,
    jd_text_of,
    ApplicantCreate,
    ApplicantUpdate,
    ApplicantPublic,
    ApplicationCreate,
    ApplicationTransitionRequest,
    ApplicationPublic,
    StageHistoryPublic,
    AuditLogPublic,
    RevealRequest,
)
from ..jobs.rules import validate_positions
from ..security.deps import CurrentUser, get_current_user, require_permission, get_db
from ..services.pii import mask_email, mask_phone, phone_digits_variants
from ..services.transitions import TransitionError, transition_application
from ..services.email_send import queue_job_assignment
from ..services.jd_template import (
    JD_TEMPLATE_VERSION,
    MISSING_FIELDS_MESSAGE,
    INVALID_TEMPLATE_MESSAGE,
    TEMPLATE_LABELS,
    build_template_docx,
    map_template_values,
    parse_template_text,
)
from ..services.jd_document import (
    JD_DOCUMENT_AI_PENDING_WARNING,
    JD_DOCUMENT_VERSION,
    is_extractable,
    normalize_jd_text,
)
from ..services.llm.jd_extract import extract_jd_fields
from ..services.jd_validate import validate_jd_extraction
from ..services.outbox_crypto import OutboxCryptoError
from ..services.resume_parse import ParseFailed, ParseTimeout, parse_bytes_isolated
from ..services.storage import validate_client_filename
from ..services.upload_validate import validate_upload
from ..services import clamav as clamav

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["hiring"])

ALLOWED_REVEAL_FIELDS = frozenset({"email", "phone"})


def _masked_applicant(doc: dict[str, Any]) -> dict[str, Any]:
    """Mask contact PII by default; full values only via the audited reveal."""
    out = dict(doc)
    out["email"] = mask_email(str(doc.get("email") or ""))
    out["phone"] = mask_phone(str(doc.get("phone") or ""))
    return out


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    """Naive datetimes are interpreted as UTC (documented until the org
    timezone setting lands; see the recorded follow-up in DECISIONS.md)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _coerce_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _lifecycle_of(doc: dict[str, Any]) -> str:
    """Stored lifecycle as a plain value.

    Mongo documents written through the API may hold the JobLifecycle enum
    member (mongomock preserves it; BSON stores the value), so normalize
    member-or-string before comparing — never str() an enum member.
    """
    raw = doc.get("lifecycleStatus") or "DRAFT"
    value = getattr(raw, "value", raw)
    return str(value)


async def _resolve_assignee(db: Any, org_id: str, user_id: str) -> dict[str, Any]:
    """PRD §21/§29: the assignee must be an existing ACTIVE user of this org."""
    key = str(user_id or "").strip()
    if not key:
        raise HTTPException(status_code=422, detail="assigneeUserId is required")
    user = await UserRepository(db).get_by_id(key, org_id)
    if user is None:
        raise HTTPException(
            status_code=422, detail="Assignee is not a valid user of this organization"
        )
    if user.get("isActive", True) is False:
        raise HTTPException(
            status_code=422, detail="Assignee is deactivated; choose an active user"
        )
    return user


async def _notify_assignee(
    db: Any, *, org_id: str, job: dict[str, Any], user: dict[str, Any]
) -> None:
    """PRD §23: notify on assign/reassign via the existing outbox channel.

    Best-effort by design: a notification failure (e.g. no encryption key
    in dev) is logged and never fails the job write.
    """
    try:
        await queue_job_assignment(
            db,
            org_id=org_id,
            job_id=job["jobId"],
            job_key=job.get("jobKey", ""),
            job_title=job.get("title", ""),
            to_email=str(user.get("email") or ""),
            to_name=str(user.get("name") or ""),
            assignee_user_id=str(user.get("userId") or ""),
        )
    except OutboxCryptoError as exc:
        logger.warning("Job assignment notification skipped: %s", exc)
    except Exception:  # noqa: BLE001 — notification must not break the write
        logger.warning("Job assignment notification failed", exc_info=True)


_JOB_MANAGE = require_permission("jobs.manage")
_JOB_READ = require_permission("resumes.upload")


# --- Jobs Routes ---

@router.post("/jobs", response_model=JobPublic, status_code=status.HTTP_201_CREATED)
async def create_job(
    payload: JobCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("jobs.manage")),
    db: Any = Depends(get_db),
) -> JobPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = JobRepository(db)
    existing = await repo.get_by_key(payload.jobKey, current_user.org_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job key '{payload.jobKey}' already exists in this organization",
        )

    doc = payload.model_dump()
    doc["orgId"] = current_user.org_id
    doc["createdBy"] = current_user.user_id
    doc["niceToHaveSkills"] = [s.model_dump() for s in payload.niceToHaveSkills]
    # Server defaults (PRD §1/§6): system-controlled opening timestamp,
    # zero filled positions, plain-text JD extracted from the rich text.
    if doc.get("openedAt") is None:
        doc["openedAt"] = _utcnow()
    doc["positionsFilled"] = 0
    doc["jdText"] = jd_text_of(payload.jdHtml)
    # PRD §21: assignee must be an active org user; snapshot their email.
    assignee = await _resolve_assignee(db, current_user.org_id, payload.assigneeUserId)
    doc["assigneeEmail"] = assignee.get("email")
    created = await repo.create(doc)

    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="job.create",
        resource_type="job",
        resource_id=created["jobId"],
        details={"jobKey": payload.jobKey, "title": payload.title,
                 "assigneeUserId": payload.assigneeUserId},
        ip_address=request.client.host if request.client else "",
    )

    # PRD §23: notify the assignee (best-effort; never fails creation).
    await _notify_assignee(db, org_id=current_user.org_id, job=created, user=assignee)

    return JobPublic(**created)


@router.get("/jobs", response_model=list[JobPublic])
async def list_jobs(
    response: Response,
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    company: str | None = Query(default=None, max_length=255),
    department: str | None = Query(default=None, max_length=255),
    assignee: str | None = Query(default=None, max_length=255),
    experience: float | None = Query(default=None, ge=0),
    workMode: str | None = Query(default=None),
    openedFrom: datetime | None = Query(default=None),
    openedTo: datetime | None = Query(default=None),
    closesFrom: datetime | None = Query(default=None),
    closesTo: datetime | None = Query(default=None),
    sort: str = Query(default="createdAt"),
    order: str = Query(default="desc"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> list[JobPublic]:
    """PRD §14-§16: search + filters + sort + pagination (default 20/page).

    Sort/order/workMode are allowlisted (§2); the page total travels in the
    X-Total-Count header so the response model stays a bare list.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if sort not in JobRepository.SORT_FIELDS:
        raise HTTPException(status_code=422, detail=f"sort must be one of {sorted(JobRepository.SORT_FIELDS)}")
    if order not in ("asc", "desc"):
        raise HTTPException(status_code=422, detail="order must be 'asc' or 'desc'")
    if workMode is not None and workMode not in ("ONSITE", "REMOTE", "HYBRID"):
        raise HTTPException(status_code=422, detail="workMode must be one of ONSITE, REMOTE, HYBRID")

    repo = JobRepository(db)
    filters: dict[str, Any] = {
        "status": status, "q": q, "company": company, "department": department,
        "assignee": assignee, "experience": experience, "work_mode": workMode,
        "opened_from": _as_utc(openedFrom), "opened_to": _as_utc(openedTo),
        "closes_from": _as_utc(closesFrom), "closes_to": _as_utc(closesTo),
    }
    docs = await repo.search(
        current_user.org_id, **filters, sort=sort, order=order, skip=skip, limit=limit,
    )
    response.headers["X-Total-Count"] = str(await repo.count_search(current_user.org_id, **filters))
    return [JobPublic(**d) for d in docs]


@router.get("/jobs/application-counts")
async def job_application_counts(
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> dict[str, dict[str, int]]:
    """Application counts per job for the listing's Applications column."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    job_ids = await JobRepository(db).list_ids(current_user.org_id)
    counts: dict[str, int] = {}
    for job_id in job_ids:
        counts[job_id] = await db["applications"].count_documents(
            {"jobId": job_id, "orgId": current_user.org_id}
        )
    return {"counts": counts}


# --- JD template + parse flow (PRD §9-§11) ---
# Declared BEFORE /jobs/{job_id} so "jd-template" is never parsed as an id.

JD_TEMPLATE_FILENAME = f"elite-hr-jd-template-{JD_TEMPLATE_VERSION}.docx"
JD_TEMPLATE_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@router.get("/jobs/jd-template")
async def download_jd_template(
    current_user: CurrentUser = Depends(_JOB_MANAGE),
) -> Response:
    """Download the prescribed blank JD template (PRD §10)."""
    _ = current_user
    return Response(
        content=build_template_docx(),
        media_type=JD_TEMPLATE_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{JD_TEMPLATE_FILENAME}"'},
    )


@router.get("/jobs/rules")
async def jobs_rules(
    current_user: CurrentUser = Depends(_JOB_READ),
) -> dict[str, Any]:
    """Read-only Jobs validation matrix so the form never duplicates rules."""
    from ..jobs.rules import public_rules

    return public_rules()


@router.post("/jobs/parse-jd", response_model=JDParseOut)
async def parse_jd_upload(
    file: UploadFile = File(...),
    mode: str = Form("template"),
    current_user: CurrentUser = Depends(_JOB_MANAGE),
    db: Any = Depends(get_db),
) -> JDParseOut:
    """PRD §9: Upload → Extract → Map. Stateless (nothing persisted).

    The caller reviews `mapped` client-side and saves through the normal
    POST /api/jobs create endpoint. Error strings match the PRD exactly.

    AI JD Ingestion (enhancement): `mode="document"` accepts a NORMAL JD
    PDF/DOCX/DOC and returns isolated-extraction text with an empty `mapped`
    (Phase 1: no LLM yet). The default `mode="template"` path below is
    byte-identical to the approved Slice 3 behavior.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    normalized_mode = (mode or "template").strip().lower()
    if normalized_mode not in ("template", "document"):
        raise HTTPException(status_code=422, detail={
            "message": "Invalid mode. Use 'template' or 'document'.",
            "errors": [{"field": "mode", "message": "mode must be 'template' or 'document'"}],
        })
    if normalized_mode == "document":
        return await _parse_jd_document(file, current_user, db)
    client_name = file.filename or "upload"
    try:
        safe_name = validate_client_filename(client_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    try:
        validated = validate_upload(safe_name, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if clamav.scan_bytes(data, safe_name) == clamav.QUARANTINED:
        raise HTTPException(
            status_code=422, detail="The uploaded file failed the security scan and cannot be processed."
        )
    try:
        parsed = parse_bytes_isolated(data, validated.kind)
    except (ParseTimeout, ParseFailed):
        raise HTTPException(
            status_code=422, detail="Could not extract text from the uploaded file."
        ) from None
    text = str(parsed.get("rawText") or "")
    if not text.strip():
        raise HTTPException(status_code=422, detail={
            "message": INVALID_TEMPLATE_MESSAGE,
            "errors": [{"field": "file", "message": "No readable text found"}],
        })

    values, missing = parse_template_text(text)
    if missing:
        raise HTTPException(status_code=422, detail={
            "message": INVALID_TEMPLATE_MESSAGE,
            "errors": [{"field": "template", "message": f"Missing labels: {', '.join(missing)}"}],
        })

    mapped, field_errors = await map_template_values(values, db, current_user.org_id)
    if field_errors:
        raise HTTPException(status_code=422, detail={
            "message": MISSING_FIELDS_MESSAGE,
            "errors": field_errors,
        })

    warnings: list[str] = []
    if not mapped.get("keywords"):
        warnings.append("Keywords are recommended for better matching.")
    if "openedAt" in mapped and not (values.get("Opened At") or "").strip():
        warnings.append("Opened At defaulted to now.")
    # Create-ready shape: the template marker uses the JobCreate field name
    # (assigneeEmail is re-snapshotted authoritatively at create time).
    mapped.pop("assigneeEmail", None)
    mapped["jdTemplateVersion"] = JD_TEMPLATE_VERSION
    return JDParseOut(
        filename=safe_name,
        kind=validated.kind,
        templateVersion=JD_TEMPLATE_VERSION,
        text=text,
        mapped=mapped,
        warnings=warnings,
    )


async def _parse_jd_document(
    file: UploadFile,
    current_user: CurrentUser,
    db: Any,
) -> JDParseOut:
    """AI JD Ingestion Phase 1: secure validate → isolated extract → text.

    Reuses the exact Slice 3 security chain (filename safety, magic bytes,
    size/zip-bomb caps, ClamAV hook, isolated 30 s parser). No LLM call, no
    persistence, no template-label requirement. Unreadable content is an
    honest 422 — never an LLM call on empty input.
    """
    _ = current_user
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    client_name = file.filename or "upload"
    try:
        safe_name = validate_client_filename(client_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    try:
        validated = validate_upload(safe_name, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if clamav.scan_bytes(data, safe_name) == clamav.QUARANTINED:
        raise HTTPException(
            status_code=422, detail="The uploaded file failed the security scan and cannot be processed."
        )
    try:
        parsed = parse_bytes_isolated(data, validated.kind)
    except (ParseTimeout, ParseFailed):
        raise HTTPException(
            status_code=422, detail="Could not extract text from the uploaded file."
        ) from None
    text = normalize_jd_text(str(parsed.get("rawText") or ""))
    if not is_extractable(text):
        raise HTTPException(status_code=422, detail={
            "message": "Could not extract text from the uploaded file.",
            "errors": [{"field": "file", "message": "No readable text found"}],
        })
    # L1 resilience: a user is waiting on this request, so the sync path
    # NEVER queues behind bulk work. If the breaker is open or no interactive
    # token is available, fail fast to the text-only fallback with a visible
    # flag (the take-or-fallback is instant — no waiting in line).
    from ..services.llm.resilience import llm_guard, llm_record

    allowed, guard_reason, _guard_info = await llm_guard(db, kind="interactive")
    if not allowed:
        busy_note = ("AI extraction paused by the circuit breaker — text extraction only."
                     if guard_reason == "breaker-open"
                     else "AI is busy — text extraction only. You can re-upload shortly.")
        return JDParseOut(
            filename=safe_name,
            kind=validated.kind,
            templateVersion=JD_DOCUMENT_VERSION,
            text=text,
            mapped={},
            warnings=[busy_note, JD_DOCUMENT_AI_PENDING_WARNING],
        )
    # Phase 2 (jd-extract-v1): structure the normalized text for review.
    # Advisory only — `mapped` stays empty until Phase 3 validates the
    # extraction against JobCreate. LLM failure degrades to the Phase 1
    # text-only result so manual entry always stays possible.
    outcome = await extract_jd_fields(
        db, current_user.org_id, text=text, output_ref=f"jd-document:{safe_name}"
    )
    await llm_record(db, outcome=outcome)
    if outcome.payload is None:
        warnings = list(outcome.reasons)
        if JD_DOCUMENT_AI_PENDING_WARNING not in warnings:
            warnings.append(JD_DOCUMENT_AI_PENDING_WARNING)
        return JDParseOut(
            filename=safe_name,
            kind=validated.kind,
            templateVersion=JD_DOCUMENT_VERSION,
            text=text,
            mapped={},
            warnings=warnings,
        )
    payload = outcome.payload
    warnings = list(payload.warnings)
    if outcome.injection_suspected:
        warnings.append("Possible prompt-injection content detected; verify every field.")
    # Phase 3: validate against the JobCreate truth (read-only; HR reviews
    # in Phase 4 and saves through the existing POST /api/jobs endpoint).
    review = await validate_jd_extraction(
        payload, db, current_user.org_id,
        original_text=text, injection_suspected=outcome.injection_suspected,
    )
    return JDParseOut(
        filename=safe_name,
        kind=validated.kind,
        templateVersion=JD_DOCUMENT_VERSION,
        text=text,
        mapped={},
        warnings=warnings,
        aiExtract=payload.model_dump(mode="json"),
        missingFields=list(payload.missingFields),
        evidence=dict(payload.evidence),
        review=review.model_dump(mode="json"),
    )


@router.get("/jobs/{job_id}", response_model=JobPublic)
async def get_job(
    job_id: str,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> JobPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = JobRepository(db)
    doc = await repo.get_by_id(job_id, current_user.org_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobPublic(**doc)


@router.put("/jobs/{job_id}", response_model=JobPublic)
async def update_job(
    job_id: str,
    payload: JobUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("jobs.manage")),
    db: Any = Depends(get_db),
) -> JobPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")

    # PRD §7/§19: ARCHIVED jobs accept no edits; CLOSED jobs accept only a
    # limited subset (closing date, assignee, keywords, description).
    lifecycle = _lifecycle_of(existing)
    if lifecycle == "ARCHIVED":
        raise HTTPException(
            status_code=409, detail="Archived jobs cannot be edited"
        )

    upd = payload.model_dump(exclude_unset=True)
    if "niceToHaveSkills" in upd and upd["niceToHaveSkills"] is not None:
        upd["niceToHaveSkills"] = [
            s.model_dump() if hasattr(s, "model_dump") else s for s in upd["niceToHaveSkills"]
        ]

    if lifecycle == "CLOSED":
        allowed_on_closed = {"closesAt", "assigneeUserId", "keywords", "jdHtml",
                             "description", "matchThreshold"}
        rejected = sorted(set(upd) - allowed_on_closed)
        if rejected:
            raise HTTPException(
                status_code=409,
                detail=f"Closed jobs accept only limited edits; not allowed here: {', '.join(rejected)}",
            )

    new_assignee = None
    old_assignee_id = existing.get("assigneeUserId")
    if "assigneeUserId" in upd and upd["assigneeUserId"] is not None:
        # PRD §21/§22: validate + snapshot; history lives in the audit log.
        new_assignee = await _resolve_assignee(db, current_user.org_id, upd["assigneeUserId"])
        upd["assigneeEmail"] = new_assignee.get("email")
    elif old_assignee_id:
        # PRD §21: assignee email changes propagate to the snapshot.
        current_owner = await UserRepository(db).get_by_id(str(old_assignee_id), current_user.org_id)
        if current_owner and current_owner.get("email") != existing.get("assigneeEmail"):
            upd["assigneeEmail"] = current_owner.get("email")

    if "jdHtml" in upd and upd["jdHtml"] is not None:
        upd["jdText"] = jd_text_of(str(upd["jdHtml"]))

    # PRD §19 edge case: invariants hold even when only one side of the
    # range is patched (the schema validates only the both-sent case).
    new_min = upd.get("minExperienceYears", existing.get("minExperienceYears"))
    new_max = upd.get("maxExperienceYears", existing.get("maxExperienceYears"))
    if new_min is not None and new_max is not None and new_max < new_min:
        raise HTTPException(
            status_code=422, detail="maxExperienceYears must be >= minExperienceYears"
        )
    new_open = _coerce_dt(upd.get("openedAt", existing.get("openedAt")))
    new_close = _coerce_dt(upd.get("closesAt", existing.get("closesAt")))
    if new_open is not None and new_close is not None:
        open_utc = _as_utc(new_open)
        close_utc = _as_utc(new_close)
        if open_utc is not None and close_utc is not None and close_utc <= open_utc:
            raise HTTPException(
                status_code=422, detail="closesAt must be greater than openedAt"
            )

    if upd.get("positionsTotal") is not None:
        try:
            validate_positions(
                upd["positionsTotal"], positions_filled=existing.get("positionsFilled") or 0
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    updated = await repo.update(job_id, upd, current_user.org_id)

    # PRD §20: the audit trail records old AND new values per changed field.
    # Slice 10: idempotent writes (nothing actually changed) log no event —
    # the trail stays append-only signal, not per-request noise.
    changes: dict[str, dict[str, Any]] = {}
    for key, value in upd.items():
        old_value = existing.get(key)
        if old_value != value:
            changes[key] = {"from": old_value, "to": value}
    audit = AuditLogRepository(db)
    if changes:
        await audit.log(
            org_id=current_user.org_id,
            actor_user_id=current_user.user_id,
            action="job.update",
            resource_type="job",
            resource_id=job_id,
            details={"changes": changes},
            ip_address=request.client.host if request.client else "",
        )
    if new_assignee is not None and str(new_assignee.get("userId")) != str(old_assignee_id or ""):
        await audit.log(
            org_id=current_user.org_id,
            actor_user_id=current_user.user_id,
            action="job.assign",
            resource_type="job",
            resource_id=job_id,
            details={"from": old_assignee_id, "to": new_assignee.get("userId")},
            ip_address=request.client.host if request.client else "",
        )
        # PRD §23: notify the NEW assignee (best-effort).
        await _notify_assignee(db, org_id=current_user.org_id, job=updated or {}, user=new_assignee)

    return JobPublic(**updated)


# --- Job lifecycle endpoints (PRD §7, §18, §24-§27) ---
# (_JOB_MANAGE / _JOB_READ are defined once above, next to the helpers.)


@router.get("/jobs/{job_id}/detail", response_model=JobDetailPublic)
async def get_job_detail(
    job_id: str,
    current_user: CurrentUser = Depends(_JOB_READ),
    db: Any = Depends(get_db),
) -> JobDetailPublic:
    """PRD §18: job + its applications + counts for the details page."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = JobRepository(db)
    doc = await repo.get_by_id(job_id, current_user.org_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")
    apps = await ApplicationRepository(db).list_by_job(job_id, current_user.org_id, limit=200)
    active = sum(1 for a in apps if str(a.get("status") or "active") == "active")
    return JobDetailPublic(
        job=JobPublic(**doc),
        applications=apps,
        counts={"total": len(apps), "active": active},
    )


@router.post("/jobs/{job_id}/close", response_model=JobPublic)
async def close_job(
    job_id: str,
    payload: JobCloseIn,
    request: Request,
    current_user: CurrentUser = Depends(_JOB_MANAGE),
    db: Any = Depends(get_db),
) -> JobPublic:
    """PRD §24: manual closure. New applications stop; job leaves active lists."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    lifecycle = _lifecycle_of(existing)
    if lifecycle not in ("DRAFT", "OPEN", "ON_HOLD"):
        raise HTTPException(
            status_code=409,
            detail=f"Only DRAFT/OPEN/ON_HOLD jobs can be closed (current: {lifecycle})",
        )
    updated = await repo.update(
        job_id,
        {"lifecycleStatus": "CLOSED", "closedAt": _utcnow()},
        current_user.org_id,
    )
    await AuditLogRepository(db).log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="job.close",
        resource_type="job",
        resource_id=job_id,
        details={"from": lifecycle, "to": "CLOSED", "reason": payload.reason},
        ip_address=request.client.host if request.client else "",
    )
    return JobPublic(**updated)


@router.post("/jobs/{job_id}/reopen", response_model=JobPublic)
async def reopen_job(
    job_id: str,
    payload: JobReopenIn,
    request: Request,
    current_user: CurrentUser = Depends(_JOB_MANAGE),
    db: Any = Depends(get_db),
) -> JobPublic:
    """PRD §26: reopening a CLOSED job requires a valid FUTURE closing date."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    closes_at = payload.closesAt
    if closes_at.tzinfo is None:
        closes_at = closes_at.replace(tzinfo=timezone.utc)
    if closes_at <= _utcnow():
        raise HTTPException(
            status_code=422, detail="Reopening requires a valid future closing date"
        )
    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    if _lifecycle_of(existing) != "CLOSED":
        raise HTTPException(
            status_code=409, detail="Only CLOSED jobs can be reopened"
        )
    updated = await repo.update(
        job_id,
        {"lifecycleStatus": "OPEN", "closesAt": closes_at, "closedAt": None},
        current_user.org_id,
    )
    await AuditLogRepository(db).log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="job.reopen",
        resource_type="job",
        resource_id=job_id,
        # Slice 10: the new closing date is part of the audited new value.
        details={"from": "CLOSED", "to": "OPEN",
                 "closesAt": closes_at.isoformat()},
        ip_address=request.client.host if request.client else "",
    )
    return JobPublic(**updated)


@router.post("/jobs/{job_id}/archive", response_model=JobPublic)
async def archive_job(
    job_id: str,
    request: Request,
    current_user: CurrentUser = Depends(_JOB_MANAGE),
    db: Any = Depends(get_db),
) -> JobPublic:
    """PRD §27: archiving preserves history (preferred over delete)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    lifecycle = _lifecycle_of(existing)
    if lifecycle == "ARCHIVED":
        raise HTTPException(status_code=409, detail="Job is already archived")
    updated = await repo.update(
        job_id,
        {"lifecycleStatus": "ARCHIVED", "archivedAt": _utcnow()},
        current_user.org_id,
    )
    await AuditLogRepository(db).log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="job.archive",
        resource_type="job",
        resource_id=job_id,
        details={"from": lifecycle, "to": "ARCHIVED"},
        ip_address=request.client.host if request.client else "",
    )
    return JobPublic(**updated)


@router.post("/jobs/{job_id}/assign", response_model=JobPublic)
async def assign_job(
    job_id: str,
    payload: JobAssignIn,
    request: Request,
    current_user: CurrentUser = Depends(_JOB_MANAGE),
    db: Any = Depends(get_db),
) -> JobPublic:
    """PRD §21: (re)assign by email. Mirrors the PUT assignee path without
    touching it (Slice 2 flow stays byte-identical)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    if _lifecycle_of(existing) == "ARCHIVED":
        raise HTTPException(
            status_code=409, detail="Archived jobs cannot be reassigned"
        )
    email = payload.email.strip().lower()
    target = await UserRepository(db).get_by_email(email, current_user.org_id)
    if target is None:
        raise HTTPException(
            status_code=422, detail="Assignee is not a valid user of this organization"
        )
    if target.get("isActive", True) is False:
        raise HTTPException(
            status_code=422, detail="Assignee is deactivated; choose an active user"
        )
    old_assignee_id = existing.get("assigneeUserId")
    updated = await repo.update(
        job_id,
        {"assigneeUserId": target.get("userId"), "assigneeEmail": target.get("email")},
        current_user.org_id,
    )
    # Slice 10: re-assigning the SAME owner is idempotent — no audit event,
    # no notification (mirrors the PUT assignee path).
    if str(old_assignee_id or "") != str(target.get("userId") or ""):
        await AuditLogRepository(db).log(
            org_id=current_user.org_id,
            actor_user_id=current_user.user_id,
            action="job.assign",
            resource_type="job",
            resource_id=job_id,
            details={"from": old_assignee_id, "to": target.get("userId")},
            ip_address=request.client.host if request.client else "",
        )
        await _notify_assignee(db, org_id=current_user.org_id, job=updated or {}, user=target)
    return JobPublic(**updated)


@router.get("/jobs/{job_id}/activity")
async def job_activity(
    job_id: str,
    current_user: CurrentUser = Depends(_JOB_READ),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """PRD §20: job-scoped activity trail (who/what/old/new/when).

    Scoped to one job so HR/interviewers can see it; the global audit log
    stays behind audit.view. Newest first.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    docs = await AuditLogRepository(db).list_by_org(
        current_user.org_id, resource_type="job", resource_id=job_id, limit=100,
    )
    return {"jobId": job_id, "items": docs, "count": len(docs)}


@router.get("/jobs/{job_id}/notifications")
async def job_notifications(
    job_id: str,
    current_user: CurrentUser = Depends(_JOB_READ),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """Slice 9: read-only visibility over the EXISTING outbox for job assignments.

    Returns metadata only (no bodies, no raw emails — masked recipient like
    diagnostics). States shown are exactly the outbox states
    (pending/sending/sent/failed) with the existing attempts/lastError/
    sentAt/sentVia fields. No new retry logic here: retries stay
    admin-only via POST /api/diagnostics/outbox/{id}/retry.
    The audit trail (job.assign entries) remains authoritative.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    cursor = db["email_outbox"].find(
        {"orgId": current_user.org_id, "kind": "job_assigned",
         "entityKey": job_id},
        {"payloadEncrypted": 0},
    ).sort("createdAt", -1).limit(50)
    items: list[dict[str, Any]] = []
    async for d in cursor:
        d.pop("_id", None)
        items.append(d)
    return {"jobId": job_id, "items": items, "count": len(items)}


@router.delete("/jobs/{job_id}")
async def delete_job(
    job_id: str,
    request: Request,
    current_user: CurrentUser = Depends(_JOB_MANAGE),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """PRD §27: hard-delete is refused when applications exist (archive instead)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = JobRepository(db)
    existing = await repo.get_by_id(job_id, current_user.org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    app_count = await db["applications"].count_documents(
        {"jobId": job_id, "orgId": current_user.org_id}
    )
    if app_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Job has applications and cannot be hard-deleted; archive it instead",
        )
    await db["jobs"].delete_one({"jobId": job_id, "orgId": current_user.org_id})
    await AuditLogRepository(db).log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="job.delete",
        resource_type="job",
        resource_id=job_id,
        details={"jobKey": existing.get("jobKey")},
        ip_address=request.client.host if request.client else "",
    )
    return {"deleted": job_id}


@router.post("/jobs/check-duplicate", response_model=JobDuplicateOut)
async def check_job_duplicate(
    payload: JobDuplicateCheckIn,
    current_user: CurrentUser = Depends(_JOB_MANAGE),
    db: Any = Depends(get_db),
) -> JobDuplicateOut:
    """PRD §12: advisory duplicate probe. NEVER blocks — the caller decides
    whether to show "A similar job already exists. Do you want to continue?"."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    query: dict[str, Any] = {"orgId": current_user.org_id, "lifecycleStatus": {"$ne": "ARCHIVED"}}
    for field in ("companyName", "jobRole", "department", "location"):
        value = getattr(payload, field)
        if value:
            query[field] = {"$regex": f"^{value.strip()}$", "$options": "i"}
    if payload.excludeJobId:
        query["jobId"] = {"$ne": payload.excludeJobId}
    cursor = db["jobs"].find(query).sort("createdAt", -1).limit(10)
    docs = []
    async for d in cursor:
        d.pop("_id", None)
        docs.append(d)
    jobs = [JobPublic(**d) for d in docs]
    return JobDuplicateOut(similarJobs=jobs, count=len(jobs))


@router.post("/admin/jobs/auto-close")
async def auto_close_jobs(
    current_user: CurrentUser = Depends(require_permission("applications.transition")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """PRD §25: close OPEN jobs past their closing date.

    The closing boundary is interpreted in the ORG's configured timezone:
    the stored wall-clock time of closesAt is localized with the org's
    IANA timezone (real tz rules, DST included — no fixed offsets).
    Missing/invalid org timezone falls back to UTC, which preserves the
    previously interim behavior; stored timestamps remain UTC instants.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    # Shared with the background worker sweep (same org-tz logic, audit,
    # atomic claim, and assignee outbox notification).
    from ..services.auto_close import auto_close_due_jobs

    return await auto_close_due_jobs(db, org_id=current_user.org_id)


# --- Applicants Routes ---

@router.post("/applicants", response_model=ApplicantPublic, status_code=status.HTTP_201_CREATED)
async def create_applicant(
    payload: ApplicantCreate,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> ApplicantPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = ApplicantRepository(db)
    existing = await repo.get_by_email(payload.email, current_user.org_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applicant with this email already exists in this organization",
        )

    doc = payload.model_dump()
    doc["orgId"] = current_user.org_id
    doc["phoneDigits"] = phone_digits_variants(payload.phone or "")
    created = await repo.create(doc)
    return ApplicantPublic(**created)


@router.get("/applicants/{applicant_id}", response_model=ApplicantPublic)
async def get_applicant(
    applicant_id: str,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> ApplicantPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = ApplicantRepository(db)
    doc = await repo.get_by_id(applicant_id, current_user.org_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Applicant not found")
    return ApplicantPublic(**_masked_applicant(doc))


@router.get("/applicants", response_model=list[ApplicantPublic])
async def list_applicants(
    q: str | None = Query(default=None, max_length=100),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> list[ApplicantPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = ApplicantRepository(db)
    if q:
        docs = await repo.search_by_org(current_user.org_id, q, skip=skip, limit=limit)
    else:
        docs = await repo.list_by_org(current_user.org_id, skip=skip, limit=limit)
    applications = ApplicationRepository(db)
    out: list[ApplicantPublic] = []
    for d in docs:
        apps = await applications.list_by_applicant(d["applicantId"], current_user.org_id)
        latest = None
        if apps:
            a0 = apps[0]
            a0_assessment = a0.get("assessment") or {}
            latest = {"applicationId": a0["applicationId"],
                      "jobId": a0["jobId"],
                      "currentStage": a0["currentStage"],
                      "matchScore": a0.get("matchScore"),
                      "needsReview": bool(a0.get("needsReview", False)),
                      "threshold": (a0.get("scoreBreakdown") or {}).get("threshold", 60),
                      "lowConfidence": bool((a0.get("scoreBreakdown") or {}).get("lowConfidence", False)),
                      "assessment": {"state": a0_assessment.get("state", "none"),
                                     "error": a0_assessment.get("error")}}
        masked = _masked_applicant(d)
        masked["latestApplication"] = latest
        out.append(ApplicantPublic(**masked))
    return out


@router.get("/applicants/{applicant_id}/profile")
async def get_applicant_profile(
    applicant_id: str,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """Full candidate view: masked profile + applications + stage timeline."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    app_repo = ApplicantRepository(db)
    doc = await app_repo.get_by_id(applicant_id, current_user.org_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Applicant not found")

    applications = ApplicationRepository(db)
    apps = await applications.list_by_applicant(applicant_id, current_user.org_id)
    history_repo = StageHistoryRepository(db)
    timeline: list[dict[str, Any]] = []
    for app_doc in apps:
        for entry in await history_repo.list_for_application(app_doc["applicationId"]):
            timeline.append({**entry, "applicationId": app_doc["applicationId"]})
    timeline.sort(key=lambda e: str(e.get("transitionAt", "")))
    return {
        "applicant": ApplicantPublic(**_masked_applicant(doc)).model_dump(),
        "applications": [ApplicationPublic(**a).model_dump() for a in apps],
        "timeline": timeline,
    }


@router.post("/applicants/{applicant_id}/reveal")
async def reveal_applicant_pii(
    applicant_id: str,
    payload: RevealRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """Explicit audited reveal of masked contact fields (email/phone only)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    wanted = list(payload.fields or [])
    if not wanted or any(f not in ALLOWED_REVEAL_FIELDS for f in wanted):
        raise HTTPException(status_code=400, detail="Only 'email' and 'phone' can be revealed.")
    repo = ApplicantRepository(db)
    doc = await repo.get_by_id(applicant_id, current_user.org_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Applicant not found")
    revealed = {f: doc.get(f, "") for f in wanted}
    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="pii.reveal",
        resource_type="applicant",
        resource_id=applicant_id,
        details={"fields": wanted},
        ip_address=request.client.host if request.client else "",
    )
    return {"applicantId": applicant_id, "revealed": revealed}


# --- Applications Routes ---

@router.post("/applications", response_model=ApplicationPublic, status_code=status.HTTP_201_CREATED)
async def create_application(
    payload: ApplicationCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> ApplicationPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    job_repo = JobRepository(db)
    job = await job_repo.get_by_id(payload.jobId, current_user.org_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    lifecycle = str(job.get("lifecycleStatus") or "DRAFT").upper()
    if lifecycle in ("CLOSED", "ARCHIVED"):
        raise HTTPException(
            status_code=409,
            detail=f"Job is {lifecycle.lower()}; new applications are not accepted",
        )

    app_repo = ApplicantRepository(db)
    applicant = await app_repo.get_by_id(payload.applicantId, current_user.org_id)
    if not applicant:
        raise HTTPException(status_code=404, detail="Applicant not found")

    repo = ApplicationRepository(db)
    active = await repo.find_active_for_pair(payload.jobId, payload.applicantId, current_user.org_id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applicant already has an active application for this job",
        )

    doc = {
        "orgId": current_user.org_id,
        "jobId": payload.jobId,
        "applicantId": payload.applicantId,
        "currentStage": payload.initialStage.value,
        "candidateKey": payload.candidateKey,
        "assignedReviewers": payload.assignedReviewers,
        "matchScore": payload.matchScore,
        "scoreBreakdown": payload.scoreBreakdown,
        "needsReview": False,
        "reviewReasons": [],
        "status": ApplicationStatus.ACTIVE.value,
    }
    created = await repo.create(doc)

    history = StageHistoryRepository(db)
    await history.record_transition(
        application_id=created["applicationId"],
        from_stage="",
        to_stage=payload.initialStage.value,
        actor_user_id=current_user.user_id,
        reason="Application created",
    )

    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="application.create",
        resource_type="application",
        resource_id=created["applicationId"],
        details={"jobId": payload.jobId, "applicantId": payload.applicantId},
        ip_address=request.client.host if request.client else "",
    )

    return ApplicationPublic(**created)


@router.get("/applications", response_model=list[ApplicationPublic])
async def list_applications(
    job_id: str | None = Query(default=None),
    stage: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> list[ApplicationPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = ApplicationRepository(db)
    if job_id:
        docs = await repo.list_by_job(job_id, current_user.org_id, stage=stage, skip=skip, limit=limit)
    else:
        docs = await repo.list_by_org(current_user.org_id, stage=stage, skip=skip, limit=limit)
    return [ApplicationPublic(**d) for d in docs]


@router.get("/applications/{application_id}", response_model=ApplicationPublic)
async def get_application(
    application_id: str,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> ApplicationPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = ApplicationRepository(db)
    doc = await repo.get_by_id(application_id, current_user.org_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Application not found")
    return ApplicationPublic(**doc)


@router.post("/applications/{application_id}/transition", response_model=ApplicationPublic)
async def transition_application_stage(
    application_id: str,
    payload: ApplicationTransitionRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> ApplicationPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Permission check: override vs regular transition (reason mandatory for both).
    if payload.isOverride:
        if not current_user.is_super_admin and "applications.override_stage" not in current_user.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: requires 'applications.override_stage' permission to override stage transitions",
            )
    elif "applications.transition" not in current_user.permissions and not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: requires 'applications.transition' permission",
        )

    try:
        updated = await transition_application(
            db,
            org_id=current_user.org_id,
            application_id=application_id,
            to_stage=payload.toStage,
            actor_user_id=current_user.user_id,
            reason=payload.reason,
            is_override=payload.isOverride,
            metadata=payload.metadata,
            ip_address=request.client.host if request.client else "",
        )
    except TransitionError as exc:
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Application not found." else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=str(exc)) from None

    return ApplicationPublic(**updated)


@router.get("/applications/{application_id}/history", response_model=list[StageHistoryPublic])
async def get_application_history(
    application_id: str,
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> list[StageHistoryPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = ApplicationRepository(db)
    app_doc = await repo.get_by_id(application_id, current_user.org_id)
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")

    history = StageHistoryRepository(db)
    docs = await history.list_for_application(application_id)
    return [StageHistoryPublic(**d) for d in docs]


# --- Audit Log Route ---

@router.get("/audit-log", response_model=list[AuditLogPublic])
async def list_audit_log(
    resource_type: str | None = Query(default=None),
    resource_id: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("audit.view")),
    db: Any = Depends(get_db),
) -> list[AuditLogPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    audit = AuditLogRepository(db)
    docs = await audit.list_by_org(
        current_user.org_id, resource_type=resource_type, resource_id=resource_id,
        skip=skip, limit=limit,
    )
    return [AuditLogPublic(**d) for d in docs]

