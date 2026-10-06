"""Pydantic schemas for the hiring data model (extra=forbid per CLAUDE.md §2)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from html import escape as html_escape
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic import StrictInt


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
    """Legacy pre-lifecycle statuses (kept for migration readability only).

    New code must use JobLifecycle. Migration 003 converts stored values.
    """

    OPEN = "open"
    ON_HOLD = "on_hold"
    CLOSED = "closed"
    FILLED = "filled"


class JobLifecycle(str, Enum):
    """Job requisition lifecycle (PRD §7). The single source of truth."""

    DRAFT = "DRAFT"
    OPEN = "OPEN"
    ON_HOLD = "ON_HOLD"
    CLOSED = "CLOSED"
    ARCHIVED = "ARCHIVED"


class WorkMode(str, Enum):
    ONSITE = "ONSITE"
    REMOTE = "REMOTE"
    HYBRID = "HYBRID"


# Rules constants moved to ..jobs.rules (imported below) and enforced there.


# PRD Jobs validation matrix now lives in app/jobs/rules.py (single source
# of truth); these names are kept as re-exports for existing imports.
from ..jobs.rules import (  # noqa: E402,F401
    JD_MIN_CHARS,
    JD_MAX_CHARS,
    MAX_KEYWORDS,
    validate_company_name,
    validate_department,
    validate_experience_years,
    validate_jd_text,
    validate_job_role,
    validate_job_title,
    validate_keywords,
    validate_positions,
)


def normalize_keywords(raw: Any) -> list[str]:
    """Trim, dedupe (case-insensitive), canonical casing, matrix charset.

    Now enforces the Slice V1 keyword rules (1-50 chars, allowed charset,
    max 20) instead of only trimming/deduping.
    """
    return validate_keywords(raw)


def jd_text_of(html: str) -> str:
    """Best-effort plain-text extraction from stored JD HTML (no deps)."""
    import re

    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]*>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


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
    # PRD §1: mandatory requisition fields.
    companyName: str = Field(..., min_length=1, max_length=255)
    jobRole: str = Field(..., min_length=1, max_length=255)
    department: str = Field(..., min_length=1, max_length=255)
    minExperienceYears: float = Field(..., ge=0)
    maxExperienceYears: float = Field(..., ge=0)
    positionsTotal: StrictInt = Field(..., ge=1, le=1000)
    keywords: list[str] = Field(default_factory=list)
    openedAt: datetime | None = None
    closesAt: datetime
    assigneeUserId: str = Field(..., min_length=1, max_length=100)
    # Optional: supplied by the JD template (§10) or a later edit.
    workMode: WorkMode | None = None
    location: str | None = Field(default=None, max_length=255)
    # PRD §8: rich-text JD is mandatory; length enforced on plain text.
    jdHtml: str = Field(..., min_length=1)
    jdTemplateVersion: str | None = Field(default=None, max_length=50)
    # Legacy plain-text description (kept for transition; prefer jdHtml).
    description: str = Field(default="")
    mustHaveSkills: list[str] = Field(default_factory=list)
    niceToHaveSkills: list[WeightedSkill] = Field(default_factory=list)
    matchThreshold: int = Field(default=60, ge=0, le=100)
    lifecycleStatus: JobLifecycle = Field(default=JobLifecycle.DRAFT)
    assessmentJobId: str | None = None
    assessmentRoundType: str = Field(default="TECHNICAL")
    reuseAssessmentMonths: int = Field(default=6, ge=1, le=24)

    @model_validator(mode="after")
    def _check_ranges(self) -> "JobCreate":
        self.companyName = validate_company_name(self.companyName)
        self.jobRole = validate_job_role(self.jobRole)
        self.title = validate_job_title(self.title)
        self.department = validate_department(self.department)
        self.keywords = validate_keywords(self.keywords)
        validate_experience_years(self.minExperienceYears)
        validate_experience_years(self.maxExperienceYears)
        if self.maxExperienceYears < self.minExperienceYears:
            raise ValueError("maxExperienceYears must be >= minExperienceYears")
        if self.openedAt is not None and self.closesAt <= self.openedAt:
            raise ValueError("closesAt must be greater than openedAt")
        plain = jd_text_of(self.jdHtml)
        validate_jd_text(plain)
        return self


class JobUpdate(BaseModel):
    """Editable subset (PRD §19): JD, keywords, assignee, closing date,
    positions (+title/description carried over from the existing API).
    jobId/jobKey/companyName/jobRole are ABSENT — sending them 422s via
    extra="forbid", which keeps the Job ID and identity fields immutable.
    Lifecycle transitions go through dedicated close/reopen/archive endpoints.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = None
    jdHtml: str | None = None
    keywords: list[str] | None = None
    assigneeUserId: str | None = Field(default=None, min_length=1, max_length=100)
    closesAt: datetime | None = None
    positionsTotal: StrictInt | None = Field(default=None, ge=1, le=1000)
    workMode: WorkMode | None = None
    location: str | None = Field(default=None, max_length=255)
    minExperienceYears: float | None = Field(default=None, ge=0)
    maxExperienceYears: float | None = Field(default=None, ge=0)
    matchThreshold: int | None = Field(default=None, ge=0, le=100)
    assessmentJobId: str | None = None
    assessmentRoundType: str | None = None
    reuseAssessmentMonths: int | None = Field(default=None, ge=1, le=24)

    @model_validator(mode="after")
    def _check_update(self) -> "JobUpdate":
        if self.keywords is not None:
            self.keywords = validate_keywords(self.keywords)
        if self.title is not None:
            self.title = validate_job_title(self.title)
        if self.minExperienceYears is not None:
            validate_experience_years(self.minExperienceYears)
        if self.maxExperienceYears is not None:
            validate_experience_years(self.maxExperienceYears)
        if (
            self.minExperienceYears is not None
            and self.maxExperienceYears is not None
            and self.maxExperienceYears < self.minExperienceYears
        ):
            raise ValueError("maxExperienceYears must be >= minExperienceYears")
        if self.positionsTotal is not None:
            validate_positions(self.positionsTotal)
        if self.jdHtml is not None:
            validate_jd_text(jd_text_of(self.jdHtml))
        return self


class JobPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobId: str
    orgId: str
    jobKey: str
    companyName: str = ""
    jobRole: str = ""
    title: str
    department: str = ""
    minExperienceYears: float | None = None
    maxExperienceYears: float | None = None
    positionsTotal: int = 1
    positionsFilled: int = 0
    positionsRemaining: int = 1
    keywords: list[str] = Field(default_factory=list)
    workMode: WorkMode | None = None
    location: str | None = None
    openedAt: datetime | None = None
    closesAt: datetime | None = None
    assigneeUserId: str | None = None
    assigneeEmail: str | None = None
    jdHtml: str = ""
    jdText: str = ""
    jdTemplateVersion: str | None = None
    lifecycleStatus: str = JobLifecycle.DRAFT.value
    closedAt: datetime | None = None
    archivedAt: datetime | None = None
    description: str = ""
    mustHaveSkills: list[str]
    niceToHaveSkills: list[WeightedSkill]
    matchThreshold: int
    assessmentJobId: str | None
    assessmentRoundType: str = "TECHNICAL"
    reuseAssessmentMonths: int
    createdBy: str
    createdAt: datetime
    updatedAt: datetime

    @model_validator(mode="before")
    @classmethod
    def _derive(cls, data: Any) -> Any:
        if isinstance(data, dict):
            total = data.get("positionsTotal", 1) or 0
            filled = data.get("positionsFilled", 0) or 0
            data = dict(data)
            data["positionsRemaining"] = max(0, total - filled)
            if not data.get("jdText") and data.get("jdHtml"):
                data["jdText"] = jd_text_of(str(data["jdHtml"]))
            elif not data.get("jdText") and data.get("description"):
                data["jdText"] = str(data["description"])
        return data


class JobCloseIn(BaseModel):
    """Manual closure (PRD §24). Reason is optional and audit-logged."""

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=500)


class JobReopenIn(BaseModel):
    """Reopen requires a valid FUTURE closing date (PRD §26)."""

    model_config = ConfigDict(extra="forbid")

    closesAt: datetime


class JobDuplicateCheckIn(BaseModel):
    """Duplicate-warning probe (PRD §12). All fields optional; the check
    matches on whichever identity fields are supplied. Never blocks."""

    model_config = ConfigDict(extra="forbid")

    companyName: str | None = None
    jobRole: str | None = None
    department: str | None = None
    location: str | None = None
    excludeJobId: str | None = None


class JobDuplicateOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    similarJobs: list[JobPublic] = Field(default_factory=list)
    count: int = 0


class JobAssignIn(BaseModel):
    """Reassign by email (PRD §21): resolved + active-checked server-side."""

    model_config = ConfigDict(extra="forbid")

    email: str = Field(..., min_length=3, max_length=255)


class JobDetailPublic(BaseModel):
    """Job Details page payload (PRD §18): job + its applications + counts."""

    model_config = ConfigDict(extra="forbid")

    job: JobPublic
    applications: list[Any] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)


class JDParseOut(BaseModel):
    """Stateless JD parse/map result (PRD §9): reviewed client-side, saved
    through the normal create endpoint. `mapped` mirrors JobCreate fields."""

    model_config = ConfigDict(extra="forbid")

    filename: str
    kind: str
    templateVersion: str
    text: str
    mapped: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    # AI JD Ingestion (document mode, Phase 2+): structured LLM extraction
    # for review. Absent (None) when the LLM was skipped/unavailable/failed
    # or when the template path was used. Additive-only: template callers
    # and older clients are unaffected. Phase 3 validates `aiExtract`
    # against JobCreate — it is advisory, never persisted directly.
    aiExtract: dict[str, Any] | None = None
    missingFields: list[str] = Field(default_factory=list)
    evidence: dict[str, str] = Field(default_factory=dict)
    # Phase 3: JobCreate-validated review payload (values / missingFields /
    # needsReview / fieldErrors / warnings / resolvedAssignee / evidence).
    # None when the template path was used or no AI extraction was available.
    review: dict[str, Any] | None = None


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
