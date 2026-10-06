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
from ..models.jobs import BackgroundJobRepository
from ..models.organization import OrganizationRepository, default_settings
from ..models.resume import ResumeBatchRepository, ResumeFileRepository
from ..schemas.resume import BatchStatus, FileStatus
from ..services.pii import phone_digits_variants
from ..config import settings as app_settings
from .assessment_flow import maybe_autosend
from .llm import detect_injection, score_candidate
from .llm.resilience import (
    as_aware,
    compute_defer_delay,
    llm_guard,
    llm_record,
)
from .resume_parse import ParseFailed, ParseTimeout, parse_bytes_isolated
from .scoring import DISAGREEMENT_FLAG_AT, combine, get_scoring_weights, keyword_score
from .storage import read_bytes
from .transitions import transition_application

logger = logging.getLogger(__name__)

RECONTACT_MONTHS = 6

#: llmStatus values stored on resume_files and in score breakdowns.
LLM_DONE = "done"
LLM_PENDING = "pending"
LLM_FAILED = "failed"
LLM_SKIPPED = "skipped"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def process_resume_file(db: Any, *, org_id: str, file_id: str,
                              worker_job: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run the full per-file pipeline. Returns a summary (never raises fatally).

    `worker_job` is the claimed background job when run from the worker; it
    enables defer-and-release on retryable LLM failures. Without it (direct
    calls), retryable LLM failures decide deterministically immediately.
    """
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

    lifecycle = str(job.get("lifecycleStatus") or "DRAFT").upper()
    if lifecycle in ("CLOSED", "ARCHIVED"):
        await files.update(file_id, org_id, {"status": FileStatus.FAILED.value,
                                              "error": f"Job is {lifecycle.lower()}; new applications are not accepted."})
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"failed": f"job {lifecycle.lower()}"}

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
        "llmStatus": LLM_PENDING,
    })

    # Deterministic-first: the keyword score is computed immediately so a
    # busy/dead model never blocks the pipeline or loses the file.
    kw = keyword_score(raw_text=raw_text, parsed=structured, job=job)
    org_repo = OrganizationRepository(db)
    org = await org_repo.get_by_org_id(org_id)
    org_settings = (org or {}).get("settings") or default_settings()
    kw_w, llm_w = get_scoring_weights(org_settings)
    threshold = int(job.get("matchThreshold", 60))

    llm = await _llm_step(
        db, org_id, job_doc=job, file_id=file_id,
        raw_text=raw_text, structured=structured, worker_job=worker_job,
    )
    if llm["mode"] == "deferred":
        await files.update(file_id, org_id, {
            "llmStatus": LLM_PENDING, "llmEtaSeconds": llm["eta_s"],
        })
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"deferred": True, "run_after": llm["run_after"].isoformat(),
                "error": llm["error"], "file_id": file_id,
                "llm_eta_s": llm["eta_s"]}
    combo = combine(keyword=kw["score"],
                    llm_score=llm["score"] if llm["usable"] else None,
                    keyword_weight=kw_w, llm_weight=llm_w)
    review_reasons: list[str] = []
    if kw["knockout"]:
        review_reasons.append(f"knockout: missing {', '.join(kw['knockoutMissing'])}")
    if combo["disagreement"] >= DISAGREEMENT_FLAG_AT:
        review_reasons.append(f"llm/keyword disagreement {combo['disagreement']}pts")
    if llm["injection"]:
        review_reasons.append("possible prompt injection in resume")
    if structured.get("lowConfidence"):
        review_reasons.append("low-confidence parse (legacy .doc)")
    if not structured.get("email"):
        review_reasons.append("missing contact email")
    if llm["note"]:
        review_reasons.append(llm["note"])
    needs_review = len(review_reasons) > 0

    breakdown = {
        "keyword": kw["score"], "matched": kw["matched"], "missing": kw["missing"],
        "niceMatched": kw["niceMatched"], "niceMissing": kw["niceMissing"],
        "knockout": kw["knockout"], "knockoutMissing": kw["knockoutMissing"],
        "expNote": kw["expNote"], "scoreVersion": kw["scoreVersion"],
        "llm": llm["score"], "llmReasons": llm["reasons"],
        "llmUnavailable": llm["status"] in (LLM_FAILED, LLM_SKIPPED),
        "llmStatus": llm["status"], "llmEtaSeconds": None,
        "llmCached": llm["cached"],
        "injectionSuspected": llm["injection"],
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
        elif not llm["usable"] and combo["final"] >= threshold - _borderline_margin():
            # Borderline without a usable LLM score: hold for human review
            # instead of auto-pooling a possibly-good candidate. Auto-pooling
            # resumes once the model answers (via follow-up) or HR decides.
            review_reasons.append(
                f"borderline score {combo['final']} vs threshold {threshold} "
                "without LLM; held for review")
            needs_review = True
            await applications.update_score(app_id, org_id, {
                "matchScore": combo["final"], "scoreBreakdown": breakdown,
                "needsReview": needs_review, "reviewReasons": review_reasons,
            })
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

    await files.update(file_id, org_id, {"llmStatus": llm["status"]})
    followup_id: str | None = None
    if llm.get("followup"):
        followup_id = await _enqueue_llm_followup(
            db, org_id, file_id, app_id,
            reason="LLM deferred past the wait budget; decided deterministically.",
        )
    await _recompute_batch(db, org_id, fdoc["batchId"])
    return {"applicationId": app_id, "score": combo["final"],
            "needsReview": needs_review, "rescored": rescored,
            "llmStatus": llm["status"], "llmFollowupJobId": followup_id}


def _borderline_margin() -> int:
    raw = app_settings.llm_borderline_margin
    return max(0, int(raw if raw is not None else 10))


def _job_reqs(job_doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": job_doc.get("title", ""),
        "mustHaveSkills": job_doc.get("mustHaveSkills") or [],
        "niceToHaveSkills": job_doc.get("niceToHaveSkills") or [],
        "minExperienceYears": job_doc.get("minExperienceYears"),
        "maxExperienceYears": job_doc.get("maxExperienceYears"),
    }


async def _llm_step(db: Any, org_id: str, *, job_doc: dict[str, Any], file_id: str,
                    raw_text: str, structured: dict[str, Any],
                    worker_job: dict[str, Any] | None) -> dict[str, Any]:
    """Guarded LLM scoring step. Returns a deterministic/deterministic-deferred
    directive dict; never raises (adapter contract) and never persists."""
    from .llm import LlmOutcome

    if not (raw_text or "").strip():
        # Blank/unreadable resumes never call the model.
        return {"mode": "deterministic", "score": None, "usable": False,
                "status": LLM_SKIPPED, "injection": False,
                "reasons": ["Blank or unreadable resume; LLM skipped."],
                "note": "blank resume — deterministic score used",
                "cached": False, "followup": False}
    if detect_injection(raw_text):
        # Never call the LLM on injection-suspect input; deterministic only.
        return {"mode": "deterministic", "score": None, "usable": False,
                "status": LLM_SKIPPED, "injection": True,
                "reasons": ["Prompt-injection pattern detected; LLM score skipped."],
                "note": None,  # caller adds the canonical injection reason
                "cached": False, "followup": False}

    allowed, reason, info = await llm_guard(db, kind="bulk")
    if not allowed:
        wait_s = float(info.get("retry_after_s", 30.0))
        message = ("LLM circuit breaker open; deferred."
                   if reason == "breaker-open" else "LLM rate limited; deferred.")
        return await _defer_or_decide(
            db, org_id, file_id, worker_job, message, wait_s)

    outcome = await score_candidate(
        db, org_id,
        parsed=structured,
        raw_text=raw_text,
        job_reqs=_job_reqs(job_doc),
        output_ref=f"file:{file_id}",
        max_attempts=1,
    )
    await llm_record(db, outcome=outcome)
    if getattr(outcome, "from_cache", False) and outcome.llm_score is not None:
        return {"mode": "scored", "score": outcome.llm_score, "usable": True,
                "status": LLM_DONE, "injection": False,
                "reasons": list(outcome.reasons or []), "note": None,
                "cached": True, "followup": False}
    if outcome.llm_score is not None and not outcome.injection_suspected:
        return {"mode": "scored", "score": outcome.llm_score, "usable": True,
                "status": LLM_DONE, "injection": False,
                "reasons": list(outcome.reasons or []), "note": None,
                "cached": False, "followup": False}
    if outcome.injection_suspected:
        return {"mode": "deterministic", "score": None, "usable": False,
                "status": LLM_SKIPPED, "injection": True,
                "reasons": list(outcome.reasons or []), "note": None,
                "cached": False, "followup": False}
    if getattr(outcome, "retryable", False):
        message = (list(outcome.reasons or []) or ["LLM busy; deferred."])[0]
        return await _defer_or_decide(
            db, org_id, file_id, worker_job, message,
            float(getattr(outcome, "retry_after_s", 0.0) or 0.0))
    return {"mode": "deterministic", "score": None, "usable": False,
            "status": LLM_FAILED, "injection": False,
            "reasons": list(outcome.reasons or ["LLM unavailable; deterministic score used."]),
            "note": "LLM unavailable — deterministic score used",
            "cached": False, "followup": False}


def _caps_exceeded(worker_job: dict[str, Any] | None) -> tuple[bool, str]:
    """Attempts cap / total age cap for LLM deferrals (dead-letter rules)."""
    if not worker_job:
        return False, ""
    max_attempts = max(1, int(app_settings.llm_job_max_attempts or 12))
    max_age_h = max(1, int(app_settings.llm_job_max_age_hours or 6))
    if int(worker_job.get("llmAttempts", 0)) >= max_attempts:
        return True, f"LLM retry budget exhausted ({max_attempts} attempts)"
    created = as_aware(worker_job.get("createdAt"))
    age_h = (_utcnow() - created).total_seconds() / 3600.0 if created else 0.0
    if age_h >= max_age_h:
        return True, "LLM retry age limit reached"
    return False, ""


async def _defer_or_decide(db: Any, org_id: str, file_id: str,
                           worker_job: dict[str, Any] | None,
                           message: str, retry_after_s: float) -> dict[str, Any]:
    """Defer-and-release within budgets; otherwise decide deterministically.

    Returns {"mode": "deferred", ...} (repo.defer already executed) or
    {"mode": "deterministic", ...} with followup=True when the wait budget
    is spent (a late-LLM job finishes the scoring later).
    """
    if worker_job is None:
        # No job context (direct call): cannot defer; decide now.
        return {"mode": "deterministic", "score": None, "usable": False,
                "status": LLM_FAILED, "injection": False,
                "reasons": [message], "note": "LLM unavailable — deterministic score used",
                "cached": False, "followup": False}
    capped, cap_reason = _caps_exceeded(worker_job)
    if capped:
        # Dead-letter semantics: deterministic fallback with a visible flag.
        return {"mode": "deterministic", "score": None, "usable": False,
                "status": LLM_FAILED, "injection": False,
                "reasons": [f"{message} {cap_reason}."],
                "note": "LLM unavailable — deterministic score used",
                "cached": False, "followup": False}
    wait_raw = app_settings.llm_wait_seconds
    wait_s = max(0, int(wait_raw if wait_raw is not None else 120))
    since = as_aware(worker_job.get("llmDeferredSince"))
    waited = (_utcnow() - since).total_seconds() if since else 0.0
    if waited >= wait_s:
        return {"mode": "deterministic", "score": None, "usable": False,
                "status": LLM_PENDING, "injection": False,
                "reasons": [f"{message} Decided on the deterministic score; "
                            "the model result will update the review when it arrives."],
                "note": "AI scoring pending — decided on deterministic score",
                "cached": False, "followup": True}
    run_after = compute_defer_delay(retry_after_s, int(worker_job.get("llmAttempts", 0)) + 1)
    repo = BackgroundJobRepository(db)
    await repo.defer(str(worker_job.get("jobId", "")), run_after=run_after, error=message)
    eta_s = max(0.0, (run_after - _utcnow()).total_seconds())
    return {"mode": "deferred", "run_after": run_after, "error": message,
            "eta_s": eta_s}


async def _enqueue_llm_followup(db: Any, org_id: str, file_id: str,
                                application_id: str, reason: str) -> str | None:
    """Enqueue the late-LLM completion job (idempotent per file)."""
    repo = BackgroundJobRepository(db)
    try:
        record = await repo.enqueue(
            org_id=org_id, kind="llm_complete", entity_type="resume_file",
            entity_key=file_id, payload={"fileId": file_id,
                                         "applicationId": application_id,
                                         "reason": reason[:200]},
            max_attempts=max(1, int(app_settings.llm_job_max_attempts or 12)),
            dedupe_key=f"llm_complete:file:{file_id}",
        )
        return str(record.get("jobId") or "")
    except Exception:  # noqa: BLE001 — follow-up is best-effort, decision stands
        logger.exception("LLM follow-up enqueue failed for file %s", file_id)
        return None


async def process_llm_followup(db: Any, *, org_id: str, file_id: str,
                               application_id: str,
                               worker_job: dict[str, Any] | None = None) -> dict[str, Any]:
    """Apply a late LLM result: annotate only, NEVER restage.

    If the late score would cross the threshold, the application gets
    needsReview instead of a transition.
    """
    files = ResumeFileRepository(db)
    fdoc = await files.get(file_id, org_id)
    applications = ApplicationRepository(db)
    app = await applications.get_by_id(application_id, org_id)
    if not fdoc or not app:
        return {"skipped": "file or application not found"}
    breakdown = dict(app.get("scoreBreakdown") or {})
    if breakdown.get("llmStatus") == LLM_DONE:
        return {"skipped": "already scored"}

    capped, cap_reason = _caps_exceeded(worker_job)
    if capped:
        await files.update(file_id, org_id, {"llmStatus": LLM_FAILED})
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"fallback": f"dead-lettered LLM follow-up ({cap_reason}); deterministic stands"}

    jobs_repo = JobRepository(db)
    job_doc = await jobs_repo.get_by_id(fdoc.get("jobId", ""), org_id)
    if not job_doc:
        return {"failed": "job removed"}
    structured = dict((fdoc.get("parsedJson") or {}))

    allowed, reason, info = await llm_guard(db, kind="bulk")
    if not allowed:
        if worker_job is None:
            return {"failed": f"guard denied ({reason})"}
        run_after = compute_defer_delay(
            float(info.get("retry_after_s", 30.0)),
            int(worker_job.get("llmAttempts", 0)) + 1)
        await BackgroundJobRepository(db).defer(
            str(worker_job.get("jobId", "")), run_after=run_after,
            error=f"LLM follow-up deferred ({reason}).")
        return {"deferred": True, "run_after": run_after.isoformat(),
                "error": reason, "file_id": file_id, "llm_eta_s": 0.0}

    from ..schemas.parsed_resume import ParsedResume

    try:
        digest_source = ParsedResume.model_validate(structured).model_dump()
    except Exception:  # noqa: BLE001 — stored parse must still validate
        digest_source = dict(structured)
    outcome = await score_candidate(
        db, org_id, parsed=digest_source,
        raw_text="", job_reqs=_job_reqs(job_doc),
        output_ref=f"file:{file_id}:followup", max_attempts=1,
    )
    await llm_record(db, outcome=outcome)
    if outcome.llm_score is None or outcome.injection_suspected:
        if getattr(outcome, "retryable", False):
            if worker_job is None:
                return {"failed": "LLM busy; no job context to defer"}
            run_after = compute_defer_delay(
                float(getattr(outcome, "retry_after_s", 0.0) or 0.0),
                int(worker_job.get("llmAttempts", 0)) + 1)
            await BackgroundJobRepository(db).defer(
                str(worker_job.get("jobId", "")),
                run_after=run_after, error="LLM follow-up deferred.")
            return {"deferred": True, "run_after": run_after.isoformat(),
                    "error": "LLM follow-up deferred", "file_id": file_id,
                    "llm_eta_s": 0.0}
        await files.update(file_id, org_id, {"llmStatus": LLM_FAILED})
        await _recompute_batch(db, org_id, fdoc["batchId"])
        return {"failed": "LLM follow-up unavailable; deterministic stands"}

    org_repo = OrganizationRepository(db)
    org = await org_repo.get_by_org_id(org_id)
    org_settings = (org or {}).get("settings") or default_settings()
    kw_w, llm_w = get_scoring_weights(org_settings)
    kw = keyword_score(raw_text="", parsed=digest_source, job=job_doc)
    combo = combine(keyword=kw["score"], llm_score=outcome.llm_score,
                    keyword_weight=kw_w, llm_weight=llm_w)
    threshold = int(job_doc.get("matchThreshold", 60))
    reasons = list(app.get("reviewReasons") or [])
    reasons.append(f"late LLM score {outcome.llm_score} applied to explanation")
    stage = str(app.get("currentStage") or "")
    would_shortlist = combo["final"] >= threshold and stage in (
        Stage.TALENT_POOL.value, Stage.PARSED.value)
    if would_shortlist:
        # Late results MUST NOT restage: flag for human review instead.
        reasons.append(
            f"late LLM score {combo['final']} vs threshold {threshold}; "
            "held for review instead of auto-moving stage")
    new_breakdown = dict(breakdown)
    new_breakdown.update({
        "llm": outcome.llm_score, "llmReasons": list(outcome.reasons or []),
        "llmUnavailable": False, "llmStatus": LLM_DONE, "llmEtaSeconds": None,
        "llmCached": bool(getattr(outcome, "from_cache", False)),
        "disagreement": combo["disagreement"], "llmUsed": combo["llmUsed"],
        "weights": combo["weights"], "final": combo["final"],
    })
    await applications.update_score(application_id, org_id, {
        "matchScore": combo["final"], "scoreBreakdown": new_breakdown,
        "needsReview": True if (would_shortlist or app.get("needsReview")) else bool(app.get("needsReview")),
        "reviewReasons": reasons,
    })
    await files.update(file_id, org_id, {"llmStatus": LLM_DONE})
    await _recompute_batch(db, org_id, fdoc["batchId"])
    return {"applicationId": application_id, "score": combo["final"],
            "needsReview": True if would_shortlist else bool(app.get("needsReview")),
            "late": True}


async def _recompute_batch(db: Any, org_id: str, batch_id: str) -> None:
    files = ResumeFileRepository(db)
    docs = await files.list_for_batch(batch_id, org_id)
    if not docs:
        return
    parsed = sum(1 for d in docs if d.get("status") == FileStatus.PARSED.value)
    failed = sum(1 for d in docs if d.get("status") == FileStatus.FAILED.value)
    quarantined = sum(1 for d in docs if d.get("status") == FileStatus.QUARANTINED.value)
    # Files awaiting the model keep the batch visibly PROCESSING (with an
    # "AI scoring pending" chip in the UI) instead of looking done/frozen.
    pending_ai = sum(1 for d in docs if d.get("llmStatus") == LLM_PENDING)
    pending = pending_ai > 0 or any(d.get("status") not in (
        FileStatus.PARSED.value, FileStatus.FAILED.value, FileStatus.QUARANTINED.value) for d in docs)
    batches = ResumeBatchRepository(db)
    await batches.update(batch_id, org_id, {
        "counts": {"total": len(docs), "parsed": parsed, "failed": failed,
                   "quarantined": quarantined, "pendingAI": pending_ai},
        "status": BatchStatus.PROCESSING.value if pending else (
            BatchStatus.DONE.value if (failed == 0 and quarantined == 0)
            else BatchStatus.PARTIAL.value),
    })
