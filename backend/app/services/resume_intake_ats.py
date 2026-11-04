"""Explainable application-specific scoring; never changes hiring stages."""
import hashlib
import json
import re
from .resume_extract import skill_hit

JOB_FIELDS = ["title", "jobRole", "department", "keywords", "mustHaveSkills", "niceToHaveSkills",
    "minExperienceYears", "maxExperienceYears", "jdText", "jdHtml", "description", "workMode", "location"]


def profile_fingerprint(profile):
    fields = ["skills", "experienceYears", "education", "ugDegree", "pgDegree", "doctorateDegree", "role", "department", "summary", "currentDesignation", "headline", "currentLocation", "preferredLocations"]
    return hashlib.sha256(json.dumps({key: profile.get(key) for key in fields}, sort_keys=True, default=str).encode()).hexdigest()


def job_fingerprint(job):
    return hashlib.sha256(json.dumps({k: job.get(k) for k in JOB_FIELDS}, sort_keys=True, default=str).encode()).hexdigest()


def score(profile, text, job, limits):
    evidence = " ".join([text or "", profile.get("summary", ""), profile.get("currentDesignation", ""),
        profile.get("role", ""), profile.get("department", ""), profile.get("headline", ""), " ".join(profile.get("skills", [])), " ".join(profile.get("education", [])),
        profile.get("ugDegree", ""), profile.get("pgDegree", ""), profile.get("doctorateDegree", "")])
    required = list(dict.fromkeys((job.get("mustHaveSkills") or []) + (job.get("keywords") or [])))[:150]
    confirmed_skills = " ".join(profile.get("skills", []))
    matched = [skill for skill in required if skill_hit(confirmed_skills, skill)]
    missing = [skill for skill in required if skill not in matched]
    skills = round(100 * len(matched) / len(required)) if required else None
    experience = profile.get("experienceYears")
    minimum = float(job.get("minExperienceYears") or 0)
    maximum = job.get("maxExperienceYears")
    exp_score = None if experience is None else 100 if experience >= minimum and (maximum is None or experience <= maximum) else 70 if experience >= minimum else round(100 * experience / max(minimum, 1))
    jd = re.sub(r"<[^>]+>", " ", str(job.get("jdText") or job.get("jdHtml") or job.get("description") or ""))
    # Resume/JD writers use Bachelor, Bachelors and Bachelor's interchangeably.
    normalize_degree = lambda value: re.sub(r"(?i)\b(bachelor|master)(?:['’]s|s)\b", r"\1", value)
    degrees = [term for term in ["bachelor", "master", "phd", "doctorate", "b.tech", "mba", "mca", "bca"] if skill_hit(normalize_degree(jd), term)]
    education_evidence = " ".join([" ".join(profile.get("education", [])), profile.get("ugDegree", ""),
        profile.get("pgDegree", ""), profile.get("doctorateDegree", "")])
    education = None if not degrees or not education_evidence.strip() else round(100 * sum(skill_hit(normalize_degree(education_evidence), term) for term in degrees) / len(degrees))
    stop = {"and", "the", "with", "for", "our", "you", "will", "are", "have", "from", "this", "that", "your", "job", "years", "experience", "work", "team"}
    keywords = required or sorted({token for token in re.findall(r"[A-Za-z][A-Za-z0-9+#.]{2,}", jd.lower()) if token not in stop})[:100]
    keyword = round(100 * sum(skill_hit(evidence, term) for term in keywords) / len(keywords)) if keywords else None
    role_terms = sorted(set(re.findall(r"[A-Za-z]{3,}", f"{job.get('jobRole','')} {job.get('title','')} {job.get('department','')}".lower())) - {"senior", "junior", "lead", "principal"})
    role = round(100 * sum(skill_hit(evidence, term) for term in role_terms) / len(role_terms)) if role_terms else None
    dimensions = {"skills": skills, "experience": exp_score, "education": education, "keyword": keyword, "role": role}
    weights = {"skills": 35, "experience": 20, "education": 10, "keyword": 15, "role": 20}
    assessed = {key: value for key, value in dimensions.items() if value is not None}
    overall = round(sum(assessed[key] * weights[key] for key in assessed) / sum(weights[key] for key in assessed)) if assessed else 0
    category = "Excellent" if overall >= limits.excellentAt else "Good" if overall >= limits.goodAt else "Moderate" if overall >= limits.moderateAt else "Low"
    strengths = ([f"Matched {len(matched)} required skills/keywords."] if matched else []) + (["Experience meets the advertised range."] if exp_score == 100 else [])
    gaps = ([f"Missing: {', '.join(missing[:20])}."] if missing else []) + (["Experience is not available; it was not assumed."] if experience is None else [])
    locations = ' '.join([profile.get('currentLocation',''), *profile.get('preferredLocations',[])])
    if job.get('location') and locations and str(job.get('workMode','')).upper() != 'REMOTE' and not skill_hit(locations,job['location']):
        gaps.append('Confirm location compatibility for this on-site or hybrid job; the declared locations differ.')
    unavailable = [key for key, value in dimensions.items() if value is None]
    return {"overall": max(0, min(100, overall)), "category": category, "breakdown": dimensions,
        "matchedSkills": matched, "missingSkills": missing, "strengths": strengths, "gaps": gaps,
        "unassessed": unavailable, "method": "local_rules", "scoreVersion": "module2-v1",
        "jobSnapshotHash": job_fingerprint(job), "evaluatedAt": None,
        "profileSnapshotHash": profile_fingerprint(profile),
        "note": "Advisory score. Unavailable criteria are excluded and weights renormalized. Personal attributes are not scored."}
