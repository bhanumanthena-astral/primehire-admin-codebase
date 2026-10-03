"""LLM-run audit repository (hash of input, never content)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid


class LlmRunRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["llm_runs"]

    async def create(self, doc: dict[str, Any]) -> dict[str, Any]:
        record = dict(doc)
        record.setdefault("runId", uuid.uuid4().hex)
        record.setdefault("createdAt", datetime.now(timezone.utc))
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record
