"""Deterministic parsed-resume schema (Slice A). LLM enrichment in Slice B."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ParsedResume(BaseModel):
    """Structured fields extracted deterministically from resume text."""

    model_config = ConfigDict(extra="forbid")

    name: str = ""
    email: str = ""
    phone: str = ""
    skills: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)
    experienceYears: float | None = None
    education: list[str] = Field(default_factory=list)
    ctcCurrentLpa: float | None = None
    ctcExpectedLpa: float | None = None
    noticePeriodDays: int | None = None
    summary: str = ""
