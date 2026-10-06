"""Slice 11 edge-case regression tests for the Jobs module."""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from tests.conftest import auth_headers, job_payload, ensure_user, post_job


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_job_edge_cases_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _sa(org_id="default"):
    return auth_headers(role="super_admin", org_id=org_id)


# ---- 2/3/4: experience & positions validation ----

def test_experience_decimal_values_accepted(client):
    headers = _sa()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload("DEC-1", "Decimal Exp", uid,
                      minExperienceYears=2.5, maxExperienceYears=5.5), headers=headers)
    assert res.status_code == 201, res.text


def test_experience_min_greater_than_max_rejected(client):
    headers = _sa()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload("EXP-1", "Bad Range", uid,
                      minExperienceYears=6, maxExperienceYears=2), headers=headers)
    assert res.status_code == 422


def test_experience_negative_rejected(client):
    headers = _sa()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload("EXP-2", "Neg Exp", uid,
                      minExperienceYears=-1), headers=headers)
    assert res.status_code == 422


@pytest.mark.parametrize("positions,expected", [
    (1.5, 422),   # decimal
    (0, 422),
    (-3, 422),
    (1, 201),
])
def test_positions_validation(client, positions, expected):
    headers = _sa()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload(f"POS-{positions}", "Pos", uid,
                      positionsTotal=positions), headers=headers)
    assert res.status_code == expected, res.text


def test_partial_experience_update_above_stored_max_rejected(client):
    """Slice 11 gap fix: patching only minExperienceYears above the stored
    max must be rejected server-side, not slip through schema validation."""
    headers = _sa()
    job = post_job(client, headers, headers, "EXP-3", "Range", minExperienceYears=2, maxExperienceYears=5)
    res = client.put(f"/api/jobs/{job['jobId']}", json={"minExperienceYears": 10}, headers=headers)
    assert res.status_code == 422
    res2 = client.put(f"/api/jobs/{job['jobId']}", json={"minExperienceYears": 4}, headers=headers)
    assert res2.status_code == 200, res2.text
    assert res2.json()["minExperienceYears"] == 4


def test_partial_date_update_closing_before_opening_rejected(client):
    headers = _sa()
    job = post_job(client, headers, headers, "DAT-2", "Dates")
    res = client.put(f"/api/jobs/{job['jobId']}", json={"closesAt": "2020-01-01T00:00:00Z"}, headers=headers)
    # openedAt defaults to creation time (now), so an early closing date fails
    assert res.status_code == 422, res.text


def test_keyword_dedupe_trim_case_insensitive(client):
    headers = _sa()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload("KW-1", "Keywords", uid,
                      keywords=[" Python ", "PYTHON", "python", "  SQL"]), headers=headers)
    assert res.status_code == 201
    assert res.json()["keywords"] == ["Python", "SQL"]


def test_keyword_cap(client):
    headers = _sa()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload("KW-2", "Too Many", uid,
                      keywords=[f"k{i}" for i in range(21)]), headers=headers)
    assert res.status_code == 422


# ---- 5/15: dates & lifecycle ----

@pytest.mark.parametrize("closes,expected", [
    ("2020-01-01T00:00:00Z", 422),   # before openedAt
    ("2025-09-01T00:00:00Z", 422),   # equal to openedAt? covered by <= check via future fixture
])
def test_closing_before_opening_rejected(client, closes, expected):
    headers = _sa()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload("DAT-1", "Dates", uid,
                      openedAt="2025-09-01T00:00:00Z", closesAt=closes), headers=headers)
    assert res.status_code == expected


def test_reopen_requires_future_date(client):
    headers = _sa()
    job = post_job(client, headers, headers, "RE-1", "Reopen", lifecycleStatus="OPEN")
    client.post(f"/api/jobs/{job['jobId']}/close", json={"reason": "x"}, headers=headers)
    bad = client.post(f"/api/jobs/{job['jobId']}/reopen", json={"closesAt": "2020-01-01T00:00:00Z"}, headers=headers)
    assert bad.status_code == 422
    good = client.post(f"/api/jobs/{job['jobId']}/reopen", json={"closesAt": "2027-01-01T00:00:00Z"}, headers=headers)
    assert good.status_code == 200, good.text


def test_closed_job_rejects_new_application(client, mock_db):
    headers = _sa()
    job = post_job(client, headers, headers, "CL-1", "Closed Job", lifecycleStatus="OPEN")
    client.post(f"/api/jobs/{job['jobId']}/close", json={}, headers=headers)
    applicant_id = "app-1"
    mock_db["applicants"].insert_one  # ensure collection exists
    import asyncio
    asyncio.get_event_loop().run_until_complete(mock_db["applicants"].insert_one({
        "applicantId": applicant_id, "orgId": "default", "email": "a@b.com", "name": "A",
    }))
    res = client.post("/api/applications", json={
        "jobId": job["jobId"], "applicantId": applicant_id, "initialStage": "RESUME_UPLOADED",
        "candidateKey": None, "assignedReviewers": [], "matchScore": None, "scoreBreakdown": {},
    }, headers=headers)
    assert res.status_code == 409


def test_archived_job_rejects_application_and_edit(client):
    headers = _sa()
    job = post_job(client, headers, headers, "AR-1", "Archived Job", lifecycleStatus="OPEN")
    client.post(f"/api/jobs/{job['jobId']}/archive", headers=headers)
    res = client.put(f"/api/jobs/{job['jobId']}", json={"title": "New title here"}, headers=headers)
    assert res.status_code == 409
    app_res = client.post("/api/applications", json={
        "jobId": job["jobId"], "applicantId": "whoever", "initialStage": "RESUME_UPLOADED",
        "candidateKey": None, "assignedReviewers": [], "matchScore": None, "scoreBreakdown": {},
    }, headers=headers)
    # 404 (job not found to non-admin?) or 409 — archived must not accept applications
    assert app_res.status_code in (404, 409)


# ---- 9/10: id handling ----

def test_job_id_immutable(client):
    headers = _sa()
    job = post_job(client, headers, headers, "ID-1", "Immutable")
    res = client.put(f"/api/jobs/{job['jobId']}", json={"jobId": "HACKED"}, headers=headers)
    assert res.status_code == 422


def test_unknown_job_id_404(client):
    res = client.get("/api/jobs/does-not-exist", headers=_sa())
    assert res.status_code == 404
    assert res.json()["detail"] == "Job not found"


# ---- 13/29: counts & delete guard ----

def test_delete_blocked_with_applications_and_counts_consistent(client, mock_db):
    headers = _sa()
    job = post_job(client, headers, headers, "DEL-1", "Has Apps", lifecycleStatus="OPEN")
    import asyncio
    asyncio.get_event_loop().run_until_complete(mock_db["applications"].insert_one({
        "orgId": "default", "jobId": job["jobId"], "applicantId": "a1", "status": "active",
        "currentStage": "RESUME_UPLOADED",
    }))
    counts = client.get("/api/jobs/application-counts", headers=headers).json()["counts"]
    assert counts[job["jobId"]] == 1
    detail = client.get(f"/api/jobs/{job['jobId']}/detail", headers=headers).json()
    assert detail["counts"]["total"] == 1
    res = client.delete(f"/api/jobs/{job['jobId']}", headers=headers)
    assert res.status_code == 409


# ---- 19: concurrent editing is server-authoritative (last-writer-wins) ----

def test_concurrent_edits_server_authoritative(client):
    headers = _sa()
    job = post_job(client, headers, headers, "CONC-1", "Original")
    r1 = client.put(f"/api/jobs/{job['jobId']}", json={"title": "User A title"}, headers=headers)
    r2 = client.put(f"/api/jobs/{job['jobId']}", json={"title": "User B title"}, headers=headers)
    assert r1.status_code == 200 and r2.status_code == 200
    final = client.get(f"/api/jobs/{job['jobId']}", headers=headers).json()
    assert final["title"] == "User B title"


# ---- 20: duplicate submission ----

def test_duplicate_job_key_conflict(client):
    headers = _sa()
    uid = ensure_user(client, headers)
    client.post("/api/jobs", json=job_payload("DUP-9", "One", uid), headers=headers)
    res = client.post("/api/jobs", json=job_payload("DUP-9", "Two", uid), headers=headers)
    assert res.status_code == 409


# ---- 7: duplicate advisory never blocks ----

def test_check_duplicate_is_advisory(client):
    headers = _sa()
    uid = ensure_user(client, headers)
    client.post("/api/jobs", json=job_payload("ADV-1", "Backend Engineer", uid,
                  companyName="Elite HR", jobRole="Backend Engineer"), headers=headers)
    res = client.post("/api/jobs/check-duplicate", json={"companyName": "Elite HR", "jobRole": "Backend Engineer"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["count"] >= 1
    # Advisory: identical job key reuse is blocked, but a new key still creates.
    created = client.post("/api/jobs", json=job_payload("ADV-2", "Backend Engineer", uid), headers=headers)
    assert created.status_code == 201


# ---- 17/18: deactivated assignee snapshot preserved ----

def test_deactivated_assignee_snapshot_preserved(client):
    headers = _sa()
    uid = ensure_user(client, headers, "stable@test.com")
    job = post_job(client, headers, headers, "SNAP-1", "Snapshot", assigneeUserId=uid)
    client.put(f"/api/users/{uid}", json={"isActive": False}, headers=headers)
    detail = client.get(f"/api/jobs/{job['jobId']}", headers=headers).json()
    assert detail["assigneeUserId"] == uid
    assert detail["assigneeEmail"] == "stable@test.com"
    # inactive assignee cannot be newly assigned
    res = client.post(f"/api/jobs/{job['jobId']}/assign", json={"email": "stable@test.com"}, headers=headers)
    assert res.status_code in (400, 422)
    # reassignment to an active user works
    uid2 = ensure_user(client, headers, "active2@test.com")
    ok = client.post(f"/api/jobs/{job['jobId']}/assign", json={"email": "active2@test.com"}, headers=headers)
    assert ok.status_code == 200, ok.text


# ---- 6: invalid assignee ----

def test_invalid_assignee_rejected_on_create(client):
    res = client.post("/api/jobs", json=job_payload("NOPE-1", "Inval", "ghost-user"), headers=_sa())
    assert res.status_code == 422


# ---- 30: org isolation ----

def test_cross_org_job_not_visible(client):
    sa = _sa()
    job = post_job(client, sa, sa, "ORG-1", "Org Job")
    other = auth_headers(role="super_admin", org_id="other-org")
    res = client.get(f"/api/jobs/{job['jobId']}", headers=other)
    assert res.status_code == 404
