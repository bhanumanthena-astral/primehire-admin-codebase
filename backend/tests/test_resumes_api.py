"""Slice A tests: upload safety fixtures, isolated parsing, batch flow.

All fixtures are SYNTHETIC (generated in-code). Never commit real resumes
or real personal data (approved adjustment 6).
"""

import hashlib
import io
import zipfile

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def setup_config(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "clamav_enabled", False)


@pytest.fixture()
def mock_db():
    return mongomock_motor.AsyncMongoMockClient()["test_resumes_api_db"]


@pytest.fixture()
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def _hr():
    return auth_headers(role="hr", org_id="default")


def _tech():
    return auth_headers(role="technical_interviewer", org_id="default")


def make_docx_bytes(lines: list[str]) -> bytes:
    import docx

    doc = docx.Document()
    for ln in lines:
        doc.add_paragraph(ln)
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


RESUME_LINES = [
    "Aarav Synthetic",
    "aarav.synthetic@example.com",
    "+919876543210",
    "Senior Software Engineer with 5 years of experience",
    "Skills: Java, Python, React, Spring Boot, SQL, AWS",
    "B.Tech Computer Science",
    "Current CTC 12 LPA, Expected CTC 18 LPA",
    "Notice period 30 days",
]


def _make_job(client, key="JOB-A"):
    res = client.post("/api/jobs", json={"jobKey": key, "title": "Backend Dev",
                                         "mustHaveSkills": ["Python", "SQL"]}, headers=_hr())
    assert res.status_code == 201
    return res.json()


def _upload(client, job_key, file_tuples, consent="true", headers=None):
    return client.post("/api/resumes/upload",
                       data={"jobKey": job_key, "consent": consent},
                       files=file_tuples, headers=headers or _hr())


async def _drain(mock_db, limit=50):
    """Run the worker until the queue is empty (Slice B: parsing is async)."""
    from app.services.worker import run_once

    for _ in range(limit):
        if await run_once(mock_db) is None:
            break


# ---- Consent + auth ----

def test_consent_required(client):
    _make_job(client)
    docx = make_docx_bytes(RESUME_LINES)
    res = _upload(client, "JOB-A", [("files", ("r.docx", docx,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))],
                  consent="false")
    assert res.status_code == 400
    assert "consent" in res.json()["detail"].lower()


def test_unauthenticated_rejected(client):
    res = client.post("/api/resumes/upload", data={"jobKey": "x", "consent": "true"})
    assert res.status_code in (401, 403)


def test_interviewer_cannot_upload(client):
    _make_job(client)
    docx = make_docx_bytes(RESUME_LINES)
    res = _upload(client, "JOB-A", [("files", ("r.docx", docx,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))],
                  headers=_tech())
    assert res.status_code == 403


# ---- Happy path: docx + pdf, worker parses, deterministic score ----

async def test_happy_path_docx_and_pdf(client, mock_db):
    _make_job(client)
    docx = make_docx_bytes(RESUME_LINES)
    pdf = make_pdf_bytes(RESUME_LINES)
    res = _upload(client, "JOB-A", [
        ("files", ("aarav.docx", docx,
                   "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ("files", ("aarav.pdf", pdf, "application/pdf")),
    ])
    assert res.status_code == 201, res.text
    # Upload returns immediately; worker finishes the pipeline.
    assert res.json()["batch"]["status"] == "processing"
    await _drain(mock_db)
    batch_id = res.json()["batch"]["batchId"]
    detail = client.get(f"/api/resumes/batches/{batch_id}", headers=_hr())
    assert detail.status_code == 200
    body = detail.json()
    assert body["batch"]["status"] == "done"
    assert body["batch"]["counts"] == {"total": 2, "parsed": 2, "failed": 0, "quarantined": 0}
    assert body["batch"]["consent"]["given"] is True
    for f in body["files"]:
        assert f["status"] == "parsed"
        assert "storageKey" not in f  # never leak storage internals
        assert f["parsedJson"]["email"] == "aarav.synthetic@example.com"
        assert f["parsedJson"]["phone"] == "+919876543210"
        assert "Python" in f["parsedJson"]["skills"]
        assert "SQL" in f["parsedJson"]["skills"]
        assert f["parsedJson"]["experienceYears"] == 5.0
        assert f["parsedJson"]["ctcCurrentLpa"] == 12.0
    # Batch detail round-trips per-file statuses.
    assert len(body["files"]) == 2
    # storageKey must not leak anywhere in any response body.
    assert "storageKey" not in detail.text


def test_download_attachment_and_nosniff(client):
    _make_job(client)
    docx = make_docx_bytes(RESUME_LINES)
    res = _upload(client, "JOB-A", [("files", ("a.docx", docx,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))])
    file_id = res.json()["files"][0]["fileId"]
    dl = client.get(f"/api/resumes/files/{file_id}/download", headers=_hr())
    assert dl.status_code == 200
    assert "attachment" in dl.headers["content-disposition"]
    assert dl.headers["x-content-type-options"] == "nosniff"
    assert hashlib.sha256(dl.content).hexdigest() == res.json()["files"][0]["contentHash"]


# ---- Hostile fixtures: API stays healthy, batch isolates failures ----

def _assert_rejected_at_upload(client, job_key, file_tuples, expect_failed=1):
    """Validation rejects happen inline (before any worker job)."""
    res = _upload(client, job_key, file_tuples)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["batch"]["counts"]["failed"] == expect_failed
    return body


async def _assert_partial_after_worker(client, mock_db, job_key, file_tuples, expect_failed=1):
    """Parse failures surface after the worker runs; batch isolates them."""
    res = _upload(client, job_key, file_tuples)
    assert res.status_code == 201, res.text
    await _drain(mock_db)
    detail = client.get(f"/api/resumes/batches/{res.json()['batch']['batchId']}", headers=_hr())
    body = detail.json()
    assert body["batch"]["status"] == "partial"
    assert body["batch"]["counts"]["failed"] == expect_failed
    return body


def test_spoofed_extension_rejected(client):
    _make_job(client, "JOB-SPOOF")
    body = _assert_rejected_at_upload(client, "JOB-SPOOF",
                           [("files", ("evil.pdf", b"MZ\x90\x00evil-binary", "application/pdf"))])
    assert body["batch"]["counts"]["parsed"] == 0


def test_wrong_magic_bytes_rejected(client):
    _make_job(client, "JOB-MAGIC")
    _assert_rejected_at_upload(client, "JOB-MAGIC",
                    [("files", ("note.pdf", b"just some plain text, not a pdf", "application/pdf"))])


def test_oversized_rejected(client, monkeypatch):
    _make_job(client, "JOB-BIG")
    monkeypatch.setattr(settings, "upload_max_mb", 1)
    big = b"%PDF-" + b"A" * (1024 * 1024 + 1)
    body = _assert_rejected_at_upload(client, "JOB-BIG", [("files", ("big.pdf", big, "application/pdf"))])
    assert "exceeds" in body["batch"]["failures"][0]["message"].lower()


def test_traversal_filename_rejected(client):
    _make_job(client, "JOB-TRAV")
    pdf = make_pdf_bytes(RESUME_LINES)
    _assert_rejected_at_upload(client, "JOB-TRAV", [("files", ("../../evil.pdf", pdf, "application/pdf"))])


def test_double_extension_rejected(client):
    _make_job(client, "JOB-DBL")
    pdf = make_pdf_bytes(RESUME_LINES)
    _assert_rejected_at_upload(client, "JOB-DBL", [("files", ("resume.pdf.exe", pdf, "application/octet-stream"))])


async def test_corrupt_pdf_parse_fails_batch_survives(client, mock_db):
    _make_job(client, "JOB-CORRUPT")
    good = make_docx_bytes(RESUME_LINES)
    corrupt = b"%PDF-1.4\n%garbage that is not a real pdf body"
    body = await _assert_partial_after_worker(client, mock_db, "JOB-CORRUPT", [
        ("files", ("good.docx", good,
                   "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ("files", ("bad.pdf", corrupt, "application/pdf")),
    ])
    statuses = {f["fileName"]: f["status"] for f in body["files"]}
    assert statuses["good.docx"] == "parsed"
    assert statuses["bad.pdf"] == "failed"


def test_zip_bomb_cap(client, monkeypatch):
    _make_job(client, "JOB-ZIP")
    monkeypatch.setattr(settings, "upload_max_uncompressed_mb", 1)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<t/>")
        zf.writestr("word/document.xml", "A" * (3 * 1024 * 1024))
    body = _assert_rejected_at_upload(client, "JOB-ZIP",
                           [("files", ("bomb.docx", buf.getvalue(),
                                       "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))])
    assert "limit" in body["batch"]["failures"][0]["message"].lower()


def test_quarantine_blocks_parse_and_download(client, monkeypatch):
    _make_job(client, "JOB-Q")
    monkeypatch.setattr(settings, "clamav_enabled", True)
    docx = make_docx_bytes(RESUME_LINES)
    res = _upload(client, "JOB-Q", [("files", ("q.docx", docx,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))])
    assert res.status_code == 201
    body = res.json()
    assert body["batch"]["counts"]["quarantined"] == 1
    assert body["files"][0]["status"] == "quarantined"
    dl = client.get(f"/api/resumes/files/{body['files'][0]['fileId']}/download", headers=_hr())
    assert dl.status_code == 403


def test_batch_cap_enforced(client):
    _make_job(client, "JOB-CAP")
    pdf = make_pdf_bytes(["hello"])
    files = [( "files", (f"f{i}.pdf", pdf, "application/pdf")) for i in range(settings.upload_batch_max + 1)]
    res = _upload(client, "JOB-CAP", files)
    assert res.status_code == 400


def test_unknown_job_404(client):
    pdf = make_pdf_bytes(["hello"])
    res = _upload(client, "NOPE", [("files", ("f.pdf", pdf, "application/pdf"))])
    assert res.status_code == 404


# ---- Deterministic extract unit tests ----

def test_deterministic_parse_ctc_and_skills():
    from app.services.resume_extract import deterministic_parse

    parsed = deterministic_parse("\n".join(RESUME_LINES))
    assert parsed["name"] == "Aarav Synthetic"
    assert parsed["phone"] == "+919876543210"
    assert parsed["noticePeriodDays"] == 30
    assert parsed["ctcExpectedLpa"] == 18.0
    assert "Spring Boot" in parsed["skills"]
    assert "React" in parsed["technologies"] or "React" in parsed["skills"]
