"""Shared auto-close sweep: closes OPEN jobs whose closing boundary passed.

Used by BOTH the admin endpoint (org-scoped) and the background worker
(org-agnostic, periodic). Timezone interpretation (Slice 13): the stored
closesAt wall-clock boundary is localized with the org's IANA timezone.
Idempotent; atomic per-job claim (update_one guarded on lifecycleStatus)
makes it safe with multiple workers. Each closure audits actor
`system:auto-close` and queues the assignee-closed outbox notification.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        # mongomock and some drivers strip tzinfo; treat naive as UTC (the
        # documented interim convention) instead of assuming system-local.
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            return None
    return None


async def auto_close_due_jobs(
    db: Any, *, org_id: str | None = None, now: datetime | None = None
) -> dict[str, Any]:
    from ..models.hiring import AuditLogRepository
    from ..models.organization import OrganizationRepository, default_settings
    from .email_send import queue_job_closed

    now = now or _utcnow()
    repo = OrganizationRepository(db)
    if org_id is not None:
        org = await repo.get_by_org_id(org_id)
        # Missing org doc still gets the UTC fallback (interim default).
        orgs = [org] if org else [{"orgId": org_id, "settings": {}}]
    else:
        orgs = await repo.list_all(limit=500)

    closed: list[str] = []
    for org in orgs:
        org_settings = org.get("settings") or {}
        tz_name = org_settings.get("timezone") or default_settings()["timezone"]
        try:
            from zoneinfo import ZoneInfo

            org_tz = ZoneInfo(tz_name)
        except Exception:
            from zoneinfo import ZoneInfo

            org_tz = ZoneInfo("UTC")
        cursor = db["jobs"].find({
            "orgId": org["orgId"],
            "lifecycleStatus": "OPEN",
            "closesAt": {"$ne": None},
        })
        async for doc in cursor:
            closes_at = _coerce_dt(doc.get("closesAt"))
            if closes_at is None:
                continue
            wall = closes_at.astimezone(timezone.utc).replace(tzinfo=None)
            boundary = wall.replace(tzinfo=org_tz)
            if boundary > now:
                continue
            # Atomic claim: only the worker that flips OPEN→CLOSED audits.
            claim = await db["jobs"].update_one(
                {"_id": doc["_id"], "lifecycleStatus": "OPEN"},
                {"$set": {"lifecycleStatus": "CLOSED", "closedAt": now, "updatedAt": now}},
            )
            if claim.matched_count != 1:
                continue
            closed.append(str(doc.get("jobId")))
            await AuditLogRepository(db).log(
                org_id=org["orgId"],
                actor_user_id="system:auto-close",
                action="job.close",
                resource_type="job",
                resource_id=str(doc.get("jobId")),
                details={"from": "OPEN", "to": "CLOSED", "reason": "closing date reached"},
                ip_address="",
            )
            try:
                assignee_email = str(doc.get("assigneeEmail") or "")
                if assignee_email:
                    from ..models.user import UserRepository

                    user = await UserRepository(db).get_by_id(
                        str(doc.get("assigneeUserId") or ""), org["orgId"]
                    )
                    await queue_job_closed(
                        db,
                        org_id=org["orgId"],
                        job_id=str(doc.get("jobId")),
                        job_key=str(doc.get("jobKey", "")),
                        job_title=str(doc.get("title", "")),
                        to_email=assignee_email,
                        to_name=str((user or {}).get("name") or ""),
                    )
                else:
                    logger.info("Auto-close: no assignee email on job %s; skipped notification.", doc.get("jobId"))
            except Exception:  # noqa: BLE001 — notification best-effort
                logger.warning("Auto-close notification failed", exc_info=True)
    return {"closed": len(closed), "jobIds": closed}
