"""Shared pytest fixtures: in-memory Mongo (mongomock-motor), no Atlas needed."""

import pytest
import mongomock_motor
from app.config import settings
from app.security.tokens import create_access_token


@pytest.fixture()
def db():
    return mongomock_motor.AsyncMongoMockClient()["testdb"]


@pytest.fixture(autouse=True)
def ensure_jwt_secret(monkeypatch):
    if not settings.jwt_secret or len(settings.jwt_secret) < 32:
        monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


def auth_headers(role: str = "super_admin", user_id: str = "test-user", org_id: str = "default") -> dict[str, str]:
    """Helper returning Bearer authorization headers for test requests."""
    token = create_access_token(
        user_id=user_id,
        org_id=org_id,
        role=role,
        session_id="test-session",
    )
    return {"Authorization": f"Bearer {token}"}
