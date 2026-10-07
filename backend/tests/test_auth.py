"""Tests for backend auth dependencies (Admin API key, Cloudflare Access JWT)."""

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import require_admin_auth
from app.config import settings

test_app = FastAPI()


@test_app.get("/api/protected")
def protected_route(auth=Depends(require_admin_auth)):
    return {"status": "ok", "user": auth}


def test_auth_bypassed_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "disable_auth", True)
    client = TestClient(test_app)
    res = client.get("/api/protected")
    assert res.status_code == 200
    assert res.json()["user"]["role"] == "admin"


def test_auth_accepts_valid_bearer_token(monkeypatch):
    monkeypatch.setattr(settings, "disable_auth", False)
    monkeypatch.setattr(settings, "admin_api_key", "secret-token-xyz")
    client = TestClient(test_app)
    res = client.get("/api/protected", headers={"Authorization": "Bearer secret-token-xyz"})
    assert res.status_code == 200
    assert res.json()["user"]["sub"] == "admin-api-key"


def test_auth_accepts_valid_x_admin_key(monkeypatch):
    monkeypatch.setattr(settings, "disable_auth", False)
    monkeypatch.setattr(settings, "admin_api_key", "secret-token-xyz")
    client = TestClient(test_app)
    res = client.get("/api/protected", headers={"X-Admin-Key": "secret-token-xyz"})
    assert res.status_code == 200
    assert res.json()["user"]["sub"] == "admin-api-key"


def test_auth_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(settings, "disable_auth", False)
    monkeypatch.setattr(settings, "admin_api_key", "secret-token-xyz")
    client = TestClient(test_app)
    res = client.get("/api/protected", headers={"Authorization": "Bearer wrong-token"})
    assert res.status_code == 403


def test_auth_rejects_missing_token_when_key_configured(monkeypatch):
    monkeypatch.setattr(settings, "disable_auth", False)
    monkeypatch.setattr(settings, "admin_api_key", "secret-token-xyz")
    client = TestClient(test_app)
    res = client.get("/api/protected")
    assert res.status_code == 401
