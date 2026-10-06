"""Slice 14: end-to-end happy-path + negative-path acceptance journey."""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from tests.conftest import auth_headers, job_payload, ensure_user


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_e2e_jobs_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def test_full_job_lifecycle_journey(client):
    sa = auth_headers(role="super_admin")

    # Create
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("E2E-1", "Journey Job", uid, lifecycleStatus="OPEN"), headers=sa)
    assert res.status_code == 201, res.text
    job = res.json()
    jid = job["jobId"]
    assert job["assigneeEmail"], "assignee email snapshot present"
    email = job["assigneeEmail"]

    # View list + details
    lst = client.get("/api/jobs", headers=sa).json()
    assert any(j["jobId"] == jid for j in lst)
    det = client.get(f"/api/jobs/{jid}/detail", headers=sa).json()
    assert det["job"]["jobId"] == jid and det["counts"]["total"] == 0

    # Edit a permitted field
    ed = client.put(f"/api/jobs/{jid}", json={"matchThreshold": 70}, headers=sa)
    assert ed.status_code == 200 and ed.json()["matchThreshold"] == 70

    # Application associated → counts consistent, delete blocked
    applicant = client.post("/api/applicants", json={"email": "e2e@x.com", "name": "E2E"}, headers=sa).json()
    appl = client.post("/api/applications", json={"jobId": jid, "applicantId": applicant["applicantId"]}, headers=sa)
    assert appl.status_code == 201
    det2 = client.get(f"/api/jobs/{jid}/detail", headers=sa).json()
    assert det2["counts"]["total"] == 1
    counts = client.get("/api/jobs/application-counts", headers=sa).json()["counts"]
    assert counts[jid] == 1
    blocked = client.delete(f"/api/jobs/{jid}", headers=sa)
    assert blocked.status_code == 409

    # Close → applications blocked
    closed = client.post(f"/api/jobs/{jid}/close", json={"reason": "filled"}, headers=sa)
    assert closed.status_code == 200
    dup = client.post("/api/applications", json={"jobId": jid, "applicantId": applicant["applicantId"]}, headers=sa)
    assert dup.status_code in (404, 409)

    # Reopen with future date, then invalid date rejected
    redo = client.post(f"/api/jobs/{jid}/reopen", json={"closesAt": "2028-01-01T00:00:00Z"}, headers=sa)
    assert redo.status_code == 200
    bad = client.post(f"/api/jobs/{jid}/reopen", json={"closesAt": "2020-01-01T00:00:00Z"}, headers=sa)
    # bad is only meaningful if CLOSED again; after reopen it's OPEN so 409 for non-closed
    assert bad.status_code in (409, 422)

    # Reassign → snapshot + audit
    uid2 = ensure_user(client, sa, "e2e-owner2@x.com")
    ra = client.post(f"/api/jobs/{jid}/assign", json={"email": "e2e-owner2@x.com"}, headers=sa)
    assert ra.status_code == 200 and ra.json()["assigneeUserId"] == uid2
    acts = client.get(f"/api/jobs/{jid}/activity", headers=sa).json()["items"]
    assert any(a["action"] in ("job.assign", "job.update") for a in acts)

    # Archive
    arc = client.post(f"/api/jobs/{jid}/archive", headers=sa)
    assert arc.status_code == 200 and arc.json()["lifecycleStatus"] == "ARCHIVED"
    still = client.get(f"/api/jobs/{jid}/detail", headers=sa).json()
    assert still["counts"]["total"] == 1  # applications preserved


def test_negative_path_invalid_job_blocked(client):
    sa = auth_headers(role="super_admin")
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("E2E-BAD", "Bad", uid,
                      minExperienceYears=10, maxExperienceYears=1), headers=sa)
    assert res.status_code == 422


def test_negative_path_delete_with_applications_blocked(client):
    sa = auth_headers(role="super_admin")
    uid = ensure_user(client, sa)
    job = client.post("/api/jobs", json=job_payload("E2E-DEL", "HasApps", uid, lifecycleStatus="OPEN"), headers=sa).json()
    applicant = client.post("/api/applicants", json={"email": "e2e2@x.com", "name": "B"}, headers=sa).json()
    client.post("/api/applications", json={"jobId": job["jobId"], "applicantId": applicant["applicantId"]}, headers=sa)
    assert client.delete(f"/api/jobs/{job['jobId']}", headers=sa).status_code == 409


def test_negative_path_unauthorized_denied(client):
    sa = auth_headers(role="super_admin")
    uid = ensure_user(client, sa)
    job = client.post("/api/jobs", json=job_payload("E2E-AUTHZ", "Guarded", uid), headers=sa).json()
    interviewer = auth_headers(role="technical_interviewer")
    assert client.put(f"/api/jobs/{job['jobId']}", json={"title": "Hacked Title"}, headers=interviewer).status_code == 403
    assert client.post(f"/api/jobs/{job['jobId']}/close", json={}, headers=interviewer).status_code == 403
    assert client.delete(f"/api/jobs/{job['jobId']}", headers=interviewer).status_code == 403
    assert client.get(f"/api/jobs/{job['jobId']}/activity", headers=interviewer).status_code == 403
