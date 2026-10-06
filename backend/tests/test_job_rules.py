"""Slice V1: Jobs validation matrix — boundary tests for every rule."""

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
    return mongomock_motor.AsyncMongoMockClient()["test_job_rules_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _sa(org_id="default"):
    return auth_headers(role="super_admin", org_id=org_id)


# ---- JD length boundaries (plain text, HTML-safety) ----

def test_jd_min_boundary(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    under = job_payload("JD-A", "Valid Role", uid, jdHtml="<p>" + "x" * 49 + "</p>")
    assert client.post("/api/jobs", json=under, headers=sa).status_code == 422
    ok = job_payload("JD-B", "Valid Role", uid, jdHtml="<p>" + "x" * 50 + "</p>")
    assert client.post("/api/jobs", json=ok, headers=sa).status_code == 201


def test_jd_max_boundary(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    ok_html = "<h2>Role</h2><p>" + "x" * 9990 + "</p>"
    ok = job_payload("JD-C", "Valid Role", uid, jdHtml=ok_html)
    assert client.post("/api/jobs", json=ok, headers=sa).status_code == 201
    over = job_payload("JD-D", "Valid Role", uid, jdHtml="<p>" + "x" * 10001 + "</p>")
    assert client.post("/api/jobs", json=over, headers=sa).status_code == 422


# ---- Positions ----

@pytest.mark.parametrize("positions,expected", [
    (0, 422), (1, 201), (1000, 201), (1001, 422), (2.5, 422),
])
def test_positions_bounds(client, positions, expected):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload(f"POS-{positions}", "Valid Role", uid, positionsTotal=positions), headers=sa)
    assert res.status_code == expected


def test_positions_cannot_go_below_filled(client, mock_db):
    import asyncio

    sa = _sa()
    uid = ensure_user(client, sa)
    job = post_job(client, sa, sa, "POS-FILL", "Valid Role", positionsTotal=5)
    asyncio.get_event_loop().run_until_complete(mock_db["jobs"].update_one(
        {"jobId": job["jobId"]}, {"$set": {"positionsFilled": 3}}))
    res = client.put(f"/api/jobs/{job['jobId']}", json={"positionsTotal": 2}, headers=sa)
    assert res.status_code == 422


# ---- Experience ----

@pytest.mark.parametrize("years,expected", [
    (0, 201), (50, 201), (50.08, 422), (-1, 422), (2.55, 422), (2.5, 201),
])
def test_experience_boundaries(client, years, expected):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload(f"EXP-{years}", "Valid Role", uid,
                      minExperienceYears=years, maxExperienceYears=years), headers=sa)
    assert res.status_code == expected


# ---- Title/role/company charsets ----

@pytest.mark.parametrize("title", [
    "Senior Engineer (Platform)", 'Lead, Backend', 'Backend: Senior', "<script>alert(1)</script>", 'Fast "Track" Dev',
])
def test_title_rejects_disallowed_characters(client, title):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("T-X", title, uid), headers=sa)
    assert res.status_code == 422


def test_role_rejects_comma(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("R-X", "Valid Role", uid, jobRole="Backend, Engineer"), headers=sa)
    assert res.status_code == 422


def test_company_rejects_scripts_and_brackets(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    for bad in ("Acme {Evil}", "Acme <script>", "Acme [Ltd]"):
        res = client.post("/api/jobs", json=job_payload("C-X", "Valid Role", uid, companyName=bad), headers=sa)
        assert res.status_code == 422, bad
    ok = client.post("/api/jobs", json=job_payload("C-OK", "Valid Role", uid, companyName="Acme Pvt. Ltd."), headers=sa)
    assert ok.status_code == 201


def test_title_allowed_charset(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("T-OK", "Frontend Developer - React / Vue & Angular", uid), headers=sa)
    assert res.status_code == 201, res.text


# ---- Keywords ----

def test_keyword_length_boundaries(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("K-1", "Valid Role", uid, keywords=["a" * 50]), headers=sa)
    assert res.status_code == 201
    res2 = client.post("/api/jobs", json=job_payload("K-2", "Valid Role", uid, keywords=["a" * 51]), headers=sa)
    assert res2.status_code == 422


def test_keyword_count_boundaries(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("K-3", "Valid Role", uid, keywords=[f"s{i}" for i in range(20)]), headers=sa)
    assert res.status_code == 201
    res2 = client.post("/api/jobs", json=job_payload("K-4", "Valid Role", uid, keywords=[f"s{i}" for i in range(21)]), headers=sa)
    assert res2.status_code == 422


def test_keyword_case_insensitive_dedupe_and_canonical_casing(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("K-5", "Valid Role", uid, keywords=["python", "PYTHON", "c#", "C#", "node.js", ".NET", "C++"]), headers=sa)
    assert res.status_code == 201, res.text
    assert res.json()["keywords"] == ["python", "C#", "Node.js", ".NET", "C++"]


def test_keyword_rejects_parens_and_comma(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    res = client.post("/api/jobs", json=job_payload("K-6", "Valid Role", uid, keywords=["React (Hooks)"]), headers=sa)
    assert res.status_code == 422


# ---- Department ----

def test_department_must_be_in_predefined_list(client):
    sa = _sa()
    uid = ensure_user(client, sa)
    bad = client.post("/api/jobs", json=job_payload("D-X", "Valid Role", uid, department="Everything"), headers=sa)
    assert bad.status_code == 422
    ok = client.post("/api/jobs", json=job_payload("D-OK", "Valid Role", uid, department="Data & Analytics"), headers=sa)
    assert ok.status_code == 201


# ---- Rules endpoint parity + authz ----

def test_rules_endpoint_matches_schema(client):
    res = client.get("/api/jobs/rules", headers=_sa())
    assert res.status_code == 200
    body = res.json()
    assert body["jdMinChars"] == 50 and body["jdMaxChars"] == 10000
    assert body["maxKeywords"] == 20 and body["positionsMin"] == 1 and body["positionsMax"] == 1000
    assert "Engineering" in body["departments"]
    denied = client.get("/api/jobs/rules", headers=auth_headers(role="technical_interviewer"))
    assert denied.status_code == 403


# ---- Create vs edit (legacy jobs grandfathered) ----

def test_edit_only_validates_changed_fields(client, mock_db):
    import asyncio

    sa = _sa()
    uid = ensure_user(client, sa)
    job = post_job(client, sa, sa, "LEGACY", "Valid Legacy Role")
    asyncio.get_event_loop().run_until_complete(mock_db["jobs"].update_one(
        {"jobId": job["jobId"]},
        {"$set": {"title": "Old Title (legacy)", "department": "LegacyDept"}}))
    # Untouched legacy fields are NOT re-validated when editing an unrelated field.
    ok = client.put(f"/api/jobs/{job['jobId']}", json={"matchThreshold": 75}, headers=sa)
    assert ok.status_code == 200, ok.text
    # Editing the affected field IS validated against the matrix.
    bad = client.put(f"/api/jobs/{job['jobId']}", json={"title": "New (Parens) Title"}, headers=sa)
    assert bad.status_code == 422
