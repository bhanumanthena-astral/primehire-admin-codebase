"""MongoDB Atlas connection, index management, and health probing."""

from __future__ import annotations

import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def get_client(mongo_uri: str) -> AsyncIOMotorClient:
    """Return a shared Motor client (one per process)."""
    global _client
    if _client is None:
        # serverSelectionTimeoutMS keeps startup/health fast-failing instead of hanging.
        _client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=5000)
    return _client


def reset_client() -> None:
    """Test hook: drop the shared client so tests stay isolated."""
    global _client
    _client = None


def get_database(mongo_uri: str, db_name: str) -> AsyncIOMotorDatabase:
    return get_client(mongo_uri)[db_name]


async def ping(db: Any) -> bool:
    """True when MongoDB answers; False on any failure (never raises)."""
    try:
        # `db.command` exists on Motor, mongomock-motor, and pymongo DB objects.
        await db.command("ping")
        return True
    except Exception as exc:  # noqa: BLE001 — health must not raise
        logger.warning("MongoDB ping failed: %s", exc)
        return False


# Index specs per collection: (keys, kwargs). Kept next to the connection so
# startup and tests share one definition.
INDEXES: dict[str, list[tuple[list[tuple[str, int]], dict[str, Any]]]] = {
    "assessments": [
        ([("jobId", 1)], {"unique": True, "name": "uniq_jobId"}),
        ([("isActive", 1)], {"name": "by_isActive"}),
    ],
    "candidates": [
        ([("assessmentId", 1)], {"name": "by_assessmentId"}),
        ([("candidateKey", 1)], {"name": "by_candidateKey"}),
        ([("email", 1)], {"name": "by_email"}),
        # Partial (not sparse): only real string identifiers are indexed, so
        # any number of pre-link candidates may coexist. The previous sparse
        # unique indexes indexed explicit nulls and raised E11000 on the
        # second insert — see LEGACY_CANDIDATE_INDEXES migration below.
        ([("primehire.interviewId", 1)], {
            "unique": True,
            "partialFilterExpression": {
                "primehire.interviewId": {"$type": "string", "$ne": ""}
            },
            "name": "uniq_interviewId_v2",
        }),
        ([("primehire.responseId", 1)], {
            "unique": True,
            "partialFilterExpression": {
                "primehire.responseId": {"$type": "string", "$ne": ""}
            },
            "name": "uniq_responseId_v2",
        }),
    ],
    "reports": [
        ([("interviewId", 1)], {"unique": True, "name": "uniq_interviewId"}),
        ([("candidateId", 1)], {"name": "by_candidateId"}),
        ([("responseId", 1)], {"sparse": True, "name": "by_responseId"}),
        ([("status", 1)], {"name": "by_status"}),
        ([("updatedAt", -1)], {"name": "by_updatedAt"}),
    ],
    "templates": [
        ([("id", 1)], {"unique": True, "name": "uniq_templateId"}),
        ([("type", 1)], {"name": "by_type"}),
    ],
}


# Sparse unique indexes retired in favor of the partial v2 indexes above.
# They indexed explicit nulls, so the second pre-link candidate insert
# raised E11000. Dropped best-effort on startup (missing = already migrated).
LEGACY_CANDIDATE_INDEXES = ("uniq_interviewId", "uniq_responseId")


async def ensure_indexes(db: Any) -> dict[str, list[str]]:
    """Create all indexes (idempotent). Returns {collection: [index names]}."""
    created: dict[str, list[str]] = {}
    for collection, specs in INDEXES.items():
        if collection == "candidates":
            for legacy in LEGACY_CANDIDATE_INDEXES:
                try:
                    await db[collection].drop_index(legacy)
                    logger.info("Dropped legacy candidates index %s", legacy)
                except Exception as exc:  # noqa: BLE001 — absent = migrated
                    logger.debug("Legacy index %s not dropped (%s)", legacy, type(exc).__name__)
        names: list[str] = []
        for keys, kwargs in specs:
            names.append(await db[collection].create_index(keys, **kwargs))
        created[collection] = names
    return created
