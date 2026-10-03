"""Deterministic keyword scoring + combination (Slice B).

Formula `keyword-v1` (documented, versioned in output):
- must-have coverage: 80 pts × matched/total
- nice-to-have weights: 15 pts × matchedWeight/totalWeight (15 if none listed)
- experience band: +5 in band, +3 above max, −10 below min, 0 if unspecified
- knockout: any must-have missing → score capped at 40 + listed + needsReview
- no requirements at all → neutral 60 (nothing to match against)

Combination (weights from org settings, default 70/30):
  final = round(kw × keyword + llm × llmScore) when the LLM answered,
  else keyword. disagreement = |keyword − llm|.
"""

from __future__ import annotations

from typing import Any

from .resume_extract import find_skills, skill_hit

SCORE_VERSION = "keyword-v1"
KNOCKOUT_CAP = 40
DISAGREEMENT_FLAG_AT = 25


def keyword_score(
    *,
    raw_text: str,
    parsed: dict[str, Any],
    job: dict[str, Any],
) -> dict[str, Any]:
    musts = [str(s) for s in (job.get("mustHaveSkills") or [])]
    nice = job.get("niceToHaveSkills") or []
    blob = " ".join([
        raw_text or "",
        " ".join(parsed.get("skills") or []),
        " ".join(parsed.get("languages") or []),
        " ".join(parsed.get("technologies") or []),
    ])

    matched = [m for m in musts if skill_hit(blob, m)]
    missing = [m for m in musts if m not in matched]

    if musts:
        must_pts = 80.0 * len(matched) / len(musts)
    else:
        must_pts = 40.0  # neutral when the job lists no must-haves (a blank
        # resume then scores 55 and pools instead of auto-shortlisting)

    total_w = sum(int(n.get("weight", 1)) for n in nice)
    if total_w > 0:
        got_w = sum(int(n.get("weight", 1)) for n in nice
                    if skill_hit(blob, str(n.get("skill", ""))))
        nice_pts = 15.0 * got_w / total_w
        nice_matched = [str(n.get("skill")) for n in nice
                        if skill_hit(blob, str(n.get("skill", "")))]
        nice_missing = [str(n.get("skill")) for n in nice
                        if str(n.get("skill")) not in nice_matched]
    else:
        nice_pts, nice_matched, nice_missing = 15.0, [], []

    exp = parsed.get("experienceYears")
    min_y, max_y = job.get("minExperienceYears"), job.get("maxExperienceYears")
    if exp is None or (min_y is None and max_y is None):
        exp_pts, exp_note = 0.0, "experience not evaluated"
    elif min_y is not None and exp < min_y:
        exp_pts, exp_note = -10.0, f"below minimum {min_y}y"
    elif max_y is not None and exp > max_y:
        exp_pts, exp_note = 3.0, f"above maximum {max_y}y"
    else:
        exp_pts, exp_note = 5.0, "in band"

    score = int(round(max(0.0, min(100.0, must_pts + nice_pts + exp_pts))))
    knockout = len(missing) > 0
    if knockout:
        score = min(score, KNOCKOUT_CAP)

    return {
        "score": score,
        "matched": matched,
        "missing": missing,
        "niceMatched": nice_matched,
        "niceMissing": nice_missing,
        "knockout": knockout,
        "knockoutMissing": missing,
        "expNote": exp_note,
        "scoreVersion": SCORE_VERSION,
    }


def combine(
    *,
    keyword: int,
    llm_score: int | None,
    keyword_weight: float = 0.7,
    llm_weight: float = 0.3,
) -> dict[str, Any]:
    if llm_score is None:
        return {"final": keyword, "disagreement": 0,
                "llmUsed": False, "weights": {"keyword": keyword_weight, "llm": llm_weight}}
    final = int(round(keyword_weight * keyword + llm_weight * llm_score))
    return {"final": max(0, min(100, final)), "disagreement": abs(keyword - llm_score),
            "llmUsed": True, "weights": {"keyword": keyword_weight, "llm": llm_weight}}


def get_scoring_weights(org_settings: dict[str, Any] | None) -> tuple[float, float]:
    """(keywordWeight, llmWeight) from org settings, default 70/30, normalized."""
    scoring = ((org_settings or {}).get("scoring") or {})
    try:
        kw = float(scoring.get("keywordWeight", 0.7))
        lw = float(scoring.get("llmWeight", 0.3))
    except (TypeError, ValueError):
        kw, lw = 0.7, 0.3
    total = kw + lw
    if total <= 0:
        return 0.7, 0.3
    return round(kw / total, 3), round(lw / total, 3)
