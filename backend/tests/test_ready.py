"""GET /api/ready: 200 only when Mongo answers AND storage is writable."""

from fastapi.testclient import TestClient

from app.main import app


async def _ping_ok(_db):
    return True


async def _ping_fail(_db):
    return False


def test_ready_not_ready_without_mongo(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.settings.mongodb_uri", "")
    monkeypatch.setattr("app.config.settings.storage_dir", str(tmp_path))
    client = TestClient(app)
    res = client.get("/api/ready")
    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["mongo"] == "unavailable"
    assert body["checks"]["storage"] == "ok"
    assert "mongodb://" not in res.text


def test_ready_ok_when_mongo_and_storage_ok(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.settings.mongodb_uri", "mongodb://mongo:27017")
    monkeypatch.setattr("app.config.settings.storage_dir", str(tmp_path))
    monkeypatch.setattr("app.api.health.ping", _ping_ok)
    client = TestClient(app)
    res = client.get("/api/ready")
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_ready_503_when_storage_not_writable(monkeypatch):
    monkeypatch.setattr("app.config.settings.mongodb_uri", "mongodb://mongo:27017")
    monkeypatch.setattr("app.api.health.ping", _ping_ok)
    monkeypatch.setattr("app.api.health._storage_writable", lambda: False)
    client = TestClient(app)
    res = client.get("/api/ready")
    assert res.status_code == 503
    assert res.json()["checks"]["storage"] == "unavailable"


def test_ready_503_when_mongo_down(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.settings.mongodb_uri", "mongodb://mongo:27017")
    monkeypatch.setattr("app.config.settings.storage_dir", str(tmp_path))
    monkeypatch.setattr("app.api.health.ping", _ping_fail)
    client = TestClient(app)
    res = client.get("/api/ready")
    assert res.status_code == 503
    assert res.json()["checks"]["mongo"] == "unavailable"
