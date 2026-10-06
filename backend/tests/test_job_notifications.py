"""Slice 9: job-assignment notifications reuse the existing outbox → worker → ZeptoMail path.

Covers PRD §23 (notify on assign + on reassignment) without inventing a new
channel, system, or retry machine:
- initial assignment queues an outbox row + an email_send background job
- reassignment queues for the NEW assignee (old → new preserved in audit)
- same-assignee repeat is idempotent (no duplicate outbox row)
- missing encryption key never blocks the job write
- worker email_send delivers a job_assigned message via Zepto (mocked)
- GET /api/jobs/{id}/notifications exposes metadata only (no bodies)
- org isolation + RBAC (interviewers denied, like activity)
"""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from tests.conftest import auth_headers, ensure_user, job_payload, post_job


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_job_notifications_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _sa(org="default"):
    return auth_headers(role="super_admin", org_id=org)


def _iv(org="default"):
    return auth_headers(role="technical_interviewer", org_id=org)


def _outbox_rows(mock_db, org="default"):
    import asyncio

    async def _collect():
        return [d async for d in mock_db["email_outbox"].find({"orgId": org})]

    return asyncio.get_event_loop().run_until_complete(_collect())


def test_initial_assignment_queues_outbox_and_worker(client, mock_db, monkeypatch):
    from cryptography.fernet import Fernet

    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "outbox_encryption_key", Fernet.generate_key().decode())
    headers = _sa()
    created = post_job(client, headers, headers, "NTF-INIT")
    rows = [m for m in _outbox_rows(mock_db) if m.get("kind") == "job_assigned"]
    assert len(rows) >= 1
    assert rows[0].get("payloadEncrypted")
    # Worker chain: an email_send background job exists for the message.
    import asyncio

    async def _jobs():
        return [d async for d in mock_db["background_jobs"].find({"kind": "email_send"})]

    jobs = asyncio.get_event_loop().run_until_complete(_jobs())
    assert len(jobs) >= 1
    # Notifications endpoint surfaces metadata (no body).
    res = client.get(f"/api/jobs/{created['jobId']}/notifications", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["jobId"] == created["jobId"]
    assert body["count"] >= 1
    assert "payloadEncrypted" not in body["items"][0]
    assert body["items"][0]["status"] in ("pending", "sending", "sent", "failed")


def test_reassignment_notifies_new_assignee_and_preserves_audit(client, mock_db, monkeypatch):
    from cryptography.fernet import Fernet

    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "outbox_encryption_key", Fernet.generate_key().decode())
    headers = _sa()
    created = post_job(client, headers, headers, "NTF-RE")
    first = ensure_user(client, headers, "re-new-a@test.com")
    second = ensure_user(client, headers, "re-new-b@test.com")
    assert client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": first}, headers=headers).status_code == 200
    assert client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": second}, headers=headers).status_code == 200
    rows = [m for m in _outbox_rows(mock_db) if m.get("kind") == "job_assigned"]
    dedupes = {m.get("dedupeKey") for m in rows}
    assert len(dedupes) >= 3  # initial + first + second (per job+assignee)
    # Audit preserves old → new.
    acts = client.get(f"/api/jobs/{created['jobId']}/activity", headers=headers).json()["items"]
    assigns = [a for a in acts if a.get("action") == "job.assign"]
    assert assigns
    assert assigns[0]["details"]["to"] == second
    # Notifications endpoint lists all three.
    notifs = client.get(f"/api/jobs/{created['jobId']}/notifications", headers=headers).json()
    assert notifs["count"] >= 3


def test_same_assignee_repeat_is_idempotent(client, mock_db, monkeypatch):
    from cryptography.fernet import Fernet

    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "outbox_encryption_key", Fernet.generate_key().decode())
    headers = _sa()
    created = post_job(client, headers, headers, "NTF-DEDUP")
    target = ensure_user(client, headers, "dedup@test.com")
    assert client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": target}, headers=headers).status_code == 200
    before = len([m for m in _outbox_rows(mock_db) if m.get("kind") == "job_assigned"])
    assert client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": target}, headers=headers).status_code == 200
    after = len([m for m in _outbox_rows(mock_db) if m.get("kind") == "job_assigned"])
    assert after == before


def test_missing_key_never_blocks_assignment(client, monkeypatch):
    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "outbox_encryption_key", "")
    headers = _sa()
    created = post_job(client, headers, headers, "NTF-NOKEY")
    target = ensure_user(client, headers, "nokey@test.com")
    res = client.put(f"/api/jobs/{created['jobId']}", json={"assigneeUserId": target}, headers=headers)
    assert res.status_code == 200
    assert res.json()["assigneeUserId"] == target


def test_worker_delivers_job_assignment_via_zepto(client, mock_db, monkeypatch):
    """The existing email_send worker handler sends job_assigned through ZeptoMail."""
    import asyncio

    from cryptography.fernet import Fernet

    from app.config import settings as _settings
    from app.services import email_send as _es

    monkeypatch.setattr(_settings, "outbox_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(_settings, "email_dry_run", False)
    monkeypatch.setattr(_es.settings, "email_dry_run", False)
    monkeypatch.setattr(_es, "recipient_allowed", lambda _e: True)

    async def _fake_zepto(to_email, to_name, subject, html_body):
        assert "assigned" in subject.lower()
        return "upstream-123"

    monkeypatch.setattr(_es, "send_via_zepto", _fake_zepto)
    headers = _sa()
    created = post_job(client, headers, headers, "NTF-WORKER")

    async def _one():
        return await mock_db["email_outbox"].find_one(
            {"orgId": "default", "kind": "job_assigned", "entityKey": created["jobId"]}
        )

    msg = asyncio.get_event_loop().run_until_complete(_one())
    assert msg is not None
    job = {"orgId": "default", "payload": {"messageId": msg["messageId"]}}
    outcome = asyncio.get_event_loop().run_until_complete(_es.process_email_job(mock_db, job))
    assert outcome.get("sent") == "zepto"
    updated = asyncio.get_event_loop().run_until_complete(_one())
    assert updated["status"] == "sent"


def test_notifications_rbac_and_org_isolation(client, monkeypatch):
    from cryptography.fernet import Fernet

    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "outbox_encryption_key", Fernet.generate_key().decode())
    headers = _sa()
    created = post_job(client, headers, headers, "NTF-RBAC")
    # Interviewers are denied (same split as activity).
    assert client.get(f"/api/jobs/{created['jobId']}/notifications", headers=_iv()).status_code == 403
    # Other org sees nothing (404 — no cross-org leak).
    other = _sa(org="other-org")
    assert client.get(f"/api/jobs/{created['jobId']}/notifications", headers=other).status_code == 404
