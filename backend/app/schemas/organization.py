"""Organization Pydantic schemas (extra=forbid per CLAUDE.md §2)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class OrgSettings(BaseModel):
    """Per-organization configurable thresholds and integrations."""

    model_config = {"extra": "forbid"}

    match_threshold: int = Field(default=60, ge=0, le=100)
    retention_days: int = Field(default=365, ge=30)
    llm_provider: str = Field(default="")
    llm_model: str = Field(default="")
    email_from: str = Field(default="noreply@nxtagent.ai")
    reminder_lead_minutes: int = Field(default=15, ge=1)


class OrganizationCreate(BaseModel):
    """Create a new organization (admin-only, future)."""

    model_config = {"extra": "forbid"}

    name: str = Field(..., min_length=1, max_length=200)
    settings: OrgSettings = Field(default_factory=OrgSettings)


class OrganizationUpdate(BaseModel):
    """Update organization settings (super_admin only)."""

    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, min_length=1, max_length=200)
    settings: OrgSettings | None = None
