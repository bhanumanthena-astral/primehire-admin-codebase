"""Slice 10: audit-trail refinement — correctness, completeness, isolation.

Reuses the existing append-only audit_log (Slice 2) + job activity endpoint
(Slice 6). No new system, no new actions, no rule changes. Verifies:
- every job mutation is audited with actor/action/old/new/timestamp
- idempotent writes log no duplicate events
- history is append-only across a reassignment chain
- job + org isolation, existing RBAC preserved
- historical assignee ids survive deactivation (no rewrite)
"""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from tests.conftest import auth_headers, ensure_user, post_job


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_job_audit_db"]


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


def _activity(client, job_id, headers):
    res = client.get(f"/api/jobs/{job_id}/activity", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["items"]


def test_create_update_assign_audited_with_old_new_actor_timestamp(client):
    headers = _sa()
    created = post_job(client, headers, headers, "AUD-C1", "Audit Job")
    job_id = created["jobId"]
    client.put(f"/api/jobs/{job_id}", json={"title": "Audit Job v2"}, headers=headers)
    newcomer = ensure_user(client, headers, "audit-new@test.com")
    client.put(f"/api/jobs/{job_id}", json={"assigneeUserId": newcomer}, headers=headers)

    items = _activity(client, job_id, headers)
    by_action = {}
    for i in items:
        by_action.setdefault(i["action"], []).append(i)

    create = by_action["job.create"][0]
    assert create["actorUserId"]
    assert create["createdAt"]
    assert create["resourceId"] == job_id
    assert create["details"]["jobKey"] == "AUD-C1"

    update = next(i for i in by_action["job.update"]
                  if "title" in (i.get("details", {}).get("changes", {})))
    assert update["details"]["changes"]["title"] == {"from": "Audit Job", "to": "Audit Job v2"}
    assert update["actorUserId"] and update["createdAt"]

    assign = by_action["job.assign"][0]
    assert assign["details"]["to"] == newcomer
    assert assign["details"]["from"] == created["assigneeUserId"]
    assert assign["actorUserId"] and assign["createdAt"]


def test_close_reopen_archive_autoclose_audited(client):
    headers = _sa()
    created = post_job(client, headers, headers, "AUD-LC", lifecycleStatus="OPEN")
    job_id = created["jobId"]

    assert client.post(f"/api/jobs/{job_id}/close", json={"reason": "hired"}, headers=headers).status_code == 200
    assert client.post(f"/api/jobs/{job_id}/reopen", json={"closesAt": "2028-01-01T00:00:00Z"},
                       headers=headers).status_code == 200
    assert client.post(f"/api/jobs/{job_id}/archive", headers=headers).status_code == 200

    # Automatic closure on a second job (past closesAt).
    past = post_job(client, headers, headers, "AUD-AUTO", lifecycleStatus="OPEN",
                     closesAt="2020-01-01T00:00:00Z")
    swept = client.post("/api/admin/jobs/auto-close", headers=headers)
    assert swept.status_code == 200

    items = _activity(client, job_id, headers)
    actions = [i["action"] for i in items]
    assert "job.close" in actions and "job.reopen" in actions and "job.archive" in actions
    close = next(i for i in items if i["action"] == "job.close")
    assert close["details"] == {"from": "OPEN", "to": "CLOSED", "reason": "hired"}
    reopen = next(i for i in items if i["action"] == "job.reopen")
    assert reopen["details"]["from"] == "CLOSED" and reopen["details"]["to"] == "OPEN"
    assert reopen["details"]["closesAt"]

    auto_items = _activity(client, past["jobId"], headers)
    auto_close = next(i for i in auto_items if i["action"] == "job.close")
    assert auto_close["actorUserId"] == "system:auto-close"
    assert auto_close["details"]["reason"] == "closing date reached"


def test_idempotent_writes_log_no_duplicate_events(client):
    headers = _sa()
    created = post_job(client, headers, headers, "AUD-IDEM")
    job_id = created["jobId"]
    before = len(_activity(client, job_id, headers))

    # PUT with no actual change → no job.update event.
    assert client.put(f"/api/jobs/{job_id}", json={"title": created["title"]}, headers=headers).status_code == 200
    assert len(_activity(client, job_id, headers)) == before

    # POST /assign to the SAME owner → no job.assign event.
    same_email = created["assigneeEmail"]
    assert client.post(f"/api/jobs/{job_id}/assign", json={"email": same_email}, headers=headers).status_code == 200
    assert len(_activity(client, job_id, headers)) == before


def test_reassignment_chain_is_append_only(client):
    headers = _sa()
    created = post_job(client, headers, headers, "AUD-CHAIN")
    job_id = created["jobId"]
    rahul = ensure_user(client, headers, "chain-rahul@test.com")
    priya = ensure_user(client, headers, "chain-priya@test.com")
    srini = ensure_user(client, headers, "chain-srini@test.com")
    for uid in (rahul, priya, srini):
        assert client.put(f"/api/jobs/{job_id}", json={"assigneeUserId": uid}, headers=headers).status_code == 200

    items = _activity(client, job_id, headers)
    assigns = [i for i in items if i["action"] == "job.assign"]
    pairs = {(a["details"]["from"], a["details"]["to"]) for a in assigns}
    assert (created["assigneeUserId"], rahul) in pairs
    assert (rahul, priya) in pairs
    assert (priya, srini) in pairs
    # Intermediate hops are preserved, never collapsed into one current value.
    assert len(assigns) >= 3


def test_job_and_org_isolation(client):
    headers = _sa()
    first = post_job(client, headers, headers, "AUD-ISO-A")
    second = post_job(client, headers, headers, "AUD-ISO-B")
    client.put(f"/api/jobs/{first['jobId']}", json={"title": "Isolated A"}, headers=headers)

    items_b = _activity(client, second["jobId"], headers)
    assert all(i["resourceId"] == second["jobId"] for i in items_b)
    assert not any(i["action"] == "job.update" and
                   "Isolated A" in str(i.get("details", {})) for i in items_b)

    other = _sa(org="other-org")
    assert client.get(f"/api/jobs/{first['jobId']}/activity", headers=other).status_code == 404


def test_activity_rbac_preserved(client):
    headers = _sa()
    job = post_job(client, headers, headers, "AUD-RBAC")
    assert client.get(f"/api/jobs/{job['jobId']}/activity", headers=_iv()).status_code == 403
    unauthed = TestClient(app)
    assert unauthed.get(f"/api/jobs/{job['jobId']}/activity").status_code in (401, 403)


def test_historical_assignee_ids_survive_deactivation(client):
    """Deactivating a former assignee never rewrites stored audit ids."""
    headers = _sa()
    created = post_job(client, headers, headers, "AUD-HIST")
    job_id = created["jobId"]
    newcomer = ensure_user(client, headers, "hist-new@test.com")
    assert client.put(f"/api/jobs/{job_id}", json={"assigneeUserId": newcomer}, headers=headers).status_code == 200

    old_id = created["assigneeUserId"]
    res = client.put(f"/api/users/{old_id}", json={"isActive": False}, headers=headers)
    assert res.status_code == 200

    items = _activity(client, job_id, headers)
    assign = next(i for i in items if i["action"] == "job.assign")
    assert assign["details"]["from"] == old_id
    assert assign["details"]["to"] == newcomer
