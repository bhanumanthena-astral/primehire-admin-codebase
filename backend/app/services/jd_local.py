"""Deterministic JD field extraction. No provider, network, or persistence."""
from __future__ import annotations

import re
from typing import Any

from .resume_extract import SKILLS, find_skills

LABELS = {
    "company": "companyName", "company name": "companyName",
    "organization": "companyName", "organisation": "companyName",
    "experience": "experienceText", "experience required": "experienceText", "experience range": "experienceText",
    "job role": "jobRole", "role": "jobRole",
    "job title": "jobTitle", "title": "jobTitle",
    "department": "department", "minimum experience": "minExperience",
    "min experience": "minExperience", "maximum experience": "maxExperience",
    "max experience": "maxExperience", "number of positions": "positionsTotal",
    "positions": "positionsTotal", "openings": "positionsTotal",
    "keywords": "keywords", "skills": "keywords", "required skills": "keywords",
    "opened at": "openedAt", "closes at": "closesAt",
    "closing date": "closesAt", "assignee": "assigneeText",
    "work mode": "workMode", "location": "location",
}


def extract_local_fields(text: str) -> dict[str, Any]:
    """Only explicit labels/ranges; conflicts stay missing for human review."""
    out: dict[str, Any] = {"keywords": [], "warnings": [], "evidence": {}}
    conflicts: set[str] = set()
    # Word tables can serialize as label/value rows, stacked cell paragraphs,
    # or pipe-separated columns. Scan each cell while retaining the original JD.
    cells = [part.strip() for part in re.split(r"[\n|]", text.replace("\u00a0", " ")) if part.strip()]
    section_names = {"job description", "role overview", "key responsibilities", "required skills",
        "required technical skills", "preferred qualifications", "nice to have", "role expectations"}
    def add(key, value, evidence):
        if key == "keywords":
            value = [v.strip() for v in re.split(r"[,;]", value) if v.strip()]
        if key in out and out[key] and out[key] != value:
            conflicts.add(key)
        else:
            out[key] = value
            out["evidence"][key] = evidence[:500]

    for index, cell in enumerate(cells):
        match = re.match(r"^([\w .-]+)\s*:\s*(.+)$", cell)
        label = match[1].strip().lower() if match else cell.rstrip(":").strip().lower()
        key = LABELS.get(label)
        if not key:
            continue
        value = match[2].strip() if match else (cells[index + 1] if index + 1 < len(cells) else "")
        # Never mistake the next heading/label for a missing value.
        next_label = value.rstrip(":").strip().lower()
        if not value or not match and (next_label in LABELS or next_label in section_names):
            continue
        add(key, value, cell if match else f"{cell}: {value}")

    for key in conflicts:
        out.pop(key, None)
        out["warnings"].append(f"Conflicting {key} values; enter this field manually.")
    # A short role heading is explicit document evidence even without a colon.
    if not out.get("jobTitle") and "jobTitle" not in conflicts:
        for cell in cells[:5]:
            if len(cell) <= 120 and len(cell.split()) <= 12 and re.search(r"\b(developer|engineer|manager|analyst|designer|architect|specialist|consultant|lead|executive|officer|intern)\b", cell, re.I) and not re.search(r"[:.!?]|\b(is|seeking|hiring|looking)\b", cell, re.I):
                out["jobTitle"] = cell
                out["evidence"]["jobTitle"] = cell
                break
    if out.get("jobTitle") and not out.get("jobRole") and "jobRole" not in conflicts:
        out["jobRole"] = out["jobTitle"]
        out["evidence"]["jobRole"] = out["evidence"].get("jobTitle", out["jobTitle"])
    if not out.get("companyName") and "companyName" not in conflicts:
        companies = re.findall(r"(?im)^\s*([\w][\w &.\-]{1,99}?)\s+is\s+(?:looking for|seeking|hiring)\b", text)
        if len(set(companies)) == 1:
            out["companyName"] = companies[0].strip()
            out["evidence"]["companyName"] = companies[0] + " is hiring"
    if not out.get("minExperience") and not out.get("maxExperience") and not conflicts.intersection({"minExperience", "maxExperience", "experienceText"}):
        experience_source = out.get("experienceText") or text
        ranges = re.findall(r"\b(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b", experience_source, re.I)
        if len(set(ranges)) == 1:
            out["minExperience"], out["maxExperience"] = ranges[0]
            out["evidence"]["experience"] = f"{ranges[0][0]}–{ranges[0][1]} years"
        elif not ranges:
            minima = re.findall(r"\b(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)\b", experience_source, re.I)
            minima += re.findall(r"\b(?:at least|minimum(?: of)?)\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b", experience_source, re.I)
            if not minima and out.get("experienceText"):
                minima = re.findall(r"^(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b", experience_source, re.I)
            if len(set(minima)) == 1:
                out["minExperience"] = minima[0]
                out["evidence"]["minExperience"] = out["evidence"].get("experienceText", f"{minima[0]}+ years")
                out["warnings"].append("No maximum experience is stated; enter it manually if required.")
    if out.get("workMode"):
        mode = out["workMode"].lower()
        if re.search(r"\bhybrid\b", mode):
            out["workMode"] = "HYBRID"
        else:
            onsite = bool(re.search(r"on[ -]?site|work[ -]?from[ -]?office|\bwfo\b", mode))
            remote = bool(re.search(r"\bremote\b|work[ -]?from[ -]?home|\bwfh\b", mode))
            if onsite != remote:
                out["workMode"] = "ONSITE" if onsite else "REMOTE"
    if not out.get("keywords") and "keywords" not in conflicts:
        out["keywords"] = find_skills(text, SKILLS)[:20]
    # Keep the full substantive description, never silently summarize/truncate.
    description_heading = re.search(r"(?im)^\s*job description[ \t]*:", text)
    out["jobDescription"] = text[description_heading.end():].strip() if description_heading else text
    out["evidence"]["jobDescription"] = out["jobDescription"][:500]
    # Internal label text is not part of the strict extraction/review contract.
    out.pop("experienceText", None)
    return out
