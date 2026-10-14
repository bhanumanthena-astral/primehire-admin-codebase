"""No live provider calls: persisted deadlines, reloads, retries and API bypasses."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import app.api.assessments as assessments_api
import app.api.candidates as candidates_api
import app.services.assessment_availability as availability
import app.services.assessment_service as assessments_service
from app.main import app
from app.services.assessment_service import AssessmentService
from app.services.candidate_service import CandidateService
from app.services.primehire_client import PrimehireError


def payload():
    return {"jobId": "JOB-BUFFER", "jobTitle": "Developer", "jobDescription": "Build apps",
            "roundType": "BASIC", "language": "ENGLISH", "createdAt": "2000-01-01T00:00:00Z",
            "candidateCreationAvailableAt": "2000-01-01T00:00:00Z",
            "questions": [{"text": "Pick one", "type": "MCQ", "maxDuration": 60,
                           "options": ["Alpha", "Beta"], "correctOption": "Beta",
                           "maxScore": 10, "weightage": 100}]}


def candidate(**overrides):
    return {"assessmentId": "JOB-BUFFER", "name": "Test Candidate", "email": "test@example.com", **overrides}


async def accepted(path, body):
    return {"status": "SUCCESS", "data": {"assessment_id": "provider-id"}}


@pytest.fixture
def clock(monkeypatch):
    clock = [datetime(2026, 10, 13, 6, 30, tzinfo=timezone.utc)]
    monkeypatch.setattr(assessments_service, "utcnow", lambda: clock[0])
    monkeypatch.setattr(availability, "utcnow", lambda: clock[0])
    return clock


async def test_persisted_deadline_survives_reloads_and_retry_without_restarting(db, clock):
    created = await AssessmentService(db, fetch=accepted).create(payload())
    deadline = created["candidateCreationAvailableAt"]
    assert datetime.fromisoformat(deadline) == clock[0] + timedelta(minutes=5)
    clock[0] += timedelta(minutes=2)
    # Fresh service instances model another browser or a process restart.
    for _ in range(3):
        reloaded = await AssessmentService(db, fetch=accepted).get_by_job_id("JOB-BUFFER")
        assert reloaded["candidateCreationAvailableAt"] == deadline
        retried = await AssessmentService(db, fetch=accepted).retry_sync("JOB-BUFFER")
        assert retried["candidateCreationAvailableAt"] == deadline
    with pytest.raises(availability.AssessmentPreparing):
        await CandidateService(db).create(candidate())
    clock[0] += timedelta(minutes=3)
    assert (await CandidateService(db).create(candidate()))["assessmentId"] == "JOB-BUFFER"
    assert (await AssessmentService(db).get_by_job_id("JOB-BUFFER"))["candidateCreationAvailableAt"] == deadline


async def test_failed_setup_stays_blocked_then_retry_starts_full_buffer(db, clock):
    async def rejected(path, body):
        raise PrimehireError("Provider unavailable")
    svc = AssessmentService(db, fetch=rejected)
    failed = await svc.create(payload())
    assert failed["syncState"]["state"] == "failed"
    assert not failed.get("candidateCreationAvailableAt")
    clock[0] += timedelta(hours=1)
    with pytest.raises(availability.AssessmentPreparing, match="setup"):
        await CandidateService(db).create(candidate())
    svc._fetch = accepted
    retried = await svc.retry_sync("JOB-BUFFER")
    assert datetime.fromisoformat(retried["candidateCreationAvailableAt"]) == clock[0] + timedelta(minutes=5)


async def test_success_http_with_provider_error_never_starts_buffer(db, clock):
    async def failed_response(path, body):
        return {"status": "ERROR", "message": "Question audio failed"}
    created = await AssessmentService(db, fetch=failed_response).create(payload())
    assert created["syncState"]["state"] == "failed"
    assert not created.get("candidateCreationAvailableAt")


@pytest.mark.parametrize("state", ["pending", "failed"])
async def test_incomplete_setup_has_no_time_based_bypass(db, clock, state):
    await db["assessments"].insert_one({"jobId": "JOB-BUFFER", "syncState": {"state": state}})
    clock[0] += timedelta(days=1)
    with pytest.raises(availability.AssessmentPreparing):
        await CandidateService(db).create(candidate())


async def test_legacy_assessments_have_no_new_buffer(db, clock):
    await db["assessments"].insert_one({"jobId": "JOB-BUFFER", "jobTitle": "Existing"})
    assert (await CandidateService(db).create(candidate()))["assessmentId"] == "JOB-BUFFER"


def test_api_rejects_single_bulk_and_reassignment_before_deadline(db, clock):
    svc = AssessmentService(db, fetch=accepted)
    app.dependency_overrides[assessments_api._service] = lambda: svc
    app.dependency_overrides[assessments_api._db] = lambda: db
    app.dependency_overrides[candidates_api._db] = lambda: db
    client = TestClient(app)
    try:
        created = client.post("/api/assessments", json=payload(), headers={"Idempotency-Key": "buffer-test"})
        assert created.status_code == 201, created.text
        deadline = created.json()["candidateCreationAvailableAt"]
        blocked = client.post("/api/candidates", json=candidate())
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["code"] == "ASSESSMENT_PREPARING"
        batch = client.post("/api/candidates/bulk", json={"items": [candidate()]})
        assert batch.json()["created"] == 0
        assert batch.json()["errors"][0]["code"] == "ASSESSMENT_PREPARING"
        assert batch.json()["errors"][0]["availableAt"] == deadline
        external = client.post("/api/candidates", json=candidate(assessmentId="LEGACY-EXTERNAL"))
        key = external.json()["candidateKey"]
        move = client.put(f"/api/candidates/{key}", json={"assessmentId": "JOB-BUFFER"})
        assert move.status_code == 409
        assert client.get(f"/api/candidates/{key}").json()["assessmentId"] == "LEGACY-EXTERNAL"
        clock[0] += timedelta(minutes=5)
        refreshed = client.get("/api/assessments/JOB-BUFFER").json()
        assert refreshed["candidateCreationAvailableAt"] == deadline
        repeated = client.post("/api/assessments", json=payload(), headers={"Idempotency-Key": "buffer-test"})
        assert repeated.json()["candidateCreationAvailableAt"] == deadline
        assert client.post("/api/candidates", json=candidate()).status_code == 201
        assert client.put(f"/api/candidates/{key}", json={"assessmentId": "JOB-BUFFER"}).status_code == 200
    finally:
        for key in (assessments_api._service, assessments_api._db, candidates_api._db):
            app.dependency_overrides.pop(key, None)
        client.close()
