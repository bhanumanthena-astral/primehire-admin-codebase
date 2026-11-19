"""Explainable application-specific scoring; never changes hiring stages.

Score version history
---------------------
module2-v1
    Treated ``mustHaveSkills + keywords`` as one required list and scored the
    keyword dimension from the same list, double-counting requirements and
    ignoring ``niceToHaveSkills``.
module2-v2
    Mandatory = ``mustHaveSkills`` when present, otherwise ``keywords`` (the
    create-job UI only collects keywords). Preferred = ``niceToHaveSkills`` plus
    any keywords not used as mandatory. Requirements match canonical aliases in
    the reviewed profile; resume evidence explains matches but never overrides a
    reviewer's added/removed skills. Partial credit is explicit (0.5) for every
    matched component of a multi-part requirement such as "AWS EC2". The five UI
    breakdown keys are preserved:
    skills = mandatory coverage, keyword = preferred coverage.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

from .skill_taxonomy import TAXONOMY_VERSION, canonical_skill, extract_skill_evidence, skill_hit

SCORE_VERSION = "module2-v2"

JOB_FIELDS = ["title", "jobRole", "department", "keywords", "mustHaveSkills", "niceToHaveSkills",
    "minExperienceYears", "maxExperienceYears", "jdText", "jdHtml", "description", "workMode", "location"]

_REQUIREMENT_LIMIT = 150
_PARTIAL_CREDIT = 0.5
_RELATED_SHORT = {"AWS", "Spring", "React", "REST", "Django", "Machine Learning", "Node.js", "Next.js", "Vue.js"}
_STOP_ROLE_WORDS = {"senior", "junior", "lead", "principal", "staff", "associate", "the", "and", "with", "for"}
_DEGREE_TERMS = ["bachelor", "master", "phd", "doctorate", "b.tech", "mba", "mca", "bca"]


def profile_fingerprint(profile):
    fields = ["skills", "experienceYears", "education", "ugDegree", "pgDegree", "doctorateDegree", "role", "department", "summary", "currentDesignation", "headline", "currentLocation", "preferredLocations"]
    return hashlib.sha256(json.dumps({key: (profile or {}).get(key) for key in fields}, sort_keys=True, default=str).encode()).hexdigest()


def job_fingerprint(job):
    job = job or {}
    return hashlib.sha256(json.dumps({k: job.get(k) for k in JOB_FIELDS}, sort_keys=True, default=str).encode()).hexdigest()


def _labels(values) -> list[str]:
    """Weighted skills, plain strings and legacy dicts all become labels."""
    output = []
    for value in values or []:
        if isinstance(value, str):
            label = value.strip()
        elif isinstance(value, dict):
            label = str(value.get("skill") or value.get("name") or "").strip()
        else:
            label = str(value or "").strip()
        if label:
            output.append(label)
    return output


def _requirements(values, limit=_REQUIREMENT_LIMIT) -> list[dict]:
    seen: set[str] = set()
    output = []
    for label in _labels(values):
        canonical = canonical_skill(label)
        key = canonical.casefold()
        if not canonical or key in seen:
            continue
        seen.add(key)
        output.append({"label": label, "canonical": canonical})
        if len(output) >= limit:
            break
    return output


def _components(label: str) -> list[dict]:
    """Split a multi-part requirement into known skill components.

    Only known components count. Short aliases such as "js"/"ts"/"bi" are
    ignored as components so "React.js" cannot earn partial credit because a
    profile mentions JavaScript. Generic prose tokens ("framework", "developer")
    never create partial credit, which keeps "AWS EC2" meaningful without
    letting every multi-word phrase score half marks.
    """
    pieces = [part.strip() for part in re.split(r"[^A-Za-z0-9+#.]+", label) if part.strip()]
    output, seen = [], set()
    for piece in pieces:
        if len(piece) <= 2:
            continue
        canonical = canonical_skill(piece)
        known = canonical.casefold() != piece.casefold() or canonical in {"AWS", "SQL", "REST", "Java", "Python", "Go"}
        if known and canonical and canonical.casefold() not in seen:
            seen.add(canonical.casefold())
            output.append({"label": piece, "canonical": canonical})
    return output


def _related(requirement: str, candidate: str) -> bool:
    """True when a specific skill legitimately satisfies a broader requirement."""
    if requirement == candidate:
        return True
    if requirement not in _RELATED_SHORT:
        return False
    shorter, longer = sorted((requirement, candidate), key=len)
    if shorter != requirement or len(shorter) < 3:
        return False
    return bool(re.search(rf"(?<!\w){re.escape(shorter)}(?!\w)", longer, re.IGNORECASE))


def _evidence_index(text: str, profile: dict) -> dict[str, dict]:
    """Evidence for explanation only; it never overrides a reviewer's edits."""
    evidence = extract_skill_evidence(text or "")
    stored = (profile or {}).get("skillEvidence") or []
    by_skill: dict[str, dict] = {}
    for item in stored:
        if isinstance(item, dict):
            canonical = canonical_skill(str(item.get("skill") or ""))
        else:
            canonical = canonical_skill(str(getattr(item, "skill", "") or ""))
        if canonical and canonical not in by_skill:
            by_skill[canonical] = item if isinstance(item, dict) else {"skill": canonical, "excerpt": "", "section": "profile", "method": "profile"}
    for item in evidence:
        by_skill.setdefault(item["skill"], item)
    return by_skill


def _profile_skills(profile: dict) -> set[str]:
    return {canonical_skill(str(skill)) for skill in (profile or {}).get("skills", []) if str(skill).strip()}


def _match(requirement: dict, profile_skills: set[str]) -> dict:
    canonical = requirement["canonical"]
    label = requirement["label"]
    if canonical in profile_skills:
        return {"requirement": label, "canonical": canonical, "status": "matched", "credit": 1.0, "method": "profile", "matchedComponents": [canonical], "missingComponents": []}
    for candidate in profile_skills:
        if _related(canonical, candidate):
            return {"requirement": label, "canonical": candidate, "status": "matched", "credit": 1.0, "method": "related_skill", "matchedComponents": [candidate], "missingComponents": []}
    components = _components(label)
    if len(components) >= 2:
        matched = [part["canonical"] for part in components if part["canonical"] in profile_skills]
        missing = [part["canonical"] for part in components if part["canonical"] not in profile_skills]
        if matched:
            return {"requirement": label, "canonical": canonical, "status": "partial", "credit": _PARTIAL_CREDIT, "method": "component", "matchedComponents": matched, "missingComponents": missing}
    return {"requirement": label, "canonical": canonical, "status": "missing", "credit": 0.0, "method": "none", "matchedComponents": [], "missingComponents": [canonical]}


def _finite_number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(float(value)) else None


def _experience_score(profile: dict, job: dict) -> float | None:
    experience = _finite_number((profile or {}).get("experienceYears"))
    if experience is None:
        return None
    minimum = _finite_number(job.get("minExperienceYears")) or 0.0
    maximum = _finite_number(job.get("maxExperienceYears"))
    if minimum < 0:
        minimum = 0.0
    if experience >= minimum and (maximum is None or experience <= maximum):
        return 100.0
    if experience >= minimum:
        return 70.0
    return round(100 * experience / max(minimum, 1), 1)


def _education_score(profile: dict, job: dict) -> float | None:
    jd = re.sub(r"<[^>]+>", " ", str(job.get("jdText") or job.get("jdHtml") or job.get("description") or ""))
    normalize_degree = lambda value: re.sub(r"(?i)\b(bachelor|master)(?:['’]s|s)\b", r"\1", value)
    degrees = [term for term in _DEGREE_TERMS if skill_hit(normalize_degree(jd), term)]
    evidence = " ".join([" ".join((profile or {}).get("education", [])), (profile or {}).get("ugDegree", ""),
        (profile or {}).get("pgDegree", ""), (profile or {}).get("doctorateDegree", "")])
    if not degrees or not evidence.strip():
        return None
    matched = sum(skill_hit(normalize_degree(evidence), term) for term in degrees)
    return round(100 * matched / len(degrees), 1)


def _role_score(profile: dict, job: dict, text: str) -> float | None:
    source = f"{job.get('jobRole', '')} {job.get('title', '')} {job.get('department', '')}".lower()
    terms = sorted({term for term in re.findall(r"[A-Za-z]{3,}", source) if term not in _STOP_ROLE_WORDS})
    if not terms:
        return None
    evidence = " ".join([text or "", (profile or {}).get("summary", ""), (profile or {}).get("currentDesignation", ""),
        (profile or {}).get("role", ""), (profile or {}).get("department", ""), (profile or {}).get("headline", "")])
    return round(100 * sum(skill_hit(evidence, term) for term in terms) / len(terms), 1)


def _weighted_preferred(values, matches: list[dict]) -> tuple[int, int]:
    total = matched = 0
    seen = set()
    by_label = {item["requirement"].casefold(): item for item in matches}
    by_canonical = {item["canonical"].casefold(): item for item in matches}
    for value in values or []:
        weight = 1
        if isinstance(value, str):
            label = value.strip()
        elif isinstance(value, dict):
            label = str(value.get("skill") or value.get("name") or "").strip()
            raw_weight = value.get("weight", 1)
            weight = max(1, min(10, int(raw_weight))) if isinstance(raw_weight, int) and not isinstance(raw_weight, bool) else 1
        else:
            label = str(value or "").strip()
        if not label:
            continue
        key = canonical_skill(label).casefold()
        if key in seen:
            continue
        seen.add(key)
        total += weight
        result = by_label.get(label.casefold()) or by_canonical.get(key)
        if result:
            matched += weight * result["credit"]
    return int(round(matched)), total


def score(profile, text, job, limits):
    profile = profile or {}
    job = job or {}
    mandatory_values = job.get("mustHaveSkills") or []
    keyword_values = job.get("keywords") or []
    preferred_values = list(job.get("niceToHaveSkills") or [])
    if not mandatory_values:
        mandatory_values = keyword_values
    else:
        mandatory_keys = {canonical_skill(value).casefold() for value in mandatory_values if isinstance(value, str)}
        preferred_values = [value for value in preferred_values
            if not isinstance(value, str) or canonical_skill(value).casefold() not in mandatory_keys]
        preferred_values += [value for value in keyword_values
            if not isinstance(value, str) or canonical_skill(value).casefold() not in mandatory_keys]
    mandatory = _requirements(mandatory_values)
    preferred = _requirements(preferred_values)
    profile_set = _profile_skills(profile)
    raw_evidence = _evidence_index(text, profile)

    mandatory_matches = [_match(item, profile_set) for item in mandatory]
    preferred_matches = [_match(item, profile_set) for item in preferred]
    mandatory_credit = sum(item["credit"] for item in mandatory_matches)
    skills = round(100 * mandatory_credit / len(mandatory_matches), 1) if mandatory_matches else None
    preferred_matched_weight, preferred_total_weight = _weighted_preferred(preferred_values, preferred_matches)
    keyword = round(100 * preferred_matched_weight / preferred_total_weight, 1) if preferred_total_weight else None

    experience = _experience_score(profile, job)
    education = _education_score(profile, job)
    role = _role_score(profile, job, text)

    matched = [item["canonical"] for item in mandatory_matches if item["status"] == "matched"]
    missing = [item["requirement"] for item in mandatory_matches if item["status"] == "missing"]
    partial = [item for item in mandatory_matches if item["status"] == "partial"]
    matched_preferred = [item["canonical"] for item in preferred_matches if item["status"] in {"matched", "partial"}]
    missing_preferred = [item["requirement"] for item in preferred_matches if item["status"] == "missing"]

    match_evidence = []
    for item in mandatory_matches + preferred_matches:
        if item["status"] == "missing":
            continue
        evidence = raw_evidence.get(item["canonical"]) or {}
        match_evidence.append({"requirement": item["requirement"], "canonical": item["canonical"],
            "status": item["status"], "method": item["method"],
            "section": evidence.get("section", ""), "excerpt": str(evidence.get("excerpt", ""))[:280],
            "matchedComponents": item["matchedComponents"], "missingComponents": item["missingComponents"]})
        if len(match_evidence) >= 40:
            break

    dimensions = {"skills": skills, "experience": experience, "education": education, "keyword": keyword, "role": role}
    weights = {"skills": 35, "experience": 20, "education": 10, "keyword": 15, "role": 20}
    assessed = {key: value for key, value in dimensions.items() if value is not None}
    overall = round(sum(assessed[key] * weights[key] for key in assessed) / sum(weights[key] for key in assessed)) if assessed else 0
    overall = max(0, min(100, overall)) if isinstance(overall, (int, float)) and math.isfinite(overall) else 0
    category = "Excellent" if overall >= limits.excellentAt else "Good" if overall >= limits.goodAt else "Moderate" if overall >= limits.moderateAt else "Low"

    strengths = []
    if mandatory_matches:
        strengths.append(f"Matched {len(matched)} of {len(mandatory_matches)} mandatory skills/keywords.")
    if matched_preferred:
        strengths.append(f"Evidenced {len(matched_preferred)} preferred skill(s).")
    if experience == 100:
        strengths.append("Experience meets the advertised range.")
    if education == 100:
        strengths.append("Education meets the stated requirement.")
    gaps = []
    if missing:
        gaps.append(f"Missing mandatory: {', '.join(missing[:20])}.")
    if partial:
        gaps.append("Partial mandatory evidence: " + "; ".join(
            f"{item['requirement']} (matched {', '.join(item['matchedComponents'])})" for item in partial[:10]) + ".")
    if missing_preferred:
        gaps.append(f"Preferred skills not evidenced: {', '.join(missing_preferred[:15])}.")
    if experience is None:
        gaps.append("Experience is not available; it was not assumed.")
    locations = ' '.join([profile.get('currentLocation', ''), *profile.get('preferredLocations', [])])
    if job.get('location') and locations and str(job.get('workMode', '')).upper() != 'REMOTE' and not skill_hit(locations, job['location']):
        gaps.append('Confirm location compatibility for this on-site or hybrid job; the declared locations differ.')
    unavailable = [key for key, value in dimensions.items() if value is None]

    score_components = {
        "mandatory": {"matched": len(matched), "partial": len(partial), "missing": len(missing), "total": len(mandatory_matches), "points": round(mandatory_credit, 2)},
        "preferred": {"matchedWeight": preferred_matched_weight, "totalWeight": preferred_total_weight},
        "weights": weights,
    }
    return {
        "overall": int(overall),
        "category": category,
        "breakdown": dimensions,
        "matchedSkills": matched,
        "missingSkills": missing,
        "matchedPreferredSkills": matched_preferred,
        "missingPreferredSkills": missing_preferred,
        "partialMatches": partial,
        "matchEvidence": match_evidence,
        "scoreComponents": score_components,
        "strengths": strengths,
        "gaps": gaps,
        "unassessed": unavailable,
        "method": "local_rules",
        "scoreVersion": SCORE_VERSION,
        "taxonomyVersion": TAXONOMY_VERSION,
        "jobSnapshotHash": job_fingerprint(job),
        "evaluatedAt": None,
        "profileSnapshotHash": profile_fingerprint(profile),
        "note": "Advisory score. Mandatory requirements are must-have skills when present, otherwise keywords; preferred requirements are nice-to-have skills plus remaining keywords. A partial match earns half credit only when a known component is evidenced. Unavailable criteria are excluded and weights renormalized. Personal attributes are not scored. A human makes every hiring decision.",
    }
