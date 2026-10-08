"""One-time browser-localStorage import (Phase 2).

Safety rules:
- Never overwrites an existing Mongo document with different content
  (EXISTING_DIFFERENT -> conflict entry, no write).
- Restartable: re-running an identical payload inserts nothing.
- Mock records (int-*/res-* markers) are imported flagged isMock:true,
  never as production records.
- Portal passwords are stripped before validation (never stored/logged).
- No report documents are created here (reports backfill separately).
"""

from __future__ import annotations

import json
from typing import Any

from ..models.assessment import AssessmentRepository, to_public as asm_public
from ..models.candidate import CandidateRepository
from ..models.template import TemplateRepository
from ..schemas.assessment import AssessmentIn
from ..schemas.candidate import CandidateIn
from ..schemas.template import TemplateIn
from .candidate_service import (
    is_genuine_uuid,
    is_real_interview_id,
    is_real_response_id,
    looks_mock,
)

try:
    from pymongo.errors import DuplicateKeyError as _DuplicateKeyError
except ImportError:  # pragma: no cover — pymongo always present with motor
    _DuplicateKeyError = Exception  # type: ignore[assignment,misc]

MIGRATION_VERSION = 1

# Frontend-only fields with no Mongo counterpart (dropped on import).
_UI_ONLY_CANDIDATE_FIELDS = {
    "linkGenerated",
    "linkValue",
    "candidateStatus",  # mirrors `status`
    "interviewExpired",  # derivable from endTime
}

# Mock-only payloads: kept for mock records, stripped from real ones.
_MOCK_ONLY_FIELDS = {"answers", "simulatedReport"}

_SYNC_KEYS = (
    "submittedDate",
    "assessmentStatus",
    "reportStatus",
    "inviteSent",
    "inviteSentAt",
    "lastInviteSentAt",
    "lastReminderSentAt",
    "reminderCount",
    "mailStatus",
)

_VOLATILE_KEYS = {"_id", "id", "mongoId", "createdAt", "updatedAt", "origin", "migrationMeta", "importedBy",
                  # candidateKey is a browser-generated surrogate: two testers'
                  # browsers mint different keys for the same real person, so
                  # identity comparison uses (assessmentId, email) instead.
                  "candidateKey",
                  # Soft-delete lifecycle markers (mirrors assessments): stored
                  # as null on live docs, absent from incoming payloads — never
                  # content. Deleted docs never match as "existing identical".
                  "deletedAt", "deletedBy"}


def canonical(doc: dict[str, Any]) -> str:
    """Stable comparison form (volatile/meta keys excluded)."""
    clean = {k: v for k, v in doc.items() if k not in _VOLATILE_KEYS}
    return json.dumps(clean, sort_keys=True, default=str)


def _comparable(doc: dict[str, Any]) -> dict[str, Any]:
    """Normalize storage-shaped differences before comparison: pruned vs
    null-filled primehire blocks, and email case/whitespace. Matching already
    normalizes; this keeps equality consistent with matching."""
    out = dict(doc)
    prime = out.get("primehire")
    if isinstance(prime, dict):
        pruned = {k: v for k, v in prime.items() if v not in (None, "")}
        if pruned:
            out["primehire"] = pruned
        else:
            out.pop("primehire", None)
    if "email" in out:
        out["email"] = _norm_email(out.get("email"))
    return out


def map_frontend_candidate(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, bool]]:
    """Flat browser Candidate -> Mongo candidate document (pre-validation).

    Returns (doc, flags) where flags records password/simulated-data stripping.
    Raises KeyError/TypeError naturally on malformed input (caller classifies).
    """
    src = dict(raw)
    flags = {"passwordStripped": False, "simulatedStripped": False}
    if "password" in src:
        flags["passwordStripped"] = True
    src.pop("password", None)
    src.pop("rowLoading", None)
    for key in _UI_ONLY_CANDIDATE_FIELDS:
        src.pop(key, None)

    interview_id = src.pop("interviewId", None)
    response_id = src.pop("responseId", None)
    raw_uuid = src.get("verifiedCandidateUUID")

    # Demo payload present? (rule 3 — explicit simulator data)
    has_demo_payload = "simulatedReport" in src or (
        isinstance(src.get("answers"), dict)
        and any(isinstance(a, str) and "Simulated response" in a for a in src["answers"].values())
    ) or bool(src.get("isMock", False))

    is_mock = looks_mock(interview_id, response_id, raw_uuid, has_demo_payload) or bool(
        src.get("isMock", False)
    )

    for key in _MOCK_ONLY_FIELDS:
        if key in src and not is_mock:
            flags["simulatedStripped"] = True
            src.pop(key, None)

    sync_state = {k: src.pop(k, None) for k in _SYNC_KEYS}
    if sync_state.get("reminderCount") is None:
        sync_state["reminderCount"] = 0

    # Unresolved fallbacks are nulled operationally; originals kept as audit-only
    # metadata (never used for API calls, lookup, regeneration, or matching).
    migration_meta: dict[str, Any] = {"unresolvedResponseId": None, "unresolvedCandidateUUID": None}
    if response_id and not is_real_response_id(response_id):
        migration_meta["unresolvedResponseId"] = response_id
        response_id = None
    candidate_uuid = src.get("verifiedCandidateUUID")
    if candidate_uuid and not is_genuine_uuid(candidate_uuid):
        migration_meta["unresolvedCandidateUUID"] = candidate_uuid
        candidate_uuid = None

    doc = {
        "candidateKey": src.pop("id", None),
        "assessmentId": src.get("assessmentId"),
        "name": src.get("name"),
        # Normalized (strip + lowercase) so matching, dedupe and comparison
        # treat case/whitespace variants as the same person.
        "email": _norm_email(src.get("email")),
        "phone": src.get("phone", ""),
        "startTime": src.get("startTime", ""),
        "endTime": src.get("endTime", ""),
        "link": src.get("link"),
        "assignedDate": src.get("assignedDate"),
        "status": src.get("status", "ACTIVE"),
        "primehire": {
            "interviewId": interview_id,
            "responseId": response_id,
            "candidateUUID": candidate_uuid,
        },
        "syncState": sync_state,
        "migrationMeta": migration_meta,
        "origin": "local-import",
        "isMock": is_mock,
    }
    # Preserve mock-only payloads on mock records (clearly flagged, never reports).
    for key in _MOCK_ONLY_FIELDS:
        if key in src:
            doc[key] = src[key]
    return doc, flags


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


async def find_existing_candidate(col: Any, mapped: dict[str, Any]) -> dict | None:
    """Stable-identifier lookup order: interviewId -> UUID -> candidateKey ->
    (assessmentId + normalized email) fallback."""
    prime = mapped.get("primehire") or {}
    interview_id = prime.get("interviewId")
    if is_real_interview_id(interview_id):
        found = await col.find_one({"primehire.interviewId": interview_id})
        if found:
            return found
    uuid = prime.get("candidateUUID")
    if uuid:
        found = await col.find_one({"primehire.candidateUUID": uuid})
        if found:
            return found
    key = mapped.get("candidateKey")
    if key:
        found = await col.find_one({"candidateKey": key})
        if found:
            return found
    if mapped.get("assessmentId") and _norm_email(mapped.get("email")):
        wanted = _norm_email(mapped.get("email"))
        cursor = col.find({"assessmentId": mapped["assessmentId"]}, {"email": 1})
        async for row in cursor:
            if _norm_email(row.get("email")) == wanted:
                return await col.find_one({"_id": row["_id"]})
    return None


def _label(prefix: str, index: int, record: Any, fallback: str) -> str:
    if isinstance(record, dict):
        for key in ("jobId", "email", "id", "candidateKey"):
            if record.get(key):
                return f"{prefix}[{index}]:{key}={record[key]}"
    return f"{prefix}[{index}]:{fallback}"


def _classify_against_existing(existing_public: dict[str, Any], incoming_doc: dict[str, Any]) -> str:
    """NEW/identical/different without writing. Compares canonical forms only."""
    if not existing_public:
        return "NEW"
    normalized = _comparable(dict(incoming_doc))
    for key in ("id", "mongoId"):
        if key in existing_public:
            normalized[key] = existing_public[key]
    return "EXISTING_IDENTICAL" if canonical(_comparable(existing_public)) == canonical(normalized) else "EXISTING_DIFFERENT"


async def dry_run(db: Any, payload: dict[str, Any], tester: str | None = None) -> dict[str, Any]:
    """Validate + classify WITHOUT writing. Returns the summary (dryRun: true)."""
    asm_repo = AssessmentRepository(db)
    cand_col = db["candidates"]
    tmpl_repo = TemplateRepository(db)

    summary: dict[str, Any] = {
        "dryRun": True,
        "migrationVersion": MIGRATION_VERSION,
        "tester": tester,
        "assessments": {"total": 0, "valid": 0, "duplicates": 0, "conflicts": 0, "invalid": 0},
        "candidates": {
            "total": 0, "valid": 0, "mock": 0,
            "duplicates": 0, "conflicts": 0, "invalid": 0,
            "passwordsSkipped": 0, "simulatedDataStripped": 0,
        },
        "templates": {"total": 0, "valid": 0, "duplicates": 0, "conflicts": 0, "invalid": 0},
        "conflicts": [],
        "errors": [],
    }

    for i, raw in enumerate(payload.get("assessments") or []):
        summary["assessments"]["total"] += 1
        try:
            data = AssessmentIn.model_validate(raw)
            doc = data.to_doc()
            existing = await asm_repo.get_by_job_and_round(doc["jobId"], doc.get("roundType"))
            if not existing:
                summary["assessments"]["valid"] += 1
            elif _classify_against_existing(existing, asm_public(doc)) == "EXISTING_IDENTICAL":
                summary["assessments"]["duplicates"] += 1
            else:
                summary["assessments"]["conflicts"] += 1
                summary["conflicts"].append(
                    {"kind": "assessment", "jobId": doc["jobId"],
                     "reason": "MongoDB and localStorage contain different values"}
                )
        except Exception as exc:  # noqa: BLE001 — collected, not raised
            summary["assessments"]["invalid"] += 1
            summary["errors"].append({"record": _label("assessment", i, raw, "unparseable"), "error": str(exc)[:300]})

    backfill_eligible = 0
    for i, raw in enumerate(payload.get("candidates") or []):
        summary["candidates"]["total"] += 1
        try:
            if not isinstance(raw, dict):
                raise ValueError("candidate must be an object")
            mapped, flags = map_frontend_candidate(raw)
            if flags["passwordStripped"]:
                summary["candidates"]["passwordsSkipped"] += 1
            if flags["simulatedStripped"]:
                summary["candidates"]["simulatedDataStripped"] += 1
            data = CandidateIn.model_validate(mapped)  # full validation, no writes
            doc = data.to_doc()
            if is_backfill_eligible_doc(doc):
                backfill_eligible += 1
            existing = await find_existing_candidate(cand_col, doc)
            verdict = _classify_against_existing(existing or {}, doc)
            if doc.get("isMock"):
                summary["candidates"]["mock"] += 1
                if verdict == "EXISTING_DIFFERENT":
                    summary["candidates"]["conflicts"] += 1
                    summary["conflicts"].append(
                        {"kind": "candidate", "candidateKey": doc.get("candidateKey"),
                         "reason": "MongoDB and localStorage contain different values (mock record)"}
                    )
            elif verdict == "NEW":
                summary["candidates"]["valid"] += 1
            elif verdict == "EXISTING_IDENTICAL":
                summary["candidates"]["duplicates"] += 1
            else:
                summary["candidates"]["conflicts"] += 1
                summary["conflicts"].append(
                    {"kind": "candidate", "candidateKey": doc.get("candidateKey"),
                     "reason": "MongoDB and localStorage contain different values"}
                )
        except Exception as exc:  # noqa: BLE001
            summary["candidates"]["invalid"] += 1
            summary["errors"].append({"record": _label("candidate", i, raw, "unparseable"), "error": str(exc)[:300]})

    for i, raw in enumerate(payload.get("templates") or []):
        summary["templates"]["total"] += 1
        try:
            data = TemplateIn.model_validate(raw)
            doc = data.to_doc()
            existing = await tmpl_repo.get_by_template_id(doc["id"])
            if not existing:
                summary["templates"]["valid"] += 1
            elif _classify_against_existing(existing, doc) == "EXISTING_IDENTICAL":
                summary["templates"]["duplicates"] += 1
            else:
                summary["templates"]["conflicts"] += 1
                summary["conflicts"].append(
                    {"kind": "template", "templateId": doc["id"],
                     "reason": "MongoDB and localStorage contain different values"}
                )
        except Exception as exc:  # noqa: BLE001
            summary["templates"]["invalid"] += 1
            summary["errors"].append({"record": _label("template", i, raw, "unparseable"), "error": str(exc)[:300]})

    summary["reportsEligibleForBackfill"] = backfill_eligible
    return summary


async def count_backfill_eligible(db: Any) -> int:
    """Candidates with GENERATED status + a real (non-mock) interviewId (DB state)."""
    cursor = db["candidates"].find(
        {
            "syncState.reportStatus": "GENERATED",
            "primehire.interviewId": {"$exists": True, "$ne": None},
        }
    )
    count = 0
    async for doc in cursor:
        interview_id = (doc.get("primehire") or {}).get("interviewId") or ""
        if is_real_interview_id(interview_id):
            count += 1
    return count


def is_backfill_eligible_doc(mapped: dict[str, Any]) -> bool:
    """Payload/doc-level eligibility: GENERATED + real interviewId (pre-import preview)."""
    sync = mapped.get("syncState") or {}
    interview_id = (mapped.get("primehire") or {}).get("interviewId")
    return sync.get("reportStatus") == "GENERATED" and is_real_interview_id(interview_id)


async def run_import(db: Any, payload: dict[str, Any], tester: str | None = None) -> dict[str, Any]:
    """Validated import with per-record counts. Restartable (no duplicates).

    Inserts are stamped origin="local-import" plus importedBy=tester when a
    tester name is supplied. Existing documents are never overwritten.
    """
    asm_repo = AssessmentRepository(db)
    cand_repo = CandidateRepository(db)
    cand_col = db["candidates"]
    tmpl_repo = TemplateRepository(db)

    result: dict[str, Any] = {
        "dryRun": False,
        "migrationVersion": MIGRATION_VERSION,
        "tester": tester,
        "assessments": {"received": 0, "inserted": 0, "existing": 0, "conflicts": 0, "invalid": 0},
        "candidates": {
            "received": 0, "inserted": 0, "existing": 0, "conflicts": 0,
            "mock": 0, "invalid": 0, "passwordsSkipped": 0, "simulatedDataStripped": 0,
        },
        "templates": {"received": 0, "inserted": 0, "existing": 0, "conflicts": 0, "invalid": 0},
        "conflicts": [],
        "errors": [],
    }

    def _stamp(doc: dict[str, Any]) -> dict[str, Any]:
        doc.setdefault("origin", "local-import")
        if tester:
            doc["importedBy"] = tester
        return doc

    for i, raw in enumerate(payload.get("assessments") or []):
        section = result["assessments"]
        section["received"] += 1
        try:
            data = AssessmentIn.model_validate(raw)
            doc = data.to_doc()
            existing = await asm_repo.get_by_job_and_round(doc["jobId"], doc.get("roundType"))
            if not existing:
                try:
                    await asm_repo.create(_stamp(doc))
                except _DuplicateKeyError:
                    # Occupant invisible to matching (e.g. soft-deleted):
                    # conflict, never overwrite, never crash the batch.
                    section["conflicts"] += 1
                    result["conflicts"].append(
                        {"kind": "assessment", "jobId": doc["jobId"],
                         "reason": "Unique index occupant exists (possibly soft-deleted)"}
                    )
                    continue
                section["inserted"] += 1
            elif canonical(_comparable(existing)) == canonical(_comparable(asm_public(doc))):
                # canonical() excludes volatile keys (incl. id/_id/timestamps)
                section["existing"] += 1
            else:
                section["conflicts"] += 1
                result["conflicts"].append(
                    {"kind": "assessment", "jobId": doc["jobId"],
                     "reason": "MongoDB and localStorage contain different values"}
                )
        except Exception as exc:  # noqa: BLE001
            section["invalid"] += 1
            result["errors"].append({"record": _label("assessment", i, raw, "unparseable"), "error": str(exc)[:300]})

    for i, raw in enumerate(payload.get("candidates") or []):
        section = result["candidates"]
        section["received"] += 1
        try:
            if not isinstance(raw, dict):
                raise ValueError("candidate must be an object")
            mapped, flags = map_frontend_candidate(raw)
            if flags["passwordStripped"]:
                section["passwordsSkipped"] += 1
            if flags["simulatedStripped"]:
                section["simulatedDataStripped"] += 1
            data = CandidateIn.model_validate(mapped)
            doc = data.to_doc()
            existing = await find_existing_candidate(cand_col, doc)
            if not existing:
                await cand_repo.create(_stamp(doc))
                section["inserted"] += 1
                if doc.get("isMock"):
                    section["mock"] += 1
            elif canonical(_comparable(existing)) == canonical(_comparable({**doc, "id": existing.get("id")})):
                section["existing"] += 1
                if doc.get("isMock"):
                    section["mock"] += 1
            else:
                section["conflicts"] += 1
                result["conflicts"].append(
                    {"kind": "candidate", "candidateKey": doc.get("candidateKey"),
                     "reason": "MongoDB and localStorage contain different values"}
                )
        except Exception as exc:  # noqa: BLE001
            section["invalid"] += 1
            result["errors"].append({"record": _label("candidate", i, raw, "unparseable"), "error": str(exc)[:300]})

    for i, raw in enumerate(payload.get("templates") or []):
        section = result["templates"]
        section["received"] += 1
        try:
            data = TemplateIn.model_validate(raw)
            doc = data.to_doc()
            existing = await tmpl_repo.get_by_template_id(doc["id"])
            if not existing:
                await tmpl_repo.create(_stamp(doc))
                section["inserted"] += 1
            elif canonical(_comparable(existing)) == canonical(_comparable({**doc, "mongoId": existing.get("mongoId")})):
                section["existing"] += 1
            else:
                section["conflicts"] += 1
                result["conflicts"].append(
                    {"kind": "template", "templateId": doc["id"],
                     "reason": "MongoDB and localStorage contain different values"}
                )
        except Exception as exc:  # noqa: BLE001
            section["invalid"] += 1
            result["errors"].append({"record": _label("template", i, raw, "unparseable"), "error": str(exc)[:300]})

    result["reportsEligibleForBackfill"] = await count_backfill_eligible(db)
    return result
