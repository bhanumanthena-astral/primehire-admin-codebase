"""Skill extraction precision/recall and Module 2 ATS explanation contracts."""
from app.schemas.resume_intake import CandidateProfile, IntakeSettings
from app.services import skill_taxonomy as taxonomy
from app.services.resume_extract import deterministic_parse
from app.services.resume_intake_ats import SCORE_VERSION, score
from app.services.resume_intake_projection import project_profile

RESUME = """\
Priya Sharma
priya.sharma@example.com | +91 98765 43210
Professional Summary
Backend engineer building reliable services.
Skills: Python, React.js, AWS EC2, PostgreSQL, Docker, Kubernetes, Spring Boot, Django REST Framework, Node.js, jQuery
Experience
- Built APIs with Python and React.
- No experience with Java.
Projects
- Power BI dashboard; scikit-learn model; Tableau reports; Salesforce integration.
"""


def test_parser_recalls_aliases_and_rejects_negated_or_contact_matches():
    parsed = deterministic_parse(RESUME)
    skills = set(parsed["skills"])
    assert {"Python", "React", "AWS EC2", "scikit-learn", "Power BI",
            "Tableau", "Salesforce", "Spring Boot", "Django REST Framework"} <= skills
    assert "Java" not in skills
    assert parsed["parserVersion"] == taxonomy.PARSER_VERSION
    assert parsed["taxonomyVersion"] == taxonomy.TAXONOMY_VERSION
    assert parsed["skillEvidence"]
    assert all(item["skill"] in skills for item in parsed["skillEvidence"])


def test_ambiguous_one_letter_and_common_word_skills_need_real_context():
    assert not taxonomy.skill_hit("ready to go the extra mile", "Go")
    assert not taxonomy.skill_hit("I use R&D and C-level meetings", "R")
    assert not taxonomy.skill_hit("I use R&D and C-level meetings", "C")
    assert taxonomy.skill_hit("Languages: Go, C, R", "Go")
    assert taxonomy.skill_hit("Languages: Go, C, R", "C")
    assert taxonomy.skill_hit("Languages: Go, C, R", "R")
    assert taxonomy.find_skills("Go, C, R", ["Go", "C", "R"]) == ["Go", "C", "R"]


def test_aliases_are_symmetric_and_never_cross_match_javascript():
    assert taxonomy.canonical_skill("React.js") == "React"
    assert taxonomy.canonical_skill("React JS") == "React"
    assert taxonomy.skill_hit("ReactJS", "React")
    assert taxonomy.skill_hit("NodeJS services", "Node.js")
    assert taxonomy.skill_hit("JS and TS", "JavaScript")
    assert not taxonomy.skill_hit("Node.js services", "JavaScript")
    assert not taxonomy.skill_hit("TypeScript services", "JavaScript")


def test_ats_uses_mandatory_then_keywords_and_explains_partial_credit():
    profile = CandidateProfile(name="Priya", skills=["React", "AWS", "scikit-learn", "Tableau", "Power BI"]).model_dump()
    job = {"title": "Backend Engineer", "jobRole": "Backend Engineer",
        "mustHaveSkills": ["React.js", "AWS EC2", "scikit-learn"],
        "niceToHaveSkills": [{"skill": "Tableau", "weight": 2}],
        "keywords": ["Power BI"]}
    result = score(profile, RESUME, job, IntakeSettings())
    assert result["breakdown"]["skills"] == 83.3
    assert result["breakdown"]["keyword"] == 100
    assert set(result["scoreComponents"]["weights"]) == {
        "skills", "experience", "education", "keyword", "role"}
    assert set(result["breakdown"]) == {"skills", "experience", "education", "keyword", "role"}
    assert result["matchedSkills"] == ["React", "scikit-learn"]
    assert result["partialMatches"][0]["requirement"] == "AWS EC2"
    assert result["partialMatches"][0]["matchedComponents"] == ["AWS"]
    assert result["matchedPreferredSkills"] == ["Tableau", "Power BI"]
    assert result["missingPreferredSkills"] == []
    assert result["scoreVersion"] == SCORE_VERSION
    assert result["taxonomyVersion"] == taxonomy.TAXONOMY_VERSION
    evidence = {item["requirement"]: item for item in result["matchEvidence"]}
    assert "AWS" in evidence["AWS EC2"]["matchedComponents"]


def test_reviewed_skills_override_resume_text_for_scoring():
    profile = CandidateProfile(name="Priya", skills=["Chemistry"]).model_dump()
    result = score(profile, RESUME, {"keywords": ["Python", "SQL"]}, IntakeSettings())
    assert result["breakdown"]["skills"] == 0
    assert result["matchedSkills"] == []
    assert set(result["breakdown"]) == {"skills", "experience", "education", "keyword", "role"}


def test_non_detail_projection_keeps_skills_and_redacts_nested_evidence():
    profile = CandidateProfile(name="Priya", email="priya.sharma@example.com", phone="9876543210",
        skills=["Python"], skillEvidence=[{"skill": "Python", "excerpt": "priya.sharma@example.com 9876543210 Python"}]).model_dump()
    projected = project_profile(profile, detail=False)
    assert projected["skills"] == ["Python"]
    assert "skillEvidence" not in projected
    assert "priya.sharma@example.com" not in projected["email"]
    detail = project_profile(profile, detail=True)
    assert detail["skillEvidence"][0]["excerpt"].find("priya.sharma@example.com") == -1
    assert detail["skillEvidence"][0]["excerpt"].find("9876543210") == -1
