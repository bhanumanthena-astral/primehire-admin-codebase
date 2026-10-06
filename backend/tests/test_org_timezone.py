"""Slice 13: org-timezone-aware automatic job closure."""

import mongomock_motor
import pytest
from datetime import datetime, timezone
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
    return mongomock_motor.AsyncMongoMockClient()["test_org_timezone_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _sa(org_id="default"):
    return auth_headers(role="super_admin", org_id=org_id)


async def _seed_org(db, org_id="default", tz=None):
    from app.models.organization import OrganizationRepository

    repo = OrganizationRepository(db)
    if not await repo.get_by_org_id(org_id):
        await repo.create({"orgId": org_id, "name": org_id})
    if tz is not None:
        await repo.update_by_org_id(org_id, {"settings.timezone": tz})


def _closes_at(iso_wall: str) -> str:
    return iso_wall


# ---- Boundary semantics ----

async def test_auto_close_uses_org_tz_boundary(client, mock_db, monkeypatch):
    """Same stored closesAt wall: Kolkata org closes it, UTC org does not."""
    from app.models.organization import seed_default_org

    await seed_default_org(mock_db)
    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    import app.services.auto_close as ac

    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    # Stored wall-clock: today 13:00. UTC org: boundary 13:00Z > now → open.
    job = post_job(client, sa, sa, "TZ-1", "OrgTz", lifecycleStatus="OPEN",
                   openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T13:00:00+00:00")
    r = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r.json()["closed"] == 0
    # Now Asia/Kolkata: boundary = 13:00+05:30 wall → instant 07:30Z ≤ now → CLOSED.
    upd = client.put("/api/org/settings", json={"timezone": "Asia/Kolkata"}, headers=sa)
    assert upd.status_code == 200, upd.text
    r2 = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r2.json()["closed"] == 1
    assert r2.json()["jobIds"] == [job["jobId"]]


async def test_auto_close_utc_fallback_when_tz_missing(client, mock_db, monkeypatch):
    """No org doc / no timezone → UTC preserves the documented interim behavior."""
    import app.services.auto_close as ac

    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    job = post_job(client, sa, sa, "TZ-2", "UtcFallback", lifecycleStatus="OPEN",
                   openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T11:00:00+00:00")
    r = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r.json()["closed"] == 1  # UTC interpretation closes it


async def test_auto_close_invalid_stored_tz_falls_back_to_utc(client, mock_db, monkeypatch):
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="UTC")
    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    # Corrupt the stored timezone directly.
    await mock_db["organizations"].update_one(
        {"orgId": "default"}, {"$set": {"settings.timezone": "Not/AZone"}}
    )
    post_job(client, sa, sa, "TZ-3", "BadTz", lifecycleStatus="OPEN",
             openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T11:00:00+00:00")
    r = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r.json()["closed"] == 1


async def test_auto_close_boundary_exactly_at_threshold(client, mock_db, monkeypatch):
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="UTC")
    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    post_job(client, sa, sa, "TZ-4", "AtThreshold", lifecycleStatus="OPEN",
             openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T12:00:00+00:00")
    r = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r.json()["closed"] == 1


async def test_auto_close_boundary_just_after_threshold(client, mock_db, monkeypatch):
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="UTC")
    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    post_job(client, sa, sa, "TZ-4b", "JustFuture", lifecycleStatus="OPEN",
             openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T12:00:01+00:00")
    r = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r.json()["closed"] == 0


async def test_auto_close_dst_boundary_new_york(client, mock_db, monkeypatch):
    """Same wall time maps to different UTC instants in Jan (EST, UTC-5)
    vs Jul (EDT, UTC-4) — only a real tz implementation passes."""
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="America/New_York")
    sa = _sa()
    uid = ensure_user(client, sa)
    post_job(client, sa, sa, "TZ-5a", "WinterJd", lifecycleStatus="OPEN",
             openedAt="2026-01-01T00:00:00+00:00", closesAt="2026-01-15T12:00:00+00:00")
    monkeypatch.setattr(ac, "_utcnow", lambda: datetime(2026, 1, 15, 16, 59, 59, tzinfo=timezone.utc))
    r1 = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r1.json()["closed"] == 0
    monkeypatch.setattr(ac, "_utcnow", lambda: datetime(2026, 1, 15, 17, 0, 0, tzinfo=timezone.utc))
    r2 = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r2.json()["closed"] == 1  # EST boundary = 17:00Z

    post_job(client, sa, sa, "TZ-5b", "SummerJd", lifecycleStatus="OPEN",
             openedAt="2026-07-01T00:00:00+00:00", closesAt="2026-07-15T12:00:00+00:00")
    monkeypatch.setattr(ac, "_utcnow", lambda: datetime(2026, 7, 15, 15, 59, 59, tzinfo=timezone.utc))
    r3 = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r3.json()["closed"] == 0
    monkeypatch.setattr(ac, "_utcnow", lambda: datetime(2026, 7, 15, 16, 0, 0, tzinfo=timezone.utc))
    r4 = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r4.json()["closed"] == 1  # EDT boundary = 16:00Z


async def test_auto_close_idempotent_and_state_filters(client, mock_db, monkeypatch):
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="UTC")
    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    closed_job = post_job(client, sa, sa, "TZ-6a", "Expired", lifecycleStatus="OPEN",
                          openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T11:00:00+00:00")
    future_job = post_job(client, sa, sa, "TZ-6b", "Future", lifecycleStatus="OPEN",
                          openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-02T11:00:00+00:00")
    archived = post_job(client, sa, sa, "TZ-6c", "Archived", lifecycleStatus="OPEN",
                        openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T11:00:00+00:00")
    client.post(f"/api/jobs/{archived['jobId']}/archive", headers=sa)
    r1 = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r1.json()["closed"] == 1 and r1.json()["jobIds"] == [closed_job["jobId"]]
    r2 = client.post("/api/admin/jobs/auto-close", headers=sa)
    assert r2.json()["closed"] == 0  # idempotent
    final = client.get(f"/api/jobs/{future_job['jobId']}", headers=sa).json()
    assert final["lifecycleStatus"] == "OPEN"
    arc = client.get(f"/api/jobs/{archived['jobId']}", headers=sa).json()
    assert arc["lifecycleStatus"] == "ARCHIVED"


async def test_auto_close_multi_org_isolation(client, mock_db, monkeypatch):
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="Asia/Kolkata")
    await _seed_org(mock_db, "orgB", tz="America/New_York")
    saA = _sa("default")
    saB = _sa("orgB")
    uidA = ensure_user(client, saA)
    uidB = ensure_user(client, saB)
    now = datetime(2026, 1, 15, 16, 30, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    # Same wall closesAt for both orgs; Jan wall 12:00 → A (Kolkata): boundary 06:30Z (closed);
    # B (NY, EST): boundary 17:00Z (open).
    post_job(client, saA, saA, "TZ-7a", "OrgA", lifecycleStatus="OPEN",
             openedAt="2026-01-01T00:00:00+00:00", closesAt="2026-01-15T12:00:00+00:00")
    jobB = post_job(client, saB, saB, "TZ-7b", "OrgB", lifecycleStatus="OPEN",
                    openedAt="2026-01-01T00:00:00+00:00", closesAt="2026-01-15T12:00:00+00:00")
    ra = client.post("/api/admin/jobs/auto-close", headers=saA)
    assert ra.json()["closed"] == 1
    rb = client.post("/api/admin/jobs/auto-close", headers=saB)
    assert rb.json()["closed"] == 0
    assert client.get(f"/api/jobs/{jobB['jobId']}", headers=saB).json()["lifecycleStatus"] == "OPEN"


async def test_auto_close_audit_and_application_block(client, mock_db, monkeypatch):
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="UTC")
    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    job = post_job(client, sa, sa, "TZ-8", "Audit", lifecycleStatus="OPEN",
                   openedAt="2026-06-01T00:00:00+00:00", closesAt="2026-06-01T11:00:00+00:00")
    client.post("/api/admin/jobs/auto-close", headers=sa)
    audits = client.get("/api/audit-log?resource_type=job", headers=sa).json()
    ac = next(a for a in audits if a["action"] == "job.close" and a["actorUserId"] == "system:auto-close")
    assert ac["details"]["reason"] == "closing date reached"
    applicant = client.post("/api/applicants", json={"email": "tz8@x.com", "name": "A"}, headers=sa).json()
    res = client.post("/api/applications", json={"jobId": job["jobId"], "applicantId": applicant["applicantId"]}, headers=sa)
    assert res.status_code == 409


async def test_manual_close_and_reopen_unchanged(client, mock_db, monkeypatch):
    import app.services.auto_close as ac

    await _seed_org(mock_db, "default", tz="Asia/Kolkata")
    sa = _sa()
    uid = ensure_user(client, sa)
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    job = post_job(client, sa, sa, "TZ-9", "Manual", lifecycleStatus="OPEN",
                   openedAt="2026-06-01T00:00:00+00:00", closesAt="2027-06-01T00:00:00+00:00")
    close = client.post(f"/api/jobs/{job['jobId']}/close", json={"reason": "manual"}, headers=sa)
    assert close.status_code == 200
    bad = client.post(f"/api/jobs/{job['jobId']}/reopen", json={"closesAt": "2020-01-01T00:00:00+00:00"}, headers=sa)
    assert bad.status_code == 422
    good = client.post(f"/api/jobs/{job['jobId']}/reopen", json={"closesAt": "2027-01-01T00:00:00+00:00"}, headers=sa)
    assert good.status_code == 200


async def test_org_settings_timezone_validation(client, mock_db):
    await _seed_org(mock_db, "default")
    sa = _sa()
    bad = client.put("/api/org/settings", json={"timezone": "Nope/Zone"}, headers=sa)
    assert bad.status_code == 422
    good = client.put("/api/org/settings", json={"timezone": "America/New_York"}, headers=sa)
    assert good.status_code == 200
    assert good.json()["settings"]["timezone"] == "America/New_York"
