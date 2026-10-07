"""PrimeHire assessment payload mapping (Slice 2A).

Builds the exact POST /assessment body PrimeHire expects from an app-shaped
assessment document. The browser never calls PrimeHire for assessments — the
backend owns this mapping and the server-to-server call.

Rules (per provider API doc):
- language is always "ENGLISH".
- every question carries max_duration.
- MCQ: options are [{"id": "A", "data": <text>}, ...] with correct_option_id
  set to the matching option id. No answer/criteria/reference fields.
- Verbal (SPEAK_TO_ANSWER):
  - BASIC sends `criteria`, never `answer`.
  - TECHNICAL sends `answer` (from referenceAnswer), never `criteria`.
  - HR sends neither scoring text field.
- HR questions never carry max_score/weightage.
- TECHNICAL/BASIC question weightages must total exactly 100.
"""

from __future__ import annotations

import re
from typing import Any

_OPTION_IDS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


class PayloadError(ValueError):
    """Raised when an assessment cannot be mapped to a PrimeHire payload."""


def sanitize_question_id(raw: str, fallback: str) -> str:
    """Valid Python identifier (alphanumeric + underscore, not leading digit)."""
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", raw or "")
    if not cleaned or cleaned[0].isdigit():
        cleaned = "q_" + (cleaned or fallback)
    return cleaned


def _mcq_options(options: list[str] | None, correct: str | None, pos: int) -> tuple[list[dict[str, str]], str]:
    if not options or any(not (o or "").strip() for o in options):
        raise PayloadError(f"Question #{pos}: MCQ needs non-empty options.")
    if len(options) > len(_OPTION_IDS):
        raise PayloadError(f"Question #{pos}: too many MCQ options (max {len(_OPTION_IDS)}).")
    mapped = [{"id": _OPTION_IDS[i], "data": text} for i, text in enumerate(options)]
    if not correct or correct not in (options or []):
        raise PayloadError(f"Question #{pos}: correct option must match one of its options.")
    correct_id = _OPTION_IDS[options.index(correct)]
    return mapped, correct_id


def map_question(question: dict[str, Any], round_type: str, pos: int) -> dict[str, Any]:
    qtype = question.get("type", "SPEAK_TO_ANSWER")
    text = (question.get("text") or question.get("question") or "").strip()
    if not text:
        raise PayloadError(f"Question #{pos}: text is required.")
    out: dict[str, Any] = {
        "id": sanitize_question_id(str(question.get("id", "")), fallback=f"q{pos}"),
        "question": text,
        "type": qtype,
        "max_duration": int(question.get("maxDuration") or question.get("max_duration") or 120),
    }
    if qtype == "MCQ":
        options, correct_id = _mcq_options(
            question.get("options"), question.get("correctOption"), pos
        )
        out["options"] = options
        out["correct_option_id"] = correct_id
    else:
        if round_type == "BASIC":
            criteria = (question.get("criteria") or "").strip()
            if not criteria:
                raise PayloadError(f"Question #{pos}: BASIC verbal questions require criteria.")
            out["criteria"] = criteria
        elif round_type == "TECHNICAL":
            answer = (
                question.get("referenceAnswer") or question.get("answer") or ""
            ).strip()
            if not answer:
                raise PayloadError(
                    f"Question #{pos}: TECHNICAL verbal questions require a reference answer."
                )
            out["answer"] = answer
        # HR verbal: neither criteria nor answer.
    if round_type != "HR":
        if question.get("maxScore") is not None or question.get("max_score") is not None:
            out["max_score"] = question.get("maxScore", question.get("max_score"))
        if question.get("weightage") is not None:
            out["weightage"] = question["weightage"]
    return out


def map_assessment(doc: dict[str, Any]) -> dict[str, Any]:
    """Map an app-shaped assessment document to the PrimeHire POST body."""
    for field in ("jobId", "jobTitle", "roundType"):
        value = doc.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            raise PayloadError(f"{field} is required.")
    round_type = doc["roundType"]
    if round_type not in ("TECHNICAL", "BASIC", "HR"):
        raise PayloadError(f"Unsupported round_type: {round_type!r}.")
    questions = doc.get("questions") or []
    if not questions:
        raise PayloadError("At least one question is required.")
    mapped_questions = [map_question(q, round_type, i + 1) for i, q in enumerate(questions)]
    if round_type != "HR":
        total = sum(int(q.get("weightage") or 0) for q in mapped_questions)
        if total != 100:
            raise PayloadError(
                f"Sum of question weightages must be exactly 100 (currently {total})."
            )
    payload: dict[str, Any] = {
        "job_id": doc["jobId"],
        "job_title": doc["jobTitle"],
        "job_description": doc.get("jobDescription") or "",
        "language": "ENGLISH",
        "round_type": round_type,
        "questions": mapped_questions,
    }
    if doc.get("startDate"):
        payload["start_date"] = doc["startDate"]
    if doc.get("endDate"):
        payload["end_date"] = doc["endDate"]
    return payload
