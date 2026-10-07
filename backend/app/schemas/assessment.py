"""Pydantic schemas for assessments (validation boundary for all input)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class QuestionIn(BaseModel):
    id: str = ""
    text: str = Field(default="", alias="question")
    type: Literal["SPEAK_TO_ANSWER", "MCQ"] = "SPEAK_TO_ANSWER"
    maxDuration: int = Field(default=120, alias="max_duration")
    referenceAnswer: str | None = Field(default=None, alias="answer")
    criteria: str | None = None
    options: list[str] | None = None
    correctOption: str | None = Field(default=None, alias="correct_option")
    maxScore: int | None = Field(default=None, alias="max_score")
    weightage: int | None = None

    model_config = {"populate_by_name": True}


class AssessmentIn(BaseModel):
    """Accepts both app (camelCase) and PrimeHire (snake_case) field names."""

    jobId: str = Field(alias="job_id")
    jobTitle: str = Field(alias="job_title")
    jobDescription: str = Field(default="", alias="job_description")
    language: str = "en"
    roundType: Literal["TECHNICAL", "BASIC", "HR"] = Field(alias="round_type")
    questions: list[QuestionIn] = []
    startDate: str | None = Field(default=None, alias="start_date")
    endDate: str | None = Field(default=None, alias="end_date")
    # Local lifecycle fields (absent from PrimeHire payloads, present in
    # browser exports). Preserved verbatim on import, never sent upstream.
    isActive: bool = True
    createdAt: str | None = None
    deactivatedAt: str | None = None

    model_config = {"populate_by_name": True}

    def to_doc(self) -> dict[str, Any]:
        return self.model_dump(by_alias=False, exclude_none=False)


class QuestionPatch(BaseModel):
    """Full question replacement entry for PUT/PATCH (validated as a unit)."""

    id: str = ""
    text: str = ""
    type: Literal["SPEAK_TO_ANSWER", "MCQ"] = "SPEAK_TO_ANSWER"
    maxDuration: int = 120
    referenceAnswer: str | None = None
    criteria: str | None = None
    options: list[str] | None = None
    correctOption: str | None = None
    maxScore: int | None = None
    weightage: int | None = None

    model_config = {"populate_by_name": True}


class AssessmentPut(BaseModel):
    """Full replacement. All content fields required + version for concurrency."""

    version: int
    jobTitle: str
    jobDescription: str = ""
    language: str = "en"
    questions: list[QuestionPatch]
    startDate: str | None = None
    endDate: str | None = None
    isActive: bool | None = None

    model_config = {"extra": "forbid"}

    def to_set_paths(self) -> dict[str, Any]:
        data = AssessmentUpdate(
            version=self.version,
            jobTitle=self.jobTitle,
            jobDescription=self.jobDescription,
            language=self.language,
            questions=self.questions,
            startDate=self.startDate,
            endDate=self.endDate,
            isActive=self.isActive,
        )
        return data.to_set_paths()


class AssessmentUpdate(BaseModel):
    """Partial update. Only provided fields are $set. `version` is required
    for optimistic concurrency (stale writes get HTTP 409)."""

    version: int
    jobTitle: str | None = None
    jobDescription: str | None = None
    language: str | None = None
    questions: list[QuestionPatch] | None = None
    startDate: str | None = None
    endDate: str | None = None
    isActive: bool | None = None

    model_config = {"extra": "forbid"}

    def to_set_paths(self) -> dict[str, Any]:
        paths: dict[str, Any] = {}
        for field in ("jobTitle", "jobDescription", "language", "isActive"):
            value = getattr(self, field)
            if value is not None:
                paths[field] = value
        if self.questions is not None:
            paths["questions"] = [q.model_dump() for q in self.questions]
        for field in ("startDate", "endDate"):
            value = getattr(self, field)
            if value is not None:
                parsed = parse_dt(value)
                paths[field] = parsed
                paths[f"{field}Iso"] = parsed.isoformat() if parsed else None
        return paths


def parse_dt(value: Any):
    from ..models.assessment import parse_dt as _parse

    return _parse(value)
