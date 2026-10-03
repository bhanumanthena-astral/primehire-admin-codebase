"""User and authentication Pydantic schemas (extra=forbid per CLAUDE.md §2)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from ..security.roles import Role


class UserRole(str, Enum):
    SUPER_ADMIN = Role.SUPER_ADMIN.value
    ADMIN = Role.ADMIN.value
    HR = Role.HR.value
    TECHNICAL_INTERVIEWER = Role.TECHNICAL_INTERVIEWER.value
    MANAGERIAL_INTERVIEWER = Role.MANAGERIAL_INTERVIEWER.value


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(..., min_length=3, max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    role: UserRole
    orgId: str | None = None
    password: str | None = None


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, min_length=1, max_length=255)
    role: UserRole | None = None
    isActive: bool | None = None


class UserPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    userId: str
    orgId: str
    email: str
    name: str
    role: str
    isActive: bool
    mfaEnabled: bool
    lastLoginAt: datetime | None = None
    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    password: str
    orgId: str | None = None


class TokenResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accessToken: str
    refreshToken: str
    tokenType: str = "bearer"
    expiresIn: int
    user: UserPublic


class MfaRequiredResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mfaRequired: bool = True
    mfaToken: str
    expiresIn: int


class MfaVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mfaToken: str
    code: str


class MfaEnrollResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    secret: str
    qrUri: str


class MfaConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    secret: str
    code: str


class MfaConfirmResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recoveryCodes: list[str]


class MfaRecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mfaToken: str
    recoveryCode: str


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    oldPassword: str
    newPassword: str


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    orgId: str | None = None


class ResetPasswordConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str
    newPassword: str


class ViewAsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    targetUserId: str
    reason: str = Field(..., min_length=5, max_length=500)


class SessionPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessionId: str
    createdAt: datetime
    expiresAt: datetime
    deviceInfo: str = ""
    isCurrent: bool = False
