"""Hiring model API routes: jobs, applicants, applications, stage transitions, and audit logs."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from ..models.hiring import (
    JobRepository,
    ApplicantRepository,
    ApplicationRepository,
    ApplicationStatus,
    StageHistoryRepository,
    AuditLogRepository,
    Stage,
)
from ..schemas.hiring import (
    JobCreate,
    JobUpdate,
    JobPublic,
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
from ..security.deps import CurrentUser, get_current_user, require_permission, get_db
from ..services.pii import mask_email, mask_phone, phone_digits_variants
from ..services.transitions import TransitionError, transition_application

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["hiring"])

ALLOWED_REVEAL_FIELDS = frozenset({"email", "phone"})


def _masked_applicant(doc: dict[str, Any]) -> dict[str, Any]:
    """Mask contact PII by default; full values only via the audited reveal."""
    out = dict(doc)
    out["email"] = mask_email(str(doc.get("email") or ""))
    out["phone"] = mask_phone(str(doc.get("phone") or ""))
    return out


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
    created = await repo.create(doc)

    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="job.create",
        resource_type="job",
        resource_id=created["jobId"],
        details={"jobKey": payload.jobKey, "title": payload.title},
        ip_address=request.client.host if request.client else "",
    )

    return JobPublic(**created)


@router.get("/jobs", response_model=list[JobPublic])
async def list_jobs(
    status: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("resumes.upload")),
    db: Any = Depends(get_db),
) -> list[JobPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = JobRepository(db)
    docs = await repo.list_by_org(current_user.org_id, status=status, skip=skip, limit=limit)
    return [JobPublic(**d) for d in docs]


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

    upd = payload.model_dump(exclude_unset=True)
    if "niceToHaveSkills" in upd and upd["niceToHaveSkills"] is not None:
        upd["niceToHaveSkills"] = [
            s.model_dump() if hasattr(s, "model_dump") else s for s in upd["niceToHaveSkills"]
        ]

    updated = await repo.update(job_id, upd, current_user.org_id)

    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="job.update",
        resource_type="job",
        resource_id=job_id,
        details=upd,
        ip_address=request.client.host if request.client else "",
    )

    return JobPublic(**updated)


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
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("audit.view")),
    db: Any = Depends(get_db),
) -> list[AuditLogPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    audit = AuditLogRepository(db)
    docs = await audit.list_by_org(
        current_user.org_id, resource_type=resource_type, skip=skip, limit=limit
    )
    return [AuditLogPublic(**d) for d in docs]
