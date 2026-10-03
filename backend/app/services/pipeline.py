"""Slice B pipeline: file → parse → LLM score → keyword score → applicant /
application create-or-rescore → stage transition → batch recompute.

Runs inside the background worker (one `resume_process` job per file), never
in the request path. LLM output is advisory: it feeds the score breakdown,
while stage moves are human-rule transitions with recorded reasons.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from ..models.hiring import (
    ApplicantRepository,
    ApplicationRepository,
    JobRepository,
    Stage,
    StageHistoryRepository,
)
from ..models.organization import OrganizationRepository, default_settings
from ..models.resume import ResumeBatchRepository, ResumeFileRepository
from ..schemas.resume import BatchStatus, FileStatus
from ..services.pii import phone_digits_variants
from .assessment_flow import maybe_autosend
from .llm import detect_injection, score_candidate
from .resume_parse import ParseFailed, ParseTimeout, parse_bytes_isolated
from .scoring import DISAGREEMENT_FLAG_AT, combine, get_scoring_weights, keyword_score
from .storage import read_bytes
from .transitions import transition_application

logger = logging.getLogger(__name__)

RECONTACT_MONTHS = 6


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def process_resume_file(db: Any, *, org_id: str, file_id: str) -> dict[str, Any]:
    """Run the full per-file pipeline. Returns a summary (never raises fatally)."""
    files = ResumeFileRepository(db)
    fdoc = await files.get(file_id, org_id)
    if not fdoc:
        return {"skipped": "file not found"}
    if fdoc.get("status") == FileStatus.QUARANTINED.value:
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"skipped": "quarantined"}

    jobs = JobRepository(db)
    job = await jobs.get_by_id(fdoc.get("jobId", ""), org_id)
    if not job:
        await files.update(file_id, org_id, {"status": FileStatus.FAILED.value,
                                              "error": "Job was removed."})
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"failed": "job removed"}

    try:
        data = read_bytes(fdoc["storageKey"])
    except (ValueError, OSError):
        await files.update(file_id, org_id, {"status": FileStatus.FAILED.value,
                                              "error": "Stored file is missing."})
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"failed": "stored file missing"}

    kind = fdoc.get("kind", "pdf")
    try:
        result = parse_bytes_isolated(data, kind)
    except (ParseTimeout, ParseFailed) as exc:
        await files.update(file_id, org_id, {"status": FileStatus.FAILED.value,
                                              "error": str(exc)})
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"failed": str(exc)}

    raw_text: str = result.get("rawText", "")
    parsed: dict[str, Any] = result.get("parsed", {})

    from ..schemas.parsed_resume import ParsedResume

    structured = ParsedResume.model_validate(parsed).model_dump()
    # Legacy .doc uses lossy strings extraction → human review, never silent.
    structured["lowConfidence"] = kind == "doc"
    await files.update(file_id, org_id, {
        "status": FileStatus.PARSED.value,
        "rawTextChars": len(raw_text),
        "parsedJson": structured,
    })

    injection = detect_injection(raw_text)
    if injection:
        # Never call the LLM on injection-suspect input; deterministic only.
        from .llm import LlmOutcome

        llm_out = LlmOutcome(injection_suspected=True, llm_unavailable=True,
                             reasons=["Prompt-injection pattern detected; LLM score skipped."])
    else:
        llm_out = await score_candidate(
            db, org_id,
            parsed=structured,
            raw_text=raw_text,
            job_reqs={
                "title": job.get("title", ""),
                "mustHaveSkills": job.get("mustHaveSkills") or [],
                "niceToHaveSkills": job.get("niceToHaveSkills") or [],
                "minExperienceYears": job.get("minExperienceYears"),
                "maxExperienceYears": job.get("maxExperienceYears"),
            },
            output_ref=f"file:{file_id}",
        )
    if injection:
        llm_out.injection_suspected = True

    kw = keyword_score(raw_text=raw_text, parsed=structured, job=job)
    org_repo = OrganizationRepository(db)
    org = await org_repo.get_by_org_id(org_id)
    org_settings = (org or {}).get("settings") or default_settings()
    kw_w, llm_w = get_scoring_weights(org_settings)
    combo = combine(keyword=kw["score"],
                    llm_score=None if (llm_out.injection_suspected or llm_out.llm_score is None)
                    else llm_out.llm_score,
                    keyword_weight=kw_w, llm_weight=llm_w)

    threshold = int(job.get("matchThreshold", 60))
    review_reasons: list[str] = []
    if kw["knockout"]:
        review_reasons.append(f"knockout: missing {', '.join(kw['knockoutMissing'])}")
    if combo["disagreement"] >= DISAGREEMENT_FLAG_AT:
        review_reasons.append(f"llm/keyword disagreement {combo['disagreement']}pts")
    if llm_out.injection_suspected:
        review_reasons.append("possible prompt injection in resume")
    if structured.get("lowConfidence"):
        review_reasons.append("low-confidence parse (legacy .doc)")
    if not structured.get("email"):
        review_reasons.append("missing contact email")
    needs_review = len(review_reasons) > 0

    breakdown = {
        "keyword": kw["score"], "matched": kw["matched"], "missing": kw["missing"],
        "niceMatched": kw["niceMatched"], "niceMissing": kw["niceMissing"],
        "knockout": kw["knockout"], "knockoutMissing": kw["knockoutMissing"],
        "expNote": kw["expNote"], "scoreVersion": kw["scoreVersion"],
        "llm": llm_out.llm_score, "llmReasons": llm_out.reasons,
        "llmUnavailable": llm_out.llm_unavailable,
        "injectionSuspected": llm_out.injection_suspected,
        "lowConfidence": structured.get("lowConfidence", False),
        "disagreement": combo["disagreement"], "llmUsed": combo["llmUsed"],
        "weights": combo["weights"], "threshold": threshold,
        "final": combo["final"],
    }

    applicants = ApplicantRepository(db)
    email = (structured.get("email") or "").strip().lower()
    if not email:
        email = f"no-email-{file_id}@placeholder.local"
    applicant = await applicants.get_by_email(email, org_id)
    if applicant is None:
        retention_days = int((org_settings.get("retentionDays") or 365))
        applicant = await applicants.create({
            "orgId": org_id,
            "email": email,
            "name": structured.get("name") or "Unknown Candidate",
            "phone": structured.get("phone") or "",
            "phoneDigits": phone_digits_variants(structured.get("phone") or ""),
            "resume": {
                "fileId": file_id,
                "fileName": fdoc.get("fileName", ""),
                "parsedJson": structured,
            },
            "consent": {"given": True, "source": "hr_upload", "textVersion": "v1",
                        "givenAt": _utcnow().isoformat()},
            "retentionUntil": (_utcnow() + timedelta(days=retention_days)).isoformat(),
            "tags": [],
        })
    else:
        # Latest parse wins for the stored resume snapshot.
        await applicants.update(applicant["applicantId"], {
            "resume": {"fileId": file_id, "fileName": fdoc.get("fileName", ""),
                       "parsedJson": structured},
        }, org_id)

    possible_dup = False
    phone = structured.get("phone") or ""
    if phone:
        for other in await applicants.find_by_phone(phone, org_id):
            if other.get("email", "").lower() != email.lower():
                possible_dup = True
                break
    if possible_dup and "possible duplicate (phone match, email differs)" not in review_reasons:
        review_reasons.append("possible duplicate (phone match, email differs)")
        needs_review = True
    if possible_dup:
        await applicants.update(applicant["applicantId"], {"possibleDuplicate": True}, org_id)

    applications = ApplicationRepository(db)
    existing = await applications.find_active_for_pair(job["jobId"], applicant["applicantId"], org_id)
    if existing is not None:
        await applications.update_score(existing["applicationId"], org_id, {
            "matchScore": combo["final"], "scoreBreakdown": breakdown,
            "needsReview": needs_review, "reviewReasons": review_reasons,
        })
        app_id = existing["applicationId"]
        rescored = True
        # Below-threshold pool exit: re-scored above threshold → back to SHORTLISTED.
        if (existing.get("currentStage") == Stage.TALENT_POOL.value
                and combo["final"] >= threshold):
            await transition_application(
                db, org_id=org_id, application_id=app_id,
                to_stage=Stage.SHORTLISTED, actor_user_id="system",
                reason=f"Re-scored {combo['final']} vs threshold {threshold} on re-upload.",
                metadata={"source": "re_upload", "fileId": file_id},
            )
            await maybe_autosend(db, org_id=org_id, application_id=app_id)
    else:
        created = await applications.create({
            "orgId": org_id,
            "jobId": job["jobId"],
            "applicantId": applicant["applicantId"],
            "currentStage": Stage.PARSED.value,
            "candidateKey": None,
            "assignedReviewers": [],
            "matchScore": combo["final"],
            "scoreBreakdown": breakdown,
            "needsReview": needs_review,
            "reviewReasons": review_reasons,
            "status": "active",
        })
        app_id = created["applicationId"]
        rescored = False
        history = StageHistoryRepository(db)
        await history.record_transition(
            application_id=app_id, from_stage="", to_stage=Stage.PARSED.value,
            actor_user_id="system", reason="Application created from resume.",
            metadata={"source": "resume_upload", "fileId": file_id},
        )
        if combo["final"] >= threshold:
            await transition_application(
                db, org_id=org_id, application_id=app_id,
                to_stage=Stage.SHORTLISTED, actor_user_id="system",
                reason=f"Scored {combo['final']} vs threshold {threshold}.",
                metadata={"source": "resume_score", "fileId": file_id},
            )
            await maybe_autosend(db, org_id=org_id, application_id=app_id)
        else:
            created_pool = await applications.update_score(app_id, org_id, {
                "talentPool": {
                    "inPool": True, "rejectedAtStage": Stage.PARSED.value,
                    "reasonCategory": "below_threshold", "recontactFlag": "eligible",
                    "eligibleAfter": (_utcnow() + timedelta(days=30 * RECONTACT_MONTHS)).isoformat(),
                },
            })
            _ = created_pool
            await transition_application(
                db, org_id=org_id, application_id=app_id,
                to_stage=Stage.TALENT_POOL, actor_user_id="system",
                reason=f"Scored {combo['final']} vs threshold {threshold}; kept for future roles.",
                metadata={"source": "resume_score", "fileId": file_id},
            )

    await _recompute_batch(db, org_id, fdoc["batchId"])
    return {"applicationId": app_id, "score": combo["final"],
            "needsReview": needs_review, "rescored": rescored}


async def _recompute_batch(db: Any, org_id: str, batch_id: str) -> None:
    files = ResumeFileRepository(db)
    docs = await files.list_for_batch(batch_id, org_id)
    if not docs:
        return
    parsed = sum(1 for d in docs if d.get("status") == FileStatus.PARSED.value)
    failed = sum(1 for d in docs if d.get("status") == FileStatus.FAILED.value)
    quarantined = sum(1 for d in docs if d.get("status") == FileStatus.QUARANTINED.value)
    pending = any(d.get("status") not in (
        FileStatus.PARSED.value, FileStatus.FAILED.value, FileStatus.QUARANTINED.value) for d in docs)
    batches = ResumeBatchRepository(db)
    await batches.update(batch_id, org_id, {
        "counts": {"total": len(docs), "parsed": parsed, "failed": failed,
                   "quarantined": quarantined},
        "status": BatchStatus.PROCESSING.value if pending else (
            BatchStatus.DONE.value if (failed == 0 and quarantined == 0)
            else BatchStatus.PARTIAL.value),
    })
