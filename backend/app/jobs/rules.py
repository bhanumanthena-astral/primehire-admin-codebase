"""Single source of truth for Jobs validation rules.

Consumed by schemas (validation), services (jd_template), the rules
endpoint (GET /api/jobs/rules), and the CLI audit. The frontend form
fetches /api/jobs/rules instead of duplicating constants.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

JD_MIN_CHARS = 50
JD_MAX_CHARS = 10_000
MAX_KEYWORDS = 20
KEYWORD_MIN_CHARS = 1
KEYWORD_MAX_CHARS = 50
MIN_EXPERIENCE_YEARS = 0.0
MAX_EXPERIENCE_YEARS = 50.0
MIN_POSITIONS = 1
MAX_POSITIONS = 1_000
COMPANY_NAME_MIN = 2
COMPANY_NAME_MAX = 150
JOB_ROLE_MIN = 2
JOB_ROLE_MAX = 100
JOB_TITLE_MIN = 2
JOB_TITLE_MAX = 150

DEPARTMENTS: tuple[str, ...] = (
    "Engineering", "Product", "Design", "Data & Analytics",
    "Quality Assurance", "DevOps", "Human Resources", "Sales",
    "Marketing", "Finance", "Customer Support", "Operations",
)

# Canonical casing for known keywords; case-insensitive dedupe keeps the
# dictionary spelling when present ("c#" -> "C#", "node.js" -> "Node.js").
KNOWN_KEYWORD_CASINGS: dict[str, str] = {
    "c#": "C#",
    "c++": "C++",
    ".net": ".NET",
    "node.js": "Node.js",
}

_TITLE_ALLOWED = set("-/&. ")
_COMPANY_ALLOWED = set("&.- ")
_KEYWORD_ALLOWED = set("+#.- ")
_DANGEROUS = re.compile(r"(<|>|\{|\}|\[|\]|\(|\)|,|:|['\"]|`|\\|/\*|<script)", re.IGNORECASE)


def _is_letter_or_digit(ch: str) -> bool:
    cat = unicodedata.category(ch)
    return cat in ("Lu", "Ll", "Lt", "Lo", "Nd")


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _validate_charset(value: str, *, label: str, min_len: int, max_len: int,
                       allowed: set[str]) -> str:
    cleaned = normalize_spaces(value)
    if len(cleaned) < min_len:
        raise ValueError(f"{label} must be at least {min_len} characters.")
    if len(cleaned) > max_len:
        raise ValueError(f"{label} must be at most {max_len} characters.")
    if _DANGEROUS.search(cleaned):
        allowed_desc = "spaces and " + "".join(sorted(a for a in allowed if a != " "))
        raise ValueError(
            f"{label} contains disallowed characters. Allowed: letters, digits, {allowed_desc}. "
            "No parentheses, commas, colons, quotes, or HTML."
        )
    for ch in cleaned:
        if not (_is_letter_or_digit(ch) or ch in allowed):
            raise ValueError(
                f"{label} contains disallowed characters. Allowed: letters, digits, {', '.join(sorted(allowed))}"
            )
    return cleaned


def validate_company_name(value: str) -> str:
    return _validate_charset(value, label="Company name", min_len=COMPANY_NAME_MIN,
                             max_len=COMPANY_NAME_MAX, allowed=_COMPANY_ALLOWED)


def validate_job_role(value: str) -> str:
    return _validate_charset(value, label="Job role", min_len=JOB_ROLE_MIN,
                             max_len=JOB_ROLE_MAX, allowed=_TITLE_ALLOWED)


def validate_job_title(value: str) -> str:
    return _validate_charset(value, label="Job title", min_len=JOB_TITLE_MIN,
                             max_len=JOB_TITLE_MAX, allowed=_TITLE_ALLOWED)


def validate_department(value: str) -> str:
    cleaned = normalize_spaces(value)
    for dept in DEPARTMENTS:
        if cleaned.casefold() == dept.casefold():
            return dept
    raise ValueError(f"Department must be one of: {', '.join(DEPARTMENTS)}")


def validate_experience_years(value: Any) -> float:
    try:
        years = float(value)
    except (TypeError, ValueError):
        raise ValueError("Experience must be a number of years.")
    if years < MIN_EXPERIENCE_YEARS or years > MAX_EXPERIENCE_YEARS:
        raise ValueError(f"Experience must be between {MIN_EXPERIENCE_YEARS:g} and {MAX_EXPERIENCE_YEARS:g} years.")
    if abs(years * 12 - round(years * 12)) > 1e-6:
        raise ValueError("Experience must be in whole months (e.g. 2.5 years = 2 years 6 months); 2.55 is not valid.")
    return years


def validate_positions(value: Any, *, positions_filled: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        # Decimal like 2.5 arrives as float → reject.
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        else:
            raise ValueError("Positions must be a whole number.")
    if value < MIN_POSITIONS:
        raise ValueError(f"Positions must be at least {MIN_POSITIONS}.")
    if value > MAX_POSITIONS:
        raise ValueError(f"Positions must be at most {MAX_POSITIONS}.")
    if positions_filled is not None and value < positions_filled:
        raise ValueError("Positions cannot be set below the current number of filled positions.")
    return value


def validate_keywords(raw: Any) -> list[str]:
    if raw is None:
        return []
    values = raw if isinstance(raw, list) else [raw]
    cleaned_out: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = normalize_spaces(str(item))
        if not text:
            continue
        if len(text) < KEYWORD_MIN_CHARS or len(text) > KEYWORD_MAX_CHARS:
            raise ValueError(f"Each keyword must be {KEYWORD_MIN_CHARS}-{KEYWORD_MAX_CHARS} characters.")
        if _DANGEROUS.search(text):
            raise ValueError("Keywords cannot contain parentheses, commas, colons, quotes, or HTML.")
        for ch in text:
            if not (_is_letter_or_digit(ch) or ch in _KEYWORD_ALLOWED):
                raise ValueError(
                    f"Keyword '{text}' has disallowed characters. Allowed: letters, digits, + # . - and single internal spaces."
                )
        # no doubled internal spaces already handled by normalize_spaces
        canonical = KNOWN_KEYWORD_CASINGS.get(text.casefold(), text)
        if canonical.casefold() in seen:
            continue
        seen.add(canonical.casefold())
        cleaned_out.append(canonical)
    if len(cleaned_out) > MAX_KEYWORDS:
        raise ValueError(f"At most {MAX_KEYWORDS} keywords are allowed.")
    return cleaned_out


def validate_jd_text(plain_text: str) -> str:
    length = len(plain_text or "")
    if length < JD_MIN_CHARS:
        raise ValueError(f"Job description must be at least {JD_MIN_CHARS} characters.")
    if length > JD_MAX_CHARS:
        raise ValueError(f"Job description must be at most {JD_MAX_CHARS} characters.")
    return plain_text


def public_rules() -> dict[str, Any]:
    """Read-only payload for GET /api/jobs/rules (frontend form parity)."""
    return {
        "jdMinChars": JD_MIN_CHARS,
        "jdMaxChars": JD_MAX_CHARS,
        "maxKeywords": MAX_KEYWORDS,
        "keywordMinChars": KEYWORD_MIN_CHARS,
        "keywordMaxChars": KEYWORD_MAX_CHARS,
        "minExperienceYears": MIN_EXPERIENCE_YEARS,
        "maxExperienceYears": MAX_EXPERIENCE_YEARS,
        "positionsMin": MIN_POSITIONS,
        "positionsMax": MAX_POSITIONS,
        "companyNameMin": COMPANY_NAME_MIN,
        "companyNameMax": COMPANY_NAME_MAX,
        "jobRoleMin": JOB_ROLE_MIN,
        "jobRoleMax": JOB_ROLE_MAX,
        "jobTitleMin": JOB_TITLE_MIN,
        "jobTitleMax": JOB_TITLE_MAX,
        "departments": list(DEPARTMENTS),
    }
