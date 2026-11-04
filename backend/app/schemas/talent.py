"""Human-requested, bounded talent-pool matching contracts."""

from typing import Annotated
from pydantic import Field
from .recruitment import Strict as Contract


class MatchRequest(Contract):
    jobId: str = Field(min_length=1, max_length=100)
    requestId: str = Field(min_length=16, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    skip: int = Field(default=0, ge=0, le=100000)
    maxCandidates: int = Field(default=100, ge=1, le=1000)


class ReuseRequest(Contract):
    reason: str = Field(min_length=3, max_length=500)


class MatchAdvice(Contract):
    score: int = Field(ge=0, le=100)
    reasons: list[Annotated[str, Field(min_length=3, max_length=500)]] = Field(
        min_length=1, max_length=5
    )
    cautions: list[Annotated[str, Field(min_length=3, max_length=500)]] = Field(
        default_factory=list, max_length=5
    )
