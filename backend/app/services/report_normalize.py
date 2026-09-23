"""Report normalization: structure-preserving snake_case -> camelCase plus
variant-aware extraction (scores, video refs, candidate UUID).

Rules:
- `normalized` keeps the FULL structure (unknown/future fields preserved);
  only *keys* are camelCased, values untouched.
- Scores are extracted ONLY when the source field exists (numeric check);
  missing metrics stay None (never 0).
- Video binaries are never touched; only URL metadata is extracted.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_SYNTHETIC_UUID_PREFIX = "c3a7db8e-0f2c-473d-82ba-"

SCORE_FIELDS = (
    "technical",
    "communication",
    "confidence",
    "fluency",
    "grammar",
    "pronunciation",
    "vocabulary",
)


class ReportValidationError(ValueError):
    """Upstream payload failed structural validation."""


def to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])


def deep_camel(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {to_camel(str(k)): deep_camel(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_camel(v) for v in obj]
    return obj


def _num(value: Any) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _pick(*candidates: Any) -> Any:
    for value in candidates:
        if value is not None:
            return value
    return None


def _question_lists(data: dict[str, Any]) -> list[Any]:
    """Question arrays at top level and inside the report block (both casings)."""
    out: list[Any] = []
    block = data.get("report") or {}
    for container in (data, block if isinstance(block, dict) else {}):
        for key in ("question_wise_result", "questionWiseResult"):
            if key in container:
                out.append(container[key])
    return out


def validate_report_data(data: Any) -> None:
    """Structural validation (raises ReportValidationError). Unknown fields OK."""
    if not isinstance(data, dict) or not data:
        raise ReportValidationError("report data must be a non-empty object")
    for questions in _question_lists(data):
        if not isinstance(questions, list):
            raise ReportValidationError("questionWiseResult must be an array when present")
        for q in questions:
            if not isinstance(q, dict):
                raise ReportValidationError("questionWiseResult items must be objects")
            for key in ("obtained_score", "obtainedScore", "max_score", "maxScore"):
                if key in q and q[key] is not None and _num(q[key]) is None:
                    raise ReportValidationError(f"question field {key} must be numeric when present")
            for key in ("video_url", "videoUrl"):
                if key in q and q[key] is not None and not isinstance(q[key], str):
                    raise ReportValidationError(f"question field {key} must be a string when present")


def extract_scores(normalized: dict[str, Any]) -> dict[str, float | int | None]:
    """Variant-tolerant score extraction from camelCased data. Missing -> None."""
    report = normalized.get("report") or {}
    overall = report.get("overallResult") or {}
    # TECHNICAL (+HR, which shares the overallResult envelope)
    tech = overall.get("technicalAnalysis") or {}
    comm = overall.get("communicationAnalysis") or report.get("communicationAnalysis") or {}
    interview = overall.get("interviewAnalysis") or {}
    # BASIC shape: top-level overallScore + communicationAnalysis
    scores: dict[str, float | int | None] = {
        "technical": _num(_pick(tech.get("overallScore"), report.get("overallScore"))),
        "communication": _num(comm.get("overallScore")),
        "confidence": _num(interview.get("confidenceScore")),
        "fluency": _num(comm.get("fluency")),
        "grammar": _num(comm.get("grammar")),
        "pronunciation": _num(comm.get("pronunciation")),
        "vocabulary": _num(comm.get("vocabulary")),
    }
    return scores


def extract_video_refs(normalized: dict[str, Any], fetched_at: str) -> list[dict[str, Any]]:
    report = normalized.get("report") or {}
    questions = report.get("questionWiseResult") or []
    refs: list[dict[str, Any]] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        url = q.get("videoUrl")
        if isinstance(url, str) and url:
            refs.append(
                {
                    "questionId": str(q.get("id") or q.get("_id") or q.get("videoId") or ""),
                    "videoUrl": url,
                    "fetchedAt": fetched_at,
                }
            )
    return refs


def extract_candidate_uuid(data: dict[str, Any]) -> str | None:
    """Genuine PrimeHire candidate UUID from interview_details (either casing).

    Returns None for missing values AND the synthetic fallback stamp.
    """
    details = data.get("interview_details") or data.get("interviewDetails") or {}
    value = details.get("candidate_id") or details.get("candidateId")
    if not value or not _UUID_RE.match(str(value)):
        return None
    if str(value).startswith(_SYNTHETIC_UUID_PREFIX):
        return None
    return str(value)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
