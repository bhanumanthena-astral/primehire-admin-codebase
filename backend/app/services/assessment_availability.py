"""A persisted preparation buffer, independent of browser sessions or TTS status."""

from typing import Any

from ..models.assessment import parse_dt, utcnow

ASSESSMENT_PREPARATION_SECONDS = 300


class AssessmentPreparing(Exception):
    def __init__(self, message: str, *, code: str = "ASSESSMENT_PREPARING", available_at: Any = None):
        super().__init__(message)
        self.code = code
        self.available_at = available_at.isoformat() if available_at else None


async def require_candidate_creation_available(db: Any, job_id: str) -> None:
    assessment = await db["assessments"].find_one({"jobId": job_id, "deletedAt": None})
    # Preserve existing candidate-import support for external/legacy profiles.
    # Portal-created assessments always have a document and use the guard below.
    if assessment is None:
        return
    state = (assessment.get("syncState") or {}).get("state")
    if state in ("pending", "failed"):
        raise AssessmentPreparing(
            "Assessment setup has not succeeded. Complete setup before adding candidates.",
            code="ASSESSMENT_SETUP_INCOMPLETE",
        )
    raw_deadline = assessment.get("candidateCreationAvailableAt")
    if raw_deadline is None:
        return  # Existing assessments do not acquire a new waiting period.
    deadline = parse_dt(raw_deadline)
    if deadline is None:
        raise AssessmentPreparing("Assessment preparation time is unavailable. Refresh and try again.")
    if utcnow() < deadline:
        raise AssessmentPreparing(
            "Assessment is preparing. Candidates can be added after the five-minute preparation buffer.",
            available_at=deadline,
        )
