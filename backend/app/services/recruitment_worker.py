"""Dedicated bounded recruitment outbox/reminder worker. No assessment dispatch."""

import asyncio
import json
import logging
from html import escape
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from ..config import settings
from ..models.outbox import EmailOutboxRepository
from ..models.recruitment import RecruitmentRepository, lease, now, aware
from .outbox_crypto import encrypt_body, decrypt_body
from .recruitment_mail import send_via_zepto, recipient_allowed, EmailSendError, dry_run
from .recruitment import finish_pending, finalize_review

logger = logging.getLogger(__name__)


def encrypt_recruitment_body(body):
    if not settings.recruitment_outbox_encryption_key:
        return encrypt_body(body)
    from cryptography.fernet import Fernet
    return Fernet(settings.recruitment_outbox_encryption_key.strip().encode()).encrypt(body.encode()).decode()


def decrypt_recruitment_body(body):
    if not settings.recruitment_outbox_encryption_key:
        return decrypt_body(body)
    from cryptography.fernet import Fernet
    return Fernet(settings.recruitment_outbox_encryption_key.strip().encode()).decrypt(body.encode()).decode()


class RecruitmentOutbox(EmailOutboxRepository):
    def __init__(self, db):
        self.coll = db["recruit_email_outbox"]


def invitation_html(row, name, purpose):
    stamp = (
        aware(row["startsAt"])
        .astimezone(ZoneInfo("Asia/Kolkata"))
        .strftime("%d %B %Y, %I:%M %p IST")
    )
    end = (
        aware(row["endsAt"])
        .astimezone(ZoneInfo("Asia/Kolkata"))
        .strftime("%I:%M %p IST")
    )
    heading = (
        "Your interview invitation"
        if purpose == "candidate"
        else (
            "Interview reminder"
            if purpose == "reminder"
            else "An interview has been assigned to you"
        )
    )
    link = (
        f'<p><a href="{escape(row["meetingLink"],quote=True)}">Join the meeting</a></p>'
        if row.get("meetingLink")
        else ""
    )
    return f'<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:28px"><h1>{heading}</h1><p>Dear {escape(name)},</p><p>{"Congratulations on progressing to the next interview stage." if purpose=="candidate" else "Please review the assigned candidate in your hiring workspace."}</p><h2>{escape(row.get("jobTitle","Job"))}</h2><p><strong>{escape(row["round"].title())} interview</strong><br>{stamp} – {end}</p>{link}<p>{escape(row.get("location", ""))}</p><p>Please be available at the scheduled time. Contact your recruiter if you need to reschedule.</p><p>Regards,<br>{escape(settings.email_from_name or "Recruitment team")}</p></div>'


async def enqueue_email(db, row, purpose):
    recipient = (
        await db["applicants" if purpose == "candidate" else "users"].find_one(
            {
                "orgId": row["orgId"],
                "applicantId" if purpose == "candidate" else "userId": (
                    row["applicantId"]
                    if purpose == "candidate"
                    else row["interviewerId"]
                ),
            }
        )
        or {}
    )
    email = recipient.get("email", "")
    if "@" not in email or email.endswith("@placeholder.local"):
        raise ValueError("A valid recipient email is required")
    subject = f'{"Interview reminder" if purpose=="reminder" else "Interview invitation"} — {row.get("jobTitle","Job")}'
    rendered = invitation_html(row, recipient.get("name", "Candidate"), purpose)
    if purpose != "candidate":
        candidate = await db["applicants"].find_one({"orgId": row["orgId"], "applicantId": row["applicantId"]}, {"name": 1}) or {}
        rendered = rendered.replace("<h2>", f'<p><strong>Candidate:</strong> {escape(candidate.get("name", "Candidate"))}</p><h2>', 1)
    body = json.dumps(
        {
            "to": email,
            "html": rendered,
        }
    )
    msg = await RecruitmentOutbox(db).enqueue(
        org_id=row["orgId"],
        kind=f"recruit_{purpose}",
        entity_type="recruit_interview",
        entity_key=row["interviewId"],
        to_email=email,
        to_name=recipient.get("name", ""),
        subject=subject,
        payload_encrypted=encrypt_recruitment_body(body),
        dedupe_key=f'{row["orgId"]}:{row["interviewId"]}:{row.get("scheduleRevision",1)}:{purpose}',
    )
    await db["recruit_email_outbox"].update_one(
        {"orgId": row["orgId"], "messageId": msg["messageId"]},
        {"$set": {"interviewRevision": row.get("scheduleRevision", 1)}},
    )
    return msg


async def deliver(db, msg):
    repo = RecruitmentOutbox(db)
    org = msg["orgId"]
    key = msg["messageId"]
    row = await db["recruit_interviews"].find_one(
        {"orgId": org, "interviewId": msg["entityKey"]}
    )
    if (
        not row
        or row["status"] != "scheduled"
        or row.get("scheduleRevision", 1) != msg.get("interviewRevision")
        or aware(row["endsAt"]) <= now()
        or (msg.get("kind") == "recruit_reminder" and aware(row["startsAt"]) <= now())
    ):
        await repo.coll.update_one(
            {"orgId": org, "messageId": key},
            {
                "$set": {
                    "status": "cancelled",
                    "lastError": "Schedule is no longer current",
                }
            },
        )
        return
    try:
        body = json.loads(decrypt_recruitment_body(msg["payloadEncrypted"]))
    except Exception:
        await repo.mark_failed(
            key, org, "Encrypted email payload unavailable", retryable=False
        )
        return
    await repo.mark_sending(key, org)
    if dry_run():
        await repo.mark_sent(key, org, via="dry_run", wipe=False)
        return
    if not recipient_allowed(body["to"]):
        await repo.mark_failed(
            key, org, "Recipient is outside the test allowlist", retryable=False
        )
        return
    try:
        await send_via_zepto(
            body["to"], msg.get("toName", ""), msg["subject"], body["html"]
        )
    except EmailSendError as exc:
        status = getattr(exc,'status_code',None)
        permanent = isinstance(status,int) and 400 <= status < 500 and status != 429
        codes = getattr(exc,'provider_codes',[])
        await repo.mark_failed(
            key, org, f"Email provider refused message (HTTP {status}; codes {','.join(codes)})" if permanent else "Email provider unavailable; retry scheduled", retryable=not permanent
        )
        return
    await repo.mark_sent(key, org, via="zepto", wipe=True)


async def tick(db):
    from .google_calendar import tick as sync_google_calendar
    await sync_google_calendar(db)
    from .talent import tick as match_talent
    await match_talent(db)
    for review in [
        r async for r in db["recruit_reviews"].find({"applied": False}).limit(25)
    ]:
        try:
            async with lease(
                db,
                review["orgId"],
                [
                    f'app:{review["applicationId"]}',
                    f'interview:{review["interviewId"]}',
                ],
            ):
                await finalize_review(db, review)
        except Exception:
            logger.warning(
                "Locked review reconciliation deferred",
                extra={"interviewId": review["interviewId"]},
            )
    rows = [
        r
        async for r in db["recruit_interviews"]
        .find({"pendingTransition": {"$exists": True}})
        .limit(25)
    ]
    for row in rows:
        try:
            async with lease(
                db,
                row["orgId"],
                [f'app:{row["applicationId"]}', f'interview:{row["interviewId"]}'],
            ):
                await finish_pending(db, row)
        except Exception:
            logger.warning(
                "Recruitment transition reconciliation deferred",
                extra={"interviewId": row["interviewId"]},
            )
    query = {
        "status": "scheduled",
        "$or": [
            {"assignmentEmailQueued": False},
            {"candidateEmailRequested": True, "candidateEmailQueued": {"$ne": True}},
            {
                "reminderQueued": False,
                "reminderAt": {"$lte": now()},
                "startsAt": {"$gt": now()},
            },
        ],
    }
    for row in [r async for r in db["recruit_interviews"].find(query).limit(50)]:
        try:
            async with lease(db, row["orgId"], [f'interview:{row["interviewId"]}']):
                row = await RecruitmentRepository(db, row["orgId"]).interview(
                    row["interviewId"]
                )
                if row["status"] != "scheduled":
                    continue
                changes = {}
                if not row.get("assignmentEmailQueued"):
                    await enqueue_email(db, row, "assignment")
                    changes["assignmentEmailQueued"] = True
                    await RecruitmentRepository(db, row["orgId"]).notify(
                        row["interviewerId"],
                        f'{row["interviewId"]}:{row.get("scheduleRevision",1)}:assigned',
                        "interview_assigned",
                        row["interviewId"],
                        row["applicationId"],
                    )
                if row.get("candidateEmailRequested") and not row.get(
                    "candidateEmailQueued"
                ):
                    await enqueue_email(db, row, "candidate")
                    changes["candidateEmailQueued"] = True
                if not row.get("reminderQueued") and aware(
                    row["reminderAt"]
                ) <= now() < aware(row["startsAt"]):
                    await enqueue_email(db, row, "reminder")
                    changes["reminderQueued"] = True
                    await RecruitmentRepository(db, row["orgId"]).notify(
                        row["interviewerId"],
                        f'{row["interviewId"]}:{row["revision"]}:reminder',
                        "interview_reminder",
                        row["interviewId"],
                        row["applicationId"],
                    )
                if changes:
                    await db["recruit_interviews"].update_one(
                        {
                            "orgId": row["orgId"],
                            "interviewId": row["interviewId"],
                            "revision": row["revision"],
                        },
                        {"$set": changes, "$unset": {"deliveryError": ""}},
                    )
        except Exception as exc:
            if not isinstance(exc, HTTPException):
                await db["recruit_interviews"].update_one(
                    {"orgId": row["orgId"], "interviewId": row["interviewId"]},
                    {
                        "$set": {
                            "deliveryError": "Notification setup unavailable; check email configuration"
                        }
                    },
                )
    for row in [
        r
        async for r in db["recruit_interviews"]
        .find(
            {
                "reviewDecision": "hold",
                "followUpAt": {"$lte": now()},
                "followUpQueued": {"$ne": True},
            }
        )
        .limit(25)
    ]:
        repo = RecruitmentRepository(db, row["orgId"])
        await repo.notify(
            row["interviewerId"],
            f'{row["interviewId"]}:followup',
            "hold_follow_up",
            row["interviewId"],
            row["applicationId"],
        )
        owner = (
            await db["jobs"].find_one({"orgId": row["orgId"], "jobId": row["jobId"]})
            or {}
        )
        await repo.notify(
            owner.get("assigneeUserId"),
            f'{row["interviewId"]}:followup',
            "hold_follow_up",
            row["interviewId"],
            row["applicationId"],
        )
        await db["recruit_interviews"].update_one(
            {"orgId": row["orgId"], "interviewId": row["interviewId"]},
            {"$set": {"followUpQueued": True}},
        )
    # A crashed send is retried after its lease window; provider delivery is at-least-once.
    from datetime import timedelta

    await db["recruit_email_outbox"].update_many(
        {"status": "sending", "updatedAt": {"$lt": now() - timedelta(minutes=3)}},
        {"$set": {"status": "pending", "nextRetryAt": now()}},
    )
    for msg in [
        m
        async for m in db["recruit_email_outbox"]
        .find({"status": "pending", "nextRetryAt": {"$lte": now()}})
        .limit(25)
    ]:
        try:
            async with lease(db, msg["orgId"], [f'interview:{msg["entityKey"]}']):
                fresh = await RecruitmentOutbox(db).get(
                    msg["messageId"], msg["orgId"], include_body=True
                )
                if fresh and fresh["status"] == "pending":
                    await deliver(db, fresh)
        except HTTPException:
            continue
    await db["recruit_leases"].update_one(
        {"_id": "recruit-worker-heartbeat"},
        {"$set": {"expiresAt": now() + timedelta(seconds=60), "healthyAt": now()}},
        upsert=True,
    )


async def run(db):
    if (
        not settings.recruitment_portals_enabled
        or settings.mongodb_database != "primehire_admin_v2"
    ):
        raise RuntimeError(
            "Recruitment worker requires the V2 database and explicit enablement"
        )
    while True:
        try:
            await tick(db)
        except Exception:
            logger.warning(
                "Recruitment worker cycle failed; retrying without logging payloads"
            )
        await asyncio.sleep(5)
