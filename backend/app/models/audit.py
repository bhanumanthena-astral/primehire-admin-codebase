"""Audit log: who created/changed what (append-only, never updated/deleted)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def log(
    db: Any,
    *,
    action: str,
    entity: str,
    entity_id: str,
    by: str = "unknown",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Append an audit entry. Never raises (audit must not break writes)."""
    entry = {
        "action": action,
        "entity": entity,
        "entityId": entity_id,
        "by": by,
        "details": details or {},
        "at": utcnow(),
    }
    try:
        result = await db["audit_logs"].insert_one(entry)
        entry["_id"] = result.inserted_id
    except Exception:  # noqa: BLE001 — audit is best-effort
        pass
    return entry


async def ensure_audit_indexes(db: Any) -> list[str]:
    """Indexes for audit_logs (kept separate from INDEXES, like idempotency)."""
    names: list[str] = []
    names.append(
        await db["audit_logs"].create_index(
            [("entity", 1), ("entityId", 1)], name="by_entity"
        )
    )
    names.append(
        await db["audit_logs"].create_index([("at", -1)], name="by_at")
    )
    return names
