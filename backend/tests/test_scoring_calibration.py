"""Calibration: ~10 synthetic resumes of known quality against keyword-v1.

Asserts the documented contract in docs/SCORING.md: strong ≥ threshold,
weak below, knockout cap, and hard 0–100 bounds on every input.
"""

from app.services.scoring import combine, keyword_score

JOB = {
    "mustHaveSkills": ["Python", "SQL"],
    "niceToHaveSkills": [{"skill": "AWS", "weight": 2}, {"skill": "Docker", "weight": 1}],
    "minExperienceYears": 2,
    "maxExperienceYears": 8,
}

THRESHOLD = 60


def _parsed(skills, exp, extra=None):
    base = {"skills": list(skills), "languages": [], "technologies": [],
            "experienceYears": exp}
    if extra:
        base.update(extra)
    return base


CASES = [
    # (label, skills, exp, expect_ge_threshold, expect_knockout)
    ("staff_engineer", ["Python", "SQL", "AWS", "Docker"], 6.0, True, False),
    ("solid_mid", ["Python", "SQL", "AWS"], 3.0, True, False),
    ("minimal_fit", ["Python", "SQL"], 2.0, True, False),
    ("capable_junior_below_min_exp", ["Python", "SQL"], 1.0, True, False),  # 80+0-10=70
    ("senior_above_max", ["Python", "SQL", "AWS"], 12.0, True, False),
    ("missing_one_must", ["Python", "AWS", "Docker"], 5.0, False, True),
    ("missing_all_must", ["Java", "React"], 5.0, False, True),
    ("unrelated", ["Excel", "Typing"], 4.0, False, True),
    ("no_skills_listed", [], 5.0, False, True),
    ("no_experience_parsed", ["Python", "SQL", "AWS", "Docker"], None, True, False),
]


def test_calibration_split_and_bounds():
    for label, skills, exp, above, knockout in CASES:
        kw = keyword_score(raw_text=" ".join(skills), parsed=_parsed(skills, exp), job=JOB)
        assert 0 <= kw["score"] <= 100, label
        assert (kw["score"] >= THRESHOLD) == above, f"{label}: {kw['score']}"
        assert kw["knockout"] == knockout, label
        if knockout:
            assert kw["score"] <= 40, f"{label}: knockout cap"
            assert kw["knockoutMissing"], label


def test_no_musts_neutral_base_no_knockout():
    job = {"mustHaveSkills": [], "niceToHaveSkills": [],
           "minExperienceYears": 2, "maxExperienceYears": 8}
    low = keyword_score(raw_text="Excel", parsed=_parsed([], 1.0), job=job)
    assert low["score"] == 45  # 40 + 15 - 10
    assert low["knockout"] is False
    assert low["score"] < THRESHOLD


def test_formula_exactness_documented_example():
    kw = keyword_score(
        raw_text="Python SQL",
        parsed=_parsed(["Python", "SQL"], 6.0),
        job={"mustHaveSkills": ["Python", "SQL"], "niceToHaveSkills": [],
             "minExperienceYears": None, "maxExperienceYears": None},
    )
    assert kw["score"] == 95  # 80 + 15 + 0, see docs/SCORING.md
    assert kw["matched"] == ["Python", "SQL"] and kw["missing"] == []


def test_combine_bounds_and_fallback():
    assert combine(keyword=95, llm_score=100)["final"] == 96  # 96.5 → banker's 96
    assert combine(keyword=0, llm_score=0)["final"] == 0
    assert combine(keyword=100, llm_score=100)["final"] == 100
    assert combine(keyword=42, llm_score=None)["final"] == 42
    assert combine(keyword=42, llm_score=None)["llmUsed"] is False
    assert all(0 <= combine(keyword=k, llm_score=l)["final"] <= 100
               for k in (0, 40, 95, 100) for l in (None, 0, 77, 100))
