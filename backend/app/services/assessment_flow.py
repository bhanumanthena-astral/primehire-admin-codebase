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
import uuid
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
    db: Any, *, org_id: str, application_id: str, actor_user_id: str, generate_only: bool = False, template: dict | None = None
) -> dict[str, Any]:
    from ..models.recruitment import lease
    async with lease(db, org_id, [f'assessment-send:{application_id}']):
        return await _request_assessment_send(db, org_id=org_id, application_id=application_id,
            actor_user_id=actor_user_id, generate_only=generate_only, template=template)


async def _request_assessment_send(
    db: Any, *, org_id: str, application_id: str, actor_user_id: str, generate_only: bool = False, template: dict | None = None
) -> dict[str, Any]:
    """Human-triggered (or autoSend) intent. Validates, persists, enqueues."""
    apps = ApplicationRepository(db)
    app_doc = await apps.get_by_id(application_id, org_id)
    if not app_doc:
        return {"result": "failed", "reason": "Application not found."}
    if app_doc.get("currentStage") != Stage.SHORTLISTED.value:
        return {"result": "skipped", "reason": f"Stage is {app_doc.get('currentStage')}, not SHORTLISTED."}
    state = (app_doc.get("assessment") or {}).get("state", "none")
    if state in {"email_queued", "email_sent"} or (generate_only and (app_doc.get('assessment') or {}).get('link')):
        return {"result": "skipped", "reason": f"Assessment already {state}."}
    jobs = JobRepository(db)
    job = await jobs.get_by_id(app_doc["jobId"], org_id)
    if not job or not job.get("assessmentJobId"):
        return {"result": "skipped", "reason": "Job has no linked assessment."}
    assessment = app_doc.get('assessment') or {}
    provider_id = assessment.get('providerCandidateId') or str(uuid.uuid5(uuid.NAMESPACE_URL,
        f"primehire-assessment:{org_id}:{application_id}:{job['assessmentJobId']}"))
    await _set_assessment(db, org_id, application_id, {"state": "send_requested", "error": None,
        "providerCandidateId": provider_id})
    queue = BackgroundJobRepository(db)
    intent = {"applicationId": application_id, "actorUserId": actor_user_id, "generateOnly": generate_only, "template": template}
    queued = await queue.enqueue(
        org_id=org_id, kind="assessment_send", entity_type="application",
        entity_key=application_id,
        payload=intent,
        dedupe_key=f"assessment_generate:application:{application_id}" if generate_only else None,
    )
    # Explicit retries can revive a finished/dead request after a provider/parser
    # failure; a running or pending request is left alone.
    if state == 'failed' and queued.get('status') in {'done', 'dead'}:
        await db['background_jobs'].update_one({'orgId':org_id,'jobId':queued['jobId'],
            'status':{'$in':['done','dead']}}, {'$set':{'status':'pending','attempts':0,
            'runAfter':_utcnow(),'leaseUntil':None,'lastError':None,'result':None,
            'payload':intent}})
    audit = AuditLogRepository(db)
    await audit.log(org_id=org_id, actor_user_id=actor_user_id, action="assessment.send_requested",
                    resource_type="application", resource_id=application_id,
                    details={"jobId": app_doc["jobId"]}, ip_address="")
    return {"result": "accepted"}


async def handle_assessment_send(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    from ..models.recruitment import lease
    application_id=str((job.get('payload') or {}).get('applicationId',''))
    async with lease(db, job['orgId'], [f'assessment-send:{application_id}']):
        return await _handle_assessment_send(db, job)


async def _handle_assessment_send(db: Any, job: dict[str, Any]) -> dict[str, Any]:
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
    if not assessment.get("link"):
        await _set_assessment(db, org_id, application_id, {"state": "upstream_pending", "error": None})
        round_type = str(job_doc.get("assessmentRoundType") or "TECHNICAL")
        if round_type not in VALID_ROUND_TYPES:
            round_type = "TECHNICAL"
        now = _utcnow()
        window_start, window_end = now, now + timedelta(days=7)
        config = await db['assessments'].find_one({'orgId':org_id,'jobId':job_doc['assessmentJobId']})
        if config:
            if config.get('publicationState', 'published') != 'published' or config.get('isActive') is False:
                await _set_assessment(db, org_id, application_id, {'state':'failed','error':'Linked assessment must be published and active.'})
                return {'failed':'assessment unavailable'}
            def as_time(value):
                result = datetime.fromisoformat(value.replace('Z','+00:00')) if isinstance(value,str) else value
                return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result
            if config.get('windowStart'): window_start = max(now, as_time(config['windowStart']))
            if config.get('windowEnd'): window_end = as_time(config['windowEnd'])
            if window_end <= window_start:
                await _set_assessment(db, org_id, application_id, {'state':'failed','error':'The linked assessment window has ended. Choose an active assessment.'})
                return {'failed':'assessment expired'}
        try:
            record = await create_interview(
                job_id=str(job_doc["assessmentJobId"]), round_type=round_type,
                candidate_id=assessment.get("providerCandidateId") or app_doc["applicantId"],
                start_time=window_start.isoformat(),
                end_time=window_end.isoformat(),
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
        from .candidate_link_crypto import encrypt_link
        protected_code = encrypt_link(record["password"]) if record.get("password") else None
        await _set_assessment(db, org_id, application_id, {
            "accessCodeEncrypted": protected_code,
            "state": "link_created",
            "interviewId": record.get("interviewId") or None,
            "link": record.get("link") or None,
            "responseId": record.get("responseId"),
            "reused": bool(record.get("reused", False)),
            "windowStart": window_start.isoformat(),
            "windowEnd": window_end.isoformat(),
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

    if payload.get("generateOnly"):
        return {"generated": True}
    if not password and assessment.get('accessCodeEncrypted'):
        from .candidate_link_crypto import decrypt_link
        password = decrypt_link(assessment['accessCodeEncrypted'])

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
        window_text=window_text, template=payload.get("template"),
        context={"start_time": assessment.get("windowStart"), "end_time": assessment.get("windowEnd"),
                 "round_type": job_doc.get("assessmentRoundType") or "Technical"},
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
    if app_doc.get("currentStage") in {"REJECTED", "WITHDRAWN", "HIRED", "TALENT_POOL"}:
        return {"skipped": "application no longer active"}
    assessment = dict(app_doc.get("assessment") or {})
    interview_id = assessment.get("interviewId")
    if not interview_id:
        return {"skipped": "no interview"}
    try:
        status = await get_interview_status(interview_id=str(interview_id))
    except UpstreamError as exc:
        raise RuntimeError(str(exc)) from exc  # retryable via job backoff
    if not status.get("submitted") and not status.get("reportAvailable"):
        from .reporting import capture
        reporting_job=await db['jobs'].find_one({'orgId':org_id,'jobId':app_doc['jobId']})
        if reporting_job:
            await capture(db,app_doc,reporting_job,submitted=False)
        patch={"syncedAt":_utcnow().isoformat(),"syncError":None}
        if status.get('started'):
            patch.update(state='in_progress',status='In progress',startedAt=status.get('startedAt') or assessment.get('startedAt'))
        await _set_assessment(db, org_id, application_id, patch)
        return {"pending": "not submitted"}
    score: int | float | None = None
    scores: dict[str, Any] = {}
    report_pending = True
    envelope = await get_report_envelope(interview_id=str(interview_id))
    if envelope:
        try:
            scores = extract_scores(deep_camel(envelope))
            score = scores.get("technical")
            report_pending = score is None
        except Exception:  # noqa: BLE001 — malformed report must not block the stage
            logger.warning("Report envelope unparseable for %s.", application_id)
    from .reporting import capture
    reporting_job=await db['jobs'].find_one({'orgId':org_id,'jobId':app_doc['jobId']})
    if reporting_job:
        try:
            await capture(db,app_doc,reporting_job,envelope,report_available=status.get('reportAvailable',False),submitted=True)
        except Exception:
            logger.warning('Report catalog synchronization deferred for %s',application_id)
    await _set_assessment(db, org_id, application_id, {
        "submittedAt": status.get("submittedAt") or assessment.get('submittedAt') or _utcnow().isoformat(),
        "submissionTimeSource": 'provider' if status.get('submittedAt') else assessment.get('submissionTimeSource') or ('unknown' if assessment.get('submittedAt') else 'observed'),
        # Completion can be the first successful poll: retain its actual start timestamp too.
        "startedAt": status.get('startedAt') or assessment.get('startedAt'),
        "score": score, "scores": scores, "reportPending": report_pending,
        "state": "report_pending" if report_pending else "completed",
        "status": "Report pending" if report_pending else "Completed",
        "syncedAt": _utcnow().isoformat(), "error": None, "syncError":None,
    })
    if app_doc.get('currentStage') in {Stage.SHORTLISTED.value, Stage.ASSESSMENT_SENT.value}:
        await transition_application(
            db, org_id=org_id, application_id=application_id,
            to_stage=Stage.ASSESSMENT_COMPLETED, actor_user_id="system",
            reason="Provider confirmed assessment submission from the generated candidate link.",
            is_override=app_doc.get('currentStage') == Stage.SHORTLISTED.value,
            metadata={"interviewId": interview_id, "score": score},
        )
    return {"completed": True, "score": score}


async def enqueue_sync_sweep(db: Any, *, limit: int = 20, org_id: str | None = None, job_id: str | None = None, force: bool = True) -> int:
    """Poll generated links and retry reports still pending, with bounded scope."""
    queue = BackgroundJobRepository(db)
    # Cross-org system sweep; each job remains org-scoped via its payload.
    query = {'currentStage':{'$nin':['REJECTED','WITHDRAWN','HIRED','TALENT_POOL']},
        'assessment.interviewId':{'$exists':True,'$nin':[None,'']},
        '$or':[{'assessment.score':None},{'assessment.reportPending':True}]}
    if org_id: query['orgId'] = org_id
    if job_id: query['jobId'] = job_id
    if not force:
        from ..config import settings
        cutoff=_utcnow()-timedelta(seconds=max(60,settings.assessment_sync_interval_s))
        query['$and']=[{'$or':[{'assessment.syncedAt':{'$exists':False}},
            {'assessment.syncedAt':None},
            {'assessment.syncedAt':{'$type':'string','$lte':cutoff.isoformat()}},
            {'assessment.syncedAt':{'$type':'date','$lte':cutoff}}]}]
    cursor = db['applications'].find(query).sort('assessment.syncedAt',1).limit(limit)
    count = 0
    async for doc in cursor:
        doc.pop("_id", None)
        existing = await db['background_jobs'].find_one({'orgId':doc['orgId'],
            'dedupeKey':f"assessment_sync:application:{doc['applicationId']}"})
        if existing and existing.get('status') in {'done','dead'}:
            await db['background_jobs'].update_one({'jobId':existing['jobId'],'orgId':doc['orgId'],
                'status':{'$in':['done','dead']}},{'$set':{'status':'pending','attempts':0,'runAfter':_utcnow(),'leaseUntil':None}})
        await queue.enqueue(
            org_id=doc["orgId"], kind="assessment_sync", entity_type="application",
            entity_key=doc["applicationId"],
            payload={"applicationId": doc["applicationId"]},
        )
        count += 1
    return count


async def process_requested_assessments(db, org_id, application_ids, *, generate_only=False):
    """Run the existing atomic jobs immediately, with at most three provider calls in flight.

    The durable job remains the recovery record; a queue daemon is not required
    for a human's generate/sync action, and a second worker cannot claim it twice.
    """
    import asyncio
    from .worker import run_once
    gate=asyncio.Semaphore(3)
    kind='assessment_send' if generate_only else 'assessment_sync'
    prefix='assessment_generate' if generate_only else 'assessment_sync'
    async def run(key):
        async with gate:
            job=await db['background_jobs'].find_one({'orgId':org_id,'dedupeKey':f'{prefix}:application:{key}'})
            if not job:return None
            return await run_once(db,kinds=[kind],job_id=job['jobId'])
    return await asyncio.gather(*(run(key) for key in dict.fromkeys(application_ids)))


async def maybe_autosend(db: Any, *, org_id: str, application_id: str) -> None:
    """autoSendAssessment (default false): enqueue right after SHORTLISTED."""
    org = await OrganizationRepository(db).get_by_org_id(org_id)
    settings_doc = (org or {}).get("settings") or default_settings()
    if settings_doc.get("autoSendAssessment") is True:
        await request_assessment_send(db, org_id=org_id, application_id=application_id,
                                      actor_user_id="system")
