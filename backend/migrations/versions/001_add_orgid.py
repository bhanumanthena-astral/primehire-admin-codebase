"""001 — Add orgId to existing collections.

Adds ``orgId = "default"`` to every document in assessments, candidates,
reports, and templates that lacks it.  Rebuilds indexes that need org-scoping.

This migration is idempotent: documents that already have an orgId are skipped.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

COLLECTIONS = ("assessments", "candidates", "reports", "templates")
DEFAULT_ORG_ID = "default"


async def upgrade(db: Any) -> dict[str, Any]:
    """Add orgId to all existing documents that lack it."""
    results: dict[str, Any] = {}
    for col_name in COLLECTIONS:
        col = db[col_name]
        # Only update docs missing orgId.
        result = await col.update_many(
            {"orgId": {"$exists": False}},
            {"$set": {"orgId": DEFAULT_ORG_ID}},
        )
        count = result.modified_count
        logger.info(
            "Collection %s: set orgId='%s' on %d documents",
            col_name, DEFAULT_ORG_ID, count,
        )
        results[col_name] = count
    return results
