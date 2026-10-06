"""003 - Migrate jobs to the requisition lifecycle (PRD Jobs module).

Converts pre-lifecycle job documents to the new shape:
- ``status`` (open/on_hold/closed/filled) -> ``lifecycleStatus``
  (DRAFT/OPEN/ON_HOLD/CLOSED/ARCHIVED); ``filled`` becomes CLOSED with
  positionsFilled = positionsTotal.
- Backfills new requisition fields with honest defaults (nothing invented:
  counts start at 1/0, keywords at [], JD text from the legacy description).
- Creates the new jobs indexes from the shared INDEXES spec and drops the
  retired ``by_orgId_status`` index (also retired at startup).

Idempotent: documents that already carry ``lifecycleStatus`` are skipped.
BACKUP REMINDER: snapshot Atlas / mongodump before applying to a real
database. Run with --dry-run first.
"""

from __future__ import annotations

import html
import logging
from typing import Any

logger = logging.getLogger(__name__)

STATUS_TO_LIFECYCLE = {
    "open": "OPEN",
    "on_hold": "ON_HOLD",
    "closed": "CLOSED",
    "filled": "CLOSED",
}

JD_MIN_CHARS = 50


def _backfill(doc: dict[str, Any]) -> dict[str, Any]:
    """Build the $set patch for one legacy job document (no writes here)."""
    old_status = str(doc.get("status") or "open")
    patch: dict[str, Any] = {
        "lifecycleStatus": STATUS_TO_LIFECYCLE.get(old_status, "OPEN"),
        "positionsTotal": 1,
        "positionsFilled": 1 if old_status == "filled" else 0,
        "keywords": list(doc.get("keywords") or []),
    }
    legacy_desc = str(doc.get("description") or "")
    patch["jdText"] = legacy_desc
    if legacy_desc:
        patch["jdHtml"] = "<p>" + html.escape(legacy_desc) + "</p>"
    else:
        patch["jdHtml"] = ""
    if old_status == "closed" or old_status == "filled":
        patch.setdefault("closedAt", doc.get("updatedAt") or doc.get("createdAt"))
    return patch


async def upgrade(db: Any) -> dict[str, Any]:
    report: dict[str, Any] = {"migrated": 0, "skipped": 0, "created": [], "dropped": []}

    cursor = db["jobs"].find({})
    async for doc in cursor:
        if doc.get("lifecycleStatus") and doc.get("positionsTotal") is not None:
            report["skipped"] += 1
            continue
        patch = _backfill(doc)
        # Never overwrite fields a newer writer may already have set.
        patch = {k: v for k, v in patch.items() if k not in doc}
        if not patch:
            report["skipped"] += 1
            continue
        await db["jobs"].update_one({"_id": doc["_id"]}, {"$set": patch})
        report["migrated"] += 1

    for legacy in ("by_orgId_status",):
        try:
            await db["jobs"].drop_index(legacy)
            report["dropped"].append(f"jobs.{legacy}")
        except Exception as exc:  # noqa: BLE001 - absent = migrated
            logger.debug("Legacy index jobs.%s not dropped (%s)", legacy, type(exc).__name__)

    from app.db.mongodb import INDEXES

    for keys, kwargs in INDEXES.get("jobs", []):
        try:
            name = await db["jobs"].create_index(keys, **kwargs)
            report["created"].append(f"jobs.{name}")
        except Exception as exc:  # noqa: BLE001 - report, don't half-apply silently
            logger.warning("Index %s on jobs not created: %s", kwargs.get("name"), type(exc).__name__)
            report.setdefault("errors", []).append(f"jobs.{kwargs.get('name')}: {type(exc).__name__}")

    return report
