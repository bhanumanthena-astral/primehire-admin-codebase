"""AI JD Ingestion Phase 5 tests: Template + AI Integration.

Pins the end-to-end contract in one place: with valid LLM configuration a
normal JD returns structured `review.values`; without it (or when the
provider fails) the fallback is honest text-only; the template path never
touches the LLM. Runtime messaging must describe the current state — no
phase references, no success claims on failure.
"""

import asyncio
import io
import json
import uuid
from datetime import datetime, timezone

import httpx
import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from app.services.jd_document import JD_DOCUMENT_AI_PENDING_WARNING
from tests.conftest import auth_headers
from tests.test_jd_template import JD_TEXT, make_docx


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")

    async def _fast(_delay, *a, **k):
        return None

    monkeypatch.setattr(asyncio, "sleep", _fast)


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_jd_integration_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _hr():
    return auth_headers(role="hr")


def _sa():
    return auth_headers(role="super_admin")


LONG_JD = (
    "Own the roadmap for SaaS and AI products. Lead discovery, write PRDs, "
    "partner with engineering and design, run experiments, and launch features "
    "that customers love. Requires strong analytical and communication skills."
)

PM_JSON = {
    "companyName": "Elite HR Technologies",
    "jobRole": "Product Management",
    "jobTitle": "Product Manager - SaaS & AI Products",
    "minExperience": 3.0,
    "maxExperience": 6.0,
    "positionsTotal": 2,
    "keywords": ["Product Management", "SaaS", "AI", "Roadmap"],
    "department": "Product",
    "openedAt": None,
    "closesAt": "2027-12-31",
    "assigneeText": "int-owner@test.com",
    "workMode": "Hybrid",
    "location": "Hyderabad, Telangana, India",
    "jobDescription": LONG_JD,
    "missingFields": ["openedAt"],
    "warnings": [],
    "evidence": {"jobTitle": "Product Manager - SaaS & AI Products"},
    "injection_suspected": False,
}


class _FakeResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = {}

    def json(self):
        return self._payload


def _ok(payload):
    return _FakeResp(200, {
        "choices": [{"message": {"content": json.dumps(payload)}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    })


def _install_fake(monkeypatch, script, calls):
    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            calls.append({"url": url, "json": json, "headers": headers})
            nxt = script.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)


def _docx(lines):
    from docx import Document

    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _upload(client, data, filename, headers, mode=None):
    kwargs: dict = {"files": {"file": (filename, data)}}
    if mode is not None:
        kwargs["data"] = {"mode": mode}
    return client.post("/api/jobs/parse-jd", headers=headers, **kwargs)


async def test_doc_configured_returns_structured_review(client, mock_db, monkeypatch):
    """Valid LLM config → PM-shaped doc yields structured review.values."""
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    monkeypatch.setattr(settings, "openrouter_model", "test-model")
    calls: list = []
    _install_fake(monkeypatch, [_ok(PM_JSON)], calls)
    await mock_db["users"].insert_one({
        "userId": uuid.uuid4().hex, "orgId": "default",
        "email": "int-owner@test.com", "name": "Int Owner",
        "role": "hr", "isActive": True,
        "createdAt": datetime.now(timezone.utc),
    })
    res = _upload(client, _docx(["Product Manager role", LONG_JD]),
                  "pm.docx", _hr(), mode="document")
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(calls) == 1  # the LLM was actually invoked
    assert body["aiExtract"]["companyName"] == "Elite HR Technologies"
    values = body["review"]["values"]
    assert values["title"] == "Product Manager - SaaS & AI Products"
    assert values["minExperienceYears"] == 3.0
    assert values["maxExperienceYears"] == 6.0
    assert values["positionsTotal"] == 2
    assert "AI" in values["keywords"] and values["workMode"] == "HYBRID"
    assert values["location"] == "Hyderabad, Telangana, India"
    assert body["review"]["resolvedAssignee"]["email"] == "int-owner@test.com"
    assert body["review"]["missingFields"] == []
    assert body["review"]["fieldErrors"] == []
    runs = [d async for d in mock_db["llm_runs"].find({})]
    assert len(runs) == 1 and runs[0]["promptVersion"] == "jd-extract-v1"


async def test_doc_missing_config_honest_fallback(client, mock_db, monkeypatch):
    """No LLM credentials → text-only fallback, accurate messaging, no calls."""
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "openrouter_model", "")
    calls: list = []
    _install_fake(monkeypatch, [_ok(PM_JSON)], calls)
    res = _upload(client, _docx(["Product Manager role", LONG_JD]),
                  "pm.docx", _hr(), mode="document")
    assert res.status_code == 200, res.text
    body = res.json()
    assert calls == []  # provider never touched
    assert body["aiExtract"] is None and body["review"] is None
    assert "Product Manager" in body["text"]
    assert JD_DOCUMENT_AI_PENDING_WARNING in body["warnings"]
    assert any("not configured" in w.lower() for w in body["warnings"])
    assert "phase" not in " ".join(body["warnings"]).lower()
    runs = [d async for d in mock_db["llm_runs"].find({})]
    assert runs == []


async def test_doc_provider_failure_honest_fallback(client, mock_db, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    monkeypatch.setattr(settings, "openrouter_model", "test-model")
    calls: list = []
    _install_fake(monkeypatch, [_FakeResp(500)] * 3, calls)
    res = _upload(client, _docx(["Product Manager role", LONG_JD]),
                  "pm.docx", _hr(), mode="document")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["aiExtract"] is None and body["review"] is None
    assert "Product Manager" in body["text"]
    assert "phase" not in " ".join(body["warnings"]).lower()


async def test_template_zero_llm_with_config(client, mock_db, monkeypatch):
    """Template uploads stay deterministic even when the LLM is configured."""
    from tests.conftest import ensure_user

    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    monkeypatch.setattr(settings, "openrouter_model", "test-model")
    calls: list = []
    _install_fake(monkeypatch, [_ok(PM_JSON)], calls)
    assignee = ensure_user(client, _sa(), "int-tpl@test.com")
    res = _upload(client, make_docx(JD_TEXT.format(assignee="int-tpl@test.com").splitlines()),
                  "jd.docx", _hr())
    assert res.status_code == 200, res.text
    assert res.json()["templateVersion"] == "v1"
    assert res.json()["mapped"]["assigneeUserId"] == assignee
    assert res.json().get("aiExtract") is None
    assert calls == []
    _ = assignee


def test_fallback_message_has_no_phase_references():
    assert "phase" not in JD_DOCUMENT_AI_PENDING_WARNING.lower()
    assert "not yet enabled" not in JD_DOCUMENT_AI_PENDING_WARNING.lower()
