"""JWT and opaque token issuance, hashing, and decoding."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from ..config import settings

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "primehire"
JWT_AUDIENCE = "primehire"

ACCESS_TOKEN_LIFETIME = timedelta(minutes=15)
REFRESH_TOKEN_LIFETIME = timedelta(days=7)
MFA_TOKEN_LIFETIME = timedelta(minutes=5)
INVITE_TOKEN_LIFETIME = timedelta(hours=24)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    """Return SHA-256 hex digest of an opaque token (refresh, invite, reset)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_opaque_token(nbytes: int = 48) -> str:
    """Generate a cryptographically secure random token string."""
    return secrets.token_urlsafe(nbytes)


def create_access_token(
    *,
    user_id: str,
    org_id: str,
    role: str,
    session_id: str,
    impersonating: str | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a signed JWT access token."""
    now = utcnow()
    exp = now + (expires_delta or ACCESS_TOKEN_LIFETIME)
    payload: dict[str, Any] = {
        "sub": user_id,
        "orgId": org_id,
        "role": role,
        "sessionId": session_id,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    if impersonating:
        payload["impersonating"] = impersonating

    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT access token. Raises jwt.PyJWTError on invalid/expired."""
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[JWT_ALGORITHM],
        issuer=JWT_ISSUER,
        audience=JWT_AUDIENCE,
    )


def create_mfa_token(*, user_id: str, org_id: str) -> str:
    """Create a short-lived token for completing MFA during login."""
    now = utcnow()
    exp = now + MFA_TOKEN_LIFETIME
    payload = {
        "sub": user_id,
        "orgId": org_id,
        "purpose": "mfa",
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_mfa_token(token: str) -> dict[str, Any]:
    """Decode and validate an MFA token."""
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[JWT_ALGORITHM],
        issuer=JWT_ISSUER,
        audience=JWT_AUDIENCE,
    )
    if payload.get("purpose") != "mfa":
        raise jwt.InvalidTokenError("Token is not an MFA token")
    return payload
