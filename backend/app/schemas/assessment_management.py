"""Validated V2 configuration, shared by the form and grouped CSV imports."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ConfigQuestion(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, allow_inf_nan=False)
    id: str = Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]{0,79}$')
    text: str = Field(min_length=1, max_length=12000)
    type: Literal['SPEAK_TO_ANSWER', 'MCQ']
    maxDuration: int = Field(gt=0, le=3600, strict=True)
    referenceAnswer: str = Field(min_length=1, max_length=12000)
    criteria: str | None = Field(default=None, max_length=12000)
    options: list[str] | None = Field(default=None, min_length=2, max_length=8)
    correctOption: str | None = Field(default=None, max_length=4000)
    maxScore: float | None = Field(default=None, gt=0, le=1000, strict=True)
    weightage: float | None = Field(default=None, ge=0, le=100, strict=True)

    @model_validator(mode='after')
    def mcq(self):
        if self.type == 'MCQ':
            options = [value.strip() for value in self.options or []]
            if len(options) < 2 or any(not value or len(value) > 4000 for value in options):
                raise ValueError('MCQ needs at least two non-empty options')
            if len(set(options)) != len(options):
                raise ValueError('MCQ options must be distinct')
            if self.correctOption not in options:
                raise ValueError('Correct Answer must match one MCQ option')
            self.options = options
        return self


class AssessmentConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    jobId: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    jobTitle: str = Field(min_length=1, max_length=200)
    jobDescription: str = Field(min_length=1, max_length=30000)
    language: Literal['ENGLISH', 'DUTCH']
    roundType: Literal['BASIC', 'TECHNICAL', 'HR']
    startDate: datetime
    endDate: datetime
    questions: list[ConfigQuestion] = Field(min_length=1, max_length=100)

    @field_validator('language', mode='before')
    @classmethod
    def language_alias(cls, value):
        return {'EN': 'ENGLISH', 'NL': 'DUTCH'}.get(str(value).upper(), str(value).upper())

    @model_validator(mode='after')
    def configuration(self):
        if not self.startDate.tzinfo or not self.endDate.tzinfo:
            raise ValueError('Dates must include a timezone')
        if self.endDate <= self.startDate:
            raise ValueError('End Date must be later than Start Date')
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError('Question IDs must be unique')
        if self.roundType != 'HR':
            if any(question.maxScore is None or question.weightage is None for question in self.questions):
                raise ValueError('Max Score and Weightage are required for BASIC and TECHNICAL')
            if abs(sum(question.weightage for question in self.questions) - 100) > 0.000001:
                raise ValueError('Question weightages must total 100%')
        return self


class SaveDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    config: AssessmentConfig
    expectedRevision: int | None = Field(default=None, ge=1)


class PublishDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expectedRevision: int = Field(ge=1)
    confirmed: Literal[True]


class CsvText(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=2_000_000)


class ConfirmCsv(CsvText):
    previewHash: str = Field(pattern=r'^[a-f0-9]{64}$')
    confirmed: Literal[True]
