"""Slice C tests: dry-run, allowlist, write-ahead crash recovery, idempotency,
password canary, outbox crypto/wipe, bulk results, sync, authz. No real network.
"""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from tests.conftest import auth_headers, job_payload, ensure_user


@pytest.fixture(autouse=True)
def setup_config(monkeypatch, tmp_path):
    from cryptography.fernet import Fernet

    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "clamav_enabled", False)
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "openrouter_model", "")
    monkeypatch.setattr(settings, "outbox_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "zeptomail_api_key", "test-zepto-key")
    monkeypatch.setattr(settings, "email_from_address", "test@example.com")
    monkeypatch.setattr(settings, "email_dry_run", True)
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", "")
    monkeypatch.setattr(settings, "primehire_access_key", "test-key")
    monkeypatch.setattr(settings, "primehire_secret_key", "test-secret")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_assess_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _hr():
    return auth_headers(role="hr", org_id="default")


def _sa():
    return auth_headers(role="super_admin", org_id="default")


CANARY = "C@nary-Pw-9zX7"

CALLS = {"interview": 0, "zepto": 0}


class FakeResp:
    def __init__(self, status_code, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeAsyncClient:
    """Routes by URL: upstream interview/status/report + Zepto."""

    scenario = {"interview": "ok", "status": "pending", "report": None}

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        if "zeptomail" in url:
            CALLS["zepto"] += 1
            assert headers.get("Authorization"), "Zepto key header required"
            return FakeResp(200, {"message": "zepto-id-1"})
        if url.endswith("/interview"):
            CALLS["interview"] += 1
            mode = FakeAsyncClient.scenario["interview"]
            if mode == "ok":
                return FakeResp(200, {"data": {"interview": {
                    "id": "int-1", "url": "https:// upstream.test/i/int-1".replace(" ", ""),
                    "password": CANARY, "responseId": "res-1"}}})
            if mode == "duplicate_known":
                return FakeResp(409, {"message": "candidate already has interview",
                                      "data": {"id": "int-old",
                                               "url": "https://upstream.test/i/int-old"}})
            if mode == "duplicate_unknown":
                return FakeResp(409, {"message": "already exists"})
            if mode == "refused":
                return FakeResp(400, {"message": "bad candidate"})
            return FakeResp(500, {"message": "boom"})
        raise AssertionError(f"unexpected POST {url}")

    async def get(self, url, headers=None):
        if url.endswith("/status"):
            mode = FakeAsyncClient.scenario["status"]
            if mode == "submitted":
                return FakeResp(200, {"data": {"interviewStatus": {
                    "isInterviewSubmitted": True, "isReportAvailable": True,
                    "submittedAt": "2026-10-03T10:00:00+00:00"}}})
            return FakeResp(200, {"data": {"interviewStatus": {
                "isInterviewSubmitted": False, "isReportAvailable": False}}})
        if url.endswith("/report"):
            rep = FakeAsyncClient.scenario["report"]
            if rep is None:
                return FakeResp(404, {})
            return FakeResp(200, {"data": rep})
        raise AssertionError(f"unexpected GET {url}")


@pytest.fixture(autouse=True)
def _fake_http(monkeypatch):
    import httpx

    CALLS["interview"] = 0
    CALLS["zepto"] = 0
    FakeAsyncClient.scenario = {"interview": "ok", "status": "pending", "report": None}
    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)


async def _drain(mock_db, limit=50):
    from app.services.worker import run_once

    for _ in range(limit):
        if await run_once(mock_db) is None:
            break


def _make_shortlisted(client, key="A-JOB", email="cand.a@example.com", assessment="UP-A-1"):
    job = client.post("/api/jobs", json={
        **job_payload(key, "Backend", ensure_user(client, _sa())),
        "mustHaveSkills": ["Python"],
        "assessmentJobId": assessment}, headers=_hr()).json()
    applicant = client.post("/api/applicants", json={"email": email, "name": "Cand A"},
                            headers=_hr()).json()
    app_res = client.post("/api/applications", json={
        "jobId": job["jobId"], "applicantId": applicant["applicantId"],
        "initialStage": "SHORTLISTED"}, headers=_hr())
    assert app_res.status_code == 201, app_res.text
    return job, applicant, app_res.json()


def _outbox(mock_db, org="default"):
    async def _list():
        return [d async for d in mock_db["email_outbox"].find({"orgId": org})]
    return _list


# ---- Dry-run: recorded, never sent, stage unchanged ----

async def test_dry_run_records_without_sending(client, mock_db):
    _, _, app_doc = _make_shortlisted(client)
    res = client.post("/api/applications/send-assessments",
                      json={"applicationIds": [app_doc["applicationId"]]}, headers=_hr())
    assert res.status_code == 200
    assert res.json()["items"][0]["result"] == "accepted"
    await _drain(mock_db)
    assert CALLS["interview"] == 1 and CALLS["zepto"] == 0
    msgs = [m for m in await _outbox(mock_db)() if m.get("kind") == "assessment_invite"]
    assert len(msgs) == 1
    assert msgs[0]["status"] == "sent" and msgs[0]["sentVia"] == "dry_run"
    assert msgs[0]["payloadEncrypted"]  # dry-run keeps the record for inspection
    prof = client.get(f"/api/applications/{app_doc['applicationId']}", headers=_hr()).json()
    assert prof["currentStage"] == "SHORTLISTED"  # dry-run never moves the stage
    # Diagnostics shows it as recorded-not-sent, bodies excluded from lists.
    diag = client.get("/api/diagnostics", headers=_sa()).json()
    assert diag["dryRun"] is True and diag["outbox"].get("sent", 0) >= 1
    single = client.get(f"/api/diagnostics/outbox/{msgs[0]['messageId']}", headers=_sa()).json()
    assert CANARY in (single["body"] or "")  # dry-run record inspectable by admin


# ---- Real send (allowlisted): one interview, one email, wipe, stage moves ----

async def test_real_send_wipes_body_and_moves_stage(client, mock_db, monkeypatch, caplog):
    monkeypatch.setattr(settings, "email_dry_run", False)
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", "cand.a@example.com")
    _, _, app_doc = _make_shortlisted(client)
    client.post("/api/applications/send-assessments",
                json={"applicationIds": [app_doc["applicationId"]]}, headers=_hr())
    await _drain(mock_db)
    assert CALLS["interview"] == 1 and CALLS["zepto"] == 1
    msgs = [m for m in await _outbox(mock_db)() if m.get("kind") == "assessment_invite"]
    assert msgs[0]["status"] == "sent" and msgs[0]["sentVia"] == "zepto"
    assert msgs[0]["payloadEncrypted"] is None and msgs[0]["wiped"] is True
    prof = client.get(f"/api/applications/{app_doc['applicationId']}", headers=_hr()).json()
    assert prof["currentStage"] == "ASSESSMENT_SENT"
    # Canary (invite password) appears nowhere it shouldn't.
    raw_app = await mock_db["applications"].find_one({"applicationId": app_doc["applicationId"]})
    assert CANARY not in str(raw_app)
    raw_apl = await mock_db["applicants"].find_one({})
    assert CANARY not in str(raw_apl)
    audits = [d async for d in mock_db["audit_log"].find({})]
    assert CANARY not in str(audits)
    runs = [d async for d in mock_db["llm_runs"].find({})]
    assert CANARY not in str(runs)
    assert CANARY not in caplog.text
    profile = client.get(
        f"/api/applicants/{prof['applicantId']}/profile", headers=_hr()).text
    assert CANARY not in profile
    listed = client.get("/api/diagnostics", headers=_sa()).text
    assert CANARY not in listed
    single = client.get(f"/api/diagnostics/outbox/{msgs[0]['messageId']}", headers=_sa()).json()
    assert single["body"] is None  # wiped real sends are never viewable


async def test_allowlist_refuses_off_list(client, mock_db, monkeypatch):
    monkeypatch.setattr(settings, "email_dry_run", False)
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", "me@example.com")
    _, _, app_doc = _make_shortlisted(client)
    client.post("/api/applications/send-assessments",
                json={"applicationIds": [app_doc["applicationId"]]}, headers=_hr())
    await _drain(mock_db)
    assert CALLS["zepto"] == 0
    msgs = [m for m in await _outbox(mock_db)() if m.get("kind") == "assessment_invite"]
    assert msgs[0]["status"] == "failed" and "allowlist" in (msgs[0]["lastError"] or "")
    prof = client.get(f"/api/applications/{app_doc['applicationId']}", headers=_hr()).json()
    assert prof["currentStage"] == "SHORTLISTED"


# ---- Idempotency: rapid double-click → one interview, one email ----

async def test_double_click_sends_once(client, mock_db, monkeypatch):
    monkeypatch.setattr(settings, "email_dry_run", False)
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", "cand.a@example.com")
    _, _, app_doc = _make_shortlisted(client)
    body = {"applicationIds": [app_doc["applicationId"]]}
    r1 = client.post("/api/applications/send-assessments", json=body, headers=_hr())
    r2 = client.post("/api/applications/send-assessments", json=body, headers=_hr())
    assert r1.json()["items"][0]["result"] == "accepted"
    assert r2.json()["items"][0]["result"] == "accepted"
    await _drain(mock_db)
    assert CALLS["interview"] == 1
    assert CALLS["zepto"] == 1
    assert len([m for m in await _outbox(mock_db)() if m.get("kind") == "assessment_invite"]) == 1


# ---- Crash recovery: killed after upstream success resumes via duplicate ----

async def test_crash_between_upstream_and_write_recovers(client, mock_db, monkeypatch):
    monkeypatch.setattr(settings, "email_dry_run", False)
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", "cand.a@example.com")
    _, _, app_doc = _make_shortlisted(client)
    app_id = app_doc["applicationId"]
    # Simulate the crash: interview exists upstream, but we never wrote it.
    FakeAsyncClient.scenario["interview"] = "duplicate_known"
    client.post("/api/applications/send-assessments",
                json={"applicationIds": [app_id]}, headers=_hr())
    await _drain(mock_db)
    assert CALLS["interview"] == 1  # retried create hit the duplicate path, no second interview
    stored = await mock_db["applications"].find_one({"applicationId": app_id})
    assert stored["assessment"]["interviewId"] == "int-old"
    assert stored["assessment"]["reused"] is True
    assert CALLS["zepto"] == 1
    assert stored["currentStage"] == "ASSESSMENT_SENT"


# ---- Bulk per-item results + validation ----

async def test_bulk_per_item_results(client, mock_db):
    job, _, shortlisted = _make_shortlisted(client, key="B1", email="b1@example.com")
    pooled_app = client.post("/api/applications", json={
        "jobId": job["jobId"],
        "applicantId": client.post("/api/applicants", json={"email": "b2@example.com", "name": "B2"},
                                   headers=_hr()).json()["applicantId"],
        "initialStage": "TALENT_POOL"}, headers=_hr()).json()
    no_assess_job = client.post("/api/jobs", json=job_payload("B-NA", "No Assess",
                                ensure_user(client, _sa())),
                                headers=_hr()).json()
    no_assess_app = client.post("/api/applications", json={
        "jobId": no_assess_job["jobId"],
        "applicantId": client.post("/api/applicants", json={"email": "b3@example.com", "name": "B3"},
                                   headers=_hr()).json()["applicantId"],
        "initialStage": "SHORTLISTED"}, headers=_hr()).json()
    res = client.post("/api/applications/send-assessments", json={"applicationIds": [
        shortlisted["applicationId"], pooled_app["applicationId"],
        no_assess_app["applicationId"], "no-such-id"]}, headers=_hr())
    assert res.status_code == 200
    by_id = {i["applicationId"]: i for i in res.json()["items"]}
    assert by_id[shortlisted["applicationId"]]["result"] == "accepted"
    assert "SHORTLISTED" in by_id[pooled_app["applicationId"]]["reason"]
    assert "assessment" in by_id[no_assess_app["applicationId"]]["reason"]
    assert by_id["no-such-id"]["result"] == "failed"


# ---- Completion sync ----

async def _send_and_stage(client, mock_db, monkeypatch, email):
    monkeypatch.setattr(settings, "email_dry_run", False)
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", email)
    _, _, app_doc = _make_shortlisted(client, key=f"S-{email.split('@')[0]}", email=email)
    client.post("/api/applications/send-assessments",
                json={"applicationIds": [app_doc["applicationId"]]}, headers=_hr())
    await _drain(mock_db)
    return app_doc["applicationId"]


async def test_sync_moves_to_completed_with_score(client, mock_db, monkeypatch):
    app_id = await _send_and_stage(client, mock_db, monkeypatch, "sync.a@example.com")
    FakeAsyncClient.scenario["status"] = "submitted"
    FakeAsyncClient.scenario["report"] = {
        "report": {
            "overallResult": {"technicalAnalysis": {"overallScore": 82},
                              "communicationAnalysis": {"overallScore": 70}},
            "questionWiseResult": [],
        },
    }
    sweep = client.post("/api/admin/sync-sweep", headers=_hr()).json()
    assert sweep["enqueued"] >= 1
    await _drain(mock_db)
    prof = client.get(f"/api/applications/{app_id}", headers=_hr()).json()
    assert prof["currentStage"] == "ASSESSMENT_COMPLETED"
    stored = await mock_db["applications"].find_one({"applicationId": app_id})
    assert stored["assessment"]["score"] == 82
    assert stored["assessment"]["submittedAt"]


async def test_sync_waits_when_not_submitted(client, mock_db, monkeypatch):
    app_id = await _send_and_stage(client, mock_db, monkeypatch, "sync.b@example.com")
    FakeAsyncClient.scenario["status"] = "pending"
    client.post("/api/admin/sync-sweep", headers=_hr())
    await _drain(mock_db)
    prof = client.get(f"/api/applications/{app_id}", headers=_hr()).json()
    assert prof["currentStage"] == "ASSESSMENT_SENT"


# ---- Outbox crypto / org settings / authz ----

async def test_outbox_body_encrypted_and_lists_hide_it(client, mock_db):
    _, _, app_doc = _make_shortlisted(client, key="E-JOB", email="enc@example.com")
    client.post("/api/applications/send-assessments",
                json={"applicationIds": [app_doc["applicationId"]]}, headers=_hr())
    await _drain(mock_db)
    raw = await mock_db["email_outbox"].find_one({})
    assert raw["payloadEncrypted"] and "upstream.test" not in raw["payloadEncrypted"]
    assert raw["toHash"] and "@" not in raw["toHash"]
    listed = client.get("/api/diagnostics", headers=_sa()).json()
    assert "payloadEncrypted" not in str(listed["failedOutbox"])


async def test_org_settings_gated_and_audited(client, mock_db):
    from app.models.organization import seed_default_org

    assert await seed_default_org(mock_db) is True
    tech = auth_headers(role="technical_interviewer", org_id="default")
    assert client.get("/api/org/settings", headers=tech).status_code == 403
    before = client.get("/api/org/settings", headers=_sa()).json()
    assert before["settings"]["autoSendAssessment"] is not True
    upd = client.put("/api/org/settings", json={"autoSendAssessment": True}, headers=_sa())
    assert upd.status_code == 200
    assert upd.json()["settings"]["autoSendAssessment"] is True
    audits = client.get("/api/audit-log?resource_type=organization", headers=_sa()).json()
    assert any(a["action"] == "org.settings_update" for a in audits)
    # HR cannot change org settings.
    assert client.put("/api/org/settings", json={"autoSendAssessment": False},
                      headers=_hr()).status_code == 403


def test_interviewer_cannot_trigger_or_see_flows(client):
    tech = auth_headers(role="technical_interviewer", org_id="default")
    assert client.post("/api/applications/send-assessments",
                       json={"applicationIds": ["x"]}, headers=tech).status_code == 403
    assert client.get("/api/diagnostics", headers=tech).status_code == 403
    assert client.get("/api/email-mode", headers=tech).status_code == 200


async def test_autosend_default_off_opt_in_sends(client, mock_db, monkeypatch):
    from app.models.organization import seed_default_org
    from tests.test_resumes_api import make_docx_bytes

    assert await seed_default_org(mock_db) is True
    monkeypatch.setattr(settings, "email_dry_run", True)
    client.post("/api/jobs", json={**job_payload("AS-JOB", "Auto", ensure_user(client, _sa())),
                                   "mustHaveSkills": ["Python"],
                                   "assessmentJobId": "UP-AS-1"}, headers=_hr())
    lines = ["Auto Cand", "auto.cand@example.com", "+919444444444",
             "Python dev with 5 years of experience", "Skills: Python, SQL", "B.Tech"]
    ct = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    client.post("/api/resumes/upload", data={"jobKey": "AS-JOB", "consent": "true"},
                files=[("files", ("a.docx", make_docx_bytes(lines), ct))], headers=_hr())
    await _drain(mock_db)
    queued = [d async for d in mock_db["background_jobs"].find({"kind": "assessment_send"})]
    assert queued == []  # default off: no auto send
    client.put("/api/org/settings", json={"autoSendAssessment": True}, headers=_sa())
    client.post("/api/resumes/upload", data={"jobKey": "AS-JOB", "consent": "true"},
                files=[("files", ("b.docx", make_docx_bytes(
                    [l.replace("Auto Cand", "Auto Two").replace("auto.cand", "auto.two")
                     for l in lines]), ct))], headers=_hr())
    await _drain(mock_db)
    queued = [d async for d in mock_db["background_jobs"].find({"kind": "assessment_send"})]
    assert len(queued) == 1


def test_validate_settings_guards():
    from app.config import Settings

    prod_dry = Settings(env="production", mongodb_uri="x", jwt_secret="s" * 40,
                        allowed_origins="https://a.com", outbox_encryption_key="k",
                        zeptomail_api_key="z", email_from_address="a@b.c",
                        email_from_name="N", email_dry_run=True)
    try:
        from app.config import validate_settings
        validate_settings(prod_dry)
    except RuntimeError as exc:
        assert "EMAIL_DRY_RUN" in str(exc)
    else:
        raise AssertionError("production dry-run must fail validation")

    dev_open = Settings(env="local", email_dry_run=False, email_test_recipient_allowlist="")
    try:
        from app.config import validate_settings
        validate_settings(dev_open)
    except RuntimeError as exc:
        assert "ALLOWLIST" in str(exc).upper() or "allowlist" in str(exc)
    else:
        raise AssertionError("dev real-send without allowlist must fail validation")
