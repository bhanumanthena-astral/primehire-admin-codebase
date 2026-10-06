"""LLM resilience Tier 1 (L1) tests: dispatch hardening for the worker path.

Fake-provider drills run through settings (no network); httpx-level fakes
cover adapter branches. sleeps are patched fast. Every batch is drained to
a final state: no loss, no duplicates, honest flags throughout.
"""

import asyncio
import io
import json
import logging
import random
from datetime import datetime, timedelta, timezone

import httpx
import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings, validate_settings
from app.main import app
from app.security.deps import get_db
from app.services.llm import resilience as res
from app.services.llm.resilience import (
    bucket_take,
    classify_status,
    compute_defer_delay,
    parse_retry_after,
    sanitized_message,
)
from tests.conftest import auth_headers, ensure_user, job_payload
from tests.test_resumes_api import make_docx_bytes, make_pdf_bytes

CT_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
CT_PDF = "application/pdf"


@pytest.fixture(autouse=True)
def setup_config(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "clamav_enabled", False)
    monkeypatch.setattr(settings, "llm_fake_provider", "off")

    async def _fast(_delay, *a, **k):
        return None

    monkeypatch.setattr(asyncio, "sleep", _fast)


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_llm_l1_db"]


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


def _iv():
    return auth_headers(role="technical_interviewer", org_id="default")


def _make_job(client, key="L1-JOB", **overrides):
    uid = ensure_user(client, _sa())
    res = client.post("/api/jobs", json=job_payload(key, "L1 Role", uid, **overrides),
                      headers=_hr())
    assert res.status_code == 201, res.text
    return res.json()


def _upload(client, job_key, files, consent="true"):
    return client.post("/api/resumes/upload",
                       data={"jobKey": job_key, "consent": consent},
                       files=files, headers=_hr())


async def _drain(mock_db, limit=400):
    from app.services.worker import run_once

    ran = 0
    for _ in range(limit):
        if await run_once(mock_db) is None:
            break
        ran += 1
    return ran


async def _force_due(mock_db):
    now = datetime.now(timezone.utc)
    await mock_db["background_jobs"].update_many(
        {"status": {"$in": ["pending", "deferred"]}},
        {"$set": {"runAfter": now}})


async def _drain_all(mock_db, rounds=40):
    """Drain including deferred work: force-due between rounds (fast-forward)."""
    for _ in range(rounds):
        await _drain(mock_db)
        remaining = await mock_db["background_jobs"].count_documents(
            {"status": {"$in": ["pending", "deferred", "running"]}})
        if remaining == 0:
            break
        await _force_due(mock_db)
    return await mock_db["background_jobs"].count_documents(
        {"status": {"$in": ["pending", "deferred", "running"]}})


def _resume_lines(email, skills, extra=""):
    return [
        "Test Candidate",
        email,
        "+919876543210",
        "Senior Software Engineer with 5 years of experience",
        f"Skills: {', '.join(skills)}",
        "B.Tech Computer Science",
        extra,
    ]


# ---- 1. Taxonomy / headers / backoff ----

def test_error_taxonomy_matrix():
    assert classify_status(429) == ("rate_limited", True)
    for s in (502, 503, 504):
        code, retryable = classify_status(s)
        assert retryable is True and code == f"http_{s}"
    for s, code in ((400, "bad_request"), (401, "auth_error"),
                    (402, "payment_required"), (403, "auth_error")):
        assert classify_status(s) == (code, False)
    assert classify_status(404) == ("http_404", False)
    # Sanitized: short, allowlisted, never bodies or secrets.
    for code in ("rate_limited", "auth_error", "payment_required",
                 "bad_schema", "http_500", "timeout", "mystery"):
        msg = sanitized_message(code)
        assert len(msg) < 120 and "sk-" not in msg and "Bearer" not in msg


def test_retry_after_parsing():
    assert parse_retry_after({"Retry-After": "7"}) == 7.0
    assert parse_retry_after({}) == 5.0
    assert parse_retry_after({"Retry-After": "junk"}) == 5.0
    assert parse_retry_after({"Retry-After": "99999"}) == 3600.0
    assert res.rate_limit_remaining({"X-RateLimit-Remaining": "3"}) == 3
    assert res.rate_limit_remaining({}) is None


def test_defer_delay_bounds():
    random.seed(11)
    for _ in range(50):
        run_after = compute_defer_delay(120.0, 1)
        delta = (run_after - datetime.now(timezone.utc)).total_seconds()
        assert 120.0 <= delta <= 150.0  # Retry-After wins + jitter cap
    for _ in range(50):
        run_after = compute_defer_delay(None, 3)
        delta = (run_after - datetime.now(timezone.utc)).total_seconds()
        assert 120.0 <= delta <= 150.0  # 30 * 2^2 = 120 base


# ---- 2. Token bucket ----

async def test_bucket_burst_refill_and_floor(mock_db, monkeypatch):
    monkeypatch.setattr(settings, "llm_rpm", 30)
    monkeypatch.setattr(settings, "llm_burst", 5)
    monkeypatch.setattr(settings, "llm_interactive_reserve", 0.0)
    key = "openrouter:test-model"
    allowed = 0
    for _ in range(7):
        ok, _ = await bucket_take(mock_db, key, kind="bulk")
        allowed += 1 if ok else 0
    assert allowed == 5  # burst exactly, never more
    ok, wait_s = await bucket_take(mock_db, key, kind="bulk")
    assert ok is False and wait_s >= 1.0
    # Refill: pretend two minutes passed at 30 rpm → full again.
    await mock_db["llm_governance"].update_one(
        {"_id": f"bucket:{key}"},
        {"$set": {"lastRefill": datetime.now(timezone.utc) - timedelta(minutes=2)}})
    ok, _ = await bucket_take(mock_db, key, kind="bulk")
    assert ok is True
    # Interactive reserve: with 1 token left, bulk waits but sync passes.
    monkeypatch.setattr(settings, "llm_interactive_reserve", 0.25)
    await mock_db["llm_governance"].update_one(
        {"_id": f"bucket:{key}"},
        {"$set": {"tokens": 1.0, "lastRefill": datetime.now(timezone.utc)}})
    ok_bulk, _ = await bucket_take(mock_db, key, kind="bulk")
    assert ok_bulk is False
    ok_int, _ = await bucket_take(mock_db, key, kind="interactive")
    assert ok_int is True


async def test_bucket_concurrent_rate_never_exceeded(mock_db, monkeypatch):
    monkeypatch.setattr(settings, "llm_rpm", 600)
    monkeypatch.setattr(settings, "llm_burst", 5)
    monkeypatch.setattr(settings, "llm_interactive_reserve", 0.0)
    key = "openrouter:concurrency-test"
    results = await asyncio.gather(*[
        bucket_take(mock_db, key, kind="bulk") for _ in range(10)
    ])
    assert sum(1 for ok, _ in results if ok) == 5


# ---- 3. Circuit breaker ----

async def test_breaker_open_halfopen_close(mock_db, monkeypatch):
    monkeypatch.setattr(settings, "llm_breaker_threshold", 3)
    monkeypatch.setattr(settings, "llm_breaker_cooldown_s", 300)
    key = "openrouter:breaker-test"
    ok, info = await res.breaker_check(mock_db, key)
    assert ok is True and info["state"] == "closed"
    for _ in range(3):
        await res.breaker_record(mock_db, key, success=False, retryable_failure=True)
    ok, info = await res.breaker_check(mock_db, key)
    assert ok is False and info["state"] == "open" and info["retry_after_s"] > 0
    # Non-retryable failures must not trip or extend the breaker.
    await res.breaker_record(mock_db, key, success=False, retryable_failure=False)
    ok, _ = await res.breaker_check(mock_db, key)
    assert ok is False
    # Cooldown passes → exactly one half-open probe.
    await mock_db["llm_governance"].update_one(
        {"_id": f"breaker:{key}"},
        {"$set": {"nextProbeAt": datetime.now(timezone.utc) - timedelta(seconds=1)}})
    ok, info = await res.breaker_check(mock_db, key)
    assert ok is True and info["state"] == "half_open"
    ok, info = await res.breaker_check(mock_db, key)
    assert ok is False and info["state"] == "half_open"  # probe in flight
    await res.breaker_record(mock_db, key, success=True, retryable_failure=False)
    ok, info = await res.breaker_check(mock_db, key)
    assert ok is True and info == {"state": "closed", "failures": 0}


# ---- 4. Defer / claim / restart ----

async def test_defer_claim_and_lease_reclaim(mock_db):
    from app.models.jobs import BackgroundJobRepository

    repo = BackgroundJobRepository(mock_db)
    rec = await repo.enqueue(org_id="default", kind="resume_process",
                             entity_type="resume_file", entity_key="f1")
    run_after = datetime.now(timezone.utc) + timedelta(seconds=60)
    updated = await repo.defer(rec["jobId"], run_after=run_after, error="429 drill")
    assert updated and updated["status"] == "deferred"
    assert updated["llmAttempts"] == 1 and updated["llmDeferredSince"]
    assert await repo.claim_next() is None  # not due yet
    await mock_db["background_jobs"].update_one(
        {"jobId": rec["jobId"]}, {"$set": {"runAfter": datetime.now(timezone.utc)}})
    claimed = await repo.claim_next()
    assert claimed and claimed["jobId"] == rec["jobId"] and claimed["status"] == "running"


async def test_deferred_jobs_survive_worker_restart(client, mock_db, monkeypatch):
    """Kill the worker mid-defer, restart, force-due: completes, no dupes."""
    monkeypatch.setattr(settings, "llm_fake_provider", "down")
    monkeypatch.setattr(settings, "llm_wait_seconds", 0)
    _make_job(client, key="RST-JOB", mustHaveSkills=["Python", "SQL"])
    res = _upload(client, "RST-JOB", [("files", ("a.docx", make_docx_bytes(
        _resume_lines("rst-a@test.com", ["Python", "SQL"])), CT_DOCX))])
    assert res.status_code == 201, res.text
    # First worker pass: fake 503 → deterministic decide + llm_complete follow-up.
    await _drain(mock_db)
    files = await mock_db["resume_files"].find({}).to_list(length=10)
    assert len(files) == 1 and files[0]["llmStatus"] == "pending"
    followups = await mock_db["background_jobs"].find(
        {"kind": "llm_complete"}).to_list(length=10)
    assert len(followups) == 1
    # "Restart": a brand-new drain loop picks up where the old one stopped.
    await _drain_all(mock_db)
    apps = await mock_db["applications"].find({}).to_list(length=10)
    assert len(apps) == 1
    files = await mock_db["resume_files"].find({}).to_list(length=10)
    assert files[0]["llmStatus"] in ("done", "failed")
    left = await mock_db["background_jobs"].count_documents(
        {"status": {"$in": ["pending", "deferred", "running"]}})
    assert left == 0


# ---- 5. Borderline protection (deterministic-only decisions) ----

def _border_job(client):
    return _make_job(
        client, key="BDL-JOB",
        niceToHaveSkills=[
            {"skill": "Python", "weight": 1},
            {"skill": "SQL", "weight": 1},
        ],
        minExperienceYears=2,
        maxExperienceYears=8,
    )


async def test_borderline_holds_parsed_sides_pool_and_shortlist(client, mock_db):
    # LLM unconfigured in tests → deterministic-only decisions.
    _border_job(client)
    # kw = 40 + 7.5 + 5 = 52/53 → borderline (held, not pooled)
    # kw = 40 + 0 + 5 = 45 → pooled; kw = 40 + 15 + 5 = 60 → shortlisted.
    cases = [
        ("cka@test.com", ["Python"], "PARSED", True),
        ("ckb@test.com", ["Go"], "TALENT_POOL", False),
        ("ckc@test.com", ["Python", "SQL"], "SHORTLISTED", False),
    ]
    for email, skills, _stage, _nr in cases:
        res = _upload(client, "BDL-JOB", [("files", (f"{email.split('@')[0]}.docx", make_docx_bytes(
            _resume_lines(email, skills)), CT_DOCX))])
        assert res.status_code == 201, res.text
    await _drain_all(mock_db)
    docs = {}
    async for a in mock_db["applications"].find({}):
        applicant = await mock_db["applicants"].find_one({"applicantId": a["applicantId"]})
        docs[applicant["email"]] = a
    assert set(docs) == {"cka@test.com", "ckb@test.com", "ckc@test.com"}
    assert docs["cka@test.com"]["currentStage"] == "PARSED"
    assert docs["cka@test.com"]["needsReview"] is True
    assert any("borderline" in r for r in docs["cka@test.com"]["reviewReasons"])
    assert docs["cka@test.com"]["scoreBreakdown"]["final"] < 60
    assert docs["ckb@test.com"]["currentStage"] == "TALENT_POOL"
    assert docs["ckc@test.com"]["currentStage"] == "SHORTLISTED"


# ---- 6. Late LLM never restages ----

async def test_late_llm_never_restages(client, mock_db, monkeypatch):
    from app.services import pipeline as pipe

    _border_job(client)
    res = _upload(client, "BDL-JOB", [("files", ("late.docx", make_docx_bytes(
        _resume_lines("late@test.com", [])), CT_DOCX))])
    assert res.status_code == 201, res.text
    await _drain_all(mock_db)
    app_doc = await mock_db["applications"].find_one({})
    assert app_doc["currentStage"] == "TALENT_POOL"
    app_id = app_doc["applicationId"]
    file_doc = await mock_db["resume_files"].find_one({})

    async def fake_high(db, org_id, **kwargs):
        from app.services.llm import LlmOutcome
        return LlmOutcome(llm_score=95, reasons=["late but great"])

    monkeypatch.setattr(pipe, "score_candidate", fake_high)
    out = await pipe.process_llm_followup(
        mock_db, org_id="default", file_id=file_doc["fileId"],
        application_id=app_id, worker_job=None)
    assert out.get("late") is True
    after = await mock_db["applications"].find_one({"applicationId": app_id})
    assert after["currentStage"] == "TALENT_POOL"  # never restaged
    assert after["needsReview"] is True
    assert any("held for review" in r for r in after["reviewReasons"])
    assert after["scoreBreakdown"]["llmStatus"] == "done"


# ---- 7. Cache, skips, canary ----

async def test_cache_hit_makes_no_call(mock_db, monkeypatch):
    import httpx
    from app.services.llm import openrouter as oro

    calls: list = []

    class FakeResp:
        status_code = 200
        headers = {}

        def json(self):
            return {"choices": [{"message": {"content":
                '{"score": 77, "reasons": ["ok"], "injection_suspected": false}'}}],
                    "usage": {}}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            calls.append(1)
            return FakeResp()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "openrouter_api_key", "k")
    monkeypatch.setattr(settings, "openrouter_model", "m")
    kwargs = dict(parsed={"skills": ["Python"]}, raw_text="Python dev",
                  job_reqs={"title": "Dev"}, output_ref="x")
    first = await oro.score_candidate(mock_db, "default", **kwargs)
    second = await oro.score_candidate(mock_db, "default", **kwargs)
    assert first.llm_score == 77 and second.from_cache is True
    assert len(calls) == 1


async def test_blank_resume_skips_llm(client, mock_db, monkeypatch):
    import httpx

    _make_job(client, key="BLK-JOB", mustHaveSkills=["Python"])
    monkeypatch.setattr(httpx, "AsyncClient", None)  # any call explodes
    res = _upload(client, "BLK-JOB", [("files", ("blank.pdf", make_pdf_bytes([]), CT_PDF))])
    assert res.status_code == 201, res.text
    await _drain_all(mock_db)
    files = await mock_db["resume_files"].find({}).to_list(length=5)
    assert len(files) == 1 and files[0]["llmStatus"] == "skipped"


async def test_provider_error_echo_canary_leaves_no_trace(client, mock_db, monkeypatch, caplog):
    import httpx

    canary_name, canary_email = "Canary Zephyr", "canary.zephyr.9@test.com"

    class EchoResp:
        status_code = 500
        headers = {}

        def json(self):  # pragma: no cover — never reached
            raise AssertionError("body must never be read")

    class EchoClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            # Simulate a provider echoing prompt text inside its error page.
            raise httpx.TransportError(
                f"500 from provider for {canary_name} <{canary_email}>")

    _make_job(client, key="CNR-JOB", mustHaveSkills=["Python"])
    monkeypatch.setattr(httpx, "AsyncClient", EchoClient)
    monkeypatch.setattr(settings, "openrouter_api_key", "k")
    monkeypatch.setattr(settings, "openrouter_model", "m")
    monkeypatch.setattr(settings, "llm_wait_seconds", 0)
    with caplog.at_level(logging.WARNING):
        res = _upload(client, "CNR-JOB", [("files", ("c.docx", make_docx_bytes(
            _resume_lines("cnr@test.com", ["Python"])), CT_DOCX))])
        assert res.status_code == 201, res.text
        await _drain_all(mock_db)
    assert "Canary" not in caplog.text and "canary.zephyr" not in caplog.text
    for coll in ("llm_runs", "background_jobs", "resume_files",
                 "applications", "applicants", "audit_log"):
        async for doc in mock_db[coll].find({}):
            blob = json.dumps(doc, default=str)
            assert "Canary" not in blob and "canary.zephyr" not in blob, coll


# ---- 8. Diagnostics card + audited retry ----

async def _seed_llm_state(mock_db):
    from app.services.llm import resilience as res_mod

    now = datetime.now(timezone.utc)
    gov_key = res_mod.governance_key()
    await mock_db["llm_governance"].insert_one({
        "_id": f"breaker:{gov_key}", "kind": "breaker",
        "key": gov_key, "state": "open", "failures": 5,
        "nextProbeAt": now + timedelta(seconds=120), "updatedAt": now,
    })
    await mock_db["llm_governance"].insert_one({
        "_id": f"bucket:{gov_key}", "kind": "bucket", "key": gov_key,
        "tokens": 2.0, "capacity": 5, "rpm": 30,
        "lastRefill": now, "version": 1, "updatedAt": now,
    })
    await mock_db["background_jobs"].insert_one({
        "jobId": "dead-llm-1", "orgId": "default", "kind": "llm_complete",
        "entityType": "resume_file", "entityKey": "f1", "payload": {},
        "status": "dead", "attempts": 12, "maxAttempts": 12,
        "runAfter": now, "leaseUntil": None, "dedupeKey": "d1",
        "lastError": "LLM timed out", "result": None,
        "createdAt": now - timedelta(minutes=9), "updatedAt": now,
    })
    await mock_db["background_jobs"].insert_one({
        "jobId": "deferred-1", "orgId": "default", "kind": "resume_process",
        "entityType": "resume_file", "entityKey": "f2", "payload": {},
        "status": "deferred", "attempts": 1, "maxAttempts": 5,
        "runAfter": now + timedelta(seconds=30), "leaseUntil": None,
        "dedupeKey": "d2", "lastError": "429 drill",
        "llmAttempts": 1, "llmDeferredSince": now - timedelta(minutes=5),
        "createdAt": now - timedelta(minutes=5), "updatedAt": now,
    })
    await mock_db["llm_runs"].insert_one({
        "orgId": "default", "promptVersion": "match-score-v1", "model": "m",
        "tokensIn": 1, "tokensOut": 1, "inputHash": "h", "outputRef": "x",
        "decider": "system", "latencyMs": 900, "error": "rate_limited",
        "createdAt": now - timedelta(minutes=30),
    })


async def test_diagnostics_llm_card_and_retry(client, mock_db):
    await _seed_llm_state(mock_db)
    res = client.get("/api/diagnostics", headers=_sa())
    assert res.status_code == 200, res.text
    card = res.json()["llm"]
    assert card["breaker"]["state"] == "open"
    assert card["bucket"]["tokens"] == 2.0
    assert card["queuedJobs"] == 1
    assert card["rateLimitedLastHour"] == 1
    assert card["lastError"]["error"] == "rate_limited"
    assert "deferredJobs" in res.json() and len(res.json()["deferredJobs"]) == 1
    # Retry is permission-gated + audited + capped.
    assert client.post("/api/diagnostics/llm/retry-failed", headers=_iv()).status_code == 403
    retry = client.post("/api/diagnostics/llm/retry-failed", headers=_sa())
    assert retry.status_code == 200, retry.text
    assert retry.json()["retried"] == 1
    job = await mock_db["background_jobs"].find_one({"jobId": "dead-llm-1"})
    assert job["status"] == "pending"
    audits = await mock_db["audit_log"].find({"action": "llm.retry_failed"}).to_list(length=5)
    assert len(audits) == 1 and audits[0]["details"]["retried"] == 1


# ---- 9. Sync JD fast path under breaker / empty bucket ----

def _jd_docx():
    from docx import Document

    doc = Document()
    doc.add_paragraph("Product Manager role with roadmap duties.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


async def test_sync_jd_fails_fast_on_open_breaker(client, mock_db, monkeypatch):
    import httpx

    monkeypatch.setattr(settings, "openrouter_api_key", "k")
    monkeypatch.setattr(settings, "openrouter_model", "m")
    now = datetime.now(timezone.utc)
    await mock_db["llm_governance"].insert_one({
        "_id": f"breaker:{res.governance_key()}", "kind": "breaker",
        "key": res.governance_key(), "state": "open", "failures": 5,
        "nextProbeAt": now + timedelta(seconds=300), "updatedAt": now,
    })
    calls: list = []

    class NoCallClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            calls.append(1)
            raise AssertionError("no LLM call allowed on open breaker")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(httpx, "AsyncClient", NoCallClient)
    resp = client.post("/api/jobs/parse-jd",
                       files={"file": ("pm.docx", _jd_docx())},
                       data={"mode": "document"}, headers=_hr())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["aiExtract"] is None and "Product Manager" in body["text"]
    assert any("breaker" in w.lower() for w in body["warnings"])
    assert calls == []


async def test_sync_jd_fails_fast_on_empty_bucket(client, mock_db, monkeypatch):
    import httpx

    monkeypatch.setattr(settings, "openrouter_api_key", "k")
    monkeypatch.setattr(settings, "openrouter_model", "m")
    now = datetime.now(timezone.utc)
    await mock_db["llm_governance"].insert_one({
        "_id": f"bucket:{res.governance_key()}", "kind": "bucket",
        "key": res.governance_key(), "tokens": 0.0, "capacity": 5,
        "rpm": 30, "lastRefill": now, "version": 1, "updatedAt": now,
    })
    monkeypatch.setattr(httpx, "AsyncClient", None)
    resp = client.post("/api/jobs/parse-jd",
                       files={"file": ("pm.docx", _jd_docx())},
                       data={"mode": "document"}, headers=_hr())
    assert resp.status_code == 200, resp.text
    assert resp.json()["aiExtract"] is None
    assert any("busy" in w.lower() for w in resp.json()["warnings"])


# ---- 10. Config guards ----

def test_validate_settings_refuses_fake_in_production():
    from app.config import Settings

    base = dict(jwt_secret="x" * 40, mongodb_uri="mongodb://x",
                allowed_origins="https://x.example",
                outbox_encryption_key="k", zeptomail_api_key="k",
                email_from_address="a@b.c", email_from_name="n",
                email_dry_run=False, email_test_recipient_allowlist="t@x.example")
    bad = Settings(env="production", llm_fake_provider="mixed", **base)
    try:
        validate_settings(bad)
    except RuntimeError as exc:
        assert "LLM_FAKE_PROVIDER" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("fake provider must fail production validation")
    bad_range = Settings(env="production", llm_rpm=0, **base)
    try:
        validate_settings(bad_range)
    except RuntimeError as exc:
        assert "LLM_RPM" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("out-of-range RPM must fail production validation")


# ---- 11. 100-resume batch with a flaky provider ----

async def test_100_resume_batch_flaky_provider_completes(client, mock_db, monkeypatch, tmp_path):
    random.seed(7)
    monkeypatch.setattr(settings, "llm_fake_provider", "mixed")
    monkeypatch.setattr(settings, "llm_fake_failure_rate", 0.5)
    monkeypatch.setattr(settings, "llm_wait_seconds", 0)
    monkeypatch.setattr(settings, "llm_rpm", 10000)
    monkeypatch.setattr(settings, "llm_burst", 200)
    monkeypatch.setattr(settings, "llm_breaker_threshold", 10000)
    monkeypatch.setattr(settings, "upload_batch_max", 100)
    _make_job(client, key="BIG-JOB", mustHaveSkills=["Python", "SQL"])
    # Distinct applicants: unique emails per file (deterministic_parse reads them).
    tiny = ["Intro line.", "Skills: Python, SQL.", "5 years of experience."]
    batch_files = []
    for i in range(100):
        lines = [f"Batch Candidate {i}", f"batch{i:03d}@test.com",
                 "+919876543210"] + tiny
        batch_files.append(("files", (f"r{i:03d}.pdf", make_pdf_bytes(lines), CT_PDF)))
    res = client.post("/api/resumes/upload",
                      data={"jobKey": "BIG-JOB", "consent": "true"},
                      files=batch_files, headers=_hr())
    assert res.status_code == 201, res.text
    left = await _drain_all(mock_db, rounds=60)
    assert left == 0
    n_apps = await mock_db["applications"].count_documents({})
    assert n_apps == 100
    n_files = await mock_db["resume_files"].count_documents({"status": "parsed"})
    assert n_files == 100
    # Every file reached a final LLM state; statuses are honest flags.
    async for f in mock_db["resume_files"].find({}):
        assert f.get("llmStatus") in ("done", "failed", "skipped"), f.get("llmStatus")
    pair_keys = set()
    async for a in mock_db["applications"].find({}):
        key = (a["jobId"], a["applicantId"])
        assert key not in pair_keys  # no duplicates
        pair_keys.add(key)
    assert len(pair_keys) == 100
