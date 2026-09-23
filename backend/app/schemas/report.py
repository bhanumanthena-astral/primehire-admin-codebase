"""Pydantic schemas for reports (shape-agnostic: rounds differ)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class ReportIn(BaseModel):
    """Inbound report capture. ``raw`` accepts ANY JSON — round shapes differ
    (TECHNICAL overall_result vs BASIC overall_score vs HR competency blocks),
    so no structural validation is applied beyond presence."""

    interviewId: str
    raw: Any
    candidateId: str | None = None
    assessmentId: str | None = None
    responseId: str | None = None
    status: Literal["GENERATED", "GENERATING", "FAILED"] = "GENERATED"
    schemaVersion: int = 1
    normalized: dict[str, Any] | None = None
    error: str | None = None
