"""AI JD Ingestion Phase 3: validate/normalize `jd-extract-v1` output.

Trust boundary:

    LLM (untrusted) → normalize → server-side assignee resolution
    → JobCreate validation (single source of truth) → review payload.

- `JobCreate` is reused as-is; NO second set of Job rules lives here.
  Field *normalization* (number/date/mode parsing leniency) mirrors the
  prescribed-template conventions but validity is always decided by
  `JobCreate` itself.
- Missing stays missing: no defaults are invented to satisfy validation.
  `jobKey` is the one exception and it is NOT reported missing — it is
  supplied by HR at save time (same as the template flow, which validates
  with a placeholder).
- Assignee: raw `assigneeText` is resolved ONLY against `UserRepository`
  (org-scoped, active-checked). Never created, never guessed, never
  taken from an LLM-supplied email. When the text names someone but the
  scrubbed LLM input lost their email, the ORIGINAL unscrubbed
  server-side text is the only other source consulted — and only when it
  yields exactly one active org user.
- No persistence, no lifecycle, no duplicate check, no RBAC decision.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

#: Placeholder so the real JobCreate validators run; stripped from output.
_AI_CHECK_JOB_KEY = "AI-CHECK"

#: JobCreate fields HR must supply/fix before save (jobKey excluded: save-time).
_REQUIRED_FOR_REVIEW = (
    "companyName",
    "jobRole",
    "title",
    "department",
    "minExperienceYears",
    "maxExperienceYears",
    "positionsTotal",
    "closesAt",
    "assigneeUserId",
    "jdHtml",
)

#: Lenient date leniency, same conventions as the template normalizer
#: (`jd_template._DATE_FORMATS`); validity still belongs to JobCreate.
_DATE_FORMATS = (
    "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z",
    "%d-%m-%Y", "%d/%m/%Y", "%d %b %Y", "%d %B %Y",
    "%b %d, %Y", "%B %d, %Y", "%m/%d/%Y",
)

_WORK_MODE_ALIASES = {
    "onsite": "ONSITE", "on-site": "ONSITE", "on site": "ONSITE",
    "office": "ONSITE", "wfo": "ONSITE",
    "remote": "REMOTE", "wfh": "REMOTE",
    "hybrid": "HYBRID",
}

# Order matters: maxBefore-min and closes-before-opened so range/order
# messages attribute to the constrained field, not the reference one.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")
_INFERRABLE_FIELDS = (
    "companyName", "jobRole", "title", "department",
    "maxExperienceYears", "minExperienceYears", "positionsTotal",
    "closesAt", "openedAt", "assigneeUserId",
    "keywords", "workMode", "location", "jdHtml",
)


def _field_from_message(message: str) -> str:
    """Attribute a model-level (empty-loc) validation message to a field."""
    lowered = (message or "").lower()
    for fname in _INFERRABLE_FIELDS:
        if fname.lower() in lowered:
            return fname
    if "job description" in lowered:
        return "jdHtml"
    return "job"


class _Ambiguous(Exception):
    """A present-but-unparseable value: needs review, never guessed."""


class JdReviewReady(BaseModel):
    """Review-ready validation result. Advisory only — never persisted."""

    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = Field(default_factory=dict)
    missingFields: list[str] = Field(default_factory=list)
    needsReview: list[dict[str, str]] = Field(default_factory=list)
    fieldErrors: list[dict[str, str]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    resolvedAssignee: dict[str, str] | None = None
    evidence: dict[str, str] = Field(default_factory=dict)


def _to_float(value: Any, field: str) -> float | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a number")
    if isinstance(value, (int, float)):
        return float(value)
    match = _NUMBER_RE.search(str(value))
    if not match:
        raise ValueError(f"{field} must be a number")
    return float(match.group(0))


def _to_positions(value: Any) -> int | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValueError("positionsTotal must be a positive integer")
    if isinstance(value, int):
        number = value
    elif isinstance(value, float):
        if not value.is_integer():
            raise ValueError("positionsTotal must be a positive integer")
        number = int(value)
    elif isinstance(value, str) and re.fullmatch(r"\d+", value.strip()):
        number = int(value.strip())
    else:
        raise ValueError("positionsTotal must be a positive integer")
    if number < 1:
        raise ValueError("positionsTotal must be a positive integer")
    return number


def _to_datetime(value: Any, field: str) -> datetime | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        parsed = None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            for fmt in _DATE_FORMATS:
                try:
                    parsed = datetime.strptime(text, fmt)
                    break
                except ValueError:
                    continue
        if parsed is None:
            raise _Ambiguous(f"{field} date is ambiguous; needs HR review")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _to_workmode(value: Any) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    mode = _WORK_MODE_ALIASES.get(str(value).strip().lower())
    if mode is None:
        raise ValueError("workMode must be one of ONSITE, REMOTE, HYBRID")
    return mode


def _to_jd_html(value: Any) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    lines = [ln.strip() for ln in str(value).splitlines() if ln.strip()]
    paras = "".join(f"<p>{p}</p>" for p in lines)
    return paras or None


def _norm_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


async def _resolve_assignee(
    db: Any, org_id: str, assignee_text: str, original_text: str
) -> tuple[dict[str, Any] | None, str, str]:
    """Resolve raw assignee text to an active org user.

    Returns (user_or_None, status, reason) with status in
    {resolved, unresolved, ambiguous, inactive}. Contacts found in the
    document are considered ONLY when the text names an assignee but no
    direct match exists (email may have been PII-scrubbed pre-LLM).
    """
    from ..models.user import UserRepository

    repo = UserRepository(db)
    text = (assignee_text or "").strip()
    if not text:
        return None, "unresolved", "No assignee specified."

    user = await repo.get_by_id(text, org_id)
    if user is None and "@" in text:
        user = await repo.get_by_email(text.strip().lower(), org_id)
    if user is not None:
        if user.get("isActive", True) is False:
            return None, "inactive", f"Assignee '{text}' is deactivated; choose an active user."
        return user, "resolved", ""

    if "@" not in text:
        users = await repo.list_by_org(org_id, limit=500)
        matches = [u for u in users if _norm_name(str(u.get("name") or "")) == _norm_name(text)]
        if len(matches) == 1:
            only = matches[0]
            if only.get("isActive", True) is False:
                return None, "inactive", f"Assignee '{text}' is deactivated; choose an active user."
            return only, "resolved", ""
        if len(matches) > 1:
            return None, "ambiguous", (
                f"Assignee '{text}' matches {len(matches)} users; HR must choose one."
            )
        # Email may have been scrubbed before the LLM call: consult the
        # original server-side text, but only a UNIQUE active match counts.
        seen: list[dict[str, Any]] = []
        for candidate in dict.fromkeys(m.group(0).lower() for m in _EMAIL_RE.finditer(original_text or "")):
            hit = await repo.get_by_email(candidate, org_id)
            if hit is not None and hit.get("isActive", True) is not False:
                seen.append(hit)
        if len(seen) == 1:
            return seen[0], "resolved", ""
        if len(seen) > 1:
            return None, "ambiguous", (
                "Several addresses in the document belong to org users; HR must choose the assignee."
            )
    return None, "unresolved", f"Assignee '{text}' is not a valid user of this organization."


async def validate_jd_extraction(
    payload: Any,
    db: Any,
    org_id: str,
    *,
    original_text: str = "",
    injection_suspected: bool = False,
) -> JdReviewReady:
    """Validate a jd-extract-v1 result against the JobCreate truth.

    Accepts a `JdExtractPayload` or its dict form (dict failures become a
    review-level `aiExtract` error, never an exception). Pure read path:
    user lookups + validation only.
    """
    from ..schemas.hiring import JobCreate, normalize_keywords

    try:
        from .llm.jd_extract import JdExtractPayload

        if isinstance(payload, dict):
            data = JdExtractPayload.model_validate(payload)
        elif isinstance(payload, JdExtractPayload):
            data = payload
        else:
            raise ValueError("AI extraction must be a jd-extract-v1 object")
    except Exception as exc:  # noqa: BLE001 — malformed AI output is a review state
        message = "; ".join(
            f"{'.'.join(str(p) for p in err.get('loc', ()))}: {err.get('msg')}"
            for err in getattr(exc, "errors", lambda: [])()
        ) or str(exc)
        return JdReviewReady(
            missingFields=list(_REQUIRED_FOR_REVIEW),
            fieldErrors=[{"field": "aiExtract", "message": f"Malformed AI extraction: {message}"}],
            warnings=["AI extraction was malformed; manual entry remains available."],
        )

    raw = data.model_dump()
    candidate: dict[str, Any] = {}
    field_errors: list[dict[str, str]] = []
    needs_review: list[dict[str, str]] = []
    warnings: list[str] = list(data.warnings or [])

    def _take_str(key: str, out_key: str | None = None) -> None:
        target = out_key or key
        value = raw.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            return
        candidate[target] = str(value).strip()

    for key in ("companyName", "jobRole", "department", "location"):
        _take_str(key)
    if raw.get("jobTitle") and str(raw["jobTitle"]).strip():
        candidate["title"] = str(raw["jobTitle"]).strip()

    for key in ("minExperienceYears", "maxExperienceYears"):
        source = "minExperience" if key == "minExperienceYears" else "maxExperience"
        try:
            number = _to_float(raw.get(source), key)
        except ValueError as exc:
            field_errors.append({"field": key, "message": str(exc)})
            continue
        if number is not None:
            candidate[key] = number

    try:
        positions = _to_positions(raw.get("positionsTotal"))
    except ValueError as exc:
        field_errors.append({"field": "positionsTotal", "message": str(exc)})
        positions = None
    if positions is not None:
        candidate["positionsTotal"] = positions

    try:
        keywords = normalize_keywords(raw.get("keywords") or [])
    except ValueError as exc:
        field_errors.append({"field": "keywords", "message": str(exc)})
        keywords = []
    if keywords:
        candidate["keywords"] = keywords

    for key in ("openedAt", "closesAt"):
        try:
            moment = _to_datetime(raw.get(key), key)
        except _Ambiguous as exc:
            needs_review.append({"field": key, "reason": str(exc)})
            continue
        if moment is not None:
            candidate[key] = moment

    try:
        mode = _to_workmode(raw.get("workMode"))
    except ValueError as exc:
        field_errors.append({"field": "workMode", "message": str(exc)})
        mode = None
    if mode is not None:
        candidate["workMode"] = mode

    jd_html = _to_jd_html(raw.get("jobDescription"))
    if jd_html is not None:
        candidate["jdHtml"] = jd_html

    # Server-side assignee resolution — the LLM never decides identity.
    user, status, reason = await _resolve_assignee(
        db, org_id, str(raw.get("assigneeText") or ""), original_text
    )
    resolved: dict[str, str] | None = None
    if status == "resolved" and user is not None:
        candidate["assigneeUserId"] = str(user.get("userId"))
        resolved = {
            "userId": str(user.get("userId")),
            "email": str(user.get("email") or ""),
            "name": str(user.get("name") or ""),
        }
    elif status in ("unresolved", "ambiguous", "inactive"):
        needs_review.append({"field": "assigneeUserId", "reason": reason})

    # The single validation truth: the same schema the create endpoint enforces.
    # "missing"-type errors mean absent-required → reported via missingFields
    # (computed below), never as field errors. Model-level (empty-loc) errors
    # are attributed by message so range/order/length failures name a field.
    errored_fields = {e["field"] for e in field_errors}
    try:
        validated = JobCreate(**{**candidate, "jobKey": _AI_CHECK_JOB_KEY})
    except Exception as exc:  # noqa: BLE001 — translate pydantic errors to fields
        for err in getattr(exc, "errors", lambda: [])():
            loc = err.get("loc", ())
            f = str(loc[0]) if loc else _field_from_message(str(err.get("msg", "")))
            if f in ("jobKey",) or f in errored_fields:
                continue
            if err.get("type") == "missing":
                continue
            field_errors.append({"field": f, "message": str(err.get("msg", "invalid value"))})
            errored_fields.add(f)
    else:
        _ = validated

    assignee_named = bool((raw.get("assigneeText") or "").strip())
    missing = [
        f for f in _REQUIRED_FOR_REVIEW
        if f not in candidate and f not in errored_fields
        # Named-but-unresolvable assignees are needsReview, not missing.
        and not (f == "assigneeUserId" and assignee_named)
    ]

    if injection_suspected:
        needs_review.append({
            "field": "document",
            "reason": "Possible prompt-injection content detected; verify every field.",
        })
        warnings.append("Possible prompt-injection content detected; verify every field.")

    values = {
        k: (v.isoformat() if isinstance(v, datetime) else v)
        for k, v in candidate.items()
    }
    return JdReviewReady(
        values=values,
        missingFields=missing,
        needsReview=needs_review,
        fieldErrors=field_errors,
        warnings=warnings,
        resolvedAssignee=resolved,
        evidence=dict(data.evidence or {}),
    )
