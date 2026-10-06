"""Integration tests for hiring API (/api/jobs, /api/applicants, /api/applications, /api/audit-log)."""

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


# ---- Job CRUD (PRD requisition schema) ----

def test_create_job(client):
    headers = _sa_headers()
    uid = ensure_user(client, headers)
    res = client.post("/api/jobs", json=job_payload(
        "SE-2025-001", "Senior Engineer", uid,
        description="Backend role",
        mustHaveSkills=["Python", "FastAPI"],
        niceToHaveSkills=[{"skill": "Rust", "weight": 3}],
    ), headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["jobKey"] == "SE-2025-001"
    assert data["title"] == "Senior Engineer"
    assert data["orgId"] == "default"
    assert data["lifecycleStatus"] == "DRAFT"
    assert data["companyName"] == "Elite HR"
    assert data["positionsTotal"] == 2
    assert data["positionsRemaining"] == 2
    assert data["keywords"] == ["Python", "SQL"]
    assert data["assigneeUserId"] == uid
    assert data["assigneeEmail"]
    assert data["openedAt"]
    assert len(data["niceToHaveSkills"]) == 1


def test_create_job_duplicate_key(client):
    headers = _sa_headers()
    uid = ensure_user(client, headers)
    client.post("/api/jobs", json=job_payload("DUP", "Alpha", uid), headers=headers)
    res = client.post("/api/jobs", json=job_payload("DUP", "Beta", uid), headers=headers)
    assert res.status_code == 409


def test_create_job_rejects_unknown_assignee(client):
    headers = _sa_headers()
    res = client.post("/api/jobs", json=job_payload("NOU-1", "No Such User", "no-such-user"),
                      headers=headers)
    assert res.status_code == 422


def test_create_job_rejects_inactive_assignee(client):
    headers = _sa_headers()
    uid = ensure_user(client, headers, "gone@test.com")
    deact = client.put(f"/api/users/{uid}", json={"isActive": False}, headers=headers)
    assert deact.status_code == 200
    res = client.post("/api/jobs", json=job_payload("INACT-1", "Inactive Owner", uid),
                      headers=headers)
    assert res.status_code == 422


def test_list_and_get_jobs(client):
    headers = _sa_headers()
    created = post_job(client, headers, headers, "J1", "Job One")
    job_id = created["jobId"]

    list_res = client.get("/api/jobs", headers=headers)
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    get_res = client.get(f"/api/jobs/{job_id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["title"] == "Job One"


def test_list_jobs_filter_lifecycle(client):
    headers = _sa_headers()
    post_job(client, headers, headers, "LF-1", "Draft Job")
    post_job(client, headers, headers, "LF-2", "Open Job", lifecycleStatus="OPEN")
    res = client.get("/api/jobs?status=OPEN", headers=headers)
    assert res.status_code == 200
    keys = [j["jobKey"] for j in res.json()]
    assert "LF-2" in keys and "LF-1" not in keys


def test_update_job(client):
    headers = _sa_headers()
    created = post_job(client, headers, headers, "UPD1", "Old")
    job_id = created["jobId"]

    upd_res = client.put(f"/api/jobs/{job_id}", json={"title": "New Title"}, headers=headers)
    assert upd_res.status_code == 200
    assert upd_res.json()["title"] == "New Title"
    # Job ID is immutable across edits.
    assert upd_res.json()["jobId"] == job_id


def test_update_job_reassigns_and_snapshots_email(client):
    headers = _sa_headers()
    created = post_job(client, headers, headers, "REA-1", "Reassign")
    first = ensure_user(client, headers, "first@test.com")
    assert created["assigneeUserId"] != first
    res = client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": first},
                     headers=headers)
    assert res.status_code == 200
    assert res.json()["assigneeUserId"] == first
    assert res.json()["assigneeEmail"] == "first@test.com"


def test_update_job_rejects_inactive_reassignee(client):
    headers = _sa_headers()
    created = post_job(client, headers, headers, "REA-2", "Reassign Bad")
    gone = ensure_user(client, headers, "gone2@test.com")
    client.put(f"/api/users/{gone}", json={"isActive": False}, headers=headers)
    res = client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": gone},
                     headers=headers)
    assert res.status_code == 422


def test_update_job_rejects_immutable_fields(client):
    """jobKey/companyName/jobRole are absent from JobUpdate: sending them 422s."""
    headers = _sa_headers()
    uid = ensure_user(client, headers)
    job_id = client.post("/api/jobs", json=job_payload("IMM1", "Immutable", uid), headers=headers).json()["jobId"]
    for field, value in (("jobKey", "OTHER"), ("companyName", "Other Co"), ("jobRole", "Other Role")):
        res = client.put(f"/api/jobs/{job_id}", json={field: value}, headers=headers)
        assert res.status_code == 422, field


def test_get_nonexistent_job(client):
    res = client.get("/api/jobs/no-such-id", headers=_sa_headers())
    assert res.status_code == 404


def test_hr_can_create_job(client):
    """HR role has jobs.manage permission."""
    uid = ensure_user(client, _sa_headers())
    res = client.post("/api/jobs", json=job_payload("HR-J", "HR Job", uid), headers=_hr_headers())
    assert res.status_code == 201


def test_interviewer_cannot_create_job(client):
    """Interviewers do NOT have jobs.manage permission (guard runs before validation)."""
    uid = ensure_user(client, _sa_headers())
    res = client.post("/api/jobs", json=job_payload("IV-J", "IV Job", uid), headers=_interviewer_headers())
    assert res.status_code == 403


# ---- Job requisition validation (PRD §3-§6, §29) ----

def _uid_client(client):
    headers = _sa_headers()
    return headers, ensure_user(client, headers)


def test_create_job_rejects_bad_ranges(client):
    headers, uid = _uid_client(client)
    base = job_payload("BAD-1", "Bad Ranges", uid)
    # max < min
    res = client.post("/api/jobs", json={**base, "minExperienceYears": 5, "maxExperienceYears": 2},
                      headers=headers)
    assert res.status_code == 422
    # negative experience
    res = client.post("/api/jobs", json={**base, "jobKey": "BAD-2", "minExperienceYears": -1},
                      headers=headers)
    assert res.status_code == 422


def test_create_job_accepts_decimal_experience(client):
    headers, uid = _uid_client(client)
    res = client.post("/api/jobs", json=job_payload(
        "DEC-1", "Decimal Exp", uid, minExperienceYears=2.5, maxExperienceYears=4.5,
    ), headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["minExperienceYears"] == 2.5
    assert data["maxExperienceYears"] == 4.5


def test_create_job_rejects_bad_positions(client):
    headers, uid = _uid_client(client)
    base = job_payload("POS-1", "Bad Positions", uid)
    for bad in (0, -3, 2.5):
        res = client.post("/api/jobs", json={**base, "jobKey": f"POS-{bad}", "positionsTotal": bad},
                          headers=headers)
        assert res.status_code == 422, bad


def test_create_job_rejects_bad_dates(client):
    headers, uid = _uid_client(client)
    base = job_payload("DT-1", "Bad Dates", uid)
    res = client.post("/api/jobs", json={**base, "openedAt": "2027-12-31T00:00:00Z",
                                         "closesAt": "2027-01-01T00:00:00Z"},
                      headers=headers)
    assert res.status_code == 422
    res = client.post("/api/jobs", json={**base, "jobKey": "DT-2", "openedAt": "2027-06-01T00:00:00Z",
                                         "closesAt": "2027-06-01T00:00:00Z"},
                      headers=headers)
    assert res.status_code == 422


def test_create_job_normalizes_keywords(client):
    headers, uid = _uid_client(client)
    res = client.post("/api/jobs", json=job_payload(
        "KW-1", "Keywords", uid, keywords=[" Python ", "python", "SQL", "", "sql "],
    ), headers=headers)
    assert res.status_code == 201
    assert res.json()["keywords"] == ["Python", "SQL"]


def test_create_job_rejects_too_many_keywords(client):
    headers, uid = _uid_client(client)
    res = client.post("/api/jobs", json=job_payload(
        "KW-2", "Too Many", uid, keywords=[f"kw{i}" for i in range(25)],
    ), headers=headers)
    assert res.status_code == 422


def test_create_job_rejects_short_jd_and_missing_fields(client):
    headers, uid = _uid_client(client)
    base = job_payload("JD-1", "Short JD", uid)
    res = client.post("/api/jobs", json={**base, "jdHtml": "<p>Too short</p>"}, headers=headers)
    assert res.status_code == 422
    res = client.post("/api/jobs", json={k: v for k, v in base.items() if k != "companyName"},
                      headers=headers)
    assert res.status_code == 422


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
    sa = _sa_headers()
    uid = ensure_user(client, sa)
    job_res = client.post("/api/jobs", json=job_payload(job_key, "App Job", uid), headers=headers)
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
    post_job(client, headers, headers, "AUD-J", "Audit Job")

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

    post_job(client, headers_a, headers_a, "ISO-A", "Org A Job")
    list_b = client.get("/api/jobs", headers=headers_b)
    assert list_b.status_code == 200
    assert len(list_b.json()) == 0

# ---- Job lifecycle endpoints (PRD §7, §18, §24-§27) ----

def _lifecycle_job(client, headers, key="LC-1", **overrides):
    sa = _sa_headers()
    return post_job(client, headers, sa, key, "Lifecycle Job", **overrides)


def test_job_detail_includes_applications(client):
    headers = _sa_headers()
    res, job_id, _applicant = _create_full_application(client, headers, job_key="DET-J")
    assert res.status_code == 201
    det = client.get(f"/api/jobs/{job_id}/detail", headers=headers)
    assert det.status_code == 200
    body = det.json()
    assert body["job"]["jobId"] == job_id
    assert body["counts"]["total"] == 1
    assert len(body["applications"]) == 1


def test_close_and_reopen_job(client):
    headers = _sa_headers()
    job = _lifecycle_job(client, headers, "LC-CLOSE", lifecycleStatus="OPEN")
    closed = client.post(f"/api/jobs/{job['jobId']}/close", json={"reason": "Hired"}, headers=headers)
    assert closed.status_code == 200
    assert closed.json()["lifecycleStatus"] == "CLOSED"
    assert closed.json()["closedAt"]
    # Closing twice is a conflict.
    again = client.post(f"/api/jobs/{job['jobId']}/close", json={}, headers=headers)
    assert again.status_code == 409
    # Reopen needs a future date.
    bad = client.post(f"/api/jobs/{job['jobId']}/reopen",
                      json={"closesAt": "2020-01-01T00:00:00Z"}, headers=headers)
    assert bad.status_code == 422
    good = client.post(f"/api/jobs/{job['jobId']}/reopen",
                       json={"closesAt": "2028-06-01T00:00:00Z"}, headers=headers)
    assert good.status_code == 200
    assert good.json()["lifecycleStatus"] == "OPEN"
    assert good.json()["closedAt"] is None
    # Reopening a non-closed job conflicts.
    res = client.post(f"/api/jobs/{job['jobId']}/reopen",
                      json={"closesAt": "2028-06-01T00:00:00Z"}, headers=headers)
    assert res.status_code == 409


def test_closed_job_limited_edits_and_archived_no_edits(client):
    headers = _sa_headers()
    job = _lifecycle_job(client, headers, "LC-LIM", lifecycleStatus="OPEN")
    client.post(f"/api/jobs/{job['jobId']}/close", json={}, headers=headers)
    # Title edits on CLOSED are rejected; closing-date edits pass.
    assert client.put(f"/api/jobs/{job['jobId']}", json={"title": "Nope"}, headers=headers).status_code == 409
    ok = client.put(f"/api/jobs/{job['jobId']}", json={"closesAt": "2028-01-01T00:00:00Z"},
                    headers=headers)
    assert ok.status_code == 200
    archived = client.post(f"/api/jobs/{job['jobId']}/archive", json={}, headers=headers)
    assert archived.status_code == 200
    assert archived.json()["lifecycleStatus"] == "ARCHIVED"
    assert client.put(f"/api/jobs/{job['jobId']}", json={"title": "Nope"}, headers=headers).status_code == 409
    assert client.post(f"/api/jobs/{job['jobId']}/archive", json={}, headers=headers).status_code == 409


def test_delete_job_without_and_with_applications(client):
    headers = _sa_headers()
    bare = _lifecycle_job(client, headers, "LC-DEL")
    gone = client.delete(f"/api/jobs/{bare['jobId']}", headers=headers)
    assert gone.status_code == 200
    assert client.get(f"/api/jobs/{bare['jobId']}", headers=headers).status_code == 404

    res, job_id, _applicant = _create_full_application(client, headers, job_key="DEL-HAS-APPS")
    assert res.status_code == 201
    blocked = client.delete(f"/api/jobs/{job_id}", headers=headers)
    assert blocked.status_code == 409


def test_check_duplicate_warns_but_never_blocks(client):
    headers = _sa_headers()
    created = _lifecycle_job(client, headers, "LC-DUP", companyName="Acme",
                             jobRole="Backend Engineer", department="Engineering",
                             location="Hyderabad")
    res = client.post("/api/jobs/check-duplicate", json={
        "companyName": "acme", "jobRole": "Backend Engineer",
        "department": "Engineering", "location": "Hyderabad",
    }, headers=headers)
    assert res.status_code == 200
    assert res.json()["count"] >= 1
    assert created["jobId"] in [j["jobId"] for j in res.json()["similarJobs"]]
    # Self-exclusion + archived exclusion.
    res = client.post("/api/jobs/check-duplicate", json={
        "companyName": "Acme", "jobRole": "Backend Engineer",
        "department": "Engineering", "location": "Hyderabad",
        "excludeJobId": created["jobId"],
    }, headers=headers)
    assert res.json()["count"] == 0


def test_auto_close_sweep_closes_expired_open_jobs(client):
    headers = _sa_headers()
    sa = _sa_headers()
    uid = ensure_user(client, sa)
    expired = job_payload("LC-EXP", "Expired", uid, lifecycleStatus="OPEN",
                          openedAt="2024-01-01T00:00:00Z", closesAt="2024-02-01T00:00:00Z")
    res = client.post("/api/jobs", json=expired, headers=headers)
    assert res.status_code == 201
    future = post_job(client, headers, sa, "LC-FUT", lifecycleStatus="OPEN")
    draft = post_job(client, headers, sa, "LC-DRF")
    sweep = client.post("/api/admin/jobs/auto-close", headers=headers)
    assert sweep.status_code == 200
    assert sweep.json()["closed"] == 1
    assert client.get(f"/api/jobs/{res.json()['jobId']}",
                      headers=headers).json()["lifecycleStatus"] == "CLOSED"
    assert client.get(f"/api/jobs/{future['jobId']}", headers=headers).json()["lifecycleStatus"] == "OPEN"
    assert client.get(f"/api/jobs/{draft['jobId']}", headers=headers).json()["lifecycleStatus"] == "DRAFT"


def test_lifecycle_forbidden_for_interviewer(client):
    """Interviewers hold neither jobs.manage nor the lifecycle actions."""
    sa = _sa_headers()
    job = post_job(client, sa, sa, "LC-RBAC")
    iv = _interviewer_headers()
    assert client.post(f"/api/jobs/{job['jobId']}/close", json={}, headers=iv).status_code == 403
    assert client.delete(f"/api/jobs/{job['jobId']}", headers=iv).status_code == 403
    assert client.post("/api/admin/jobs/auto-close", headers=iv).status_code == 403


def test_assignment_queues_outbox_notification(client, monkeypatch):
    """With an encryption key, (re)assigning notifies via the outbox (deduped)."""
    from cryptography.fernet import Fernet

    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "outbox_encryption_key", Fernet.generate_key().decode())
    headers = _sa_headers()
    created = post_job(client, headers, headers, "LC-NOTIF")
    first = ensure_user(client, headers, "notify@test.com")
    res = client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": first},
                     headers=headers)
    assert res.status_code == 200
    diag = client.get("/api/diagnostics", headers=headers).json()
    pending = diag["outbox"].get("pending", 0)
    assert pending >= 1
    # Re-assigning to the SAME person is idempotent (no duplicate message).
    again = client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": first},
                       headers=headers)
    assert again.status_code == 200
    diag2 = client.get("/api/diagnostics", headers=headers).json()
    assert diag2["outbox"].get("pending", 0) == pending
    # Assigning WITHOUT a key still succeeds (notification skipped, never fatal).
    monkeypatch.setattr(_settings, "outbox_encryption_key", "")
    second = ensure_user(client, headers, "notify2@test.com")
    ok = client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": second},
                    headers=headers)
    assert ok.status_code == 200
    assert ok.json()["assigneeUserId"] == second

# ---- Jobs list: search / filter / sort / pagination (PRD §14-§16) ----

def _search_job(client, headers, sa, key, assignee_email="search-owner@test.com", **over):
    base = {"companyName": "Acme", "jobRole": "Backend Engineer", "title": "Engineer",
            "department": "Engineering"}
    base.update(over)
    local, _, domain = assignee_email.partition("@")
    uid = ensure_user(client, sa, f"{local}-{key.lower()}@{domain}")
    return post_job(client, headers, sa, key, assigneeUserId=uid, **base)


def test_jobs_search_variants(client):
    headers = _sa_headers()
    sa = _sa_headers()
    _search_job(client, headers, sa, "Sea-Backend", title="Senior Backend Engineer")
    _search_job(client, headers, sa, "Sea-Frontend", title="Junior Frontend Developer",
                **{"jobRole": "Frontend Engineer"})
    # Exact + partial + case-insensitive + starts-with + contains.
    got = client.get("/api/jobs?q=sea-backend", headers=headers).json()
    assert [j["jobKey"] for j in got] == ["Sea-Backend"]
    got = client.get("/api/jobs?q=Backend", headers=headers).json()
    assert [j["jobKey"] for j in got] == ["Sea-Backend"]
    got = client.get("/api/jobs?q=acme", headers=headers).json()
    assert {j["jobKey"] for j in got} == {"Sea-Backend", "Sea-Frontend"}
    got = client.get("/api/jobs?q=senior back", headers=headers).json()
    assert [j["jobKey"] for j in got] == ["Sea-Backend"]
    got = client.get("/api/jobs?q=search-owner", headers=headers).json()
    assert {j["jobKey"] for j in got} == {"Sea-Backend", "Sea-Frontend"}


def test_jobs_combined_filters(client):
    headers = _sa_headers()
    sa = _sa_headers()
    _search_job(client, headers, sa, "Flt-1", companyName="Acme")
    _search_job(client, headers, sa, "Flt-2", companyName="Globex", lifecycleStatus="OPEN")
    res = client.get("/api/jobs?company=acme&status=DRAFT", headers=headers)
    assert res.status_code == 200
    assert [j["jobKey"] for j in res.json()] == ["Flt-1"]
    res = client.get("/api/jobs?department=engineering&assignee=zzz-no-match", headers=headers)
    assert res.status_code == 200
    assert res.json() == []
    res = client.get("/api/jobs?department=engineering&assignee=search-owner", headers=headers)
    assert res.status_code == 200
    assert {j["jobKey"] for j in res.json()} == {"Flt-1", "Flt-2"}
    res = client.get("/api/jobs?workMode=ONSITE", headers=headers)
    assert res.status_code == 200
    res = client.get("/api/jobs?workMode=SPACE", headers=headers)
    assert res.status_code == 422


def test_jobs_sort_and_pagination(client):
    headers = _sa_headers()
    sa = _sa_headers()
    for i, title in enumerate(["Zulu", "Alpha", "Mike"]):
        post_job(client, headers, sa, f"Pg-{i}", title)
    res = client.get("/api/jobs?sort=title&order=asc&limit=2", headers=headers)
    assert res.status_code == 200
    assert [j["title"] for j in res.json()] == ["Alpha", "Mike"]
    assert res.headers["X-Total-Count"] == "3"
    page2 = client.get("/api/jobs?sort=title&order=asc&limit=2&skip=2", headers=headers)
    assert [j["title"] for j in page2.json()] == ["Zulu"]
    assert page2.headers["X-Total-Count"] == "3"
    bad = client.get("/api/jobs?sort=nope", headers=headers)
    assert bad.status_code == 422
    bad = client.get("/api/jobs?order=sideways", headers=headers)
    assert bad.status_code == 422


def test_jobs_application_counts(client):
    headers = _sa_headers()
    res, job_id, _a = _create_full_application(client, headers, job_key="CNT-J")
    assert res.status_code == 201
    counts = client.get("/api/jobs/application-counts", headers=headers)
    assert counts.status_code == 200
    assert counts.json()["counts"].get(job_id) == 1


def test_assign_by_email(client):
    headers = _sa_headers()
    job = post_job(client, headers, headers, "ASG-1")
    newcomer = ensure_user(client, headers, "newcomer@test.com")
    res = client.post(f"/api/jobs/{job['jobId']}/assign", json={"email": "newcomer@test.com"},
                      headers=headers)
    assert res.status_code == 200
    assert res.json()["assigneeUserId"] == newcomer
    assert res.json()["assigneeEmail"] == "newcomer@test.com"
    # Unknown + deactivated emails are refused.
    assert client.post(f"/api/jobs/{job['jobId']}/assign", json={"email": "nobody@test.com"},
                       headers=headers).status_code == 422
    gone = ensure_user(client, headers, "gone3@test.com")
    client.put(f"/api/users/{gone}", json={"isActive": False}, headers=headers)
    assert client.post(f"/api/jobs/{job['jobId']}/assign",
                       json={"email": "gone3@test.com"}, headers=headers).status_code == 422
    # Interviewers cannot assign.
    iv = _interviewer_headers()
    assert client.post(f"/api/jobs/{job['jobId']}/assign",
                       json={"email": "newcomer@test.com"}, headers=iv).status_code == 403

# ---- Job activity / audit trail (PRD §20) ----

def test_job_activity_lists_create_update_assign_with_old_new(client):
    headers = _sa_headers()
    created = post_job(client, headers, headers, "ACT-1", "Activity Job")
    job_id = created["jobId"]
    client.put(f"/api/jobs/{job_id}", json={"title": "Activity Job v2"}, headers=headers)
    newcomer = ensure_user(client, headers, "activity-new@test.com")
    client.put(f"/api/jobs/{job_id}", json={"assigneeUserId": newcomer}, headers=headers)

    res = client.get(f"/api/jobs/{job_id}/activity", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["jobId"] == job_id
    actions = [i["action"] for i in body["items"]]
    assert "job.create" in actions
    assert "job.update" in actions
    assert "job.assign" in actions
    update = next(i for i in body["items"] if i["action"] == "job.update" and "title" in i.get("details", {}).get("changes", {}))
    assert update["details"]["changes"]["title"] == {"from": "Activity Job", "to": "Activity Job v2"}
    assign = next(i for i in body["items"] if i["action"] == "job.assign")
    assert assign["details"]["to"] == newcomer
    for item in body["items"]:
        assert item["createdAt"] and item["actorUserId"]


def test_job_activity_404_and_forbidden(client):
    headers = _sa_headers()
    assert client.get("/api/jobs/no-such-job/activity", headers=headers).status_code == 404
    job = post_job(client, headers, headers, "ACT-2")
    iv = _interviewer_headers()
    assert client.get(f"/api/jobs/{job['jobId']}/activity", headers=iv).status_code == 403


def test_audit_log_filters_by_resource_id(client):
    headers = _sa_headers()
    first = post_job(client, headers, headers, "AUD-F1")
    post_job(client, headers, headers, "AUD-F2")
    res = client.get(f"/api/audit-log?resource_type=job&resource_id={first['jobId']}",
                     headers=headers)
    assert res.status_code == 200
    assert len(res.json()) >= 1
    assert all(e["resourceId"] == first["jobId"] for e in res.json())

def test_assign_archived_job_conflicts(client):
    """Archived jobs accept no edits — reassignment included (Slice 7)."""
    headers = _sa_headers()
    job = post_job(client, headers, headers, "LC-ARC-ASG", lifecycleStatus="OPEN")
    client.post(f"/api/jobs/{job['jobId']}/close", json={}, headers=headers)
    client.post(f"/api/jobs/{job['jobId']}/archive", json={}, headers=headers)
    newcomer = ensure_user(client, headers, "arc-new@test.com")
    res = client.put(f"/api/jobs/{job['jobId']}", json={"assigneeUserId": newcomer},
                     headers=headers)
    assert res.status_code == 409
    assert client.post(f"/api/jobs/{job['jobId']}/assign",
                       json={"email": "arc-new@test.com"}, headers=headers).status_code == 409
