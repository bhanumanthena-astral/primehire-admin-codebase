"""Diagnostics: outbox + worker visibility (Slice C).

Rules: lists never include bodies; the single-message view decrypts the
body ONLY for dry-run records (real sends are wiped on success). The
allowlist is reported as configured/not — never its values.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..models.jobs import BackgroundJobRepository
from ..models.outbox import EmailOutboxRepository
from ..security.deps import CurrentUser, get_current_user, require_permission, get_db
from ..services.outbox_crypto import decrypt_body

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["diagnostics"])


@router.get("/email-mode")
async def email_mode(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Lightweight flag for UI banners (any authenticated user)."""
    _ = current_user
    return {"dryRun": bool(settings.email_dry_run)}


@router.get("/diagnostics")
async def get_diagnostics(
    current_user: CurrentUser = Depends(require_permission("audit.view")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    outbox = EmailOutboxRepository(db)
    jobs = BackgroundJobRepository(db)
    failed_outbox = await outbox.list_meta(current_user.org_id, status="failed", limit=20)
    dead_jobs = await jobs.list_by_org(current_user.org_id, status="dead", limit=20)
    return {
        "dryRun": bool(settings.email_dry_run),
        "allowlistConfigured": bool(settings.test_recipient_allowlist),
        "outbox": await outbox.counts_by_status(current_user.org_id),
        "failedOutbox": failed_outbox,
        "deadJobs": dead_jobs,
    }


@router.get("/diagnostics/outbox/{message_id}")
async def get_outbox_message(
    message_id: str,
    current_user: CurrentUser = Depends(require_permission("audit.view")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = EmailOutboxRepository(db)
    msg = await repo.get(message_id, current_user.org_id, include_body=True)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found.")
    body: str | None = None
    # Dry-run records only: real sends are wiped, pending real-mode bodies
    # stay encrypted at rest and are never displayed.
    if msg.get("sentVia") == "dry_run" and msg.get("payloadEncrypted"):
        try:
            body = decrypt_body(str(msg["payloadEncrypted"]))
        except Exception:  # noqa: BLE001
            body = None
    msg.pop("payloadEncrypted", None)
    msg["body"] = body
    return msg


@router.post("/diagnostics/outbox/{message_id}/retry")
async def retry_outbox_message(
    message_id: str,
    current_user: CurrentUser = Depends(require_permission("audit.view")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = EmailOutboxRepository(db)
    if not await repo.requeue(message_id, current_user.org_id):
        raise HTTPException(status_code=404, detail="Only failed messages can be retried.")
    return {"messageId": message_id, "status": "pending"}


@router.post("/diagnostics/jobs/{job_id}/retry")
async def retry_job(
    job_id: str,
    current_user: CurrentUser = Depends(require_permission("audit.view")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    repo = BackgroundJobRepository(db)
    if not await repo.requeue(job_id, current_user.org_id):
        raise HTTPException(status_code=404, detail="Only dead/failed jobs can be retried.")
    return {"jobId": job_id, "status": "pending"}
