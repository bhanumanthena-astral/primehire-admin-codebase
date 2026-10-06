"""AI JD Ingestion Phase 3 tests: jd-extract-v1 → JobCreate-truth validation.

Service tests call `validate_jd_extraction` directly; endpoint tests upload a
DOCX in document mode with a faked OpenRouter. Nothing here may persist a Job
or create a user — asserted explicitly.
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
from app.services.jd_validate import validate_jd_extraction
from app.services.llm import jd_extract as jdx
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")

    async def _fast(_delay, *a, **k):
        return None

    monkeypatch.setattr(asyncio, "sleep", _fast)


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_jd_validate_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _hr(org="default"):
    return auth_headers(role="hr", org_id=org)


def _sa(org="default"):
    return auth_headers(role="super_admin", org_id=org)


LONG_JD = (
    "Own the roadmap for SaaS and AI products. Lead discovery, write PRDs, "
    "partner with engineering and design, run experiments, and launch features "
    "that customers love. Requires strong analytical and communication skills."
)

FULL = {
    "companyName": "Elite HR Technologies",
    "jobRole": "Product Management",
    "jobTitle": "Product Manager - SaaS & AI Products",
    "minExperience": 3.0,
    "maxExperience": 6.0,
    "positionsTotal": 2,
    "keywords": ["Product Management", "SaaS", "AI"],
    "department": "Product",
    "openedAt": "2026-10-01",
    "closesAt": "2027-12-31",
    "assigneeText": None,
    "workMode": "Hybrid",
    "location": "Hyderabad, Telangana, India",
    "jobDescription": LONG_JD,
    "missingFields": [],
    "warnings": [],
    "evidence": {"jobTitle": "Product Manager - SaaS"},
    "injection_suspected": False,
}


async def _add_user(mock_db, email, name, org="default", active=True):
    doc = {
        "userId": uuid.uuid4().hex,
        "orgId": org,
        "email": email.strip().lower(),
        "name": name,
        "role": "hr",
        "isActive": active,
        "createdAt": datetime.now(timezone.utc),
    }
    await mock_db["users"].insert_one(doc)
    return doc


async def _counts(mock_db):
    jobs = await mock_db["jobs"].count_documents({})
    users = await mock_db["users"].count_documents({})
    return jobs, users


def _docx(lines):
    from docx import Document

    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


class _FakeResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = {}

    def json(self):
        return self._payload


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


def _ok(payload):
    return _FakeResp(200, {
        "choices": [{"message": {"content": json.dumps(payload)}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    })


def _configured(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    monkeypatch.setattr(settings, "openrouter_model", "test-model")


# ---- Valid + missing ----

async def test_review_valid_full_extraction(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    payload = {**FULL, "assigneeText": "owner@test.com"}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert review.missingFields == [] and review.fieldErrors == []
    assert review.values["companyName"] == "Elite HR Technologies"
    assert review.values["title"] == "Product Manager - SaaS & AI Products"
    assert review.values["minExperienceYears"] == 3.0
    assert review.values["positionsTotal"] == 2
    assert review.values["workMode"] == "HYBRID"
    assert review.resolvedAssignee["email"] == "owner@test.com"
    assert review.values["assigneeUserId"] == review.resolvedAssignee["userId"]
    assert review.evidence["jobTitle"].startswith("Product Manager")


async def test_review_missing_required_stays_missing(mock_db):
    review = await validate_jd_extraction(
        {"jobTitle": "Dev", "jobDescription": LONG_JD}, mock_db, "default")
    for f in ("companyName", "jobRole", "department", "minExperienceYears",
              "maxExperienceYears", "positionsTotal", "closesAt",
              "assigneeUserId"):
        assert f in review.missingFields, f
    assert review.values.get("title") == "Dev"
    assert "companyName" not in review.values  # nothing invented


async def test_review_optional_missing_is_fine(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    payload = {**FULL, "assigneeText": "owner@test.com",
               "location": None, "workMode": None, "openedAt": None}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert review.missingFields == [] and review.fieldErrors == []
    assert "location" not in review.values and "workMode" not in review.values


# ---- Experience / positions / keywords / JD ----

async def test_review_decimal_experience(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    payload = {**FULL, "assigneeText": "owner@test.com",
               "minExperience": 2.5, "maxExperience": 4.5}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert review.fieldErrors == []
    assert review.values["minExperienceYears"] == 2.5


async def test_review_invalid_range(mock_db):
    # NOTE: range/cap/length rules live in a mode="after" validator, which
    # pydantic only runs when all fields are present — hence a resolvable
    # assignee, mirroring a complete extraction.
    await _add_user(mock_db, "owner@test.com", "Owner One")
    payload = {**FULL, "assigneeText": "owner@test.com",
               "minExperience": 5.0, "maxExperience": 2.0}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert any(e["field"] == "maxExperienceYears" for e in review.fieldErrors)


async def test_review_negative_experience_rejected(mock_db):
    payload = {**FULL, "minExperience": -1.0}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert any(e["field"] == "minExperienceYears" for e in review.fieldErrors)


async def test_review_three_plus_years_no_max_invented(mock_db):
    payload = {**FULL, "minExperience": 3.0, "maxExperience": None,
               "missingFields": ["maxExperienceYears"]}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert review.values["minExperienceYears"] == 3.0
    assert "maxExperienceYears" in review.missingFields
    assert "maxExperienceYears" not in review.values


async def test_review_invalid_positions(mock_db):
    review = await validate_jd_extraction({**FULL, "positionsTotal": 0}, mock_db, "default")
    assert any(e["field"] == "positionsTotal" for e in review.fieldErrors)


async def test_review_duplicate_keywords_normalized(mock_db):
    payload = {**FULL, "keywords": ["Python", " SQL ", "python", ""]}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert review.values["keywords"] == ["Python", "SQL"]


async def test_review_keyword_cap_enforced(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    payload = {**FULL, "assigneeText": "owner@test.com",
               "keywords": [f"skill{i}" for i in range(25)]}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert any(e["field"] == "keywords" for e in review.fieldErrors)


async def test_review_jd_too_short(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "owner@test.com", "jobDescription": "Hire dev."},
        mock_db, "default")
    assert any(e["field"] == "jdHtml" for e in review.fieldErrors)


async def test_review_jd_too_long(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "owner@test.com", "jobDescription": "x" * 20001},
        mock_db, "default")
    assert any(e["field"] == "jdHtml" for e in review.fieldErrors)


# ---- Dates ----

async def test_review_valid_dates(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    payload = {**FULL, "assigneeText": "owner@test.com"}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert review.fieldErrors == []
    assert review.values["closesAt"].startswith("2027-12-31")


async def test_review_ambiguous_date_needs_review(mock_db):
    review = await validate_jd_extraction({**FULL, "closesAt": "soon"}, mock_db, "default")
    assert any(n["field"] == "closesAt" for n in review.needsReview)
    assert "closesAt" in review.missingFields


async def test_review_impossible_date_needs_review(mock_db):
    review = await validate_jd_extraction({**FULL, "closesAt": "2026-13-45"},
                                          mock_db, "default")
    assert any(n["field"] == "closesAt" for n in review.needsReview)


async def test_review_closes_before_opened_is_error(mock_db):
    await _add_user(mock_db, "owner@test.com", "Owner One")
    payload = {**FULL, "assigneeText": "owner@test.com",
               "openedAt": "2027-06-01", "closesAt": "2027-01-01"}
    review = await validate_jd_extraction(payload, mock_db, "default")
    assert any(e["field"] == "closesAt" for e in review.fieldErrors)


# ---- Assignee resolution (server authoritative) ----

async def test_assignee_exact_email_match(mock_db):
    user = await _add_user(mock_db, "Priya.ShARMA@test.com", "Priya Sharma")
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "priya.sharma@test.com"}, mock_db, "default")
    assert review.resolvedAssignee["userId"] == user["userId"]
    assert review.resolvedAssignee["email"] == "priya.sharma@test.com"  # record, not LLM
    assert "assigneeUserId" not in review.missingFields


async def test_assignee_name_match(mock_db):
    user = await _add_user(mock_db, "priya@test.com", "Priya Sharma")
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "  priya   sharma "}, mock_db, "default")
    assert review.resolvedAssignee["userId"] == user["userId"]
    assert review.resolvedAssignee["email"] == "priya@test.com"


async def test_assignee_no_match_unresolved(mock_db):
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "Ghost Nobody"}, mock_db, "default")
    assert review.resolvedAssignee is None
    assert "assigneeUserId" not in review.missingFields  # named but unresolved → review
    assert any(n["field"] == "assigneeUserId" for n in review.needsReview)


async def test_assignee_two_same_names_ambiguous(mock_db):
    await _add_user(mock_db, "priya-a@test.com", "Priya Sharma")
    await _add_user(mock_db, "priya-b@test.com", "Priya Sharma")
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "Priya Sharma"}, mock_db, "default")
    assert review.resolvedAssignee is None
    entry = next(n for n in review.needsReview if n["field"] == "assigneeUserId")
    assert "2 users" in entry["reason"]


async def test_assignee_inactive_not_assigned(mock_db):
    before = await mock_db["users"].count_documents({})
    await _add_user(mock_db, "old@test.com", "Old Colleague", active=False)
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "old@test.com"}, mock_db, "default")
    assert review.resolvedAssignee is None
    assert any(n["field"] == "assigneeUserId" for n in review.needsReview)
    assert await mock_db["users"].count_documents({}) == before + 1  # no auto-create


async def test_assignee_email_recovered_from_original_text(mock_db):
    # Scrubbed pre-LLM: name survived, email only in server-side text.
    user = await _add_user(mock_db, "priya.hr@test.com", "Unrelated Name")
    original = "Assignee: Priya Sharma\nReach priya.hr@test.com for details."
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "Priya Sharma"}, mock_db, "default",
        original_text=original)
    assert review.resolvedAssignee["userId"] == user["userId"]


async def test_contacts_not_mistaken_for_assignee(mock_db):
    await _add_user(mock_db, "contact@test.com", "Contact Person")
    original = "Apply at contact@test.com."
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": None}, mock_db, "default", original_text=original)
    assert review.resolvedAssignee is None
    assert "assigneeUserId" in review.missingFields


async def test_assignee_org_isolation(mock_db):
    await _add_user(mock_db, "other@test.com", "Other Org", org="orgB")
    review = await validate_jd_extraction(
        {**FULL, "assigneeText": "other@test.com"}, mock_db, "default")
    assert review.resolvedAssignee is None
    assert any(n["field"] == "assigneeUserId" for n in review.needsReview)


# ---- Robustness / fallback ----

async def test_injection_suspected_flagged(mock_db):
    review = await validate_jd_extraction(
        FULL, mock_db, "default", injection_suspected=True)
    assert any(n["field"] == "document" for n in review.needsReview)
    assert any("injection" in w.lower() for w in review.warnings)
    assert review.values.get("companyName") == "Elite HR Technologies"  # still inspectable


async def test_malformed_dict_is_review_state(mock_db):
    review = await validate_jd_extraction(
        {"companyName": 123, "bogus": True}, mock_db, "default")
    assert any(e["field"] == "aiExtract" for e in review.fieldErrors)
    assert "companyName" in review.missingFields


# ---- Endpoint wiring ----

async def test_endpoint_review_present_on_success(client, mock_db, monkeypatch):
    _configured(monkeypatch)
    calls: list = []
    _install_fake(monkeypatch, [_ok({**FULL, "assigneeText": "owner@test.com"})], calls)
    await mock_db["users"].insert_one({
        "userId": uuid.uuid4().hex, "orgId": "default",
        "email": "owner@test.com", "name": "Owner One",
        "role": "hr", "isActive": True,
        "createdAt": datetime.now(timezone.utc),
    })
    res = client.post("/api/jobs/parse-jd",
                      files={"file": ("pm.docx", _docx(["Product Manager role", LONG_JD]))},
                      data={"mode": "document"}, headers=_hr())
    assert res.status_code == 200, res.text
    body = res.json()
    review = body["review"]
    assert review["values"]["companyName"] == "Elite HR Technologies"
    assert review["resolvedAssignee"]["email"] == "owner@test.com"
    assert review["missingFields"] == []
    assert review["fieldErrors"] == []
    assert body["aiExtract"]["companyName"] == "Elite HR Technologies"


def test_endpoint_review_none_without_llm(client, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "openrouter_model", "")
    calls: list = []
    _install_fake(monkeypatch, [_ok(FULL)], calls)
    res = client.post("/api/jobs/parse-jd",
                      files={"file": ("pm.docx", _docx(["Product Manager role"]))},
                      data={"mode": "document"}, headers=_hr())
    assert res.status_code == 200, res.text
    assert res.json()["review"] is None and res.json()["aiExtract"] is None


async def test_endpoint_no_persistence_or_user_creation(client, mock_db, monkeypatch):
    _configured(monkeypatch)
    calls: list = []
    _install_fake(monkeypatch, [_ok(FULL)], calls)
    jobs0, users0 = await _counts(mock_db)
    for i in range(2):
        res = client.post("/api/jobs/parse-jd",
                          files={"file": (f"pm{i}.docx", _docx(["Product Manager role"]))},
                          data={"mode": "document"}, headers=_hr())
        assert res.status_code == 200, res.text
    assert await _counts(mock_db) == (jobs0, users0)


def test_endpoint_unauthorized(client):
    res = client.post("/api/jobs/parse-jd",
                      files={"file": ("pm.docx", _docx(["x"]))},
                      data={"mode": "document"})
    assert res.status_code == 401
    iv = auth_headers(role="technical_interviewer", org_id="default")
    res = client.post("/api/jobs/parse-jd",
                      files={"file": ("pm.docx", _docx(["x"]))},
                      data={"mode": "document"}, headers=iv)
    assert res.status_code == 403


async def test_endpoint_pm_jd_end_to_end(client, mock_db, monkeypatch):
    _configured(monkeypatch)
    calls: list = []

    pm = {**FULL, "assigneeText": "pm-owner@test.com",
          "missingFields": ["openedAt"],
          "keywords": ["Product Management", "Product Strategy", "SaaS", "AI",
                       "Generative AI", "Roadmap", "User Research",
                       "Product Analytics", "Agile", "Scrum", "PRD", "JIRA",
                       "SQL", "APIs", "UX", "Stakeholder Management"]}
    _install_fake(monkeypatch, [_ok(pm)], calls)
    await mock_db["users"].insert_one({
        "userId": uuid.uuid4().hex, "orgId": "default",
        "email": "pm-owner@test.com", "name": "PM Owner",
        "role": "hr", "isActive": True,
        "createdAt": datetime.now(timezone.utc),
    })
    res = client.post("/api/jobs/parse-jd",
                      files={"file": ("pm.pdf.docx", _docx(
                          ["Product Manager - SaaS & AI Products", LONG_JD]))},
                      data={"mode": "document"}, headers=_hr())
    assert res.status_code == 200, res.text
    review = res.json()["review"]
    assert review["values"]["jobRole"] == "Product Management"
    assert review["values"]["minExperienceYears"] == 3.0
    assert review["values"]["maxExperienceYears"] == 6.0
    assert review["values"]["positionsTotal"] == 2
    assert "Stakeholder Management" in review["values"]["keywords"]
    assert review["resolvedAssignee"]["email"] == "pm-owner@test.com"
    assert "openedAt" not in review["missingFields"]  # optional
