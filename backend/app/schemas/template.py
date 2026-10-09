"""Pydantic schemas for mail templates."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator


class TemplateIn(BaseModel):
    id: str
    name: str
    type: Literal["STANDARD_INVITATION", "REMINDER", "CUSTOM"] = "CUSTOM"
    subject: str = ""
    body: str = ""

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Template id must not be empty.")
        return value

    def to_doc(self) -> dict[str, Any]:
        return self.model_dump()


class TemplateUpdate(BaseModel):
    """Partial update. Only provided fields are applied (never the id)."""

    name: str | None = None
    type: Literal["STANDARD_INVITATION", "REMINDER", "CUSTOM"] | None = None
    subject: str | None = None
    body: str | None = None

    model_config = {"extra": "forbid"}
