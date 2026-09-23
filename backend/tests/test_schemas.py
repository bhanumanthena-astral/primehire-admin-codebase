"""Schema validation: naming aliases, password rejection, shape-agnostic reports."""

import pytest

from app.schemas.assessment import AssessmentIn
from app.schemas.candidate import CandidateIn
from app.schemas.report import ReportIn


def test_assessment_accepts_snake_and_camel():
    snake = AssessmentIn.model_validate(
        {"job_id": "JOB-1", "job_title": "T", "round_type": "HR", "questions": []}
    )
    assert snake.to_doc()["jobId"] == "JOB-1"
    camel = AssessmentIn.model_validate({"jobId": "JOB-2", "jobTitle": "T", "roundType": "BASIC"})
    assert camel.to_doc()["jobTitle"] == "T"


def test_assessment_preserves_lifecycle_fields():
    doc = AssessmentIn.model_validate(
        {"jobId": "J", "jobTitle": "T", "roundType": "TECHNICAL",
         "isActive": False, "createdAt": "2026-01-01T00:00:00.000Z", "deactivatedAt": None}
    ).to_doc()
    assert doc["isActive"] is False
    assert doc["createdAt"] == "2026-01-01T00:00:00.000Z"
    assert doc["deactivatedAt"] is None


def test_assessment_rejects_bad_round():
    with pytest.raises(Exception):
        AssessmentIn.model_validate({"jobId": "J", "jobTitle": "T", "roundType": "NOPE"})


def test_candidate_rejects_password_and_row_loading():
    base = {"assessmentId": "JOB-1", "name": "A", "email": "a@x.com"}
    with pytest.raises(Exception):
        CandidateIn.model_validate({**base, "password": "x"})
    with pytest.raises(Exception):
        CandidateIn.model_validate({**base, "rowLoading": True})
    ok = CandidateIn.model_validate(base)
    assert ok.to_doc()["status"] == "ACTIVE"


def test_report_accepts_any_round_shape():
    technical = {"report": {"overall_result": {"technical_analysis": {"overall_score": 80}}}}
    basic = {"report": {"overall_score": 70, "communication_analysis": {}}}
    hr = {"report": {"overall_result": {"hr_competency_analysis": {}, "personality_insights": {}}}}
    for raw in (technical, basic, hr):
        assert ReportIn.model_validate({"interviewId": "iv", "raw": raw}).raw == raw
