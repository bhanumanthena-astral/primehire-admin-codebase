"""Google authorization contracts. Organization and user identity are server owned."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator


class GoogleStart(BaseModel):
    model_config = ConfigDict(extra='forbid')
    returnTo: str = Field(default='/', max_length=500)


class CalendarAvailability(BaseModel):
    model_config = ConfigDict(extra='forbid')
    applicationId: str = Field(min_length=1, max_length=100)
    interviewerId: str = Field(min_length=1, max_length=100)
    startsAt: datetime
    endsAt: datetime
    interviewId: str | None = Field(default=None, max_length=100)

    @model_validator(mode='after')
    def times(self):
        if not self.startsAt.tzinfo or not self.endsAt.tzinfo:
            raise ValueError('Include a timezone with both times')
        if not 300 <= (self.endsAt - self.startsAt).total_seconds() <= 28800:
            raise ValueError('Duration must be 5 minutes to 8 hours')
        return self
