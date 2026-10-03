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
from .pipeline import process_resume_file
from .transitions import TransitionError, transition_application

logger = logging.getLogger(__name__)

Handler = Callable[[Any, dict[str, Any]], Awaitable[dict[str, Any]]]


async def _handle_resume_process(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    return await process_resume_file(db, org_id=job["orgId"], file_id=payload.get("fileId", ""))


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


HANDLERS: dict[str, Handler] = {
    "resume_process": _handle_resume_process,
    "assessment_send": _handle_assessment_send,
    "email_send": _handle_email_send,
    "assessment_sync": _handle_assessment_sync,
}


async def run_once(db: Any, kinds: list[str] | None = None) -> dict[str, Any] | None:
    """Claim and run a single due job. Returns the job + outcome, or None."""
    repo = BackgroundJobRepository(db)
    job = await repo.claim_next(kinds)
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
    await repo.complete(job["jobId"], result)
    return {"jobId": job["jobId"], "status": "done", "result": result}


async def run_forever(db: Any, poll_seconds: int = 5) -> None:
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
    while not stop.is_set():
        outcome = await run_once(db)
        if outcome is None:
            try:
                await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
            except asyncio.TimeoutError:
                pass
        now = _time.monotonic()
        if now - last_sweep >= max(60, _settings.assessment_sync_interval_s):
            last_sweep = now
            try:
                swept = await enqueue_sync_sweep(db, limit=_settings.assessment_sync_batch)
                if swept:
                    logger.info("Sync sweep enqueued %d applications.", swept)
            except Exception:  # noqa: BLE001 — sweep must not kill the worker
                logger.exception("Sync sweep failed")
    logger.info("Worker stopped.")
