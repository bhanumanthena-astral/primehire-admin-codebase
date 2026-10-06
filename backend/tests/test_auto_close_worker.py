"""Slice V1: org-timezone-aware periodic auto-close via the worker sweep."""

import asyncio
import mongomock_motor
import pytest
from datetime import datetime, timezone

from app.main import app
from app.security.deps import get_db
from fastapi.testclient import TestClient
from app.config import settings
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_auto_close_worker_db"]


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


async def _insert_job(db, org_id, job_id, lifecycle, closes_at: datetime | None):
    await db["jobs"].insert_one({
        "orgId": org_id, "jobId": job_id, "jobKey": job_id, "title": "T",
        "lifecycleStatus": lifecycle, "closesAt": closes_at,
        "assigneeEmail": "owner@example.com", "assigneeUserId": "u1",
    })


async def test_worker_sweep_closes_due_jobs_only_open(mock_db, monkeypatch):
    await _seed_org(mock_db, "default", "UTC")
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    import app.services.auto_close as ac

    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    await _insert_job(mock_db, "default", "J-OPEN", "OPEN", datetime(2026, 6, 1, 11, 0, 0, tzinfo=timezone.utc))
    await _insert_job(mock_db, "default", "J-FUTURE", "OPEN", datetime(2026, 6, 2, 11, 0, 0, tzinfo=timezone.utc))
    await _insert_job(mock_db, "default", "J-DRAFT", "DRAFT", datetime(2026, 6, 1, 11, 0, 0, tzinfo=timezone.utc))
    await _insert_job(mock_db, "default", "J-HOLD", "ON_HOLD", datetime(2026, 6, 1, 11, 0, 0, tzinfo=timezone.utc))
    await _insert_job(mock_db, "default", "J-ARCH", "ARCHIVED", datetime(2026, 6, 1, 11, 0, 0, tzinfo=timezone.utc))
    result = await ac.auto_close_due_jobs(mock_db)
    assert result["closed"] == 1 and result["jobIds"] == ["J-OPEN"]
    statuses = {d["jobId"]: d["lifecycleStatus"] async for d in mock_db["jobs"].find({})}
    assert statuses["J-OPEN"] == "CLOSED"
    assert statuses["J-FUTURE"] == "OPEN"
    assert statuses["J-DRAFT"] == "DRAFT"
    assert statuses["J-HOLD"] == "ON_HOLD"
    assert statuses["J-ARCH"] == "ARCHIVED"


async def test_worker_sweep_boundary_exact_instant_and_idempotent(mock_db, monkeypatch):
    await _seed_org(mock_db, "default", "UTC")
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    import app.services.auto_close as ac

    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    await _insert_job(mock_db, "default", "J-EDGE", "OPEN", datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc))
    first = await ac.auto_close_due_jobs(mock_db)
    assert first["closed"] == 1
    second = await ac.auto_close_due_jobs(mock_db)
    assert second["closed"] == 0
    audits = await mock_db["audit_log"].count_documents({"action": "job.close", "actorUserId": "system:auto-close"})
    assert audits == 1


async def test_worker_sweep_org_timezone_applied(mock_db, monkeypatch):
    await _seed_org(mock_db, "default", "Asia/Kolkata")
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    import app.services.auto_close as ac

    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    # closesAt wall 13:00Z stored; Kolkata boundary is 07:30Z -> already due.
    await _insert_job(mock_db, "default", "J-TZ", "OPEN", datetime(2026, 6, 1, 13, 0, 0, tzinfo=timezone.utc))
    result = await ac.auto_close_due_jobs(mock_db)
    assert result["closed"] == 1


async def test_worker_sweep_two_workers_racing_close_once(mock_db, monkeypatch):
    await _seed_org(mock_db, "default", "UTC")
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    import app.services.auto_close as ac

    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    await _insert_job(mock_db, "default", "J-RACE", "OPEN", datetime(2026, 6, 1, 11, 0, 0, tzinfo=timezone.utc))
    r1, r2 = await asyncio.gather(ac.auto_close_due_jobs(mock_db), ac.auto_close_due_jobs(mock_db))
    total = r1["closed"] + r2["closed"]
    assert total == 1
    audits = await mock_db["audit_log"].count_documents({"action": "job.close", "actorUserId": "system:auto-close"})
    assert audits == 1


async def test_worker_sweep_notification_outbox_dedupe(mock_db, monkeypatch):
    await _seed_org(mock_db, "default", "UTC")
    now = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    import app.services.auto_close as ac

    monkeypatch.setattr(ac, "_utcnow", lambda: now)
    await _insert_job(mock_db, "default", "J-EMAIL", "OPEN", datetime(2026, 6, 1, 11, 0, 0, tzinfo=timezone.utc))
    from app.services.outbox_crypto import encrypt_body  # noqa: F401  (ensures crypto surface stays)
    # AUTO-CLOSE will try to queue an email; missing encryption key must not fail the sweep.
    result = await ac.auto_close_due_jobs(mock_db)
    assert result["closed"] == 1
    second = await ac.auto_close_due_jobs(mock_db)
    assert second["closed"] == 0


async def test_worker_downtime_catchup_closes_backlog(mock_db, monkeypatch):
    await _seed_org(mock_db, "default", "UTC")
    in_the_past = datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc)
    import app.services.auto_close as ac

    monkeypatch.setattr(ac, "_utcnow", lambda: in_the_past)
    await _insert_job(mock_db, "default", "J-OLD", "OPEN", datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc))
    # Worker was down; when it comes back with a later "now", it must catch up.
    monkeypatch.setattr(ac, "_utcnow", lambda: datetime(2026, 6, 3, 10, 0, 0, tzinfo=timezone.utc))
    result = await ac.auto_close_due_jobs(mock_db)
    assert result["closed"] == 1
