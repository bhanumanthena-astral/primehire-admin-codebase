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


@pytest.fixture(autouse=True)
def hermetic_llm_config(monkeypatch):
    """Tests never touch the real provider: blank ambient LLM credentials.

    A local backend/.env may hold a real OPENROUTER key (developer drills);
    without this guard every suite would spend quota and flake on 429s.
    Tests needing the LLM set key/model explicitly (or use the fake mode).
    """
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "openrouter_model", "")
    monkeypatch.setattr(settings, "llm_fake_provider", "off")


def auth_headers(role: str = "super_admin", user_id: str = "test-user", org_id: str = "default") -> dict[str, str]:
    """Helper returning Bearer authorization headers for test requests."""
    token = create_access_token(
        user_id=user_id,
        org_id=org_id,
        role=role,
        session_id="test-session",
    )
    return {"Authorization": f"Bearer {token}"}


def job_payload(job_key: str = "JOB-1", title: str = "Backend Dev",
                assignee_user_id: str | None = None, **overrides) -> dict:
    """Valid PRD requisition payload for POST /api/jobs (Slice 1 schema).

    Pass a real user id from ensure_user() — the API rejects unknown or
    deactivated assignees (PRD §21). Tests asserting 422 on OTHER fields
    may pass any string here only when the guard under test runs first
    (e.g. role-denied 403s).
    """
    payload = {
        "jobKey": job_key,
        "title": title,
        "companyName": "Elite HR",
        "jobRole": "Backend Engineer",
        "department": "Engineering",
        "minExperienceYears": 2,
        "maxExperienceYears": 5,
        "positionsTotal": 2,
        "keywords": ["Python", "SQL"],
        "closesAt": "2027-12-31T00:00:00Z",
        "assigneeUserId": assignee_user_id or "missing-assignee",
        "jdHtml": "<p>We are hiring a backend engineer with Python and SQL experience for our platform team.</p>",
    }
    payload.update(overrides)
    return payload


def ensure_user(client, sa_headers: dict, email: str | None = None, role: str = "hr") -> str:
    """Create a real org user via the API; returns its userId for assignee tests."""
    import uuid as _uuid

    res = client.post("/api/users", json={
        "email": email or f"assignee-{_uuid.uuid4().hex[:8]}@test.com",
        "name": "Assignee",
        "role": role,
    }, headers=sa_headers)
    assert res.status_code == 201, res.text
    return res.json()["user"]["userId"]


def post_job(client, job_headers: dict, sa_headers: dict, job_key: str,
             title: str = "Backend Dev", **overrides) -> dict:
    """Create a job with a real assignee user; asserts 201. For negative
    tests, build the payload with job_payload() + ensure_user() instead."""
    uid = ensure_user(client, sa_headers)
    res = client.post("/api/jobs", json=job_payload(job_key, title, uid, **overrides),
                      headers=job_headers)
    assert res.status_code == 201, res.text
    return res.json()
