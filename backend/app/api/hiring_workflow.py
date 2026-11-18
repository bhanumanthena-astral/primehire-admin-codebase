from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from fastapi import APIRouter, Depends, HTTPException
from ..security.deps import get_db, require_permission, get_current_user
from ..security.recruitment import job_allowed, app_allowed, writable
from ..services import hiring_workflow as service

router = APIRouter(prefix="/api/hiring-workflow", tags=["hiring-workflow"])


def database(db=Depends(get_db)):
    if db is None:
        raise HTTPException(503, "Hiring settings are unavailable")
    return db


class Template(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    category: Literal[
        "rejection", "candidate_reminder", "company_reminder", "report_share"
    ]
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=16000)


class Preferences(BaseModel):
    expectedRevision: int = Field(ge=0)
    templates: list[Template] = Field(max_length=60)
    defaultRejectionId: str | None = None

    @model_validator(mode="after")
    def unique(self):
        if len({t.id for t in self.templates}) != len(self.templates):
            raise ValueError("Template IDs must be unique")
        return self


class Trait(BaseModel):
    id: str = Field(min_length=1, max_length=60, pattern=r"^[A-Za-z][A-Za-z0-9_]*$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    active: bool = True


class Traits(BaseModel):
    expectedRevision: int = Field(ge=0)
    traits: list[Trait] = Field(min_length=1, max_length=24)

    @model_validator(mode="after")
    def valid(self):
        if not 1 <= sum(t.active for t in self.traits) <= 6:
            raise ValueError("Use between one and six active traits")
        if len({t.id for t in self.traits}) != len(self.traits):
            raise ValueError("Trait IDs must be unique")
        return self


@router.get("/settings")
async def settings(
    user=Depends(require_permission("recruitment.view")), db=Depends(database)
):
    row = await service.preferences(db, user.org_id)
    row.pop("_id", None)
    return row


@router.put("/interviews/{interview_id}/traits")
async def save_interview_traits(
    interview_id: str,
    payload: Traits,
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    from ..models.recruitment import RecruitmentRepository, lease
    from ..security.recruitment import interview_allowed, MANAGERS

    writable(user)
    async with lease(db, user.org_id, [f"interview:{interview_id}"]):
        row = await RecruitmentRepository(db, user.org_id).interview(interview_id)
        await interview_allowed(db, user, row)
        if user.role in MANAGERS:
            if "recruitment.manage" not in user.permissions:
                raise HTTPException(403, "Recruitment management permission is required")
        elif row["interviewerId"] != user.user_id or "recruitment.review" not in user.permissions:
            raise HTTPException(403, "Only the assigned reviewer can change these traits")
        if row["status"] != "scheduled":
            raise HTTPException(409, "Traits cannot be changed after the interview is closed")
        result = await service.save_traits(
            db, user, row["jobId"], row["round"], payload, row["interviewerId"]
        )
        result.pop("_id", None)
        return result


@router.put("/settings")
async def save(
    payload: Preferences,
    user=Depends(require_permission("users.manage")),
    db=Depends(database),
):
    writable(user)
    if user.role not in {"admin", "super_admin", "hr"}:
        raise HTTPException(403, "Administrator access required")
    return await service.save_preferences(db, user, payload)


@router.get("/jobs/{job_id}/traits/{round}")
async def traits(
    job_id: str,
    round: Literal["technical", "managerial", "hr"],
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    await job_allowed(db, user, job_id)
    row = await service.traits(db, user.org_id, job_id, round)
    row.pop("_id", None)
    return row


@router.put("/jobs/{job_id}/traits/{round}")
async def save_traits(
    job_id: str,
    round: Literal["technical", "managerial", "hr"],
    payload: Traits,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    writable(user)
    await job_allowed(db, user, job_id)
    row = await service.save_traits(db, user, job_id, round, payload)
    row.pop("_id", None)
    return row


@router.get("/applications/{application_id}/rejection-preview")
async def rejection_preview(
    application_id: str,
    user=Depends(require_permission("applications.transition")),
    db=Depends(database),
):
    application = await app_allowed(db, user, application_id)
    return await service.rejection_preview(db, user.org_id, application)


@router.get("/integration-status")
async def integration_status(user=Depends(get_current_user), db=Depends(database)):
    from ..services import google_oauth as oauth

    row = (
        await db.google_connections.find_one(
            {"orgId": user.org_id, "userId": user.user_id}
        )
        or {}
    )
    scopes = row.get("scopes", [])
    return {
        "configured": oauth.configured(),
        "connected": row.get("status") == "connected",
        "calendarAuthorized": oauth.CALENDAR_SCOPE in scopes,
        "gmailAuthorized": oauth.GMAIL_SCOPE in scopes,
        "expiresAt": row.get("expiresAt"),
        "status": row.get("status", "not_connected"),
    }


class DuplicateDecision(BaseModel):
    decision: Literal["keep", "dismiss"]
    reason: str = Field(min_length=3, max_length=1000)
    expectedRevision: int = Field(ge=1)


@router.post("/items/{item_id}/duplicate-review")
async def duplicate_review(
    item_id: str,
    payload: DuplicateDecision,
    user=Depends(require_permission("resumes.upload")),
    db=Depends(database),
):
    writable(user)
    if user.role not in {"super_admin", "admin", "hr"}:
        raise HTTPException(403, "Administrator review required")
    from ..services import resume_intake as intake
    from ..models.resume_intake import IntakeRepository, fenced_claim, now

    item, _ = await intake.item_for(db, user, item_id, write=True)
    async with fenced_claim(db, user.org_id, ["item:" + item_id]):
        updated = await IntakeRepository(db).patch_item(
            item_id,
            user.org_id,
            {
                "duplicateReview": {
                    "decision": payload.decision,
                    "reason": payload.reason,
                    "reviewedBy": user.user_id,
                    "reviewedAt": now(),
                }
            },
            payload.expectedRevision,
        )
        await intake.audit(
            db,
            user,
            "duplicate_reviewed",
            item_id,
            {"decision": payload.decision, "reason": payload.reason},
        )
    return {
        "revision": updated["revision"],
        "duplicateReview": updated["duplicateReview"],
    }


class SourceChange(BaseModel):
    source: str = Field(max_length=50)


@router.put("/applications/{key}/source")
async def source_change(
    key: str,
    payload: SourceChange,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    writable(user)
    from ..schemas.resume_intake import SOURCES

    if payload.source not in SOURCES:
        raise HTTPException(422, "Choose a supported application source")
    application = await app_allowed(db, user, key)
    await db.applications.update_one(
        {"orgId": user.org_id, "applicationId": key},
        {"$set": {"applicationSource": payload.source}},
    )
    await db.resume_intake_items.update_many(
        {"orgId": user.org_id, "applicationId": key},
        {"$set": {"source": payload.source}},
    )
    from ..models.hiring import AuditLogRepository

    await AuditLogRepository(db).log(
        org_id=user.org_id,
        actor_user_id=user.user_id,
        action="application.source_changed",
        resource_type="application",
        resource_id=key,
        details={"from": application.get("applicationSource"), "to": payload.source},
    )
    return {"source": payload.source}


class Share(BaseModel):
    reportIds: list[str] = Field(min_length=1, max_length=10)
    recipientUserId: str = Field(min_length=1, max_length=100)
    templateId: str = Field(min_length=1, max_length=80)
    provider: Literal["company", "gmail"] = "company"
    requestId: str = Field(min_length=8, max_length=100)


@router.get("/applications/{key}/shareable")
async def shareable(
    key: str, user=Depends(require_permission("reports.view")), db=Depends(database)
):
    return await service.shareable(db, user, key)


@router.post("/applications/{key}/share")
async def share(
    key: str,
    payload: Share,
    user=Depends(require_permission("reports.export")),
    db=Depends(database),
):
    writable(user)
    return await service.queue_share(db, user, key, payload)


@router.get("/hr-recipients")
async def recipients(
    applicationId: str = "",
    user=Depends(require_permission("reports.view")),
    db=Depends(database),
):
    from ..security.deps import CurrentUser
    from ..security.roles import effective_permissions
    from ..services.reporting import application_for

    if applicationId:
        await application_for(db, user, applicationId)
    items = []
    async for person in db.users.find(
        {
            "orgId": user.org_id,
            "isActive": True,
            "role": {"$in": ["hr", "admin", "super_admin"]},
        }
    ).limit(100):
        if applicationId:
            context = CurrentUser(
                person["userId"],
                user.org_id,
                person["role"],
                await effective_permissions(db, person),
                "",
            )
            try:
                await application_for(db, context, applicationId)
            except HTTPException:
                continue
        items.append({key: person.get(key, "") for key in ["userId", "name", "email"]})
    return {"items": items}


@router.post("/applications/{key}/share-preview")
async def share_preview(
    key: str,
    payload: Share,
    user=Depends(require_permission("reports.export")),
    db=Depends(database),
):
    writable(user)
    return await service.queue_share(db, user, key, payload, preview_only=True)


@router.get("/applications/{key}/messages")
async def messages(
    key: str, user=Depends(require_permission("recruitment.view")), db=Depends(database)
):
    await app_allowed(db, user, key)
    return {
        "items": await db.recruit_email_outbox.find(
            {
                "orgId": user.org_id,
                "entityKey": key,
                "kind": {"$in": ["workflow_rejection", "workflow_share"]},
            },
            {
                "_id": 0,
                "messageId": 1,
                "status": 1,
                "kind": 1,
                "sentVia": 1,
                "deliveryStatus": 1,
                "lastError": 1,
                "sentAt": 1,
                "createdAt": 1,
            },
        )
        .sort("createdAt", -1)
        .limit(30)
        .to_list(30)
    }


@router.post("/messages/{key}/retry")
async def retry(
    key: str,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    writable(user)
    message = await db.recruit_email_outbox.find_one(
        {
            "orgId": user.org_id,
            "messageId": key,
            "kind": {"$in": ["workflow_rejection", "workflow_share"]},
        }
    )
    if not message:
        raise HTTPException(404, "Message not found")
    await app_allowed(db, user, message["entityKey"])
    if message["status"] != "failed" or not message.get("payloadEncrypted"):
        raise HTTPException(
            409, "Only failed messages with a retained payload can be retried"
        )
    if not await service.delivery_allowed(db, message):
        raise HTTPException(409, "The application or report access changed")
    from ..models.recruitment import now

    await db.recruit_email_outbox.update_one(
        {"orgId": user.org_id, "messageId": key, "status": "failed"},
        {
            "$set": {
                "status": "pending",
                "attempts": 0,
                "nextRetryAt": now(),
                "lastError": None,
            }
        },
    )
    return {"status": "queued"}
