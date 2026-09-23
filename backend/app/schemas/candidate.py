"""Pydantic schemas for candidates.

``password`` is deliberately absent: portal passwords are never accepted,
stored, or returned (see models/candidate.py security policy).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class PrimehireIds(BaseModel):
    interviewId: str | None = None
    responseId: str | None = None
    candidateUUID: str | None = None


class SyncState(BaseModel):
    submittedDate: str | None = None
    assessmentStatus: str | None = None
    reportStatus: Literal["GENERATING", "GENERATED", "FAILED"] | None = None
    inviteSent: bool | None = None
    inviteSentAt: str | None = None
    lastInviteSentAt: str | None = None
    lastReminderSentAt: str | None = None
    reminderCount: int = 0
    mailStatus: str | None = None


class MigrationMeta(BaseModel):
    """Informational-only import audit trail. NEVER used for PrimeHire calls,
    report lookup, regeneration, or identity matching."""

    unresolvedResponseId: str | None = None
    unresolvedCandidateUUID: str | None = None


class CandidateIn(BaseModel):
    candidateKey: str | None = None
    assessmentId: str
    name: str
    email: str
    phone: str = ""
    startTime: str = ""
    endTime: str = ""
    link: str | None = None
    assignedDate: str | None = None
    status: Literal["ACTIVE", "INACTIVE"] = "ACTIVE"
    primehire: PrimehireIds = Field(default_factory=PrimehireIds)
    syncState: SyncState = Field(default_factory=SyncState)
    migrationMeta: MigrationMeta = Field(default_factory=MigrationMeta)
    origin: str = "primehire"
    isMock: bool = False

    model_config = {"extra": "forbid"}

    @model_validator(mode="before")
    @classmethod
    def reject_forbidden(cls, data: Any) -> Any:
        if isinstance(data, dict) and ("password" in data or "rowLoading" in data):
            raise ValueError("password/rowLoading must never be sent to the API")
        return data

    def to_doc(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=False)
