"""Background worker: claim → handle → complete/fail (Slice B).

One `resume_process` job per uploaded file. Handlers run with per-file
isolation (a bad file fails its own job, never the worker). Crash-safe:
unfinished leases expire and are reclaimed; dedupe keys prevent double
processing after a restart.

Run: `python cli.py worker [--poll-seconds 5]` (from `backend/`).
DEPLOYMENT: the worker must be running for parsing/scoring to complete.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Any, Awaitable, Callable

from ..models.jobs import BackgroundJobRepository
from .assessment_flow import (
    enqueue_sync_sweep,
    handle_assessment_send,
    handle_assessment_sync,
)
from .email_send import process_email_job
from .pipeline import process_llm_followup, process_resume_file
from .transitions import TransitionError, transition_application


async def _handle_intake(db, job):
    from .resume_intake_jobs import import_batch, parse_item
    from .resume_intake_review import resume_confirmation
    from .resume_intake_bulk import prepare_bulk
    from .resume_intake_selection import score_batch,score_item
    from ..models.resume_intake import IntakeRepository, now
    from datetime import timedelta
    handler = {"resume_intake_import": import_batch, "resume_intake_parse": parse_item,
        "resume_intake_confirm": resume_confirmation, "resume_intake_bulk_confirm": prepare_bulk,
        "resume_intake_score_batch":score_batch,"resume_intake_score":score_item}[job["kind"]]
    async def heartbeat():
        while True:
            await asyncio.sleep(30)
            await db["background_jobs"].update_one({"jobId": job["jobId"], "status": "running", "attempts": job["attempts"]},
                {"$set": {"leaseUntil": now() + timedelta(seconds=300)}})
    keepalive = asyncio.create_task(heartbeat())
    try:
        return await handler(db, job)
    except Exception as exc:
        if getattr(exc,'status_code',None)==409 and getattr(exc,'detail',None)=='Another request is processing this candidate. Retry shortly.':
            retry_at=now()+timedelta(seconds=2)
            await db['background_jobs'].update_one({'jobId':job['jobId'],'orgId':job['orgId'],'attempts':job['attempts']},
                {'$set':{'status':'deferred','runAfter':retry_at,'leaseUntil':None,'lastError':'Concurrent intake lease; retrying shortly.'}})
            return {'deferred':True,'run_after':retry_at,'error':'intake_busy'}
        raise
    finally:
        keepalive.cancel()
        try:
            await keepalive
        except asyncio.CancelledError:
            pass
        batch_id = job.get("payload", {}).get("batchId")
        if not batch_id and job.get("payload", {}).get("itemId"):
            item = await IntakeRepository(db).get_item(job["payload"]["itemId"], job["orgId"])
            batch_id = (item or {}).get("batchId")
        if batch_id:
            await IntakeRepository(db).refresh_summary(batch_id, job["orgId"])

logger = logging.getLogger(__name__)

Handler = Callable[[Any, dict[str, Any]], Awaitable[dict[str, Any]]]


async def _handle_resume_process(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    return await process_resume_file(db, org_id=job["orgId"], file_id=payload.get("fileId", ""),
                                     worker_job=job)


async def _handle_llm_complete(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    return await process_llm_followup(db, org_id=job["orgId"],
                                      file_id=str(payload.get("fileId", "")),
                                      application_id=str(payload.get("applicationId", "")),
                                      worker_job=job)


async def _handle_assessment_send(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    return await handle_assessment_send(db, job)


async def _handle_email_send(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    from .assessment_flow import _set_assessment

    outcome = await process_email_job(db, job)
    payload = job.get("payload") or {}
    application_id = str(payload.get("applicationId", ""))
    if not application_id:
        return outcome
    # Chain: only a REAL send moves the stage (dry-run records, never sends).
    if outcome.get("sent") == "zepto":
        actor = str(payload.get("actorUserId", "system"))
        try:
            await transition_application(
                db, org_id=job["orgId"], application_id=application_id,
                to_stage="ASSESSMENT_SENT", actor_user_id=actor,
                reason="Assessment invite sent to candidate.",
                metadata={"messageId": payload.get("messageId", "")},
            )
        except TransitionError as exc:
            logger.warning("Post-send transition skipped: %s", exc)
    elif outcome.get("failed") or outcome.get("refused"):
        # Back to link_created with a visible error so retry resumes at email.
        await _set_assessment(db, job["orgId"], application_id, {
            "state": "link_created",
            "emailError": str(outcome.get("failed") or outcome.get("refused")),
        })
    return outcome


async def _handle_assessment_sync(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    return await handle_assessment_sync(db, job)


async def _handle_whatsapp(db, job):
    from .whatsapp_invites import deliver
    return await deliver(db, job)


async def _handle_report_sync(db,job):
    from .reporting import sync_report
    return await sync_report(db,job)


HANDLERS: dict[str, Handler] = {
    "report_sync": _handle_report_sync,
    "whatsapp_invite": _handle_whatsapp,
    "resume_intake_import": _handle_intake,
    "resume_intake_parse": _handle_intake,
    "resume_intake_confirm": _handle_intake,
    "resume_intake_bulk_confirm": _handle_intake,
    "resume_intake_score_batch": _handle_intake,
    "resume_intake_score": _handle_intake,
    "resume_process": _handle_resume_process,
    "llm_complete": _handle_llm_complete,
    "assessment_send": _handle_assessment_send,
    "email_send": _handle_email_send,
    "assessment_sync": _handle_assessment_sync,
}


async def run_once(db: Any, kinds: list[str] | None = None, *, job_id: str | None = None) -> dict[str, Any] | None:
    from ..config import settings
    if settings.free_tier_guard_enabled and kinds and any(k.startswith('resume_intake_') for k in kinds):
        # One heavy intake operation across the import lane and Kafka consumer,
        # acquired BEFORE the job claim so a waiting job cannot lose its lease.
        loop = asyncio.get_running_loop()
        lock = getattr(loop, '_elitehr_intake_lock', None)
        if lock is None:
            lock = asyncio.Lock()
            setattr(loop, '_elitehr_intake_lock', lock)
        async with lock:
            from .capacity_guard import wait_for_capacity
            await wait_for_capacity()
            return await _execute_once(db, kinds, job_id=job_id)
    return await _execute_once(db, kinds, job_id=job_id)


async def _execute_once(db: Any, kinds: list[str] | None = None, *, job_id: str | None = None) -> dict[str, Any] | None:
    """Claim and run a single due job. Returns the job + outcome, or None."""
    repo = BackgroundJobRepository(db)
    job = await repo.claim_next(kinds, job_id=job_id)
    if job is None:
        return None
    handler = HANDLERS.get(job.get("kind", ""))
    if handler is None:
        await repo.fail(job["jobId"], f"Unknown job kind '{job.get('kind')}'.", retryable=False)
        return {"jobId": job["jobId"], "status": "dead", "error": "unknown kind"}
    try:
        result = await handler(db, job)
    except Exception as exc:  # noqa: BLE001 — job fails, worker lives
        logger.exception("Job %s failed", job["jobId"])
        status = await repo.fail(job["jobId"], f"{type(exc).__name__}", retryable=True)
        return {"jobId": job["jobId"], "status": status, "error": type(exc).__name__}
    if isinstance(result, dict) and result.get("deferred"):
        # The handler parked the job with repo.defer(): do NOT complete it.
        # Deferred jobs are reclaimed by claim_next when due — including
        # after a worker restart — so nothing is lost or duplicated.
        return {"jobId": job["jobId"], "status": "deferred",
                "runAfter": result.get("run_after"), "error": result.get("error")}
    await repo.complete(job["jobId"], result)
    return {"jobId": job["jobId"], "status": "done", "result": result}


async def run_forever(db: Any, poll_seconds: int = 5, kinds: list[str] | None = None) -> None:
    from ..config import settings as _settings

    stop = asyncio.Event()

    def _stop(*_args: Any) -> None:
        stop.set()

    try:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _stop)
            except (NotImplementedError, RuntimeError):
                pass
    except RuntimeError:
        pass
    logger.info("Worker started (poll %ss).", poll_seconds)
    import time as _time

    last_sweep = 0.0
    last_auto_close = 0.0
    while not stop.is_set():
        outcome = await run_once(db) if kinds is None else await run_once(db, kinds=kinds)
        if outcome is None:
            try:
                await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
            except asyncio.TimeoutError:
                pass
        now = _time.monotonic()
        if now - last_sweep >= max(60, _settings.assessment_sync_interval_s):
            last_sweep = now
            try:
                swept = await enqueue_sync_sweep(db, limit=_settings.assessment_sync_batch, force=False)
                if swept:
                    logger.info("Sync sweep enqueued %d applications.", swept)
            except Exception:  # noqa: BLE001 — sweep must not kill the worker
                logger.exception("Sync sweep failed")
        if now - last_auto_close >= max(10, _settings.jobs_auto_close_interval_s):
            last_auto_close = now
            try:
                from .auto_close import auto_close_due_jobs

                result = await auto_close_due_jobs(db)
                if result.get("closed"):
                    logger.info("Auto-close sweep closed %d job(s).", result["closed"])
            except Exception:  # noqa: BLE001 — sweep must not kill the worker
                logger.exception("Auto-close sweep failed")
    logger.info("Worker stopped.")
