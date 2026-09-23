"""Pydantic schemas for mail templates."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class TemplateIn(BaseModel):
    id: str
    name: str
    type: Literal["STANDARD_INVITATION", "REMINDER", "CUSTOM"] = "CUSTOM"
    subject: str = ""
    body: str = ""

    def to_doc(self) -> dict[str, Any]:
        return self.model_dump()
