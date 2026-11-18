"""Integration tests for user management API (/api/users)."""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models.user import UserRepository
from app.security.deps import get_db
from app.security.passwords import hash_password
from app.security.roles import Role
from app.security.tokens import create_access_token


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_users_api_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


async def _make_user_and_token(mock_db, role="super_admin", email="super@example.com"):
    repo = UserRepository(mock_db)
    user = await repo.create({
        "email": email,
        "name": "Super User",
        "role": role,
        "orgId": "org-1",
        "passwordHash": hash_password("ValidPassword123!"),
        "isActive": True,
    })
    token = create_access_token(
        user_id=user["userId"],
        org_id="org-1",
        role=role,
        session_id="sess-test",
    )
    return user, {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_list_users(client, mock_db):
    _, headers = await _make_user_and_token(mock_db)
    res = client.get("/api/users", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) == 1


@pytest.mark.asyncio
async def test_create_user_admin_forbidden_for_regular_admin(client, mock_db):
    # A regular admin does NOT have roles.assign_admin
    _, admin_headers = await _make_user_and_token(mock_db, role="admin", email="regular_admin@example.com")
    res = client.post(
        "/api/users",
        json={"email": "newadmin@example.com", "name": "New Admin", "role": "admin"},
        headers=admin_headers,
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_create_user_success_super_admin(client, mock_db):
    _, super_headers = await _make_user_and_token(mock_db, role="super_admin", email="root@example.com")
    res = client.post(
        "/api/users",
        json={"email": "newhr@example.com", "name": "New HR", "role": "hr"},
        headers=super_headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert "user" in data
    assert data["user"]["email"] == "newhr@example.com"
    assert "inviteUrl" in data
    assert "/accept-invite#token=" in data["inviteUrl"]


@pytest.mark.asyncio
async def test_update_and_delete_user(client, mock_db):
    user, super_headers = await _make_user_and_token(mock_db)
    repo = UserRepository(mock_db)
    target = await repo.create({
        "email": "target@example.com",
        "name": "Target User",
        "role": "hr",
        "orgId": "org-1",
    })

    # Update name
    put_res = client.put(f"/api/users/{target['userId']}", json={"name": "Updated Target"}, headers=super_headers)
    assert put_res.status_code == 200
    assert put_res.json()["name"] == "Updated Target"

    # Delete target
    del_res = client.delete(f"/api/users/{target['userId']}", headers=super_headers)
    assert del_res.status_code == 204

    # Target is gone
    get_res = client.get(f"/api/users/{target['userId']}", headers=super_headers)
    assert get_res.status_code == 404

@pytest.mark.asyncio
async def test_user_directory_lists_only_active_for_job_creators(client, mock_db):
    """GET /api/users/directory: jobs.manage roles see active users; interviewers 403."""
    _, sa = await _make_user_and_token(mock_db, email="super@example.com")
    repo = UserRepository(mock_db)
    await repo.create({
        "email": "hr@example.com", "name": "HR", "role": "hr", "orgId": "org-1",
        "passwordHash": hash_password("ValidPassword123!"), "isActive": True,
    })
    await repo.create({
        "email": "gone@example.com", "name": "Gone", "role": "hr", "orgId": "org-1",
        "passwordHash": hash_password("ValidPassword123!"), "isActive": False,
    })
    res = client.get("/api/users/directory", headers=sa)
    assert res.status_code == 200
    emails = [u["email"] for u in res.json()]
    assert "hr@example.com" in emails
    assert "gone@example.com" not in emails

    _, iv = await _make_user_and_token(mock_db, role="technical_interviewer",
                                       email="iv@example.com")
    assert client.get("/api/users/directory", headers=iv).status_code == 403

@pytest.mark.asyncio
async def test_company_permission_request_and_tenant_boundary(client, mock_db):
    _, root = await _make_user_and_token(mock_db)
    company = client.post("/api/companies", headers=root, json={"name": "Acme"}).json()
    org = company["orgId"]
    payload = {"email": "admin@acme.test", "name": "Pat", "role": "admin", "orgId": org,
               "adminPermissions": ["jobs.view"]}
    assert client.post("/api/users", headers=root, json={**payload, "adminPermissions": ["roles.assign_admin"]}).status_code == 422
    created = client.post("/api/users", headers=root, json=payload)
    assert created.status_code == 201, created.text
    uid = created.json()["user"]["userId"]
    admin = {"Authorization": "Bearer " + create_access_token(user_id=uid, org_id=org, role="admin", session_id="acme")}
    own = client.get("/api/companies", headers=admin).json()
    assert [c["orgId"] for c in own["companies"]] == [org]
    assert own["granted"] == ["jobs.view"]
    assert client.get("/api/users", headers=admin).status_code == 403
    assert client.post("/api/companies", headers=admin, json={"name":"Other"}).status_code == 403
    for permission in ("users.manage", "whatsapp.campaign"):
        assert client.post("/api/companies/requests/"+permission, headers=admin).status_code == 200
    tree = client.get("/api/companies", headers=root).json()["companies"]
    member = next(c for c in tree if c["orgId"] == org)["members"][0]
    assert member["userId"] == uid and "users.manage" in member["permissionRequests"]
    path = f"/api/companies/{org}/requests/{uid}/users.manage"
    assert client.put(path, headers=admin, json={"approve":True}).status_code == 403
    assert client.put(path.replace(org, "other"), headers=root, json={"approve":True}).status_code == 409
    assert client.put(path, headers=root, json={"approve":True}).status_code == 200
    assert client.put(path, headers=root, json={"approve":True}).status_code == 409
    assert [u["userId"] for u in client.get("/api/users", headers=admin).json()] == [uid]
    assert client.put(path.replace("users.manage","whatsapp.campaign"), headers=root, json={"approve":False}).status_code == 200
    state = client.get("/api/companies", headers=admin).json()
    assert state["pending"] == [] and "whatsapp.campaign" not in state["granted"]
