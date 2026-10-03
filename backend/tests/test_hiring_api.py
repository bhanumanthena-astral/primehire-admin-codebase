"""Integration tests for hiring API (/api/jobs, /api/applicants, /api/applications, /api/audit-log)."""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_hiring_api_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


# ---- Helpers ----

def _sa_headers(org_id="default"):
    return auth_headers(role="super_admin", org_id=org_id)


def _hr_headers(org_id="default"):
    return auth_headers(role="hr", org_id=org_id)


def _interviewer_headers(org_id="default"):
    return auth_headers(role="technical_interviewer", org_id=org_id)


# ---- Job CRUD ----

def test_create_job(client):
    res = client.post("/api/jobs", json={
        "jobKey": "SE-2025-001",
        "title": "Senior Engineer",
        "description": "Backend role",
        "mustHaveSkills": ["Python", "FastAPI"],
        "niceToHaveSkills": [{"skill": "Rust", "weight": 3}],
    }, headers=_sa_headers())
    assert res.status_code == 201
    data = res.json()
    assert data["jobKey"] == "SE-2025-001"
    assert data["title"] == "Senior Engineer"
    assert data["orgId"] == "default"
    assert data["status"] == "open"
    assert len(data["niceToHaveSkills"]) == 1


def test_create_job_duplicate_key(client):
    headers = _sa_headers()
    client.post("/api/jobs", json={"jobKey": "DUP", "title": "Alpha"}, headers=headers)
    res = client.post("/api/jobs", json={"jobKey": "DUP", "title": "Beta"}, headers=headers)
    assert res.status_code == 409


def test_list_and_get_jobs(client):
    headers = _sa_headers()
    create_res = client.post("/api/jobs", json={"jobKey": "J1", "title": "Job One"}, headers=headers)
    job_id = create_res.json()["jobId"]

    list_res = client.get("/api/jobs", headers=headers)
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    get_res = client.get(f"/api/jobs/{job_id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["title"] == "Job One"


def test_update_job(client):
    headers = _sa_headers()
    create_res = client.post("/api/jobs", json={"jobKey": "UPD1", "title": "Old"}, headers=headers)
    job_id = create_res.json()["jobId"]

    upd_res = client.put(f"/api/jobs/{job_id}", json={"title": "New Title"}, headers=headers)
    assert upd_res.status_code == 200
    assert upd_res.json()["title"] == "New Title"


def test_get_nonexistent_job(client):
    res = client.get("/api/jobs/no-such-id", headers=_sa_headers())
    assert res.status_code == 404


def test_hr_can_create_job(client):
    """HR role has jobs.manage permission."""
    res = client.post("/api/jobs", json={"jobKey": "HR-J", "title": "HR Job"}, headers=_hr_headers())
    assert res.status_code == 201


def test_interviewer_cannot_create_job(client):
    """Interviewers do NOT have jobs.manage permission."""
    res = client.post("/api/jobs", json={"jobKey": "IV-J", "title": "IV Job"}, headers=_interviewer_headers())
    assert res.status_code == 403


# ---- Applicants ----

def test_create_applicant(client):
    res = client.post("/api/applicants", json={
        "email": "alice@example.com",
        "name": "Alice Smith",
        "phone": "+1234567890",
    }, headers=_sa_headers())
    assert res.status_code == 201
    data = res.json()
    assert data["email"] == "alice@example.com"
    assert data["orgId"] == "default"


def test_create_applicant_duplicate_email(client):
    headers = _sa_headers()
    client.post("/api/applicants", json={"email": "dup@x.com", "name": "A"}, headers=headers)
    res = client.post("/api/applicants", json={"email": "dup@x.com", "name": "B"}, headers=headers)
    assert res.status_code == 409


# ---- Applications & Transitions ----

def _create_full_application(client, headers, job_key="APP-J", applicant_email="app@test.com"):
    """Helper: creates a job, applicant, and application, returning all IDs."""
    job_res = client.post("/api/jobs", json={"jobKey": job_key, "title": "App Job"}, headers=headers)
    job_id = job_res.json()["jobId"]

    app_res = client.post("/api/applicants", json={"email": applicant_email, "name": "Test Applicant"}, headers=headers)
    applicant_id = app_res.json()["applicantId"]

    appl_res = client.post("/api/applications", json={
        "jobId": job_id,
        "applicantId": applicant_id,
    }, headers=headers)
    return appl_res, job_id, applicant_id


def test_create_application(client):
    headers = _sa_headers()
    res, job_id, applicant_id = _create_full_application(client, headers)
    assert res.status_code == 201
    data = res.json()
    assert data["jobId"] == job_id
    assert data["applicantId"] == applicant_id
    assert data["currentStage"] == "RESUME_UPLOADED"
    assert data["status"] == "active"


def test_create_application_missing_job(client):
    headers = _sa_headers()
    client.post("/api/applicants", json={"email": "lonely@x.com", "name": "Lonely"}, headers=headers)
    app = client.post("/api/applicants", json={"email": "lonely2@x.com", "name": "Lonely2"}, headers=headers)
    res = client.post("/api/applications", json={
        "jobId": "no-such-job",
        "applicantId": app.json()["applicantId"],
    }, headers=headers)
    assert res.status_code == 404


def test_valid_stage_transition(client):
    headers = _sa_headers()
    res, _, _ = _create_full_application(client, headers, job_key="TR-J", applicant_email="tr@x.com")
    app_id = res.json()["applicationId"]

    # RESUME_UPLOADED -> PARSED (valid)
    trans = client.post(f"/api/applications/{app_id}/transition", json={
        "toStage": "PARSED",
        "reason": "Resume parsed successfully",
    }, headers=headers)
    assert trans.status_code == 200
    assert trans.json()["currentStage"] == "PARSED"


def test_invalid_stage_transition(client):
    """RESUME_UPLOADED -> HIRED is not valid without override."""
    headers = _hr_headers()
    res, _, _ = _create_full_application(client, headers, job_key="INV-J", applicant_email="inv@x.com")
    app_id = res.json()["applicationId"]

    trans = client.post(f"/api/applications/{app_id}/transition", json={
        "toStage": "HIRED",
        "reason": "skip everything",
    }, headers=headers)
    assert trans.status_code == 400
    assert "Invalid stage transition" in trans.json()["detail"]


def test_super_admin_override_transition(client):
    """Super admin can override any transition with a reason."""
    headers = _sa_headers()
    res, _, _ = _create_full_application(client, headers, job_key="OVR-J", applicant_email="ovr@x.com")
    app_id = res.json()["applicationId"]

    trans = client.post(f"/api/applications/{app_id}/transition", json={
        "toStage": "HIRED",
        "reason": "Emergency hire by CEO request",
        "isOverride": True,
    }, headers=headers)
    assert trans.status_code == 200
    assert trans.json()["currentStage"] == "HIRED"
    assert trans.json()["status"] == "hired"


def test_override_requires_reason(client):
    """Override transitions must include an explicit reason."""
    headers = _sa_headers()
    res, _, _ = _create_full_application(client, headers, job_key="REQ-J", applicant_email="req@x.com")
    app_id = res.json()["applicationId"]

    trans = client.post(f"/api/applications/{app_id}/transition", json={
        "toStage": "HIRED",
        "reason": "",
        "isOverride": True,
    }, headers=headers)
    assert trans.status_code == 400
    assert "reason" in trans.json()["detail"].lower()


def test_hr_cannot_override(client):
    """HR role lacks applications.override_stage permission."""
    headers_sa = _sa_headers()
    headers_hr = _hr_headers()
    res, _, _ = _create_full_application(client, headers_sa, job_key="NOOR-J", applicant_email="noor@x.com")
    app_id = res.json()["applicationId"]

    trans = client.post(f"/api/applications/{app_id}/transition", json={
        "toStage": "HIRED",
        "reason": "Trying to override",
        "isOverride": True,
    }, headers=headers_hr)
    assert trans.status_code == 403


def test_application_history(client):
    headers = _sa_headers()
    res, _, _ = _create_full_application(client, headers, job_key="HIST-J", applicant_email="hist@x.com")
    app_id = res.json()["applicationId"]

    # Initial creation + one transition = 2 entries
    client.post(f"/api/applications/{app_id}/transition", json={
        "toStage": "PARSED",
        "reason": "Auto parsed",
    }, headers=headers)

    hist_res = client.get(f"/api/applications/{app_id}/history", headers=headers)
    assert hist_res.status_code == 200
    entries = hist_res.json()
    assert len(entries) == 2
    assert entries[0]["fromStage"] == ""
    assert entries[0]["toStage"] == "RESUME_UPLOADED"
    assert entries[1]["toStage"] == "PARSED"


# ---- Audit Log ----

def test_audit_log(client):
    headers = _sa_headers()
    # Create a job (generates audit entry)
    client.post("/api/jobs", json={"jobKey": "AUD-J", "title": "Audit Job"}, headers=headers)

    res = client.get("/api/audit-log", headers=headers)
    assert res.status_code == 200
    entries = res.json()
    assert len(entries) >= 1
    assert any(e["action"] == "job.create" for e in entries)


def test_audit_log_forbidden_for_interviewer(client):
    """Interviewers cannot see the audit log (missing audit.view)."""
    res = client.get("/api/audit-log", headers=_interviewer_headers())
    assert res.status_code == 403


# ---- Org Isolation ----

def test_org_isolation_jobs(client):
    """Jobs created in org A are invisible to org B."""
    headers_a = _sa_headers(org_id="org-a")
    headers_b = _sa_headers(org_id="org-b")

    client.post("/api/jobs", json={"jobKey": "ISO-A", "title": "Org A Job"}, headers=headers_a)
    list_b = client.get("/api/jobs", headers=headers_b)
    assert list_b.status_code == 200
    assert len(list_b.json()) == 0
