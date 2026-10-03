"""Assessment hand-off with write-ahead state (Slice C).

Per-application `assessment` object:
  send_requested → upstream_pending → link_created → email_queued
  → email_sent, or `failed` at any step with {error}.

Intent is persisted BEFORE each external call and the result right after,
so a crash between the upstream call and the write resumes safely: the
retry either continues, or the upstream duplicate response is adopted
(reuse the existing interview — never rotate IDs blindly, never fabricate).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from ..models.hiring import (
    ApplicantRepository,
    ApplicationRepository,
    AuditLogRepository,
    JobRepository,
    Stage,
)
from ..models.jobs import BackgroundJobRepository
from ..models.organization import OrganizationRepository, default_settings
from .email_send import queue_assessment_invite
from .primehire_api import (
    UpstreamDuplicate,
    UpstreamError,
    create_interview,
    get_interview_status,
    get_report_envelope,
)
from .report_normalize import deep_camel, extract_scores
from .transitions import transition_application

logger = logging.getLogger(__name__)

TERMINAL_SENT = {"link_created", "email_queued", "email_sent"}
VALID_ROUND_TYPES = {"TECHNICAL", "BASIC", "HR"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _set_assessment(db: Any, org_id: str, application_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    repo = ApplicationRepository(db)
    doc = await repo.get_by_id(application_id, org_id)
    if not doc:
        return None
    merged = dict(doc.get("assessment") or {})
    merged.update(patch)
    merged["updatedAt"] = _utcnow().isoformat()
    return await repo.update_score(application_id, org_id, {"assessment": merged})


async def request_assessment_send(
    db: Any, *, org_id: str, application_id: str, actor_user_id: str
) -> dict[str, Any]:
    """Human-triggered (or autoSend) intent. Validates, persists, enqueues."""
    apps = ApplicationRepository(db)
    app_doc = await apps.get_by_id(application_id, org_id)
    if not app_doc:
        return {"result": "failed", "reason": "Application not found."}
    if app_doc.get("currentStage") != Stage.SHORTLISTED.value:
        return {"result": "skipped", "reason": f"Stage is {app_doc.get('currentStage')}, not SHORTLISTED."}
    state = (app_doc.get("assessment") or {}).get("state", "none")
    if state in TERMINAL_SENT:
        return {"result": "skipped", "reason": f"Assessment already {state}."}
    jobs = JobRepository(db)
    job = await jobs.get_by_id(app_doc["jobId"], org_id)
    if not job or not job.get("assessmentJobId"):
        return {"result": "skipped", "reason": "Job has no linked assessment."}
    await _set_assessment(db, org_id, application_id, {"state": "send_requested", "error": None})
    queue = BackgroundJobRepository(db)
    await queue.enqueue(
        org_id=org_id, kind="assessment_send", entity_type="application",
        entity_key=application_id,
        payload={"applicationId": application_id, "actorUserId": actor_user_id},
    )
    audit = AuditLogRepository(db)
    await audit.log(org_id=org_id, actor_user_id=actor_user_id, action="assessment.send_requested",
                    resource_type="application", resource_id=application_id,
                    details={"jobId": app_doc["jobId"]}, ip_address="")
    return {"result": "accepted"}


async def handle_assessment_send(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    """Worker: resume the write-ahead machine from the last persisted state."""
    payload = job.get("payload") or {}
    application_id = str(payload.get("applicationId", ""))
    actor = str(payload.get("actorUserId", "system"))
    org_id = job["orgId"]
    apps = ApplicationRepository(db)
    app_doc = await apps.get_by_id(application_id, org_id)
    if not app_doc:
        return {"skipped": "application gone"}
    if app_doc.get("currentStage") != Stage.SHORTLISTED.value:
        return {"skipped": f"stage {app_doc.get('currentStage')}"}
    assessment = dict(app_doc.get("assessment") or {})
    state = assessment.get("state", "send_requested")
    if state in ("email_queued", "email_sent"):
        # Email leg already handled; stage catch-up (if any) is separate.
        return {"skipped": f"assessment {state}"}
    jobs = JobRepository(db)
    job_doc = await jobs.get_by_id(app_doc["jobId"], org_id)
    if not job_doc or not job_doc.get("assessmentJobId"):
        await _set_assessment(db, org_id, application_id, {"state": "failed", "error": "Job has no linked assessment."})
        return {"failed": "no assessment linked"}

    # Step 1: upstream interview (skipped when a link already exists).
    if not assessment.get("interviewId"):
        await _set_assessment(db, org_id, application_id, {"state": "upstream_pending", "error": None})
        round_type = str(job_doc.get("assessmentRoundType") or "TECHNICAL")
        if round_type not in VALID_ROUND_TYPES:
            round_type = "TECHNICAL"
        now = _utcnow()
        try:
            record = await create_interview(
                job_id=str(job_doc["assessmentJobId"]), round_type=round_type,
                candidate_id=app_doc["applicantId"],
                start_time=now.isoformat(),
                end_time=(now + timedelta(days=7)).isoformat(),
            )
        except UpstreamDuplicate as exc:
            if exc.interview and (exc.interview.get("interviewId") or exc.interview.get("link")):
                record = dict(exc.interview)
                record["reused"] = True
                logger.info("Adopted existing upstream interview for %s.", application_id)
            else:
                await _set_assessment(db, org_id, application_id,
                                      {"state": "failed", "error": "Upstream reports an existing interview (unidentified)."})
                return {"failed": "upstream duplicate, unidentified"}
        except UpstreamError as exc:
            await _set_assessment(db, org_id, application_id, {"state": "failed", "error": str(exc)})
            raise  # retryable via job backoff
        await _set_assessment(db, org_id, application_id, {
            "state": "link_created",
            "interviewId": record.get("interviewId") or None,
            "link": record.get("link") or None,
            "responseId": record.get("responseId"),
            "reused": bool(record.get("reused", False)),
            "windowStart": now.isoformat(),
            "windowEnd": (now + timedelta(days=7)).isoformat(),
            "error": None,
        })
        # Password lives in memory only from here — never persisted except
        # inside the encrypted outbox body, wiped after the real send.
        password = record.get("password")
    else:
        password = None

    app_doc = await apps.get_by_id(application_id, org_id)
    assessment = dict(app_doc.get("assessment") or {})
    if assessment.get("state") == "email_queued":
        return {"skipped": "email already queued"}

    # Step 2: queue the invite email.
    applicants = ApplicantRepository(db)
    applicant = await applicants.get_by_id(app_doc["applicantId"], org_id)
    email = (applicant or {}).get("email", "")
    if not email or email.endswith("@placeholder.local"):
        await _set_assessment(db, org_id, application_id,
                              {"state": "failed", "error": "Missing candidate contact email."})
        return {"failed": "missing contact"}
    link = assessment.get("link") or ""
    if not link:
        await _set_assessment(db, org_id, application_id,
                              {"state": "failed", "error": "Upstream gave no interview link."})
        return {"failed": "no link"}
    window_text = "Please complete it within 7 days."
    msg = await queue_assessment_invite(
        db, org_id=org_id, application_id=application_id,
        to_email=email, to_name=(applicant or {}).get("name") or "Candidate",
        link=link, password=password, job_title=job_doc.get("title", ""),
        window_text=window_text,
    )
    await _set_assessment(db, org_id, application_id,
                          {"state": "email_queued", "messageId": msg["messageId"], "error": None})
    queue = BackgroundJobRepository(db)
    await queue.enqueue(
        org_id=org_id, kind="email_send", entity_type="outbox_message",
        entity_key=msg["messageId"],
        payload={"messageId": msg["messageId"], "applicationId": application_id,
                 "actorUserId": actor},
    )
    return {"queued": msg["messageId"]}


async def handle_assessment_sync(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    """Worker: poll upstream status for ASSESSMENT_SENT; transition on submit."""
    payload = job.get("payload") or {}
    application_id = str(payload.get("applicationId", ""))
    org_id = job["orgId"]
    apps = ApplicationRepository(db)
    app_doc = await apps.get_by_id(application_id, org_id)
    if not app_doc:
        return {"skipped": "application gone"}
    if app_doc.get("currentStage") != Stage.ASSESSMENT_SENT.value:
        return {"skipped": f"stage {app_doc.get('currentStage')}"}
    assessment = dict(app_doc.get("assessment") or {})
    interview_id = assessment.get("interviewId")
    if not interview_id:
        return {"skipped": "no interview"}
    window_end = assessment.get("windowEnd")
    try:
        if window_end and _utcnow() > datetime.fromisoformat(window_end):
            await _set_assessment(db, org_id, application_id, {"syncSkipped": "window expired"})
            return {"skipped": "window expired"}
    except ValueError:
        pass
    try:
        status = await get_interview_status(interview_id=str(interview_id))
    except UpstreamError as exc:
        raise RuntimeError(str(exc)) from exc  # retryable via job backoff
    if not status.get("submitted"):
        return {"pending": "not submitted"}
    score: int | float | None = None
    scores: dict[str, Any] = {}
    report_pending = True
    envelope = await get_report_envelope(interview_id=str(interview_id))
    if envelope:
        try:
            scores = extract_scores(deep_camel(envelope))
            score = scores.get("technical")
            report_pending = False
        except Exception:  # noqa: BLE001 — malformed report must not block the stage
            logger.warning("Report envelope unparseable for %s.", application_id)
    await _set_assessment(db, org_id, application_id, {
        "submittedAt": status.get("submittedAt") or _utcnow().isoformat(),
        "score": score, "scores": scores, "reportPending": report_pending,
    })
    await transition_application(
        db, org_id=org_id, application_id=application_id,
        to_stage=Stage.ASSESSMENT_COMPLETED, actor_user_id="system",
        reason="Assessment submitted by candidate.",
        metadata={"interviewId": interview_id, "score": score},
    )
    return {"completed": True, "score": score}


async def enqueue_sync_sweep(db: Any, *, limit: int = 20) -> int:
    """Enqueue one `assessment_sync` per ASSESSMENT_SENT application (capped)."""
    queue = BackgroundJobRepository(db)
    # Cross-org system sweep; each job remains org-scoped via its payload.
    cursor = db["applications"].find({"currentStage": Stage.ASSESSMENT_SENT.value}).limit(limit)
    count = 0
    async for doc in cursor:
        doc.pop("_id", None)
        await queue.enqueue(
            org_id=doc["orgId"], kind="assessment_sync", entity_type="application",
            entity_key=doc["applicationId"],
            payload={"applicationId": doc["applicationId"]},
        )
        count += 1
    return count


async def maybe_autosend(db: Any, *, org_id: str, application_id: str) -> None:
    """autoSendAssessment (default false): enqueue right after SHORTLISTED."""
    org = await OrganizationRepository(db).get_by_org_id(org_id)
    settings_doc = (org or {}).get("settings") or default_settings()
    if settings_doc.get("autoSendAssessment") is True:
        await request_assessment_send(db, org_id=org_id, application_id=application_id,
                                      actor_user_id="system")
