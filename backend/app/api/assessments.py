"""Assessment hand-off + org settings routes (Slice C).

- POST /api/applications/send-assessments — human bulk action: explicit id
  list, per-item accepted/skipped/failed results. Only SHORTLISTED
  applications whose job links an assessment are accepted; the worker does
  the rest. One audit entry per bulk action (counts, no PII).
- POST /api/applications/{id}/request-assessment — single send / retry.
- GET/PUT /api/org/settings — allowlisted org flags (autoSendAssessment
  default false; changes audited).
- POST /api/admin/sync-sweep — enqueue completion checks now (worker also
  sweeps on its own interval).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from ..models.hiring import AuditLogRepository
from ..models.organization import OrganizationRepository, default_settings
from ..security.deps import CurrentUser, require_permission, get_db
from ..security.job_access import can_access_application, owner_scope
from ..services.assessment_flow import enqueue_sync_sweep, request_assessment_send
from ..services.scoring import get_scoring_weights

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["assessments"])


class ManualAssessmentEmail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    toEmail: EmailStr
    toName: str = Field(default="", max_length=200)
    subject: str = Field(min_length=1, max_length=300, pattern=r"^[^\r\n]+$")
    htmlBody: str = Field(min_length=1, max_length=100000)


@router.post("/send-email")
async def send_manual_assessment_email(
    payload: ManualAssessmentEmail,
    user: CurrentUser = Depends(require_permission("applications.transition")),
):
    from ..config import settings
    from ..services import email_send

    if user.impersonating:
        raise HTTPException(403, "Sending email while impersonating is disabled.")
    if settings.email_dry_run or not settings.zeptomail_api_key:
        raise HTTPException(503, "Live assessment email is disabled.")
    if not email_send.recipient_allowed(payload.toEmail):
        raise HTTPException(403, "Recipient is outside the test allowlist.")
    try:
        await email_send.send_via_zepto(payload.toEmail, payload.toName, payload.subject, payload.htmlBody)
    except email_send.EmailSendError:
        raise HTTPException(502, "Email provider could not accept the message.") from None
    return {"success": True}


class InvitationTemplate(BaseModel):
    subject: str = Field(min_length=1, max_length=300, pattern=r"^[^\r\n]+$")
    body: str = Field(min_length=1, max_length=20000)


class BulkSendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicationIds: list[str] = Field(default_factory=list, max_length=50)
    template: InvitationTemplate | None = None
    generateOnly: bool = False


class OrgSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    autoSendAssessment: bool | None = None
    scoring: dict[str, Any] | None = None
    reminderLeadMinutes: int | None = Field(default=None, ge=5, le=120)
    timezone: str | None = Field(default=None, max_length=64)


@router.post("/applications/send-assessments")
async def bulk_send_assessments(
    payload: BulkSendRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("applications.transition")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not payload.applicationIds:
        raise HTTPException(status_code=400, detail="No applications selected.")
    items: list[dict[str, Any]] = []
    for application_id in payload.applicationIds:
        if not await can_access_application(db, current_user, application_id):
            items.append({'applicationId':application_id,'result':'failed','reason':'Application not found.'})
            continue
        try:
            outcome = await request_assessment_send(
                db, org_id=current_user.org_id, application_id=application_id,
                actor_user_id=current_user.user_id, generate_only=payload.generateOnly,
                template=payload.template.model_dump() if payload.template else None,
            )
        except HTTPException as exc:
            outcome={'result':'failed','reason':str(exc.detail)}
        items.append({"applicationId": application_id, **outcome})
    if payload.generateOnly:
        from ..services.assessment_flow import process_requested_assessments
        await process_requested_assessments(db,current_user.org_id,
            [row['applicationId'] for row in items if row['result']=='accepted'],generate_only=True)
        for row in items:
            if row['result']!='accepted':continue
            saved=await db['applications'].find_one({'orgId':current_user.org_id,'applicationId':row['applicationId']})
            assessment=(saved or {}).get('assessment') or {}
            row['linkStatus']='generated' if assessment.get('link') else 'processing'
            if assessment.get('state')=='failed':
                row.update(result='failed',linkStatus='failed',reason=assessment.get('error') or 'Link generation failed. Retry the candidate.')
    accepted = sum(1 for i in items if i["result"] == "accepted")
    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id,
        actor_user_id=current_user.user_id,
        action="assessment.bulk_send",
        resource_type="application",
        resource_id=f"bulk:{accepted}/{len(items)}",
        details={"total": len(items), "accepted": accepted,
                 "applicationIds": payload.applicationIds},
        ip_address=request.client.host if request.client else "",
    )
    return {"items": items, "accepted": accepted, "total": len(items)}


@router.post("/applications/{application_id}/request-assessment")
async def request_single_assessment(
    application_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("applications.transition")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not await can_access_application(db, current_user, application_id):
        raise HTTPException(status_code=404, detail="Application not found")
    outcome = await request_assessment_send(
        db, org_id=current_user.org_id, application_id=application_id,
        actor_user_id=current_user.user_id,
    )
    if outcome["result"] == "failed":
        raise HTTPException(status_code=404, detail=outcome.get("reason", "Not found."))
    return {"applicationId": application_id, **outcome}


@router.get("/org/settings")
async def get_org_settings(
    current_user: CurrentUser = Depends(require_permission("org.settings")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    org = await OrganizationRepository(db).get_by_org_id(current_user.org_id)
    merged = dict(default_settings())
    merged.update((org or {}).get("settings") or {})
    # Never leak provider keys through settings (names only, no values here anyway).
    return {"orgId": current_user.org_id, "settings": merged}


@router.put("/org/settings")
async def update_org_settings(
    payload: OrgSettingsUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("org.settings")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = OrganizationRepository(db)
    org = await repo.get_by_org_id(current_user.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")
    updates: dict[str, Any] = {}
    if payload.autoSendAssessment is not None:
        updates["settings.autoSendAssessment"] = payload.autoSendAssessment
    if payload.scoring is not None:
        kw, lw = get_scoring_weights({"scoring": payload.scoring})
        updates["settings.scoring"] = {"keywordWeight": kw, "llmWeight": lw}
    if payload.reminderLeadMinutes is not None:
        updates["settings.reminderLeadMinutes"] = payload.reminderLeadMinutes
    if payload.timezone is not None:
        from ..schemas.organization import validate_timezone

        try:
            validate_timezone(payload.timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        updates["settings.timezone"] = payload.timezone
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    await repo.update_by_org_id(current_user.org_id, updates)
    audit = AuditLogRepository(db)
    await audit.log(
        org_id=current_user.org_id, actor_user_id=current_user.user_id,
        action="org.settings_update", resource_type="organization",
        resource_id=current_user.org_id, details={"updated": sorted(updates)},
        ip_address=request.client.host if request.client else "",
    )
    return await get_org_settings(current_user=current_user, db=db)


@router.post("/admin/sync-sweep")
async def trigger_sync_sweep(
    current_user: CurrentUser = Depends(require_permission("applications.transition")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if owner_scope(current_user):
        raise HTTPException(status_code=403, detail="Only an administrator can trigger an organization-wide sweep")
    from ..config import settings as _settings

    count = await enqueue_sync_sweep(db, limit=_settings.assessment_sync_batch)
    return {"enqueued": count}


class WhatsAppApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    expectedPrice: float = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)


class WhatsAppSend(BulkSendRequest):
    recipientConsentConfirmed: bool = False


async def whatsapp_job(db, user, job_id):
    from ..security.job_access import job_repository
    if db is None:
        raise HTTPException(503, "Database unavailable")
    row = await job_repository(db, user).get_by_id(job_id, user.org_id)
    if not row:
        row = await db["jobs"].find_one({"orgId": user.org_id, "jobId": job_id, "createdBy": user.user_id})
    if not row:
        raise HTTPException(404, "Job not found")
    return row


@router.get("/jobs/{job_id}/whatsapp")
async def whatsapp_capabilities(job_id: str, user=Depends(require_permission("jobs.view")), db=Depends(get_db)):
    from ..services.whatsapp_invites import configuration
    row = await whatsapp_job(db, user, job_id)
    config = configuration()
    approval = row.get("whatsappApproval") or {}
    return {**config, "enabled": bool(approval.get("enabled") and approval.get("price") == config["price"] and approval.get("currency") == config["currency"]),
        "canApprove": user.role in {"super_admin", "admin", "hr"} and not user.impersonating}


@router.put("/jobs/{job_id}/whatsapp")
async def approve_whatsapp(job_id: str, payload: WhatsAppApproval, user=Depends(require_permission("jobs.manage")), db=Depends(get_db)):
    from ..services.whatsapp_invites import configuration
    from ..models.recruitment import now
    await whatsapp_job(db, user, job_id)
    if user.impersonating or user.role not in {"super_admin", "admin", "hr"}:
        raise HTTPException(403, "A manager must approve WhatsApp costs")
    config = configuration()
    if payload.enabled and (not config["configured"] or payload.expectedPrice != config["price"] or payload.currency != config["currency"]):
        raise HTTPException(409, "Configure Meta and review the current price before enabling WhatsApp")
    approval = {"enabled": payload.enabled, "price": config["price"], "currency": config["currency"], "approvedBy": user.user_id, "approvedAt": now()}
    await db["jobs"].update_one({"orgId": user.org_id, "jobId": job_id}, {"$set": {"whatsappApproval": approval}})
    await AuditLogRepository(db).log(org_id=user.org_id, actor_user_id=user.user_id, action="whatsapp.approval", resource_type="job", resource_id=job_id, details={"enabled": payload.enabled, "price": config["price"], "currency": config["currency"]})
    return {"enabled": payload.enabled}


@router.post("/jobs/{job_id}/whatsapp/send")
async def send_whatsapp(job_id: str, payload: WhatsAppSend, user=Depends(require_permission("jobs.view")), db=Depends(get_db)):
    from ..services.whatsapp_invites import queue
    row = await whatsapp_job(db, user, job_id)
    if user.impersonating or user.role not in {"super_admin", "admin", "hr", "recruiter"} or user.role not in {"super_admin", "admin"} and user.user_id not in {row.get("createdBy"), row.get("assigneeUserId")}:
        raise HTTPException(403, "Only this job's creator, assignee or administrator can send WhatsApp invitations")
    if not payload.recipientConsentConfirmed or not payload.applicationIds:
        raise HTTPException(422, "Select candidates and confirm their WhatsApp opt-in")
    result = await queue(db, user, row, payload.applicationIds)
    await AuditLogRepository(db).log(org_id=user.org_id, actor_user_id=user.user_id, action="whatsapp.bulk_queue", resource_type="job", resource_id=job_id, details={"recipientConsentConfirmed": True, "requested": len(payload.applicationIds), "queued": sum(i['status']=='queued' for i in result['items'])})
    return result
