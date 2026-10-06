"""Tests for the JD template download + parse/map flow (PRD Jobs §9-§11)."""

import io

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from app.services.jd_template import (
    INVALID_TEMPLATE_MESSAGE,
    MISSING_FIELDS_MESSAGE,
    TEMPLATE_LABELS,
    build_template_docx,
    parse_template_text,
)
from tests.conftest import auth_headers, ensure_user


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_jd_template_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _sa():
    return auth_headers(role="super_admin")


def _hr():
    return auth_headers(role="hr")


def _iv():
    return auth_headers(role="technical_interviewer")


def make_docx(lines: list[str]) -> bytes:
    from docx import Document

    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


JD_TEXT = """Company Name: Acme Pvt Ltd
Job Role: Backend Engineer
Job Title: Senior Backend Engineer
Minimum Experience: 2.5
Maximum Experience: 5
Number of Positions: 3
Keywords: Python, SQL, python
Department: Engineering
Opened At: 2026-10-01
Closes At: 2026-12-31
Assignee: {assignee}
Work Mode: Hybrid
Location: Hyderabad
Job Description:
Build and scale backend services for our hiring platform.
Own Python services end to end with strong SQL fundamentals.
"""


def _upload(client, data: bytes, filename: str, headers):
    return client.post("/api/jobs/parse-jd", files={"file": (filename, data)}, headers=headers)


def test_template_download_has_all_labels(client):
    res = client.get("/api/jobs/jd-template", headers=_sa())
    assert res.status_code == 200
    assert res.content[:2] == b"PK"  # docx (zip) magic
    from docx import Document

    doc = Document(io.BytesIO(res.content))
    body = "\n".join(p.text for p in doc.paragraphs)
    for label in TEMPLATE_LABELS:
        assert label in body


def test_template_download_forbidden_for_interviewer(client):
    assert client.get("/api/jobs/jd-template", headers=_iv()).status_code == 403


def test_parse_valid_template_maps_all_fields(client):
    assignee = ensure_user(client, _sa(), "jd-owner@test.com")
    res = _upload(client, make_docx(JD_TEXT.format(assignee="jd-owner@test.com").splitlines()),
                  "jd.docx", _hr())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["templateVersion"] == "v1"
    mapped = body["mapped"]
    assert mapped["companyName"] == "Acme Pvt Ltd"
    assert mapped["title"] == "Senior Backend Engineer"
    assert mapped["minExperienceYears"] == 2.5
    assert mapped["positionsTotal"] == 3
    assert mapped["keywords"] == ["Python", "SQL"]  # deduped + trimmed
    assert mapped["assigneeUserId"] == assignee
    assert mapped["workMode"] == "HYBRID"
    assert mapped["jdTemplateVersion"] == "v1"


def test_parse_prescribed_template_file_itself(client):
    """The downloadable template parses (its placeholders are valid)."""
    assignee = ensure_user(client, _sa(), "tpl-owner@test.com")
    res = client.get("/api/jobs/jd-template", headers=_sa())
    res2 = _upload(client, res.content, "template.docx", _hr())
    # Placeholders use a non-existent assignee email -> field error naming it.
    assert res2.status_code == 422
    assert res2.json()["detail"]["message"] == MISSING_FIELDS_MESSAGE
    fields = [e["field"] for e in res2.json()["detail"]["errors"]]
    assert "assigneeUserId" in fields
    _ = assignee


def test_parse_rejects_non_template_document(client):
    res = _upload(client, make_docx(["Just some prose", "about hiring generally."]),
                  "notes.docx", _hr())
    assert res.status_code == 422
    assert res.json()["detail"]["message"] == INVALID_TEMPLATE_MESSAGE


def test_parse_reports_missing_mandatory_fields(client):
    lines = [
        "Company Name: Acme",
        "Job Role: ",
        "Job Title: Dev",
        "Minimum Experience: 1",
        "Maximum Experience: 3",
        "Number of Positions: 1",
        "Keywords: ",
        "Department: ",
        "Opened At: ",
        "Closes At: ",
        "Assignee: ",
        "Work Mode: ",
        "Location: ",
        "Job Description: ",
    ]
    res = _upload(client, make_docx(lines), "partial.docx", _hr())
    assert res.status_code == 422
    body = res.json()
    assert body["detail"]["message"] == MISSING_FIELDS_MESSAGE
    fields = [e["field"] for e in body["detail"]["errors"]]
    assert "jobRole" in fields and "closesAt" in fields and "assigneeUserId" in fields


def _jd_lines(**changes):
    base = {
        "Company Name": "Acme Pvt Ltd",
        "Job Role": "Backend Engineer",
        "Job Title": "Senior Backend Engineer",
        "Minimum Experience": "2.5",
        "Maximum Experience": "5",
        "Number of Positions": "3",
        "Keywords": "Python, SQL",
        "Department": "Engineering",
        "Opened At": "2026-10-01",
        "Closes At": "2026-12-31",
        "Assignee": "range-owner@test.com",
        "Work Mode": "Hybrid",
        "Location": "Hyderabad",
    }
    base.update(changes)
    lines = [f"{k}: {v}" for k, v in base.items()]
    lines += ["Job Description:",
              "Build and scale backend services for our hiring platform.",
              "Own Python services end to end with strong SQL fundamentals."]
    return lines


def _field_errors(client, lines):
    res = _upload(client, make_docx(lines), "bad.docx", _hr())
    assert res.status_code == 422
    assert res.json()["detail"]["message"] == MISSING_FIELDS_MESSAGE
    return [e["field"] for e in res.json()["detail"]["errors"]]


def test_parse_validates_ranges_positions_dates_assignee(client):
    ensure_user(client, _sa(), "range-owner@test.com")
    assert "maxExperienceYears" in _field_errors(
        client, _jd_lines(**{"Minimum Experience": "5", "Maximum Experience": "1"}))
    assert "positionsTotal" in _field_errors(client, _jd_lines(**{"Number of Positions": "0"}))
    assert "positionsTotal" in _field_errors(client, _jd_lines(**{"Number of Positions": "2.5"}))
    assert "closesAt" in _field_errors(client, _jd_lines(**{"Closes At": "2020-01-01"}))
    assert "assigneeUserId" in _field_errors(client, _jd_lines(**{"Assignee": "ghost@nowhere.com"}))


def test_parse_rejects_wrong_extension_and_spoofed_bytes(client):
    res = _upload(client, b"plain text, not a document", "jd.txt", _hr())
    assert res.status_code == 400
    res = _upload(client, b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "jd.docx", _hr())
    assert res.status_code == 400


def test_parse_forbidden_for_interviewer(client):
    res = _upload(client, make_docx(["Company Name: Acme"]), "jd.docx", _iv())
    assert res.status_code == 403


def test_mapped_output_creates_job(client):
    """Review → Save: the mapped payload passes straight into job creation."""
    assignee = ensure_user(client, _sa(), "save-owner@test.com")
    res = _upload(client, make_docx(JD_TEXT.format(assignee="save-owner@test.com").splitlines()),
                  "jd.docx", _hr())
    assert res.status_code == 200
    mapped = dict(res.json()["mapped"])
    mapped["jobKey"] = "JD-SAVE-1"
    created = client.post("/api/jobs", json=mapped, headers=_hr())
    assert created.status_code == 201, created.text
    assert created.json()["title"] == "Senior Backend Engineer"
    assert created.json()["jdTemplateVersion"] == "v1"
    assert created.json()["assigneeEmail"] == "save-owner@test.com"


def test_parse_template_text_unit():
    values, missing = parse_template_text("Company Name: Acme\nJob Title: Dev\n")
    assert values["Company Name"] == "Acme"
    assert "Job Role" in missing and "Job Description" in missing
    # Multi-line Job Description runs to end of document.
    values, missing = parse_template_text(
        "Company Name: Acme\nJob Description:\nLine one\nLine two\n")
    assert values["Job Description"] == "Line one\nLine two"
    assert missing == [label for label in TEMPLATE_LABELS
                       if label not in ("Company Name", "Job Description")]


def test_build_template_docx_unit():
    data = build_template_docx()
    assert data[:2] == b"PK"

