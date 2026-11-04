"""Recruitment-only contracts. No resume or assessment mutations."""

from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Round = Literal["technical", "managerial", "hr"]
VisibleField = Literal[
    "skills",
    "experience",
    "education",
    "summary",
    "assessment",
    "resume",
    "previousReviews",
    "compensation",
    "contact",
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Schedule(Strict):
    applicationId: str = Field(min_length=1, max_length=100)
    round: Round
    interviewerId: str = Field(min_length=1, max_length=100)
    startsAt: datetime
    endsAt: datetime
    meetingLink: str = Field(default="", max_length=500)
    location: str = Field(default="", max_length=200)
    reminderMinutes: Literal[10, 15, 20] = 15
    reason: str = Field(min_length=3, max_length=500)
    overrideReason: str = Field(default="", max_length=500)

    @field_validator("meetingLink")
    @classmethod
    def safe_link(cls, value):
        from urllib.parse import urlsplit

        if value:
            parsed = urlsplit(value)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
            ):
                raise ValueError("Meeting links must use HTTPS without credentials")
        return value

    @model_validator(mode="after")
    def times(self):
        if self.startsAt.tzinfo is None or self.endsAt.tzinfo is None:
            raise ValueError("Include a timezone with both times")
        self.startsAt = self.startsAt.astimezone(timezone.utc)
        self.endsAt = self.endsAt.astimezone(timezone.utc)
        seconds = (self.endsAt - self.startsAt).total_seconds()
        if not 300 <= seconds <= 8 * 3600:
            raise ValueError("Duration must be 5 minutes to 8 hours")
        return self


class Reschedule(Schedule):
    expectedRevision: int = Field(ge=1)


class Action(Strict):
    expectedRevision: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


class Review(Strict):
    expectedRevision: int = Field(ge=1)
    decision: Literal["advance", "reject", "hold", "another_round", "hire"]
    strengths: str = Field(min_length=3, max_length=3000)
    concerns: str = Field(default="", max_length=3000)
    comments: str = Field(min_length=3, max_length=5000)
    scorecard: dict[str, int] = Field(default_factory=dict, max_length=8)
    notes: str = Field(default="", max_length=10000)
    followUpAt: datetime | None = None

    @field_validator("scorecard")
    @classmethod
    def scores(cls, value):
        allowed = {
            "technicalDepth",
            "problemSolving",
            "communication",
            "ownership",
            "leadership",
            "cultureFit",
        }
        if any(
            k not in allowed or type(v) is not int or not 1 <= v <= 5
            for k, v in value.items()
        ):
            raise ValueError("Use named scorecard criteria with integer scores 1–5")
        return value

    @model_validator(mode="after")
    def hold_date(self):
        if self.decision == "hold" and (
            not self.followUpAt
            or not self.followUpAt.tzinfo
            or self.followUpAt <= datetime.now(timezone.utc)
        ):
            raise ValueError("A hold requires a future timezone-aware follow-up date")
        return self


class AccessProfile(Strict):
    visibleFields: list[VisibleField] = Field(max_length=9)
    expectedRevision: int = Field(default=0, ge=0)
    reason: str = Field(min_length=3, max_length=500)


class Compensation(Strict):
    expectedRevision: int = Field(ge=1)
    currency: Literal["INR", "USD", "EUR", "GBP"] = "INR"
    period: Literal["annual", "monthly"] = "annual"
    budget: float | None = Field(default=None, ge=0, le=1_000_000_000)
    candidateExpectation: float | None = Field(default=None, ge=0, le=1_000_000_000)
    proposedOffer: float | None = Field(default=None, ge=0, le=1_000_000_000)
    agreedAmount: float | None = Field(default=None, ge=0, le=1_000_000_000)
    notes: str = Field(default="", max_length=3000)
    reason: str = Field(min_length=3, max_length=500)


class OfferAction(Strict):
    expectedRevision: int = Field(ge=1)
    status: Literal["negotiating", "offered", "accepted", "declined", "joined"]
    reason: str = Field(min_length=3, max_length=500)


class QuestionsAction(Strict):
    expectedRevision: int = Field(ge=1)
    regenerate: bool = False
    expectedQuestionRevision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def regeneration_revision(self):
        if self.regenerate and self.expectedQuestionRevision is None:
            raise ValueError("Question revision is required to regenerate")
        return self


class QuestionAnswer(Strict):
    expectedRevision: int = Field(ge=1)
    questionId: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=5, max_length=500)
    asked: bool = False
    answer: str = Field(default="", max_length=3000)


class Reveal(Strict):
    reason: str = Field(min_length=3, max_length=500)


class ManagerialDraft(Strict):
    expectedRevision: int = Field(ge=1)
    strengths: str = Field(default="", max_length=3000)
    concerns: str = Field(default="", max_length=3000)
    comments: str = Field(default="", max_length=5000)
    notes: str = Field(default="", max_length=10000)
    decision: Literal["advance", "reject", "hold", "another_round"] = "advance"
    scorecard: dict[str, int] = Field(default_factory=dict, max_length=8)
    followUpAt: datetime | None = None

    _scores = field_validator("scorecard")(Review.scores.__func__)
