"""Module 4 profile and assignment contracts; no candidate identity is editable."""
import re
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .resume_intake import CandidateProfile as IntakeProfile


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


def text_rule(value, punctuation, minimum=2):
    if value and (len(value) < minimum or any(not (unicodedata.category(c)[0] in 'LN' or c == ' ' or c in punctuation or unicodedata.category(c).startswith('M')) for c in value)):
        raise ValueError('Use the permitted letters, numbers, spaces and punctuation')
    return value


class Education(Contract):
    qualification: str = Field(min_length=2, max_length=100)
    specialization: str = Field(default='', max_length=150)
    institution: str = Field(default='', max_length=200)
    graduationYear: int | None = None

    @field_validator('qualification', 'specialization', 'institution')
    @classmethod
    def valid_text(cls, value, info):
        return text_rule(value, {'qualification':'-.&()', 'specialization':'-,&()', 'institution':"&,.-'()"}[info.field_name])

    @field_validator('graduationYear', mode='before')
    @classmethod
    def year(cls, value):
        current = datetime.now(ZoneInfo('Asia/Kolkata')).year
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 1900 <= value <= current + 10):
            raise ValueError('Use a year from 1900 to the current year plus 10')
        return value


class Profile(Contract):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(default='', max_length=254)
    phone: str = Field(default='', max_length=35)
    currentLocation: str = Field(default='', max_length=100)
    preferredLocations: list[str] = Field(default_factory=list, max_length=50)
    experienceYears: float | None = Field(default=None, ge=0, le=50)
    currentCompany: str = Field(default='', max_length=150)
    currentDesignation: str = Field(default='', max_length=100)
    department: str = Field(default='', max_length=100)
    role: str = Field(default='', max_length=100)
    industry: str = Field(default='', max_length=100)
    skills: list[str] = Field(default_factory=list, max_length=50)
    headline: str = Field(default='', max_length=250)
    summary: str = Field(default='', max_length=5000)
    educationRecords: list[Education] = Field(default_factory=list, max_length=30)

    @field_validator('name')
    @classmethod
    def name_rule(cls, value):
        if any(not (unicodedata.category(c)[0] in 'LM' or c in " -'.") for c in value) or not any(c.isalpha() for c in value):
            raise ValueError('Use Unicode letters, spaces, hyphens, apostrophes and periods')
        return value

    @field_validator('email')
    @classmethod
    def email_rule(cls, value):
        return IntakeProfile.email_valid(value)

    @field_validator('phone')
    @classmethod
    def phone_rule(cls, value):
        return IntakeProfile.phone_valid(value)

    @field_validator('experienceYears', mode='before')
    @classmethod
    def experience_rule(cls, value):
        if value is None:
            return None
        try:
            number = Decimal(str(value))
            if isinstance(value, bool) or not number.is_finite() or number.as_tuple().exponent < -2:
                raise ValueError
        except (InvalidOperation, ValueError):
            raise ValueError('Use a number with at most two decimal places') from None
        return value

    @field_validator('currentLocation', 'currentCompany', 'currentDesignation', 'department', 'role', 'industry', 'headline')
    @classmethod
    def text_fields(cls, value, info):
        allowed = {'currentLocation':',-.', 'currentCompany':"&-'.,", 'currentDesignation':'-&.,()/',
            'department':'-&/', 'role':'-&/', 'industry':'&-,', 'headline':".,:;!?&'()-/+#"}
        return text_rule(value, allowed[info.field_name], 5 if info.field_name == 'headline' else 2)

    @field_validator('skills', 'preferredLocations')
    @classmethod
    def tags(cls, values, info):
        result, seen = [], set()
        for value in values:
            value = value.strip()
            max_length = 50 if info.field_name == 'skills' else 100
            if not value or len(value) > max_length:
                raise ValueError('Entries must be non-empty and within the field length limit')
            text_rule(value, '+#.-/' if info.field_name == 'skills' else ',-.', 1 if info.field_name == 'skills' else 2)
            if value.casefold() not in seen:
                result.append(value); seen.add(value.casefold())
        return result

    @model_validator(mode='after')
    def contact(self):
        if not self.email and not self.phone:
            raise ValueError('Keep at least one valid contact: email or phone')
        return self


class ProfileUpdate(Contract):
    profile: Profile
    expectedRevision: int = Field(ge=0)
    expectedUpdatedAt: datetime | None = None


class AssignmentCreate(Contract):
    assessmentId: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    applicationId: str | None = Field(default=None, min_length=1, max_length=100)
    startDate: datetime
    endDate: datetime
    confirmed: Literal[True]

    @model_validator(mode='after')
    def date_range(self):
        if not self.startDate.tzinfo or not self.endDate.tzinfo or self.endDate <= self.startDate:
            raise ValueError('Supply timezone-aware dates; End Date must be later than Start Date')
        return self


class AssignmentDates(Contract):
    startDate: datetime
    endDate: datetime
    expectedRevision: int = Field(ge=1)

    @model_validator(mode='after')
    def date_range(self):
        if not self.startDate.tzinfo or not self.endDate.tzinfo or self.endDate <= self.startDate:
            raise ValueError('Supply timezone-aware dates; End Date must be later than Start Date')
        return self


class Revision(Contract):
    expectedRevision: int = Field(ge=1)
