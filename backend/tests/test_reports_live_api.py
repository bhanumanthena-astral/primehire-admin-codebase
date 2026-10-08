"""GET /api/reports/jobs/{jobId}/candidates/{candidateId}: secure live proxy contract.

The browser sends ONLY Job ID + Candidate ID. The server resolves the
interviewId from Mongo, injects PrimeHire keys server-side, and relays the
upstream report. Upstream calls are mocked — no network, no real keys.
"""

import asyncio

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

import app.api.reports as reports_api
from app.main import app
from app.services.primehire_client import PrimehireError

UPSTREAM = {
    "status": "SUCCESS",
    "message": "Report fetched",
    "data": {"overall_result": {"technical_analysis": {"overall_score": 82}}},
}


def _seed_candidate(db, **overrides):
    doc = {
        "candidateKey": "CAND-1",
        "assessmentId": "JOB-1",
        "name": "Test Candidate",
        "email": "t@example.com",
        "primehire": {"interviewId": "abc123hex"},
        "deletedAt": None,
    }
    doc.update(overrides)
    asyncio.get_event_loop().run_until_complete(db["candidates"].insert_one(doc))


def _get(db, job="JOB-1", cand="CAND-1"):
    app.dependency_overrides[reports_api._db] = lambda: db
    try:
        return TestClient(app).get(f"/api/reports/jobs/{job}/candidates/{cand}")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)


def _ok_fetch_factory(seen):
    async def _ok(interview_id):
        seen.append(interview_id)
        return dict(UPSTREAM)

    return _ok


def test_live_report_200_uses_resolved_interview_id(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db)
    seen: list = []
    monkeypatch.setattr(reports_api, "fetch_interview_report", _ok_fetch_factory(seen))
    #Creds present in this dev env via backend/.env; ensure the property path works.
    res = _get(db)
    assert res.status_code == 200  # Test 1: valid job + candidate + authorized -> report
    assert res.json() == UPSTREAM  # relayed verbatim for the existing UI
    assert seen == ["abc123hex"]  # upstream keyed by server-resolved id only
    for secret in ("x-access-key", "x-secret-key", "PRIMEHIRE", "mongodb://", "password"):
        assert secret not in res.text


def test_cross_job_access_forbidden(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db)  # belongs to JOB-1
    seen: list = []
    monkeypatch.setattr(reports_api, "fetch_interview_report", _ok_fetch_factory(seen))
    res = _get(db, job="JOB-OTHER")
    assert res.status_code == 403  # Test 8: another job/org report rejected
    assert res.json()["detail"]["code"] == "FORBIDDEN"
    assert seen == []  # upstream never contacted


def test_missing_candidate_404(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    seen: list = []
    monkeypatch.setattr(reports_api, "fetch_interview_report", _ok_fetch_factory(seen))
    res = _get(db, cand="CAND-NOPE")
    assert res.status_code == 404  # Test 6: invalid candidate id
    assert res.json()["detail"]["code"] == "CANDIDATE_NOT_FOUND"
    assert seen == []


def test_missing_interview_id_404(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db, primehire={})
    seen: list = []
    monkeypatch.setattr(reports_api, "fetch_interview_report", _ok_fetch_factory(seen))
    res = _get(db)
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "REPORT_NOT_READY"
    assert seen == []


def test_mock_interview_id_400(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db, primehire={"interviewId": "int-mock-1"})
    seen: list = []
    monkeypatch.setattr(reports_api, "fetch_interview_report", _ok_fetch_factory(seen))
    res = _get(db)
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "MOCK_ID"
    assert seen == []


def test_malformed_ids_400(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db)
    seen: list = []
    monkeypatch.setattr(reports_api, "fetch_interview_report", _ok_fetch_factory(seen))
    # URL-encoded traversal / empty segments must not reach Mongo or upstream.
    res = _get(db, job="..%2F..", cand="CAND-1")
    assert res.status_code in (400, 404)  # Test 5: invalid job id rejected
    assert seen == []


def test_missing_backend_config_500_without_secret(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db)
    monkeypatch.setattr("app.config.settings.primehire_access_key", "")
    monkeypatch.setattr("app.config.settings.primehire_secret_key", "")

    async def _boom(_iid):
        raise AssertionError("upstream must not be contacted without creds")

    monkeypatch.setattr(reports_api, "fetch_interview_report", _boom)
    res = _get(db)
    assert res.status_code == 500  # Test 4: missing backend key -> controlled error
    body = res.json()["detail"]
    assert body["code"] == "CONFIGURATION_ERROR"
    assert "PRIMEHIRE_ACCESS_KEY" in body["message"]  # actionable, no value
    for secret in ("x-access-key", "x-secret-key", "U7D1", "ZFF26"):
        assert secret not in res.text


def test_upstream_401_maps_to_502_sanitized(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db)

    async def _denied(_iid):
        raise PrimehireError("rejected", status=401)

    monkeypatch.setattr(reports_api, "fetch_interview_report", _denied)
    res = _get(db)
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "UPSTREAM_AUTH_FAILED"
    assert "x-access-key" not in res.text and "x-secret-key" not in res.text


def test_upstream_timeout_504(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db)

    async def _slow(_iid):
        raise PrimehireError("timed out", status=504)

    monkeypatch.setattr(reports_api, "fetch_interview_report", _slow)
    res = _get(db)
    assert res.status_code == 504  # Test 9: upstream down -> proper error
    assert res.json()["detail"]["code"] == "UPSTREAM_TIMEOUT"


def test_upstream_unreachable_502(monkeypatch):
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed_candidate(db)

    async def _down(_iid):
        raise PrimehireError("unreachable", status=502)

    monkeypatch.setattr(reports_api, "fetch_interview_report", _down)
    res = _get(db)
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "UPSTREAM_ERROR"


def _client_with_response(monkeypatch, response):
    """Swap httpx.AsyncClient for a fake returning a REAL httpx.Response.

    Regression guard: the success path must work against the genuine
    httpx API (which has `.is_success`, not requests-style `.ok`).
    """
    import httpx

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return response

        async def post(self, *a, **k):
            return response

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)


def test_fetch_report_success_with_real_httpx_response(monkeypatch):
    """The production 500: `response.ok` does not exist on httpx.Response."""
    import httpx

    from app.services import primehire_client as remote

    monkeypatch.setattr("app.config.settings.primehire_access_key", "AK")
    monkeypatch.setattr("app.config.settings.primehire_secret_key", "SK")
    _client_with_response(
        monkeypatch,
        httpx.Response(200, json={"status": "SUCCESS", "data": {"ok": True}}),
    )
    out = asyncio.get_event_loop().run_until_complete(
        remote.fetch_interview_report("abc123")
    )
    assert out == {"status": "SUCCESS", "data": {"ok": True}}


def test_check_upstream_success_with_real_httpx_response(monkeypatch):
    import httpx

    from app.services import primehire_client as remote

    monkeypatch.setattr("app.config.settings.primehire_access_key", "AK")
    monkeypatch.setattr("app.config.settings.primehire_secret_key", "SK")
    _client_with_response(monkeypatch, httpx.Response(200, json={"x": 1}))
    assert (
        asyncio.get_event_loop().run_until_complete(remote.check_upstream())
        == 200
    )


def test_create_assessment_success_with_real_httpx_response(monkeypatch):
    import httpx

    from app.services import primehire_client as remote

    monkeypatch.setattr("app.config.settings.primehire_access_key", "AK")
    monkeypatch.setattr("app.config.settings.primehire_secret_key", "SK")
    _client_with_response(monkeypatch, httpx.Response(200, json={"job_id": "J1"}))
    out = asyncio.get_event_loop().run_until_complete(
        remote.create_assessment_remote({"job_id": "J1"})
    )
    assert out == {"job_id": "J1"}


def test_fetch_report_non_json_200_is_controlled_502(monkeypatch):
    import httpx

    from app.services import primehire_client as remote

    monkeypatch.setattr("app.config.settings.primehire_access_key", "AK")
    monkeypatch.setattr("app.config.settings.primehire_secret_key", "SK")
    _client_with_response(monkeypatch, httpx.Response(200, content=b"not-json"))
    try:
        asyncio.get_event_loop().run_until_complete(
            remote.fetch_interview_report("abc123")
        )
        raise AssertionError("expected PrimehireError")
    except PrimehireError as exc:
        assert exc.status == 502


def test_fetch_interview_report_timeout_mapping(monkeypatch):
    """Unit: httpx timeouts become PrimehireError(504); keys never in message."""
    import httpx

    from app.services import primehire_client as remote

    monkeypatch.setattr("app.config.settings.primehire_access_key", "AK")
    monkeypatch.setattr("app.config.settings.primehire_secret_key", "SK")

    class _TimeoutClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            raise httpx.ConnectTimeout("slow")

    monkeypatch.setattr(httpx, "AsyncClient", _TimeoutClient)
    with pytest.raises(PrimehireError) as exc:
        asyncio.get_event_loop().run_until_complete(remote.fetch_interview_report("abc123"))
    assert exc.value.status == 504
    assert "AK" not in str(exc.value) and "SK" not in str(exc.value)
