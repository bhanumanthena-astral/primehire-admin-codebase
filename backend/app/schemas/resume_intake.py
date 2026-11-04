"""Module 2 request contracts. Missing extracted fields remain blank."""
from __future__ import annotations

import re
from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CandidateProfile(Contract):
    name: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=25)
    currentLocation: str = Field(default="", max_length=100)
    preferredLocations: list[str] = Field(default_factory=list, max_length=30)
    experienceYears: float | None = Field(default=None, ge=0, le=50)
    currentCompany: str = Field(default="", max_length=150)
    currentDesignation: str = Field(default="", max_length=100)
    department: str = Field(default="", max_length=100)
    role: str = Field(default="", max_length=100)
    industry: str = Field(default="", max_length=100)
    skills: list[str] = Field(default_factory=list, max_length=150)
    headline: str = Field(default="", max_length=250)
    summary: str = Field(default="", max_length=5000)
    education: list[str] = Field(default_factory=list, max_length=30)
    ugDegree: str = Field(default="", max_length=100)
    ugSpecialization: str = Field(default="", max_length=150)
    ugUniversity: str = Field(default="", max_length=200)
    ugGraduationYear: int | None = None
    pgDegree: str = Field(default="", max_length=100)
    pgSpecialization: str = Field(default="", max_length=150)
    pgUniversity: str = Field(default="", max_length=200)
    pgGraduationYear: int | None = None
    doctorateDegree: str = Field(default="", max_length=100)
    doctorateSpecialization: str = Field(default="", max_length=150)
    doctorateUniversity: str = Field(default="", max_length=200)
    doctorateGraduationYear: int | None = None
    gender: Literal["", "female", "male", "non_binary", "prefer_not_to_say", "other"] = ""
    maritalStatus: Literal["", "single", "married", "divorced", "widowed", "prefer_not_to_say"] = ""
    homeTown: str = Field(default="", max_length=100)
    pinCode: str = Field(default="", max_length=12)
    dateOfBirth: date | None = None

    @field_validator('name', 'currentLocation', 'currentCompany', 'currentDesignation', 'department', 'role', 'industry', 'homeTown')
    @classmethod
    def minimum_text_length(cls, value):
        if value and len(value) < 2:
            raise ValueError('Use at least two characters or leave unavailable information blank')
        return value

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        if value:
            parts = value.rsplit("@", 1)
            if len(parts) != 2 or len(parts[0]) > 64 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+", parts[0]) or parts[0].startswith(".") or parts[0].endswith(".") or ".." in parts[0]:
                raise ValueError("Email must be valid")
            labels = parts[1].split(".")
            if len(labels) < 2 or any(not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in labels):
                raise ValueError("Email must be valid")
        return value.lower()

    @field_validator("phone")
    @classmethod
    def phone_valid(cls, value):
        if not value:
            return value
        if not re.fullmatch(r"\+?[\d\s().-]+", value):
            raise ValueError("Phone must contain 7–15 digits")
        digits = re.sub(r"\D", "", value)
        if not 7 <= len(digits) <= 15:
            raise ValueError("Phone must contain 7–15 digits")
        return ("+" if value.startswith("+") else "") + digits

    @field_validator("skills", "preferredLocations", "education")
    @classmethod
    def unique_values(cls, values):
        result, seen = [], set()
        for value in values:
            value = value.strip()
            if len(value) > 200:
                raise ValueError("List entries cannot exceed 200 characters")
            if value and value.casefold() not in seen:
                seen.add(value.casefold())
                result.append(value)
        return result

    @field_validator("ugGraduationYear", "pgGraduationYear", "doctorateGraduationYear")
    @classmethod
    def year_valid(cls, value):
        if value is not None and not 1900 <= value <= date.today().year + 6:
            raise ValueError("Graduation year is outside the valid range")
        return value

    @field_validator("dateOfBirth")
    @classmethod
    def dob_valid(cls, value):
        if value and value > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return value

    @field_validator("dateOfBirth", mode="before")
    @classmethod
    def date_type(cls, value):
        if value == "":
            return None
        if isinstance(value, (bool, int, float)):
            raise ValueError("Date of birth must be a date, not a numeric timestamp")
        return value

    @field_validator("experienceYears", "ugGraduationYear", "pgGraduationYear", "doctorateGraduationYear", mode="before")
    @classmethod
    def numeric_type(cls, value):
        if isinstance(value, bool):
            raise ValueError("Numeric candidate fields cannot be true/false")
        return value

    @field_validator("pinCode")
    @classmethod
    def pin_valid(cls, value):
        if value and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 -]{1,11}", value):
            raise ValueError("Invalid postal code")
        return value


class IntakeSettings(Contract):
    viewerDownloads: bool = False
    resumeMaxMb: int = Field(default=10, ge=1, le=25)
    zipMaxMb: int = Field(default=100, ge=1, le=100)
    zipMaxFiles: int = Field(default=1000, ge=1, le=1000)
    expandedMaxMb: int = Field(default=500, ge=10, le=1000)
    excelMaxMb: int = Field(default=10, ge=1, le=25)
    excelMaxRows: int = Field(default=5000, ge=1, le=5000)
    excellentAt: int = Field(default=80, ge=1, le=100)
    goodAt: int = Field(default=65, ge=1, le=99)
    moderateAt: int = Field(default=50, ge=1, le=98)

    @model_validator(mode="after")
    def categories_ordered(self):
        if not self.moderateAt < self.goodAt < self.excellentAt:
            raise ValueError("Score category thresholds must increase")
        return self


class ReviewRequest(Contract):
    expectedRevision: int = Field(ge=1)
    profile: CandidateProfile
    candidateId: str | None = Field(default=None, max_length=100)
    atsRangeRevision: int | None = Field(default=None,ge=0)


class RevisionRequest(Contract):
    expectedRevision: int = Field(ge=1)


class NoteRequest(Contract):
    text: str = Field(min_length=1, max_length=2000)


class AssignRequest(Contract):
    userId: str = Field(min_length=1, max_length=100)
    expectedRevision: int = Field(ge=1)


class DeleteRequest(Contract):
    reason: str = Field(min_length=3, max_length=500)
    expectedRevision: int = Field(ge=1)


class AssociateRequest(Contract):
    jobId: str = Field(min_length=1, max_length=100)


class BulkConfirmRequest(Contract):
    reviewed: bool
    atsRangeRevision: int | None = Field(default=None,ge=0)


class AtsRangeRequest(Contract):
    minimum: int = Field(ge=0,le=100,strict=True)
    maximum: int = Field(ge=0,le=100,strict=True)
    expectedRevision: int = Field(ge=0)

    @model_validator(mode='after')
    def ordered(self):
        if self.minimum>self.maximum:raise ValueError('Minimum ATS score must not exceed maximum')
        return self


class SettingsUpdate(Contract):
    expectedRevision: int = Field(ge=0)
    settings: IntakeSettings


SOURCES = frozenset({"local", "linkedin", "naukri", "referral", "email", "other"})
REVIEWABLE = frozenset({"review_required", "duplicate_suspected", "completed", "duplicate"})
RETRYABLE = frozenset({"failed", "scan_required", "ocr_required", "conversion_required", "confirming", "confirmation_paused"})
STATUSES = frozenset({"uploaded", "queued", "processing", "review_required", "duplicate_suspected",
    "completed", "duplicate", "failed", "rejected", "virus_detected", "unsupported_format",
    "password_protected", "ocr_required", "scan_required", "conversion_required", "deleted", "confirming", "confirmation_paused"})
