"""AI JD Ingestion Phase 1 tests: normal JD PDF/DOCX → secure text extraction.

Additive only: the prescribed-template path is pinned byte-identical by the
`mode`-default regression tests below plus the full `test_jd_template.py`
suite (untouched). Document mode performs NO LLM call and persists nothing.
"""

import io

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app import config as config_module
from app.config import settings
from app.main import app
from app.security.deps import get_db
from app.services import clamav as clamav_module
from app.services.jd_document import (
    JD_DOCUMENT_AI_PENDING_WARNING,
    JD_DOCUMENT_VERSION,
    is_extractable,
    normalize_jd_text,
)
from app.services.resume_parse import ParseTimeout
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def setup_config(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_jd_document_db"]


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


# Synthetic normal-JD prose (deliberately NOT the prescribed template).
JD_PROSE_LINES = [
    "Product Manager - SaaS & AI Products",
    "Elite HR Technologies, Hyderabad",
    "We are hiring a Product Manager with 3+ years of experience, up to 6 years.",
    "You will own the roadmap, write PRDs, and partner with engineering on AI features.",
    "Must-have: Product Strategy, SaaS, Roadmapping, SQL, APIs, Agile/Scrum.",
]


def make_docx_bytes(lines: list[str]) -> bytes:
    from docx import Document

    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def make_pdf_bytes(lines: list[str]) -> bytes:
    """Minimal valid single-page PDF with Helvetica text (synthetic)."""
    content = ["BT /F1 12 Tf 50 750 Td"]
    for i, ln in enumerate(lines):
        esc = ln.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content.append(f"({esc}) Tj")
        if i < len(lines) - 1:
            content.append("0 -15 Td")
    content.append("ET")
    stream = " ".join(content).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
         b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = [b"%PDF-1.4"]
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(sum(len(p) + 1 for p in out))
        out.append(f"{i} 0 obj".encode() + b"\n" + body + b"\nendobj")
    xref_at = sum(len(p) + 1 for p in out)
    out.append(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f ".encode())
    for off in offsets:
        out.append(f"{off:010d} 00000 n ".encode())
    out.append(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF".encode())
    return b"\n".join(out)


def _upload(client, data: bytes, filename: str, headers, mode: str | None = None):
    kwargs: dict = {"files": {"file": (filename, data)}}
    if mode is not None:
        kwargs["data"] = {"mode": mode}
    return client.post("/api/jobs/parse-jd", headers=headers, **kwargs)


# ---- Happy paths ----

def test_document_mode_extracts_docx_prose(client):
    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "pm-jd.docx", _hr(), mode="document")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["templateVersion"] == JD_DOCUMENT_VERSION
    assert body["kind"] == "docx"
    assert "Product Manager - SaaS" in body["text"]
    assert "Elite HR Technologies" in body["text"]
    assert body["mapped"] == {}
    assert JD_DOCUMENT_AI_PENDING_WARNING in body["warnings"]


def test_document_mode_extracts_pdf(client):
    res = _upload(client, make_pdf_bytes(JD_PROSE_LINES), "pm-jd.pdf", _hr(), mode="document")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["templateVersion"] == JD_DOCUMENT_VERSION
    assert body["kind"] == "pdf"
    assert "Product Manager" in body["text"]
    assert body["mapped"] == {}


def test_document_mode_ignores_template_labels(client):
    """A prescribed template file sent as document is treated as plain text."""
    from tests.test_jd_template import JD_TEXT, make_docx

    res = _upload(client, make_docx(["Company Name: Acme Pvt Ltd", "Job Title: Dev"]),
                  "tpl.docx", _hr(), mode="document")
    assert res.status_code == 200, res.text
    assert res.json()["templateVersion"] == JD_DOCUMENT_VERSION
    assert res.json()["mapped"] == {}
    _ = JD_TEXT


# ---- Template path pinned byte-identical ----

def test_template_default_without_mode_unchanged(client):
    """Existing callers (file only) still hit the deterministic template path."""
    from tests.test_jd_template import JD_TEXT, make_docx
    from tests.conftest import ensure_user

    assignee = ensure_user(client, _sa(), "doc-pin@test.com")
    res = _upload(client, make_docx(JD_TEXT.format(assignee="doc-pin@test.com").splitlines()),
                  "jd.docx", _hr())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["templateVersion"] == "v1"
    assert body["mapped"]["companyName"] == "Acme Pvt Ltd"
    assert body["mapped"]["assigneeUserId"] == assignee


def test_template_explicit_mode_unchanged(client):
    from tests.test_jd_template import INVALID_TEMPLATE_MESSAGE

    res = _upload(client, make_docx_bytes(["Just some prose"]),
                  "notes.docx", _hr(), mode="template")
    assert res.status_code == 422
    assert res.json()["detail"]["message"] == INVALID_TEMPLATE_MESSAGE
    _ = INVALID_TEMPLATE_MESSAGE


def test_template_rejects_normal_prose_as_before(client):
    """Normal prose without mode still 422s — the behavior Phase 1 preserves."""
    from tests.test_jd_template import INVALID_TEMPLATE_MESSAGE

    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "pm-jd.docx", _hr())
    assert res.status_code == 422
    assert res.json()["detail"]["message"] == INVALID_TEMPLATE_MESSAGE


# ---- Request shape ----

def test_document_missing_file_is_422(client):
    res = client.post("/api/jobs/parse-jd", data={"mode": "document"}, headers=_hr())
    assert res.status_code == 422


def test_invalid_mode_is_422(client):
    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "pm-jd.docx", _hr(), mode="ai-magic")
    assert res.status_code == 422
    assert res.json()["detail"]["errors"][0]["field"] == "mode"


def test_document_forbidden_for_interviewer(client):
    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "pm-jd.docx", _iv(), mode="document")
    assert res.status_code == 403


# ---- Security / failure modes (same chain as template) ----

def test_document_rejects_wrong_extension(client):
    res = _upload(client, b"plain text, not a document", "jd.txt", _hr(), mode="document")
    assert res.status_code == 400


def test_document_rejects_spoofed_bytes(client):
    res = _upload(client, b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "jd.docx", _hr(), mode="document")
    assert res.status_code == 400


def test_document_rejects_traversal_filename(client):
    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "../evil.docx", _hr(), mode="document")
    assert res.status_code == 400


def test_document_rejects_empty_file(client):
    res = _upload(client, b"", "empty.pdf", _hr(), mode="document")
    assert res.status_code == 400


def test_document_unextractable_pdf_is_422(client):
    corrupt = b"%PDF-1.4\n%garbage that is not a real pdf body"
    res = _upload(client, corrupt, "broken.pdf", _hr(), mode="document")
    assert res.status_code == 422
    assert "extract" in res.text.lower() or "readable" in res.text.lower()


def test_document_oversized_is_400(client, monkeypatch):
    monkeypatch.setattr(config_module.settings, "upload_max_mb", 0)
    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "big.docx", _hr(), mode="document")
    assert res.status_code == 400
    assert "exceeds" in res.json()["detail"].lower()


def test_document_quarantined_is_422(client, monkeypatch):
    monkeypatch.setattr(
        clamav_module, "scan_bytes",
        lambda data, filename="": clamav_module.QUARANTINED,
    )
    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "pm-jd.docx", _hr(), mode="document")
    assert res.status_code == 422
    assert "security scan" in res.json()["detail"].lower()


def test_document_timeout_is_422(client, monkeypatch):
    import app.api.hiring as hiring_api

    def _boom(_data, _kind, timeout=30):
        raise ParseTimeout("Parsing exceeded 30s and was killed.")

    monkeypatch.setattr(hiring_api, "parse_bytes_isolated", _boom)
    res = _upload(client, make_docx_bytes(JD_PROSE_LINES), "pm-jd.docx", _hr(), mode="document")
    assert res.status_code == 422
    assert "extract" in res.json()["detail"].lower()


# ---- Normalizer units ----

def test_normalize_jd_text_unit():
    assert normalize_jd_text("a\r\nb\rc  ") == "a\nb\nc"
    assert normalize_jd_text("\n\nHello\n\n\n\nWorld\n\n") == "Hello\n\n\nWorld"
    assert is_extractable("  \n  ") is False
    assert is_extractable("Product Manager") is True
    long_text = "x" * (20000 + 500)
    assert len(normalize_jd_text(long_text)) == 20000
