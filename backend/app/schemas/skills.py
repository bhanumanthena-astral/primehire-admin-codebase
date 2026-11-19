"""Shared skill-evidence contract for legacy and Module 2 parsers."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SkillEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    skill: str = Field(min_length=1, max_length=120)
    matchedText: str = Field(default="", max_length=120)
    section: str = Field(default="other", max_length=40)
    page: int | None = Field(default=None, ge=1)
    excerpt: str = Field(default="", max_length=300)
    method: str = Field(default="canonical", max_length=20)
    confidence: float = Field(default=0.8, ge=0, le=1)
    occurrences: int = Field(default=1, ge=1)
