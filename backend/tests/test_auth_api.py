"""Integration tests for authentication API (/api/auth)."""

from datetime import datetime, timedelta, timezone
import mongomock_motor
import pyotp
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models.user import UserRepository, SessionRepository, to_public_user
from app.security.deps import get_db
from app.security.passwords import hash_password
from app.security.roles import Role
from app.security.tokens import create_access_token


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_auth_api_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


async def _create_test_user(mock_db, role="admin", email="admin@example.com", password="Password123!@#", mfa=False):
    repo = UserRepository(mock_db)
    user_doc = {
        "email": email,
        "name": "Test Admin",
        "role": role,
        "orgId": "org-default",
        "passwordHash": hash_password(password),
        "isActive": True,
        "mfa": {"enabled": mfa},
    }
    return await repo.create(user_doc)


def test_login_invalid_credentials(client, mock_db):
    res = client.post("/api/auth/login", json={"email": "nonexistent@example.com", "password": "Password123!@#"})
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_success(client, mock_db):
    user = await _create_test_user(mock_db, email="success@example.com")
    res = client.post("/api/auth/login", json={"email": "success@example.com", "password": "Password123!@#"})
    assert res.status_code == 200
    data = res.json()
    assert "accessToken" in data
    assert data["user"]["email"] == "success@example.com"
    assert "passwordHash" not in data["user"]
    # Refresh cookie set
    assert "primehire_refresh_token" in res.cookies


@pytest.mark.asyncio
async def test_login_mfa_flow(client, mock_db):
    secret = pyotp.random_base32()
    user = await _create_test_user(mock_db, email="mfa@example.com", mfa=True)
    # Store encrypted secret
    from app.security.mfa import encrypt_mfa_secret
    repo = UserRepository(mock_db)
    await repo.update(user["userId"], {"mfa.secretEncrypted": encrypt_mfa_secret(secret)})

    # Login triggers MFA prompt
    res = client.post("/api/auth/login", json={"email": "mfa@example.com", "password": "Password123!@#"})
    assert res.status_code == 200
    data = res.json()
    assert data.get("mfaRequired") is True
    mfa_token = data["mfaToken"]

    # Verify with invalid code
    bad_verify = client.post("/api/auth/mfa/verify", json={"mfaToken": mfa_token, "code": "000000"})
    assert bad_verify.status_code == 401

    # Verify with correct code
    totp = pyotp.TOTP(secret)
    valid_code = totp.now()
    good_verify = client.post("/api/auth/mfa/verify", json={"mfaToken": mfa_token, "code": valid_code})
    assert good_verify.status_code == 200
    assert "accessToken" in good_verify.json()


@pytest.mark.asyncio
async def test_refresh_token_rotation(client, mock_db):
    user = await _create_test_user(mock_db, email="refresh@example.com")
    login_res = client.post("/api/auth/login", json={"email": "refresh@example.com", "password": "Password123!@#"})
    ref_cookie = login_res.cookies["primehire_refresh_token"]

    client.cookies.set("primehire_refresh_token", ref_cookie)
    ref_res = client.post("/api/auth/refresh")
    assert ref_res.status_code == 200
    assert "accessToken" in ref_res.json()
    new_cookie = ref_res.cookies["primehire_refresh_token"]
    assert new_cookie != ref_cookie


@pytest.mark.asyncio
async def test_me_endpoint_and_logout(client, mock_db):
    user = await _create_test_user(mock_db, email="me@example.com")
    login_res = client.post("/api/auth/login", json={"email": "me@example.com", "password": "Password123!@#"})
    token = login_res.json()["accessToken"]

    # Unauthenticated request fails
    assert client.get("/api/auth/me").status_code == 401

    # Authenticated request succeeds
    headers = {"Authorization": f"Bearer {token}"}
    me_res = client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "me@example.com"

    # Logout
    logout_res = client.post("/api/auth/logout", headers=headers)
    assert logout_res.status_code == 200

    # Session revoked -> next request with same token fails
    assert client.get("/api/auth/me", headers=headers).status_code == 401
