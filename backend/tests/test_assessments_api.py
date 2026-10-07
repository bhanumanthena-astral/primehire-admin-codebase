"""Slice 2A tests: assessment write path end to end.

- PrimeHire payload matrix (TECHNICAL/BASIC/HR x verbal/MCQ/mixed).
- pending -> synced / failed + Retry, with mocked PrimeHire (no network).
- Idempotency-Key, version 409, unique jobId+roundType, BSON dates.
- List filters (search, roundType, isActive, since).
"""

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

import app.api.assessments as assessments_api
import app.api.directory as directory_api
from app.db.mongodb import ensure_indexes
from app.main import app
from app.services import primehire_client as remote
from app.services.assessment_service import AssessmentService
from app.services.primehire_payload import PayloadError, map_assessment


def _fresh_db():
    return mongomock_motor.AsyncMongoMockClient()["t"]


def _verbal(**over):
    q = {"id": "q1", "text": "Tell us about yourself.", "type": "SPEAK_TO_ANSWER",
         "maxDuration": 120, "maxScore": 50, "weightage": 100}
    q.update(over)
    return q


def _mcq(**over):
    q = {"id": "q2", "text": "Pick one.", "type": "MCQ", "maxDuration": 60,
         "options": ["Alpha", "Beta"], "correctOption": "Alpha",
         "maxScore": 50, "weightage": 100}
    q.update(over)
    return q


def _payload(round_type="TECHNICAL", questions=None, **over):
    body = {"jobId": "JOB-T1", "jobTitle": "Backend Dev", "jobDescription": "desc",
            "language": "ENGLISH", "roundType": round_type,
            "questions": questions if questions is not None else [
                _verbal(referenceAnswer="ref", weightage=60, maxScore=60),
                _mcq(weightage=40, maxScore=40),
            ]}
    body.update(over)
    return body


async def _ok_fetch(path, payload):
    return {"status": "SUCCESS", "data": {"assessment_id": "ph-123"}}


async def _boom_fetch(path, payload):
    raise remote.PrimehireError("PrimeHire unreachable: ConnectionError")


# ---------- payload matrix ----------

def _matrix_cases():
    tech_v = _verbal(referenceAnswer="ref", weightage=100)
    tech_m = _mcq(weightage=100)
    basic_v = _verbal(criteria="rubric", weightage=100)
    basic_m = _mcq(weightage=100)
    hr_v = {"id": "q1", "text": "Why us?", "type": "SPEAK_TO_ANSWER", "maxDuration": 90}
    hr_m = {"id": "q2", "text": "Pick one.", "type": "MCQ", "maxDuration": 60,
            "options": ["A", "B"], "correctOption": "B"}
    return [
        ("TECHNICAL", [tech_v], "verbal"),
        ("TECHNICAL", [tech_m], "mcq"),
        ("TECHNICAL", [dict(tech_v, weightage=60), dict(tech_m, weightage=40)], "mixed"),
        ("BASIC", [basic_v], "verbal"),
        ("BASIC", [basic_m], "mcq"),
        ("BASIC", [dict(basic_v, weightage=60), dict(basic_m, weightage=40)], "mixed"),
        ("HR", [hr_v], "verbal"),
        ("HR", [hr_m], "mcq"),
        ("HR", [hr_v, hr_m], "mixed"),
    ]


@pytest.mark.parametrize("round_type,questions,kind", _matrix_cases())
def test_payload_matrix(round_type, questions, kind):
    doc = {"jobId": "J", "jobTitle": "T", "jobDescription": "d",
           "roundType": round_type, "questions": questions}
    out = map_assessment(doc)
    assert out["language"] == "ENGLISH"
    assert out["round_type"] == round_type
    assert len(out["questions"]) == len(questions)
    for i, q in enumerate(out["questions"]):
        src = questions[i]
        assert q["max_duration"]  # every question carries max_duration
        if q["type"] == "MCQ":
            ids = [o["id"] for o in q["options"]]
            assert ids == ["A", "B", "C", "D"][:len(ids)]
            assert [o["data"] for o in q["options"]] == src["options"]
            assert q["correct_option_id"] == ids[src["options"].index(src["correctOption"])]
        else:
            if round_type == "BASIC":
                assert "criteria" in q and "answer" not in q  # QA #18/#23
            elif round_type == "TECHNICAL":
                assert "answer" in q and "criteria" not in q
            else:
                assert "answer" not in q and "criteria" not in q
        if round_type == "HR":
            assert "max_score" not in q and "weightage" not in q
    if round_type != "HR":
        assert sum(q.get("weightage", 0) for q in out["questions"]) == 100


def test_payload_rejects_bad_weightage_total():
    with pytest.raises(PayloadError, match="exactly 100"):
        map_assessment({"jobId": "J", "jobTitle": "T", "roundType": "TECHNICAL",
                        "questions": [_verbal(referenceAnswer="r", weightage=50)]})


def test_payload_rejects_basic_answer_instead_of_criteria():
    with pytest.raises(PayloadError, match="criteria"):
        map_assessment({"jobId": "J", "jobTitle": "T", "roundType": "BASIC",
                        "questions": [_verbal(referenceAnswer="r", weightage=100)]})


def test_payload_rejects_mcq_mismatch():
    with pytest.raises(PayloadError, match="correct option"):
        map_assessment({"jobId": "J", "jobTitle": "T", "roundType": "HR",
                        "questions": [_mcq(correctOption="Gamma")]})


# ---------- service + route helpers ----------

def _client_with(db, fetch=None):
    svc = AssessmentService(db, fetch=fetch)
    app.dependency_overrides[assessments_api._service] = lambda: svc
    app.dependency_overrides[assessments_api._db] = lambda: db
    app.dependency_overrides[directory_api._db] = lambda: db
    return TestClient(app), svc


def _teardown():
    app.dependency_overrides.pop(assessments_api._service, None)
    app.dependency_overrides.pop(assessments_api._db, None)
    app.dependency_overrides.pop(directory_api._db, None)


# ---------- write path ----------

async def test_create_synced_flow(db):
    svc = AssessmentService(db, fetch=_ok_fetch)
    stored = await svc.create(_payload())
    assert stored["syncState"]["state"] == "synced"
    assert stored["primehire"]["assessmentId"] == "ph-123"
    assert stored["version"] == 1
    assert stored["createdBy"]
    raw = await db["assessments"].find_one({})
    import datetime as dt
    assert isinstance(raw["createdAt"], dt.datetime)
    assert isinstance(raw["updatedAt"], dt.datetime)


async def test_create_failed_then_retry(db):
    svc = AssessmentService(db, fetch=_boom_fetch)
    stored = await svc.create(_payload())
    assert stored["syncState"]["state"] == "failed"
    assert "unreachable" in stored["syncState"]["error"]
    # Record is kept — retry with a working fetch recovers it.
    svc._fetch = _ok_fetch
    retried = await svc.retry_sync("JOB-T1")
    assert retried["syncState"]["state"] == "synced"


async def test_create_without_credentials_keeps_record(db, monkeypatch):
    monkeypatch.setattr("app.config.settings.primehire_access_key", "")
    monkeypatch.setattr("app.config.settings.primehire_secret_key", "")
    svc = AssessmentService(db)  # real HTTP layer, no credentials configured
    stored = await svc.create(_payload())
    assert stored["syncState"]["state"] == "failed"
    assert "not configured" in stored["syncState"]["error"]
    assert await db["assessments"].count_documents({}) == 1


def test_route_create_idempotent():
    db = _fresh_db()
    client, _ = _client_with(db, fetch=_ok_fetch)
    try:
        headers = {"Idempotency-Key": "key-abc-123"}
        first = client.post("/api/assessments", json=_payload(), headers=headers)
        assert first.status_code == 201, first.text
        second = client.post("/api/assessments", json=_payload(), headers=headers)
        assert second.status_code == 201
        assert second.json()["jobId"] == "JOB-T1"
        # Same key, different payload would still return the ORIGINAL response.
        third = client.post("/api/assessments", json=_payload(jobTitle="Different"),
                            headers=headers)
        assert third.status_code == 201
        assert third.json()["jobTitle"] == "Backend Dev"
        listed = client.get("/api/assessments").json()
        assert listed["total"] == 1
    finally:
        _teardown()


def test_route_duplicate_job_round_conflicts():
    db = _fresh_db()
    client, _ = _client_with(db, fetch=_ok_fetch)
    try:
        assert client.post("/api/assessments", json=_payload()).status_code == 201
        dup = client.post("/api/assessments", json=_payload())
        assert dup.status_code == 409
        # Same jobId, different roundType is a different assessment.
        other = client.post("/api/assessments", json=_payload(
            round_type="BASIC",
            questions=[_verbal(criteria="c", weightage=100)]))
        assert other.status_code == 201, other.text
    finally:
        _teardown()


def test_route_version_conflict_409_with_current():
    db = _fresh_db()
    client, _ = _client_with(db, fetch=_ok_fetch)
    try:
        created = client.post("/api/assessments", json=_payload()).json()
        assert created["version"] == 1
        ok = client.put("/api/assessments/JOB-T1", json={
            "version": 1, "jobTitle": "Renamed", "jobDescription": "d",
            "language": "ENGLISH",
            "questions": [_verbal(referenceAnswer="r", weightage=100)],
        })
        assert ok.status_code == 200, ok.text
        assert ok.json()["version"] == 2
        stale = client.put("/api/assessments/JOB-T1", json={
            "version": 1, "jobTitle": "Stale", "jobDescription": "d",
            "language": "ENGLISH",
            "questions": [_verbal(referenceAnswer="r", weightage=100)],
        })
        assert stale.status_code == 409
        body = stale.json()["detail"]
        assert body["code"] == "VERSION_CONFLICT"
        assert "someone else" in body["message"]
        assert body["current"]["jobTitle"] == "Renamed"
    finally:
        _teardown()


def test_route_patch_and_activate_cycle():
    db = _fresh_db()
    client, _ = _client_with(db, fetch=_ok_fetch)
    try:
        created = client.post("/api/assessments", json=_payload()).json()
        patched = client.patch("/api/assessments/JOB-T1", json={
            "version": created["version"], "jobTitle": "Patched"})
        assert patched.status_code == 200 and patched.json()["jobTitle"] == "Patched"
        # Untouched fields preserved (targeted $set, no whole-doc replace).
        assert patched.json()["jobDescription"] == "desc"

        deact = client.patch("/api/assessments/JOB-T1", json={
            "version": patched.json()["version"]})
        # PATCH without isActive leaves state alone.
        assert deact.status_code == 200 and deact.json()["isActive"] is True

        off = client.patch("/api/assessments/JOB-T1/deactivate", json={
            "version": deact.json()["version"]})
        assert off.status_code == 200 and off.json()["isActive"] is False
        assert off.json()["deactivatedAt"]
        on = client.patch("/api/assessments/JOB-T1/activate", json={
            "version": off.json()["version"]})
        assert on.status_code == 200 and on.json()["isActive"] is True
    finally:
        _teardown()


def test_route_get_and_404():
    db = _fresh_db()
    client, _ = _client_with(db, fetch=_ok_fetch)
    try:
        client.post("/api/assessments", json=_payload())
        got = client.get("/api/assessments/JOB-T1")
        assert got.status_code == 200 and got.json()["jobTitle"] == "Backend Dev"
        missing = client.get("/api/assessments/NOPE")
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "ASSESSMENT_NOT_FOUND"
    finally:
        _teardown()


def test_route_list_filters_and_since():
    db = _fresh_db()
    client, _ = _client_with(db, fetch=_ok_fetch)
    try:
        client.post("/api/assessments", json=_payload(jobId="JOB-A", jobTitle="Alpha Backend"))
        client.post("/api/assessments", json=_payload(
            jobId="JOB-B", jobTitle="Beta HR", round_type="HR",
            questions=[{"id": "q1", "text": "Why?", "type": "SPEAK_TO_ANSWER", "maxDuration": 90}]))

        all_items = client.get("/api/assessments").json()
        assert all_items["total"] == 2

        by_search = client.get("/api/assessments?search=alpha").json()
        assert by_search["total"] == 1 and by_search["items"][0]["jobId"] == "JOB-A"

        by_round = client.get("/api/assessments?roundType=HR").json()
        assert by_round["total"] == 1 and by_round["items"][0]["jobId"] == "JOB-B"

        bad_round = client.get("/api/assessments?roundType=NOPE")
        assert bad_round.status_code == 422

        active = client.get("/api/assessments?isActive=true").json()
        assert active["total"] == 2

        future = client.get("/api/assessments?since=2999-01-01T00:00:00Z").json()
        assert future["total"] == 0  # unchanged data costs a cheap empty page
        past = client.get("/api/assessments?since=2000-01-01T00:00:00Z").json()
        assert past["total"] == 2
    finally:
        _teardown()


def test_route_retry_endpoint():
    db = _fresh_db()
    client, svc = _client_with(db, fetch=_boom_fetch)
    try:
        created = client.post("/api/assessments", json=_payload()).json()
        assert created["syncState"]["state"] == "failed"
        svc._fetch = _ok_fetch
        retried = client.post("/api/assessments/JOB-T1/retry")
        assert retried.status_code == 200
        assert retried.json()["syncState"]["state"] == "synced"
        # Retrying an already-synced record is a no-op returning the doc.
        again = client.post("/api/assessments/JOB-T1/retry")
        assert again.status_code == 200 and again.json()["syncState"]["state"] == "synced"
    finally:
        _teardown()


async def test_find_duplicates_dry_run(db):
    await db["assessments"].insert_many([
        {"jobId": "JOB-D", "roundType": "TECHNICAL"},
        {"jobId": "JOB-D", "roundType": "TECHNICAL"},
        {"jobId": "JOB-D", "roundType": "HR"},
    ])
    svc = AssessmentService(db)
    dups = await svc.find_duplicates()
    assert len(dups) == 1
    assert dups[0]["_id"] == {"jobId": "JOB-D", "roundType": "TECHNICAL"}
    assert dups[0]["count"] == 2


async def test_unique_index_build_and_legacy_drop(db):
    await db["assessments"].create_index([("jobId", 1)], unique=True, name="uniq_jobId")
    created = await ensure_indexes(db)
    assert "uniq_jobId_roundType" in created["assessments"]
    info = await db["assessments"].index_information()
    assert "uniq_jobId" not in info
    assert "uniq_jobId_roundType" in info


async def test_idempotency_indexes(db):
    from app.db.mongodb import ensure_idempotency_indexes

    names = await ensure_idempotency_indexes(db)
    assert "ttl_createdAt" in names and "uniq_key" in names
