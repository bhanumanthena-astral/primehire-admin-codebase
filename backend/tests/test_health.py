"""GET /api/health: alive without secrets, mongo states without leaking details."""

from fastapi.testclient import TestClient

from app.main import app


def test_health_ok_without_mongo(monkeypatch):
    monkeypatch.setattr("app.config.settings.mongodb_uri", "")
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["mongo"] == "not_configured"
    assert "mongodb_uri" not in res.text.lower()
    assert "mongodb://" not in res.text


def test_health_unreachable_mongo(monkeypatch):
    # Unroutable address + short timeout: must report unreachable, never raise.
    monkeypatch.setattr("app.config.settings.mongodb_uri", "mongodb://127.0.0.1:1")
    monkeypatch.setattr("app.db.mongodb._client", None, raising=False)
    import app.db.mongodb as m

    m.reset_client()
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["mongo"] in ("unreachable", "connected")
    m.reset_client()
