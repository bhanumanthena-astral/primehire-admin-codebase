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
