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
from pydantic import BaseModel, ConfigDict, Field

from ..models.hiring import AuditLogRepository
from ..models.organization import OrganizationRepository, default_settings
from ..security.deps import CurrentUser, require_permission, get_db
from ..services.assessment_flow import enqueue_sync_sweep, request_assessment_send
from ..services.scoring import get_scoring_weights

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["assessments"])


class BulkSendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicationIds: list[str] = Field(default_factory=list, max_length=50)


class OrgSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    autoSendAssessment: bool | None = None
    scoring: dict[str, Any] | None = None
    reminderLeadMinutes: int | None = Field(default=None, ge=5, le=120)


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
        outcome = await request_assessment_send(
            db, org_id=current_user.org_id, application_id=application_id,
            actor_user_id=current_user.user_id,
        )
        items.append({"applicationId": application_id, **outcome})
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
    from ..config import settings as _settings

    count = await enqueue_sync_sweep(db, limit=_settings.assessment_sync_batch)
    return {"enqueued": count}
