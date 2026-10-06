"""Assessment-invite email: render → gate → outbox → Zepto (Slice C).

Safety order per message:
1. Render (subject has no link/password; body has them once).
2. Dry-run? Record as sent-via-dry_run. Never call Zepto.
3. Allowlist (non-production real sends only): refuse off-list recipients.
4. Zepto with timeout + retries; log IDs/status/latency only — never the
   recipient address unmasked, never any body.
5. Wipe the encrypted body after a REAL send (password gone for good).
"""

from __future__ import annotations

import json
import logging
import random
from typing import Any

import httpx

from ..config import settings
from ..models.outbox import EmailOutboxRepository
from .outbox_crypto import decrypt_body, encrypt_body, OutboxCryptoError

logger = logging.getLogger(__name__)

ZEPTO_URL = "https://api.zeptomail.in/v1.1/email"


class EmailSendError(Exception):
    """Safe message (no addresses, no bodies)."""


def recipient_allowed(email: str) -> bool:
    """True if a REAL send to this address is permitted in this env."""
    if settings.is_production:
        return True
    addr = (email or "").strip().lower()
    for entry in settings.test_recipient_allowlist:
        if "@" in entry and addr == entry:
            return True
        if entry.startswith("@") and addr.endswith(entry):
            return True
    return False


def render_assessment_invite(
    *,
    candidate_name: str,
    link: str,
    password: str | None,
    job_title: str,
    window_text: str,
) -> dict[str, str]:
    subject = f"Your assessment invitation — {job_title}"
    access = (
        f"<p>Access password: <strong>{password}</strong></p>"
        if password else ""
    )
    html = (
        f"<p>Dear {candidate_name},</p>"
        f"<p>You are invited to complete the online assessment for "
        f"<strong>{job_title}</strong>.</p>"
        f"<p>Start here: <a href=\"{link}\">{link}</a></p>"
        f"{access}"
        f"<p>{window_text}</p>"
        f"<p>Good luck,<br>{settings.email_from_name}</p>"
    )
    return {"subject": subject, "html": html}


async def queue_assessment_invite(
    db: Any,
    *,
    org_id: str,
    application_id: str,
    to_email: str,
    to_name: str,
    link: str,
    password: str | None,
    job_title: str,
    window_text: str,
) -> dict[str, Any]:
    """Render + encrypt + enqueue (idempotent on dedupe). Never sends here."""
    rendered = render_assessment_invite(
        candidate_name=to_name, link=link, password=password,
        job_title=job_title, window_text=window_text,
    )
    body = json.dumps({"to": to_email, "subject": rendered["subject"], "html": rendered["html"]})
    repo = EmailOutboxRepository(db)
    return await repo.enqueue(
        org_id=org_id,
        kind="assessment_invite",
        entity_type="application",
        entity_key=application_id,
        to_email=to_email,
        to_name=to_name,
        subject=rendered["subject"],
        payload_encrypted=encrypt_body(body),
        dedupe_key=f"assessment_invite:application:{application_id}",
    )


async def queue_job_assignment(
    db: Any,
    *,
    org_id: str,
    job_id: str,
    job_key: str,
    job_title: str,
    to_email: str,
    to_name: str,
    assignee_user_id: str,
) -> dict[str, Any]:
    """Notify a (re)assigned job owner via the existing outbox channel.

    Same render → encrypt → enqueue pattern as assessment invites, then
    chain into the EXISTING `email_send` background job so the standard
    worker delivers through ZeptoMail (outbox → worker → ZeptoMail).
    No new channel, no new retry logic: delivery, backoff, and dedupe
    reuse the outbox + background_jobs infrastructure verbatim.
    Dedupe key covers the (job, assignee) pair so repeats are
    idempotent. Raises OutboxCryptoError when no encryption key is
    configured — callers treat notification as best-effort and must not
    fail the job write.
    """
    subject = f"You have been assigned a job — {job_title} ({job_key})"
    html = (
        f"<p>Dear {to_name},</p>"
        f"<p>You have been assigned as the owner of <strong>{job_title}</strong> "
        f"({job_key}).</p>"
        f"<p>Please review the requisition and its applications.</p>"
        f"<p>Good luck,<br>{settings.email_from_name}</p>"
    )
    body = json.dumps({"to": to_email, "subject": subject, "html": html})
    repo = EmailOutboxRepository(db)
    msg = await repo.enqueue(
        org_id=org_id,
        kind="job_assigned",
        entity_type="job",
        entity_key=job_id,
        to_email=to_email,
        to_name=to_name,
        subject=subject,
        payload_encrypted=encrypt_body(body),
        dedupe_key=f"job_assigned:job:{job_id}:{assignee_user_id}",
    )
    # Chain into the existing worker path (same as assessment invites).
    # The generic `email_send` handler delivers by messageId; with no
    # applicationId it performs no stage transition — pure delivery.
    # Best-effort: an enqueue failure here must never fail the job write
    # (the caller already guards), but log for diagnostics.
    try:
        from ..models.jobs import BackgroundJobRepository

        queue = BackgroundJobRepository(db)
        await queue.enqueue(
            org_id=org_id,
            kind="email_send",
            entity_type="outbox_message",
            entity_key=str(msg.get("messageId", "")),
            payload={"messageId": str(msg.get("messageId", "")),
                      "jobId": job_id},
            dedupe_key=f"email_send:outbox:{msg.get('messageId', '')}",
        )
    except Exception:  # noqa: BLE001 — outbox row already durable; worker sweep covers
        logger.warning("Job-assignment email_send enqueue failed", exc_info=True)
    return msg


async def queue_job_closed(
    db: Any,
    *,
    org_id: str,
    job_id: str,
    job_key: str,
    job_title: str,
    to_email: str,
    to_name: str,
) -> dict[str, Any]:
    """Notify the job's owner that the job auto-closed (outbox, idempotent
    on job_id). Mirrors queue_job_assignment; delivery via the same
    email_send worker path and EMAIL_DRY_RUN gate."""
    subject = f"Job closed automatically — {job_title} ({job_key})"
    html = (
        f"<p>Dear {to_name},</p>"
        f"<p>The job <strong>{job_title}</strong> ({job_key}) has been closed "
        f"automatically because its closing date/time was reached.</p>"
        f"<p>Good luck,<br>{settings.email_from_name}</p>"
    )
    body = json.dumps({"to": to_email, "subject": subject, "html": html})
    repo = EmailOutboxRepository(db)
    msg = await repo.enqueue(
        org_id=org_id,
        kind="job_closed",
        entity_type="job",
        entity_key=job_id,
        to_email=to_email,
        to_name=to_name,
        subject=subject,
        payload_encrypted=encrypt_body(body),
        dedupe_key=f"job_closed:job:{job_id}",
    )
    try:
        from ..models.jobs import BackgroundJobRepository

        queue = BackgroundJobRepository(db)
        await queue.enqueue(
            org_id=org_id,
            kind="email_send",
            entity_type="outbox_message",
            entity_key=str(msg.get("messageId", "")),
            payload={"messageId": str(msg.get("messageId", "")), "jobId": job_id},
            dedupe_key=f"email_send:outbox:{msg.get('messageId', '')}",
        )
    except Exception:  # noqa: BLE001
        logger.warning("job_closed email_send enqueue failed", exc_info=True)
    return msg


async def send_via_zepto(to_email: str, to_name: str, subject: str, html_body: str) -> str:
    """POST to ZeptoMail. Returns upstream id. Retries 3×, never logs PII."""
    payload = {
        "from": {"address": settings.email_from_address.strip(),
                 "name": settings.email_from_name.strip()},
        "to": [{"email_address": {"address": to_email.strip(), "name": (to_name or "").strip()}}],
        "subject": subject,
        "htmlbody": html_body,
    }
    last_error = "send failed"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    ZEPTO_URL,
                    json=payload,
                    # Same convention as the working Express relay (server.ts).
                    headers={"Accept": "application/json", "Content-Type": "application/json",
                             "Authorization": settings.zeptomail_api_key.strip()},
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = type(exc).__name__
            logger.warning("Zepto attempt %d failed: %s", attempt + 1, type(exc).__name__)
            await _sleep_backoff(attempt)
            continue
        logger.info("Zepto attempt %d status=%s", attempt + 1, resp.status_code)
        if 200 <= resp.status_code < 300:
            try:
                return str(resp.json().get("message", "sent"))
            except ValueError:
                return "sent"
        last_error = f"http_{resp.status_code}"
        if resp.status_code in (401, 403):
            raise EmailSendError("Email provider rejected the credentials.")
        if 400 <= resp.status_code < 500:
            raise EmailSendError(f"Email provider refused the message ({resp.status_code}).")
        await _sleep_backoff(attempt)
    raise EmailSendError(f"Email provider unavailable ({last_error}).")


async def _sleep_backoff(attempt: int) -> None:
    import asyncio

    await asyncio.sleep(min(60, 2 ** attempt) + random.uniform(0, 2))


async def process_email_job(db: Any, job: dict[str, Any]) -> dict[str, Any]:
    """Worker handler for `email_send`: gate → send → wipe. Returns outcome."""
    payload = job.get("payload") or {}
    message_id = str(payload.get("messageId", ""))
    org_id = job["orgId"]
    repo = EmailOutboxRepository(db)
    msg = await repo.get(message_id, org_id, include_body=True)
    if not msg:
        return {"skipped": "message not found"}
    if msg.get("status") == "sent":
        return {"skipped": "already sent"}
    if not msg.get("payloadEncrypted"):
        await repo.mark_failed(message_id, org_id, "Body already wiped; cannot resend.", retryable=False)
        return {"failed": "body wiped"}

    try:
        body = json.loads(decrypt_body(str(msg["payloadEncrypted"])))
    except Exception as exc:  # noqa: BLE001 — crypto/config errors are not PII
        await repo.mark_failed(message_id, org_id, f"{type(exc).__name__}", retryable=False)
        return {"failed": type(exc).__name__}

    to_email = str(body.get("to", ""))
    await repo.mark_sending(message_id, org_id)

    if settings.email_dry_run:
        await repo.mark_sent(message_id, org_id, via="dry_run", wipe=False)
        logger.info("Outbox %s recorded (dry-run, not sent).", message_id)
        return {"recorded": "dry_run"}

    if not recipient_allowed(to_email):
        await repo.mark_failed(message_id, org_id, "Recipient not on test allowlist.", retryable=False)
        logger.info("Outbox %s refused (allowlist).", message_id)
        return {"refused": "allowlist"}

    try:
        upstream_id = await send_via_zepto(
            to_email, str(msg.get("toName", "")), str(msg.get("subject", "")),
            str(body.get("html", "")))
    except EmailSendError as exc:
        status = await repo.mark_failed(message_id, org_id, str(exc), retryable=True,
                                         max_attempts=int(msg.get("maxAttempts", 5)))
        return {"failed": str(exc), "status": status}
    await repo.mark_sent(message_id, org_id, via="zepto", wipe=True)
    logger.info("Outbox %s sent via Zepto (upstream=%s).", message_id, upstream_id)
    return {"sent": "zepto"}


def audit_safe_details(msg: dict[str, Any]) -> dict[str, Any]:
    """Details safe for audit_log: IDs + masked recipient only, never bodies."""
    return {"messageId": msg.get("messageId"), "kind": msg.get("kind"),
            "toMasked": msg.get("toMasked"), "subject": msg.get("subject")}
