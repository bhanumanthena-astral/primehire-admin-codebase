"""Phase 2 migration tests: dry-run, import, dedupe, conflicts, mocks, security."""

import pytest
from fastapi.testclient import TestClient

from app.services import migration_service

ASM = {
    "jobId": "JOB-T1",
    "jobTitle": "Backend Dev",
    "jobDescription": "desc",
    "language": "en",
    "roundType": "TECHNICAL",
    "questions": [
        {
            "id": "q1",
            "text": "What is a closure?",
            "type": "SPEAK_TO_ANSWER",
            "maxDuration": 120,
            "referenceAnswer": "ref",
            "criteria": "crit",
            "maxScore": 20,
            "weightage": 50,
        },
        {
            "id": "q2",
            "text": "Pick one",
            "type": "MCQ",
            "maxDuration": 60,
            "options": ["a", "b"],
            "correctOption": "a",
            "maxScore": 10,
            "weightage": 50,
        },
    ],
    "isActive": True,
}

CAND = {
    "id": "CAND-ABC123",
    "assessmentId": "JOB-T1",
    "name": "Test User",
    "email": "t@x.com",
    "phone": "123",
    "startTime": "2026-01-01T00:00:00.000Z",
    "endTime": "2026-01-05T00:00:00.000Z",
    "link": "https://primehire-test.com/interview/x",
    "password": "PRIME-SECRET",
    "assignedDate": "2026-01-01T00:00:00.000Z",
    "submittedDate": None,
    "status": "ACTIVE",
    "reportStatus": None,
    "interviewId": "interview-real-1",
    "responseId": "response-real-1",
    "verifiedCandidateUUID": "11111111-2222-3333-4444-555555555555",
    "inviteSent": True,
    "reminderCount": 2,
    "mailStatus": "Reminder Sent",
    "rowLoading": False,
}

MOCK_CAND = dict(CAND, id="CAND-MOCK", email="m@x.com", interviewId="int-abc", responseId="res-abc")

TMPL = {"id": "tpl-x", "name": "X", "type": "CUSTOM", "subject": "s", "body": "b"}


def payload(**over):
    base = {"version": 1, "assessments": [ASM], "candidates": [CAND], "templates": [TMPL]}
    base.update(over)
    return base


# 1. dry-run changes nothing
async def test_dry_run_import(db):
    res = await migration_service.dry_run(db, payload())
    assert res["dryRun"] is True
    assert res["assessments"]["valid"] == 1
    assert res["candidates"]["valid"] == 1
    assert res["candidates"]["passwordsSkipped"] == 1  # CAND carries a password
    assert res["templates"]["valid"] == 1
    assert await db["assessments"].count_documents({}) == 0
    assert await db["candidates"].count_documents({}) == 0
    assert await db["templates"].count_documents({}) == 0


# 2/3. valid assessment + candidate import
async def test_valid_import(db):
    res = await migration_service.run_import(db, payload())
    assert res["assessments"]["inserted"] == 1
    assert res["candidates"]["inserted"] == 1
    assert res["templates"]["inserted"] == 1
    assert res["errors"] == [] and res["conflicts"] == []


# 4/5/11/12. duplicates + restartable (second run inserts nothing)
async def test_duplicate_and_restartable(db):
    first = await migration_service.run_import(db, payload())
    second = await migration_service.run_import(db, payload())
    assert (first["assessments"]["inserted"], first["candidates"]["inserted"]) == (1, 1)
    assert second["assessments"] == {"received": 1, "inserted": 0, "existing": 1, "conflicts": 0, "invalid": 0}
    assert second["candidates"]["inserted"] == 0
    assert second["candidates"]["existing"] == 1
    assert second["candidates"]["conflicts"] == 0
    assert await db["candidates"].count_documents({}) == 1


# 6b. dry-run detects conflicts without writing
async def test_dry_run_detects_conflicts(db):
    await migration_service.run_import(db, payload())
    changed = dict(CAND, name="Someone Else")
    changed_asm = dict(ASM, jobTitle="Renamed")
    res = await migration_service.dry_run(
        db, payload(assessments=[changed_asm], candidates=[changed], templates=[TMPL])
    )
    assert res["dryRun"] is True
    assert res["candidates"]["conflicts"] == 1
    assert res["assessments"]["conflicts"] == 1
    assert res["templates"]["duplicates"] == 1
    assert len(res["conflicts"]) == 2
    assert "inserted" not in res["candidates"]  # dry-run never reports inserts
    assert await db["candidates"].count_documents({}) == 1  # nothing written


# 6. conflicting candidate (same key, different content) -> conflict, no overwrite
async def test_conflicting_candidate(db):
    await migration_service.run_import(db, payload())
    changed = dict(CAND, name="Someone Else")
    res = await migration_service.run_import(db, payload(candidates=[changed]))
    assert res["candidates"]["conflicts"] == 1
    assert res["candidates"]["inserted"] == 0
    assert len(res["conflicts"]) == 1
    stored = await db["candidates"].find_one({})
    assert stored["name"] == "Test User"  # original preserved


# 5/6. unresolved fallbacks nulled operationally, kept as audit metadata
async def test_unresolved_ids_become_audit_metadata(db):
    from app.services import migration_service as ms

    mapped, _ = ms.map_frontend_candidate(
        dict(CAND, interviewId="interview-real-9", responseId="res-fallback9",
             verifiedCandidateUUID="c3a7db8e-0f2c-473d-82ba-aaaaaaaaaaaa")
    )
    assert mapped["isMock"] is False  # real interviewId -> REAL
    assert mapped["primehire"]["interviewId"] == "interview-real-9"
    assert mapped["primehire"]["responseId"] is None
    assert mapped["primehire"]["candidateUUID"] is None
    assert mapped["migrationMeta"]["unresolvedResponseId"] == "res-fallback9"
    assert mapped["migrationMeta"]["unresolvedCandidateUUID"] == "c3a7db8e-0f2c-473d-82ba-aaaaaaaaaaaa"
    # genuine UUID is preserved operationally
    mapped2, _ = ms.map_frontend_candidate(
        dict(CAND, interviewId="interview-real-9", responseId="resp-real-9",
             verifiedCandidateUUID="11111111-2222-3333-4444-555555555555")
    )
    assert mapped2["primehire"]["candidateUUID"] == "11111111-2222-3333-4444-555555555555"
    assert mapped2["primehire"]["responseId"] == "resp-real-9"
    assert mapped2["migrationMeta"] == {"unresolvedResponseId": None, "unresolvedCandidateUUID": None}


# 7. mock candidate flagged, never production
async def test_mock_candidate(db):
    res = await migration_service.run_import(db, payload(candidates=[MOCK_CAND]))
    assert res["candidates"]["inserted"] == 1
    assert res["candidates"]["mock"] == 1
    stored = await db["candidates"].find_one({})
    assert stored["isMock"] is True


# 8/9. malformed records collected, valid ones still import
async def test_malformed_records(db):
    res = await migration_service.run_import(
        db,
        payload(
            assessments=[{"jobTitle": "missing jobId"}],
            candidates=["not-an-object", {"name": "no email/assessment"}],
        ),
    )
    assert res["assessments"]["invalid"] == 1
    assert res["candidates"]["invalid"] == 2
    assert len(res["errors"]) == 3
    assert res["templates"]["inserted"] == 1  # unrelated sections unaffected


# 10. password never stored, never returned
async def test_password_rejection(db):
    res = await migration_service.run_import(db, payload())
    assert res["candidates"]["passwordsSkipped"] == 1
    stored = await db["candidates"].find_one({})
    assert "password" not in stored
    assert "PRIME-SECRET" not in str(res)


# 13. nested questions preserved exactly
async def test_nested_question_preservation(db):
    await migration_service.run_import(db, payload())
    stored = await db["assessments"].find_one({})
    assert stored["questions"][0]["referenceAnswer"] == "ref"
    assert stored["questions"][0]["criteria"] == "crit"
    assert stored["questions"][1]["options"] == ["a", "b"]
    assert stored["questions"][1]["correctOption"] == "a"
    assert stored["questions"][0]["maxScore"] == 20
    assert stored["questions"][0]["weightage"] == 50


# 14. PrimeHire IDs preserved under primehire.*
async def test_primehire_id_preservation(db):
    await migration_service.run_import(db, payload())
    stored = await db["candidates"].find_one({})
    assert stored["candidateKey"] == "CAND-ABC123"  # app key separate from _id
    assert str(stored["_id"]) != "CAND-ABC123"
    assert stored["primehire"] == {
        "interviewId": "interview-real-1",
        "responseId": "response-real-1",
        "candidateUUID": "11111111-2222-3333-4444-555555555555",
    }
    assert stored["syncState"]["reminderCount"] == 2
    assert stored["syncState"]["mailStatus"] == "Reminder Sent"


# ---- route-level: 15/16. mongo unavailable + auth ----
def _client(monkeypatch, secret="s3cr3t", uri="mongodb://x"):
    import app.api.migration as mig

    monkeypatch.setattr("app.config.settings.migration_secret", secret)
    monkeypatch.setattr("app.config.settings.mongodb_uri", uri)
    from app.main import app

    return TestClient(app), mig


def test_route_rejects_without_secret(monkeypatch, db):
    client, mig = _client(monkeypatch, secret="")
    res = client.post("/api/migration/import", json=payload())
    assert res.status_code == 403


def test_route_rejects_wrong_secret(monkeypatch, db):
    client, mig = _client(monkeypatch, secret="s3cr3t")
    res = client.post("/api/migration/import", json=payload(), headers={"X-Migration-Secret": "wrong"})
    assert res.status_code == 403


def test_route_503_without_mongo(monkeypatch):
    client, _ = _client(monkeypatch, secret="s3cr3t", uri="")
    res = client.post("/api/migration/import", json=payload(), headers={"X-Migration-Secret": "s3cr3t"})
    assert res.status_code == 503


def test_route_dry_run_end_to_end(monkeypatch, db):
    import app.api.migration as mig

    client, _ = _client(monkeypatch, secret="s3cr3t", uri="mongodb://x")
    monkeypatch.setattr(mig, "get_database", lambda *a: db)
    res = client.post(
        "/api/migration/import?dryRun=true",
        json=payload(),
        headers={"X-Migration-Secret": "s3cr3t"},
    )
    assert res.status_code == 200
    assert res.json()["dryRun"] is True
    assert "s3cr3t" not in res.text
