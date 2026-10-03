"""Authorization matrix: role × endpoint guard coverage (CLAUDE.md §1).

For every routed endpoint, asserts:
  - Unauthenticated request → 401 or 403
  - Each role that SHOULD be denied → 403
  - Each role that SHOULD be allowed → 2xx

The matrix is the single source of truth; add a row whenever an endpoint is
added.  A missing guard will make a test fail.
"""

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
    return mongomock_motor.AsyncMongoMockClient()["test_authz_matrix_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


# ---- Matrix definition ----
# Each row: (method, path, roles_allowed, roles_denied)
#   - "ANY_AUTHED" in roles_allowed means any authenticated role passes.
#   - We test with a body for POST/PUT/PATCH methods.
#   - Expected status for denied = 403; for unauthed = 401 or 403.

_SAMPLE_UUID = "00000000-0000-0000-0000-000000000000"

AUTHZ_MATRIX = [
    # --- Health (no auth required) ---
    ("GET", "/api/health", None, []),  # None means no auth required

    # --- Auth endpoints (no auth required for login, reset) ---
    ("POST", "/api/auth/login", None, []),
    ("POST", "/api/auth/reset-password-request", None, []),
    ("POST", "/api/auth/reset-password", None, []),

    # --- Auth endpoints (auth required) ---
    ("GET", "/api/auth/me", "ANY_AUTHED", []),
    ("POST", "/api/auth/logout", "ANY_AUTHED", []),
    ("POST", "/api/auth/logout-all", "ANY_AUTHED", []),
    ("POST", "/api/auth/change-password", "ANY_AUTHED", []),
    ("POST", "/api/auth/mfa/enroll", "ANY_AUTHED", []),
    ("POST", "/api/auth/mfa/confirm", "ANY_AUTHED", []),
    ("GET", "/api/auth/sessions", "ANY_AUTHED", []),

    # --- Users management ---
    ("GET", "/api/users", ["super_admin", "admin"], ["hr", "technical_interviewer", "managerial_interviewer"]),
    # Admin has users.manage, so admin CAN create users (except assigning super_admin role, enforced separately).
    ("POST", "/api/users", ["super_admin", "admin"], ["hr", "technical_interviewer", "managerial_interviewer"]),

    # --- Jobs ---
    # Until the Phase 3 field projection exists, interviewers get 403 on
    # every hiring read (deny by default; masking alone is not a boundary).
    ("POST", "/api/jobs", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", "/api/jobs", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", f"/api/jobs/{_SAMPLE_UUID}", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),

    # --- Applicants ---
    ("POST", "/api/applicants", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", "/api/applicants", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", f"/api/applicants/{_SAMPLE_UUID}", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", f"/api/applicants/{_SAMPLE_UUID}/profile", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("POST", f"/api/applicants/{_SAMPLE_UUID}/reveal", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),

    # --- Applications ---
    ("POST", "/api/applications", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", "/api/applications", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", f"/api/applications/{_SAMPLE_UUID}", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),

    # --- Audit Log ---
    ("GET", "/api/audit-log", ["super_admin", "admin"], ["hr", "technical_interviewer", "managerial_interviewer"]),

    # --- Assessment hand-off (HR action; interviewers never trigger sends) ---
    ("POST", "/api/applications/send-assessments", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("POST", f"/api/applications/{_SAMPLE_UUID}/request-assessment", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", "/api/org/settings", ["super_admin"], ["admin", "hr", "technical_interviewer", "managerial_interviewer"]),
    ("PUT", "/api/org/settings", ["super_admin"], ["admin", "hr", "technical_interviewer", "managerial_interviewer"]),
    ("POST", "/api/admin/sync-sweep", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),

    # --- Diagnostics (admin visibility; email-mode is any-authed) ---
    ("GET", "/api/email-mode", "ANY_AUTHED", []),
    ("GET", "/api/diagnostics", ["super_admin", "admin"], ["hr", "technical_interviewer", "managerial_interviewer"]),
    ("GET", f"/api/diagnostics/outbox/{_SAMPLE_UUID}", ["super_admin", "admin"], ["hr", "technical_interviewer", "managerial_interviewer"]),
    ("POST", f"/api/diagnostics/outbox/{_SAMPLE_UUID}/retry", ["super_admin", "admin"], ["hr", "technical_interviewer", "managerial_interviewer"]),
    ("POST", f"/api/diagnostics/jobs/{_SAMPLE_UUID}/retry", ["super_admin", "admin"], ["hr", "technical_interviewer", "managerial_interviewer"]),

    # --- Resumes (HR upload flow; interviewers never see uploads) ---
    ("POST", "/api/resumes/upload", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", "/api/resumes/batches", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", f"/api/resumes/batches/{_SAMPLE_UUID}", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),
    ("GET", f"/api/resumes/files/{_SAMPLE_UUID}/download", ["super_admin", "admin", "hr"], ["technical_interviewer", "managerial_interviewer"]),

    # --- Reports & Directory (existing endpoints, require auth via router-level dependency) ---
    ("GET", f"/api/reports/{_SAMPLE_UUID}", "ANY_AUTHED", []),
    ("GET", "/api/assessments", "ANY_AUTHED", []),
    ("GET", "/api/candidates", "ANY_AUTHED", []),
]


def _minimal_body(method: str, path: str) -> dict | None:
    """Return a minimal valid-ish JSON body for POST/PUT methods to avoid validation 422s."""
    if method not in ("POST", "PUT", "PATCH"):
        return None
    if "/login" in path:
        return {"email": "x@x.com", "password": "P@ssw0rd12345"}
    if "/reset-password-request" in path:
        return {"email": "x@x.com"}
    if "/reset-password" in path:
        return {"token": "abc", "newPassword": "P@ssw0rd12345"}
    if "/change-password" in path:
        return {"oldPassword": "P@ssw0rd12345", "newPassword": "NewP@ssw0rd12345"}
    if "/mfa/confirm" in path:
        return {"secret": "JBSWY3DPEHPK3PXP", "code": "123456"}
    if "/jobs" in path:
        return {"jobKey": "AUTHZ-TEST", "title": "Authz Test"}
    if "/applicants" in path and "reveal" in path:
        return {"fields": ["email"]}
    if path.endswith("/applicants"):
        return {"email": "authz@test.com", "name": "Authz"}
    if "/applications" in path:
        return {"jobId": _SAMPLE_UUID, "applicantId": _SAMPLE_UUID}
    if "/users" in path:
        return {"email": "authz-user@x.com", "name": "Test", "role": "hr"}
    return {}


# ---- Test: unauthenticated access is denied ----

_AUTH_REQUIRED_ROWS = [
    (m, p) for m, p, allowed, _ in AUTHZ_MATRIX if allowed is not None
]


@pytest.mark.parametrize("method,path", _AUTH_REQUIRED_ROWS, ids=[f"{m} {p}" for m, p in _AUTH_REQUIRED_ROWS])
def test_unauthenticated_request_rejected(client, method, path):
    """Every auth-guarded endpoint must reject unauthenticated requests."""
    body = _minimal_body(method, path)
    kwargs = {"json": body} if body else {}
    res = getattr(client, method.lower())(path, **kwargs)
    assert res.status_code in (401, 403), (
        f"{method} {path} allowed unauthenticated access (got {res.status_code})"
    )


# ---- Test: denied roles get 403 ----

_DENIED_ROWS = [
    (m, p, role)
    for m, p, _, denied in AUTHZ_MATRIX
    for role in denied
]


@pytest.mark.parametrize("method,path,role", _DENIED_ROWS, ids=[f"{m} {p} [{r}]" for m, p, r in _DENIED_ROWS])
def test_denied_role_gets_403(client, method, path, role):
    """Roles NOT in the allowed list must get 403."""
    body = _minimal_body(method, path)
    kwargs = {"json": body} if body else {}
    headers = auth_headers(role=role)
    res = getattr(client, method.lower())(path, headers=headers, **kwargs)
    assert res.status_code == 403, (
        f"{method} {path} as {role}: expected 403, got {res.status_code}"
    )


# ---- Test: allowed roles get 2xx/4xx-not-403 (the guard passed) ----

_ALLOWED_ROWS = [
    (m, p, role)
    for m, p, allowed, _ in AUTHZ_MATRIX
    if allowed is not None and allowed != "ANY_AUTHED"
    for role in (allowed if isinstance(allowed, list) else [allowed])
]


@pytest.mark.parametrize("method,path,role", _ALLOWED_ROWS, ids=[f"{m} {p} [{r}]" for m, p, r in _ALLOWED_ROWS])
def test_allowed_role_passes_guard(client, method, path, role):
    """Allowed roles must NOT get 401/403 (may get 404/409/422 due to missing data, but not auth failures)."""
    body = _minimal_body(method, path)
    kwargs = {"json": body} if body else {}
    headers = auth_headers(role=role)
    res = getattr(client, method.lower())(path, headers=headers, **kwargs)
    assert res.status_code not in (401, 403), (
        f"{method} {path} as {role}: got {res.status_code}, expected auth to pass"
    )
