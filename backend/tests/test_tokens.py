"""Tests for JWT access, MFA, and refresh tokens."""

from datetime import timedelta
import time
import jwt
import pytest

from app.security.tokens import (
    create_access_token,
    decode_access_token,
    create_mfa_token,
    decode_mfa_token,
    generate_opaque_token,
    hash_token,
    JWT_ISSUER,
    JWT_AUDIENCE,
)
from app.config import settings


@pytest.fixture(autouse=True)
def setup_jwt_secret(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


def test_access_token_lifecycle():
    token = create_access_token(
        user_id="user-123",
        org_id="org-456",
        role="admin",
        session_id="sess-789",
    )
    payload = decode_access_token(token)
    assert payload["sub"] == "user-123"
    assert payload["orgId"] == "org-456"
    assert payload["role"] == "admin"
    assert payload["sessionId"] == "sess-789"
    assert payload["iss"] == JWT_ISSUER
    assert payload["aud"] == JWT_AUDIENCE
    assert "impersonating" not in payload


def test_access_token_impersonation():
    token = create_access_token(
        user_id="super-admin-1",
        org_id="org-1",
        role="super_admin",
        session_id="sess-1",
        impersonating="user-target-99",
    )
    payload = decode_access_token(token)
    assert payload["sub"] == "super-admin-1"
    assert payload["impersonating"] == "user-target-99"


def test_access_token_expired():
    token = create_access_token(
        user_id="u1",
        org_id="o1",
        role="hr",
        session_id="s1",
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(token)


def test_access_token_tampered():
    token = create_access_token(
        user_id="u1",
        org_id="o1",
        role="hr",
        session_id="s1",
    )
    # Alter token string
    tampered = token[:-4] + "AAAA"
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(tampered)


def test_mfa_token():
    token = create_mfa_token(user_id="u1", org_id="o1")
    payload = decode_mfa_token(token)
    assert payload["sub"] == "u1"
    assert payload["orgId"] == "o1"
    assert payload["purpose"] == "mfa"


def test_opaque_token_and_hash():
    tok = generate_opaque_token()
    assert len(tok) >= 48
    h1 = hash_token(tok)
    h2 = hash_token(tok)
    assert h1 == h2
    assert len(h1) == 64  # sha256 hex
