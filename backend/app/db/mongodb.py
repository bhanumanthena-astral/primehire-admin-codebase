"""MongoDB Atlas connection, index management, and health probing."""

from __future__ import annotations

import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def get_client(mongo_uri: str) -> Any:
    """Return a shared Motor client (one per process)."""
    global _client
    if _client is None:
        if mongo_uri.startswith("mongomock://"):
            import mongomock_motor
            _client = mongomock_motor.AsyncMongoMockClient()
        else:
            # serverSelectionTimeoutMS keeps startup/health fast-failing instead of hanging.
            _client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=5000)
    return _client


def set_fallback_mock_client(db_name: str) -> Any:
    """Fallback to in-memory mock client when MongoDB is unreachable in local dev."""
    global _client
    import mongomock_motor
    _client = mongomock_motor.AsyncMongoMockClient()
    return _client[db_name]



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
#
# Org-scoped indexes: assessments, candidates, templates carry orgId prefix
# on indexes that were previously global. Reports stay globally keyed by
# upstream interviewId (they are unique across the PrimeHire system).
INDEXES: dict[str, list[tuple[list[tuple[str, int]], dict[str, Any]]]] = {
    "organizations": [
        ([(  "orgId", 1)], {"unique": True, "name": "uniq_orgId"}),
    ],
    "assessments": [
        ([("orgId", 1), ("jobId", 1)], {"unique": True, "name": "uniq_org_jobId"}),
        ([("orgId", 1), ("isActive", 1)], {"name": "by_org_isActive"}),
    ],
    "candidates": [
        ([("orgId", 1), ("assessmentId", 1)], {"name": "by_org_assessmentId"}),
        ([("orgId", 1), ("candidateKey", 1)], {"name": "by_org_candidateKey"}),
        ([("orgId", 1), ("email", 1)], {"name": "by_org_email"}),
        # Partial (not sparse): only real string identifiers are indexed, so
        # any number of pre-link candidates may coexist. The previous sparse
        # unique indexes indexed explicit nulls and raised E11000 on the
        # second insert — see LEGACY_CANDIDATE_INDEXES migration below.
        ([(  "primehire.interviewId", 1)], {
            "unique": True,
            "partialFilterExpression": {
                "primehire.interviewId": {"$type": "string", "$ne": ""}
            },
            "name": "uniq_interviewId_v2",
        }),
        ([(  "primehire.responseId", 1)], {
            "unique": True,
            "partialFilterExpression": {
                "primehire.responseId": {"$type": "string", "$ne": ""}
            },
            "name": "uniq_responseId_v2",
        }),
    ],
    "reports": [
        ([(  "interviewId", 1)], {"unique": True, "name": "uniq_interviewId"}),
        ([(  "candidateId", 1)], {"name": "by_candidateId"}),
        ([(  "responseId", 1)], {"sparse": True, "name": "by_responseId"}),
        ([(  "status", 1)], {"name": "by_status"}),
        ([(  "updatedAt", -1)], {"name": "by_updatedAt"}),
    ],
    "templates": [
        ([("orgId", 1), ("id", 1)], {"unique": True, "name": "uniq_org_templateId"}),
        ([("orgId", 1), ("type", 1)], {"name": "by_org_type"}),
    ],
    "migrations": [
        ([(  "version", 1)], {"unique": True, "name": "uniq_version"}),
    ],
    "users": [
        ([(  "userId", 1)], {"unique": True, "name": "uniq_userId"}),
        ([("orgId", 1), ("email", 1)], {"unique": True, "name": "uniq_org_email"}),
        ([("orgId", 1)], {"name": "by_orgId"}),
    ],
    "sessions": [
        ([(  "sessionId", 1)], {"unique": True, "name": "uniq_sessionId"}),
        ([(  "userId", 1)], {"name": "by_userId"}),
        ([(  "expiresAt", 1)], {"expireAfterSeconds": 0, "name": "ttl_expiresAt"}),
    ],
    "login_attempts": [
        ([(  "key", 1)], {"unique": True, "name": "uniq_key"}),
        ([(  "expiresAt", 1)], {"expireAfterSeconds": 0, "name": "ttl_expiresAt"}),
    ],
    "invitations": [
        ([(  "tokenHash", 1)], {"unique": True, "name": "uniq_tokenHash"}),
        ([(  "userId", 1)], {"name": "by_userId"}),
        ([(  "expiresAt", 1)], {"expireAfterSeconds": 0, "name": "ttl_expiresAt"}),
    ],
    "jobs": [
        ([("orgId", 1), ("jobKey", 1)], {"unique": True, "name": "uniq_org_jobKey"}),
        ([("orgId", 1), ("status", 1)], {"name": "by_orgId_status"}),
    ],
    "applicants": [
        ([(  "applicantId", 1)], {"unique": True, "name": "uniq_applicantId"}),
        ([("orgId", 1), ("email", 1)], {"unique": True, "name": "uniq_org_email"}),
        ([("orgId", 1), ("phoneDigits", 1)], {"name": "by_org_phonedigits"}),
        ([("orgId", 1), ("resume.parsedJson.skills", 1)], {"name": "by_org_skill"}),
    ],
    "applications": [
        ([(  "applicationId", 1)], {"unique": True, "name": "uniq_applicationId"}),
        # Partial unique: a new application for the same (org, applicant, job)
        # is allowed only after REJECTED or WITHDRAWN. HIRED and TALENT_POOL
        # still block duplicates (approved adjustment 3). Re-score, don't
        # duplicate, below-threshold re-uploads for the same job.
        ([("orgId", 1), ("jobId", 1), ("applicantId", 1)], {
            "unique": True,
            "name": "uniq_active_application",
            "partialFilterExpression": {
                "currentStage": {"$nin": ["REJECTED", "WITHDRAWN"]}
            },
        }),
        ([("orgId", 1), ("jobId", 1)], {"name": "by_org_job"}),
        ([("orgId", 1), ("currentStage", 1)], {"name": "by_org_stage"}),
        ([(  "candidateKey", 1)], {"sparse": True, "name": "by_candidateKey"}),
    ],
    "stage_history": [
        ([(  "historyId", 1)], {"unique": True, "name": "uniq_historyId"}),
        ([(  "applicationId", 1)], {"name": "by_applicationId"}),
    ],
    "audit_log": [
        ([(  "auditId", 1)], {"unique": True, "name": "uniq_auditId"}),
        ([("orgId", 1), ("createdAt", -1)], {"name": "by_org_created"}),
        ([("resourceType", 1), ("resourceId", 1)], {"name": "by_resource"}),
    ],
    # --- Phase 2 collections ---
    "resume_batches": [
        ([(  "batchId", 1)], {"unique": True, "name": "uniq_batchId"}),
        ([("orgId", 1), ("createdAt", -1)], {"name": "by_org_created"}),
    ],
    "resume_files": [
        ([(  "fileId", 1)], {"unique": True, "name": "uniq_fileId"}),
        ([("orgId", 1), ("batchId", 1)], {"name": "by_org_batch"}),
        ([("orgId", 1), ("contentHash", 1)], {"name": "by_org_hash"}),
    ],
    "background_jobs": [
        ([(  "jobId", 1)], {"unique": True, "name": "uniq_jobId"}),
        ([(  "dedupeKey", 1)], {"unique": True, "name": "uniq_dedupeKey"}),
        ([(  "status", 1), ("runAfter", 1)], {"name": "by_status_runAfter"}),
    ],
    "email_outbox": [
        ([(  "messageId", 1)], {"unique": True, "name": "uniq_messageId"}),
        ([(  "dedupeKey", 1)], {"unique": True, "name": "uniq_dedupeKey"}),
        ([(  "status", 1), ("nextRetryAt", 1)], {"name": "by_status_nextRetry"}),
    ],
    "llm_runs": [
        ([("orgId", 1), ("createdAt", -1)], {"name": "by_org_created"}),
    ],
}

# Old indexes that must be retired — best-effort drop on startup.
LEGACY_INDEXES: dict[str, tuple[str, ...]] = {
    "candidates": ("uniq_interviewId", "uniq_responseId"),
    # Pre-org-scoping global indexes:
    "assessments": ("uniq_jobId", "by_isActive"),
    "templates": ("uniq_templateId", "by_type"),
    # Pre-Phase-2 global application uniqueness (replaced by partial
    # uniq_active_application allowing re-apply after REJECTED/WITHDRAWN):
    "applications": ("uniq_job_applicant",),
    # Raw-phone index replaced by canonical phoneDigits lookup:
    "applicants": ("by_org_phone",),
}


async def ensure_indexes(db: Any) -> dict[str, list[str]]:
    """Create all indexes (idempotent). Returns {collection: [index names]}."""
    created: dict[str, list[str]] = {}
    for collection, specs in INDEXES.items():
        # Drop legacy indexes first (missing = already migrated).
        for legacy in LEGACY_INDEXES.get(collection, ()):
            try:
                await db[collection].drop_index(legacy)
                logger.info("Dropped legacy %s index %s", collection, legacy)
            except Exception as exc:  # noqa: BLE001 — absent = migrated
                logger.debug(
                    "Legacy index %s.%s not dropped (%s)",
                    collection, legacy, type(exc).__name__,
                )
        names: list[str] = []
        for keys, kwargs in specs:
            names.append(await db[collection].create_index(keys, **kwargs))
        created[collection] = names
    return created
