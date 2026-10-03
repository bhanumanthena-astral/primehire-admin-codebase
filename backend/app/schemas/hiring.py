"""Pydantic schemas for the hiring data model (extra=forbid per CLAUDE.md §2)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class Stage(str, Enum):
    RESUME_UPLOADED = "RESUME_UPLOADED"
    PARSED = "PARSED"
    SHORTLISTED = "SHORTLISTED"
    TALENT_POOL = "TALENT_POOL"
    ASSESSMENT_SENT = "ASSESSMENT_SENT"
    ASSESSMENT_COMPLETED = "ASSESSMENT_COMPLETED"
    ROUND1_PENDING_ASSIGNMENT = "ROUND1_PENDING_ASSIGNMENT"
    ROUND1_SCHEDULED = "ROUND1_SCHEDULED"
    ROUND1_REVIEW_PENDING = "ROUND1_REVIEW_PENDING"
    ROUND2_PENDING_ASSIGNMENT = "ROUND2_PENDING_ASSIGNMENT"
    ROUND2_SCHEDULED = "ROUND2_SCHEDULED"
    ROUND2_REVIEW_PENDING = "ROUND2_REVIEW_PENDING"
    HR_ROUND = "HR_ROUND"
    OFFER = "OFFER"
    HIRED = "HIRED"
    REJECTION_PENDING_HR_REVIEW = "REJECTION_PENDING_HR_REVIEW"
    REJECTED = "REJECTED"
    ON_HOLD = "ON_HOLD"
    WITHDRAWN = "WITHDRAWN"


class JobStatus(str, Enum):
    OPEN = "open"
    ON_HOLD = "on_hold"
    CLOSED = "closed"
    FILLED = "filled"


class ApplicationStatus(str, Enum):
    ACTIVE = "active"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    HIRED = "hired"


class WeightedSkill(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skill: str
    weight: int = Field(default=1, ge=1, le=10)


# --- Job Schemas ---

class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobKey: str = Field(..., min_length=2, max_length=100)
    title: str = Field(..., min_length=2, max_length=255)
    description: str = Field(default="")
    mustHaveSkills: list[str] = Field(default_factory=list)
    niceToHaveSkills: list[WeightedSkill] = Field(default_factory=list)
    minExperienceYears: int | None = Field(default=None, ge=0)
    maxExperienceYears: int | None = Field(default=None, ge=0)
    matchThreshold: int = Field(default=60, ge=0, le=100)
    status: JobStatus = Field(default=JobStatus.OPEN)
    assessmentJobId: str | None = None
    assessmentRoundType: str = Field(default="TECHNICAL")
    reuseAssessmentMonths: int = Field(default=6, ge=1, le=24)


class JobUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    mustHaveSkills: list[str] | None = None
    niceToHaveSkills: list[WeightedSkill] | None = None
    minExperienceYears: int | None = None
    maxExperienceYears: int | None = None
    matchThreshold: int | None = None
    status: JobStatus | None = None
    assessmentJobId: str | None = None
    assessmentRoundType: str | None = None
    reuseAssessmentMonths: int | None = None


class JobPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobId: str
    orgId: str
    jobKey: str
    title: str
    description: str
    mustHaveSkills: list[str]
    niceToHaveSkills: list[WeightedSkill]
    minExperienceYears: int | None
    maxExperienceYears: int | None
    matchThreshold: int
    status: str
    assessmentJobId: str | None
    assessmentRoundType: str = "TECHNICAL"
    reuseAssessmentMonths: int
    createdBy: str
    createdAt: datetime
    updatedAt: datetime


# --- Applicant Schemas ---

class ApplicantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(..., min_length=3, max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    phone: str = Field(default="")
    resume: dict[str, Any] = Field(default_factory=dict)
    consent: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class ApplicantUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    phone: str | None = None
    resume: dict[str, Any] | None = None
    consent: dict[str, Any] | None = None
    tags: list[str] | None = None


class ApplicantPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicantId: str
    orgId: str
    email: str
    name: str
    phone: str = ""
    resume: dict[str, Any] = Field(default_factory=dict)
    consent: dict[str, Any] = Field(default_factory=dict)
    retentionUntil: str | None = None
    tags: list[str] = Field(default_factory=list)
    possibleDuplicate: bool = False
    phoneDigits: list[str] = Field(default_factory=list)
    # Triage summary for lists (latest application only; detail lives in profile).
    latestApplication: dict[str, Any] | None = None
    # Legacy flat fields (Phase 1 docs) — kept optional for back-compat reads.
    resumeStoragePath: str | None = None
    parsedResumeData: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime
    updatedAt: datetime


# --- Application Schemas ---

class ApplicationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobId: str
    applicantId: str
    initialStage: Stage = Field(default=Stage.RESUME_UPLOADED)
    candidateKey: str | None = None
    assignedReviewers: list[str] = Field(default_factory=list)
    matchScore: int | None = None
    scoreBreakdown: dict[str, Any] = Field(default_factory=dict)


class ApplicationTransitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    toStage: Stage
    reason: str = Field(default="")
    isOverride: bool = Field(default=False)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RevealRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[str] = Field(default_factory=list)


class ApplicationPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicationId: str
    orgId: str
    jobId: str
    applicantId: str
    currentStage: str
    stageEnteredAt: datetime
    candidateKey: str | None
    assignedReviewers: list[str]
    matchScore: int | None
    scoreBreakdown: dict[str, Any]
    needsReview: bool = False
    reviewReasons: list[str] = Field(default_factory=list)
    talentPool: dict[str, Any] | None = None
    assessment: dict[str, Any] | None = None
    status: str
    createdAt: datetime
    updatedAt: datetime


class StageHistoryPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    historyId: str
    applicationId: str
    fromStage: str
    toStage: str
    transitionAt: datetime
    actorUserId: str
    reason: str
    isOverride: bool = False
    metadata: dict[str, Any]


class AuditLogPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auditId: str
    orgId: str
    actorUserId: str
    action: str
    resourceType: str
    resourceId: str
    details: dict[str, Any]
    ipAddress: str
    createdAt: datetime
