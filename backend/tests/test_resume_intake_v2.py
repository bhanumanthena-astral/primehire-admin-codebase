"""Module 2 behavioral/security tests: isolated Mongo and private temp files."""
import asyncio
import io
import zipfile
from datetime import timedelta
import pytest
import httpx
from app.main import app
from app.config import settings
from app.security.deps import get_db, CurrentUser
from app.security.roles import get_permissions_for_role
from app.security.tokens import create_access_token
from app.models.resume_intake import ensure_intake_indexes, IntakeRepository, now
from app.services import resume_intake_security as security
from app.services.worker import run_once
from app.services.resume_intake_review import confirm
from app.schemas.resume_intake import ReviewRequest


def headers(role="hr", org="default", uid=None):
    return {"Authorization": "Bearer " + create_access_token(user_id=uid or role, org_id=org, role=role, session_id="fixture-session")}


def word(email="candidate@example.com", name="Example Candidate"):
    from docx import Document
    document = Document()
    for line in [name, email, "Phone: +919876543210", "Python SQL", "3 years of experience", "Current designation: Backend Engineer"]:
        document.add_paragraph(line)
    output = io.BytesIO(); document.save(output)
    return output.getvalue()


def workbook(rows, columns=None):
    from openpyxl import Workbook
    book = Workbook(); sheet = book.active
    sheet.append(columns or ["Candidate Name", "Email", "Phone", "Resume File Name", "Key Skills"])
    for row in rows:
        sheet.append(row)
    output = io.BytesIO(); book.save(output)
    return output.getvalue()


def zipped(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return output.getvalue()


@pytest.fixture
async def client(db, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "resume_module_v2_enabled", True)
    monkeypatch.setattr(settings, "mongodb_database", "primehire_admin_v2")
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    monkeypatch.setattr(security, "scan", lambda data: "clean")
    await ensure_intake_indexes(db)
    for role in ["super_admin", "admin", "hr", "recruiter", "viewer", "technical_interviewer", "managerial_interviewer"]:
        await db["users"].insert_one({"userId": role, "orgId": "default", "role": role, "name": role, "isActive": True})
    await db["users"].insert_one({"userId": "other", "orgId": "other", "role": "hr", "name": "Other", "isActive": True})
    for job_id, owner, keywords in [("a", "hr", ["Python", "SQL"]), ("b", "hr", ["Chemistry"]), ("viewer-job", "viewer", ["Python"]), ("recruiter-job", "recruiter", ["Python"])]:
        await db["jobs"].insert_one({"jobId": job_id, "jobKey": f"JOB-{job_id}", "orgId": "default", "title": "Backend Engineer", "jobRole": "Backend Engineer",
            "assigneeUserId": owner, "lifecycleStatus": "OPEN", "closesAt": now()+timedelta(days=365), "positionsTotal": 5,
            "positionsFilled": 0, "keywords": keywords, "minExperienceYears": 2, "maxExperienceYears": 5})
    app.dependency_overrides[get_db] = lambda: db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            c._intake_test_db = db
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


async def upload(client, data=None, *, mode="single", job="a", name="resume.docx", mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document", role="hr", key="fixture-upload-0001"):
    return await client.post("/api/resume-intake/upload", data={"jobId": job, "mode": mode, "source": "local", "consent": "true"},
        files=[("files", (name, data if data is not None else word(), mime))], headers={**headers(role), "Idempotency-Key": key})


async def drain(db, limit=30):
    for _ in range(limit):
        if await run_once(db, kinds=["resume_intake_import", "resume_intake_parse", "resume_intake_score_batch", "resume_intake_score", "resume_intake_confirm"]) is None:
            return
    raise AssertionError("Worker did not drain bounded fixture queue")


async def first(client, batch_id):
    response = await client.get(f"/api/resume-intake/batches/{batch_id}", headers=headers())
    assert response.status_code == 200, response.text
    return response.json()["items"][0]


async def reveal(client, item):
    response = await client.post(f"/api/resume-intake/items/{item['itemId']}/reveal", headers=headers())
    assert response.status_code == 200
    return response.json()


async def select_range(client, batch_id, minimum=0, maximum=100):
    batch = (await client.get(f'/api/resume-intake/batches/{batch_id}', headers=headers())).json()['batch']
    response = await client.put(f'/api/resume-intake/batches/{batch_id}/ats-range', json={
        'minimum':minimum,'maximum':maximum,'expectedRevision':batch.get('atsRangeRevision',0)},headers=headers())
    assert response.status_code == 200, response.text
    await drain(client._intake_test_db, limit=150)
    return response.json()


async def confirm_http(client, item):
    batch = (await client.get(f'/api/resume-intake/batches/{item["batchId"]}',headers=headers())).json()['batch']
    if not batch.get('atsRange'):
        await select_range(client, item['batchId'])
    await drain(client._intake_test_db, limit=150)
    response = await client.post(f"/api/resume-intake/items/{item['itemId']}/confirm",
        json={"expectedRevision": item["revision"], "profile": item["profile"]}, headers=headers())
    assert response.status_code == 202, response.text
    return response.json()


async def test_single_review_confirmation_and_advisory_ats(client, db):
    received = await upload(client)
    assert received.status_code == 202, received.text
    batch = received.json()["batchId"]
    await drain(db)
    item = await first(client, batch)
    assert item["status"] == "review_required"
    assert "candidate@example.com" not in str(item)
    assert await db["applicants"].count_documents({}) == 0
    reviewed = await reveal(client, item)
    assert reviewed["profile"]["email"] == "candidate@example.com"
    queued = await confirm_http(client, reviewed)
    assert queued["status"] == "confirming"
    await drain(db)
    complete = await first(client, batch)
    assert complete["status"] == "completed"
    assert 0 <= complete["ats"]["overall"] <= 100
    person = await db["applicants"].find_one({})
    application = await db["applications"].find_one({})
    assert "ats" not in person and "matchScore" not in person
    assert application["currentStage"] == "PARSED"
    assert await db["outbox"].count_documents({}) == 0
    assert (await client.get(f"/api/resume-intake/items/{item['itemId']}/download", headers=headers())).status_code == 200
    pdf = await client.get(f"/api/resume-intake/items/{item['itemId']}/profile.pdf", headers=headers())
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
    assert await db["audit_log"].count_documents({"action": "resume_intake.profile_reveal"}) == 1


async def test_idempotency_conflict_and_same_candidate_two_jobs(client, db):
    original = word()
    one = await upload(client, original)
    replay = await upload(client, original)
    assert one.json()["batchId"] == replay.json()["batchId"]
    assert await db["resume_intake_batches"].count_documents({}) == 1
    changed = await upload(client, word(email="different@example.com"))
    assert changed.status_code == 409
    await drain(db)
    await confirm_http(client, await reveal(client, await first(client, one.json()["batchId"])))
    await drain(db)
    score_one = (await first(client, one.json()["batchId"]))["ats"]["overall"]
    second = await upload(client, original, job="b", key="fixture-upload-0002")
    await drain(db)
    await confirm_http(client, await reveal(client, await first(client, second.json()["batchId"])))
    await drain(db)
    assert await db["applicants"].count_documents({}) == 1
    assert await db["applications"].count_documents({}) == 2
    assert score_one != (await first(client, second.json()["batchId"]))["ats"]["overall"]
    third = await upload(client, original, key="fixture-upload-0003")
    await drain(db)
    await confirm_http(client, await reveal(client, await first(client, third.json()["batchId"])))
    await drain(db)
    assert (await first(client, third.json()["batchId"]))["status"] == "duplicate"
    assert await db["applications"].count_documents({}) == 2


async def test_zip_partial_failure_preserves_success_and_identifies_errors(client, db):
    archive = zipped([("folder/good.docx", word()), ("../unsafe.docx", word()), ("nested.zip", zipped([])), ("photo.png", b"image")])
    response = await upload(client, archive, mode="zip", name="resumes.zip", mime="application/zip")
    assert response.status_code == 202
    await drain(db)
    result = (await client.get(f"/api/resume-intake/batches/{response.json()['batchId']}", headers=headers())).json()
    assert result["total"] == 4
    assert sum(i["status"] == "review_required" for i in result["items"]) == 1
    assert sum(i["status"] in {"rejected", "unsupported_format"} for i in result["items"]) == 3
    report = await client.get(f"/api/resume-intake/batches/{response.json()['batchId']}/report?errorsOnly=true", headers=headers())
    assert report.status_code == 200 and "Unsafe archive entry" in report.text and "nested.zip" in report.text


async def test_excel_valid_invalid_formula_and_exports(client, db):
    sheet = workbook([["Valid Candidate", "valid@example.com", "", "", "Python, Python, SQL"],
        ["Bad Candidate", "invalid", "", "", "SQL"], ["=HYPERLINK(\"x\")", "x@example.com", "", "", "Python"], [None]*5])
    response = await upload(client, sheet, mode="excel", name="candidates.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert response.status_code == 202
    await drain(db)
    result = (await client.get(f"/api/resume-intake/batches/{response.json()['batchId']}", headers=headers())).json()
    assert result["total"] == 3
    assert [i["status"] for i in result["items"]] == ["review_required", "rejected", "rejected"]
    item = await reveal(client, result["items"][0])
    assert item["profile"]["skills"] == ["Python", "SQL"]
    assert "No resume" in item["warnings"][0]
    for format in ["csv", "xlsx"]:
        exported = await client.get(f"/api/resume-intake/batches/{response.json()['batchId']}/export?format={format}", headers=headers())
        assert exported.status_code == 200
        assert "attachment" in exported.headers["content-disposition"]
    template = await client.get("/api/resume-intake/template", headers=headers())
    assert template.status_code == 200 and template.content.startswith(b"PK")


@pytest.mark.parametrize("verdict", ["scan_required", "virus_detected"])
async def test_security_failure_cannot_create_candidate_or_download(client, db, monkeypatch, verdict):
    monkeypatch.setattr(security, "scan", lambda data: verdict)
    response = await upload(client)
    await drain(db)
    item = await first(client, response.json()["batchId"])
    assert item["status"] == verdict
    assert await db["applicants"].count_documents({}) == 0
    assert (await client.get(f"/api/resume-intake/items/{item['itemId']}/download", headers=headers())).status_code == 409
    if verdict == "scan_required":
        monkeypatch.setattr(security, "scan", lambda data: "clean")
        retry = await client.post(f"/api/resume-intake/items/{item['itemId']}/retry", json={"expectedRevision": item["revision"]}, headers=headers())
        assert retry.status_code == 200
        await drain(db)
        assert (await first(client, response.json()["batchId"]))["status"] == "review_required"


async def test_role_assignment_tenant_and_job_closure(client, db):
    response = await upload(client)
    batch = response.json()["batchId"]
    for role in ["viewer", "technical_interviewer", "managerial_interviewer"]:
        rejected = await upload(client, role=role, key=f"blocked-role-{role}")
        assert rejected.status_code == 403
    assert (await client.get(f"/api/resume-intake/batches/{batch}", headers=headers("recruiter"))).status_code == 404
    assert (await client.get(f"/api/resume-intake/batches/{batch}", headers=headers(org="other", uid="other"))).status_code == 404
    assert (await client.get("/api/resume-intake/batches")).status_code == 401
    await db["jobs"].update_one({"jobId": "a"}, {"$set": {"lifecycleStatus": "CLOSED"}})
    assert (await upload(client, key="closed-job-0001")).status_code == 409
    await drain(db)
    item = await reveal(client, await first(client, batch))
    attempt = await client.post(f"/api/resume-intake/items/{item['itemId']}/confirm", json={"expectedRevision": item["revision"], "profile": item["profile"]}, headers=headers())
    assert attempt.status_code == 409
    assert await db["applications"].count_documents({}) == 0


async def test_concurrent_confirmation_creates_one_person_and_one_application(client, db):
    from app.services.resume_intake import add_item
    batch = {"_id": "concurrent", "orgId": "default", "jobId": "a", "jobKey": "JOB-a", "jobTitle": "Engineer",
        "mode": "excel", "source": "local", "createdBy": "hr", "createdAt": now(), "retentionUntil": now()+timedelta(days=365), "imported": True,"atsRange":{"minimum":0,"maximum":100},"atsRangeRevision":1}
    await db["resume_intake_batches"].insert_one(batch)
    profile = {"name": "Same Candidate", "email": "same@example.com", "phone": "+919998887777", "skills": ["Python"]}
    from app.schemas.resume_intake import CandidateProfile
    profile = CandidateProfile.model_validate(profile).model_dump(mode="json")
    items = []
    for row in range(50):
        item = await add_item(db, batch, row, profile=profile)
        await db["resume_intake_items"].update_one({"_id": item["_id"]}, {"$set": {"scanStatus": "clean"}})
        items.append(item)
    from app.services.resume_intake_selection import enqueue_score
    job = await db['jobs'].find_one({'jobId':'a'})
    for item in items:
        await enqueue_score(db,{**item,'scanStatus':'clean'},job)
    await drain(db,limit=150)
    user = CurrentUser("hr", "default", "hr", get_permissions_for_role("hr"), "fixture")
    async def attempt(item):
        return await confirm(db, user, item["_id"], ReviewRequest(expectedRevision=1, profile=profile))
    outcomes = await asyncio.gather(*(attempt(item) for item in items), return_exceptions=True)
    # Conflicting leases deliberately return retryable 409; clients retry.
    for item, result in zip(items, outcomes):
        if isinstance(result, Exception):
            assert getattr(result, "status_code", None) == 409
            await attempt(item)
    assert await db["applicants"].count_documents({}) == 1
    assert await db["applications"].count_documents({}) == 1
    assert await db["resume_intake_items"].count_documents({"status": "completed"}) == 1
    assert await db["resume_intake_items"].count_documents({"status": "duplicate"}) == 49


async def test_job_workspace_batches_are_scoped_and_authorized(client, db):
    await upload(client, job="a", key="workspace-job-a")
    await upload(client, job="b", key="workspace-job-b")
    response = await client.get("/api/resume-intake/batches?jobId=a", headers=headers())
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["jobId"] == "a"
    denied = await client.get("/api/resume-intake/batches?jobId=recruiter-job", headers=headers())
    assert denied.status_code in (403, 404)
