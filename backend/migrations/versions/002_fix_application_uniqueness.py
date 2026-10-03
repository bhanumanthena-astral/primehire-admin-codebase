"""002 — Fix applications uniqueness to partial + add Phase 2 indexes.

Replaces the global ``uniq_job_applicant`` unique index on ``applications``
with the partial ``uniq_active_application`` index that permits a new
application for the same (orgId, jobId, applicantId) only after REJECTED or
WITHDRAWN. HIRED and TALENT_POOL still block duplicates.

Also creates the Phase 2 collections' indexes (resume_batches, resume_files,
background_jobs, email_outbox, llm_runs) and the new applicant indexes.

BACKUP REMINDER: take an Atlas snapshot or `mongodump` export before applying
this migration to a real database. Run with --dry-run first and review the
report. See docs/DECISIONS.md Phase 2 §7.

Idempotent: safe to re-run; index creation uses the shared INDEXES spec.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def upgrade(db: Any) -> dict[str, Any]:
    """Apply the index fix. Returns a dry-run-style report of what changed."""
    logger.warning(
        "BACKUP REMINDER: snapshot/export your database before migration 002 "
        "touches real data. Run --dry-run first."
    )
    report: dict[str, Any] = {"dropped": [], "created": [], "activeDuplicates": 0}

    # Detect active duplicates that would violate the new partial index.
    # Group by (orgId, jobId, applicantId) among non-terminal stages.
    pipeline = [
        {"$match": {"currentStage": {"$nin": ["REJECTED", "WITHDRAWN"]}}},
        {
            "$group": {
                "_id": {
                    "orgId": "$orgId",
                    "jobId": "$jobId",
                    "applicantId": "$applicantId",
                },
                "count": {"$sum": 1},
            }
        },
        {"$match": {"count": {"$gt": 1}}},
    ]
    dupes = 0
    try:
        async for _ in db["applications"].aggregate(pipeline):
            dupes += 1
    except Exception:  # noqa: BLE001 — mongomock may lack aggregate; count manually
        seen: dict[tuple, int] = {}
        try:
            async for doc in db["applications"].find(
                {"currentStage": {"$nin": ["REJECTED", "WITHDRAWN"]}}
            ):
                key = (doc.get("orgId"), doc.get("jobId"), doc.get("applicantId"))
                seen[key] = seen.get(key, 0) + 1
            dupes = sum(1 for c in seen.values() if c > 1)
        except Exception:
            dupes = -1  # unknown; index creation will surface real conflicts
    report["activeDuplicates"] = dupes
    if dupes > 0:
        logger.warning(
            "Found %d duplicate active application groups; resolve before "
            "creating the partial unique index.",
            dupes,
        )

    # Drop the old global unique index (best-effort: absent = already migrated).
    for legacy in ("uniq_job_applicant",):
        try:
            await db["applications"].drop_index(legacy)
            report["dropped"].append(f"applications.{legacy}")
        except Exception as exc:  # noqa: BLE001 — absent = migrated
            logger.debug("Legacy index applications.%s not dropped (%s)", legacy, type(exc).__name__)

    # Create new/changed indexes from the shared spec (idempotent).
    from app.db.mongodb import INDEXES

    for collection in ("applications", "applicants", "resume_batches", "resume_files",
                       "background_jobs", "email_outbox", "llm_runs"):
        for keys, kwargs in INDEXES.get(collection, []):
            try:
                name = await db[collection].create_index(keys, **kwargs)
                report["created"].append(f"{collection}.{name}")
            except Exception as exc:  # noqa: BLE001 — report, don't half-apply silently
                logger.warning("Index %s on %s not created: %s", kwargs.get("name"), collection, type(exc).__name__)
                report.setdefault("errors", []).append(f"{collection}.{kwargs.get('name')}: {type(exc).__name__}")

    return report
