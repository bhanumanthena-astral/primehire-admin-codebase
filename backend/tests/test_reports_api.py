"""GET /api/reports/{interviewId}: Mongo-first retrieval contract."""

import mongomock_motor
from fastapi.testclient import TestClient

import app.api.reports as reports_api
from app.main import app

STORED = {
    "interviewId": "real-iv-1",
    "candidateId": "cand-mongo-id",
    "assessmentId": "JOB-1",
    "responseId": None,
    "status": "GENERATED",
    "source": "primehire",
    "schemaVersion": 1,
    "raw": {"interview_details": {"round_type": "TECHNICAL"}},
    "rawResponse": {"status": "SUCCESS", "data": {}},
    "normalized": {
        "interviewDetails": {"roundType": "TECHNICAL"},
        "report": {"overallResult": {"technicalAnalysis": {"overallScore": 82}},
                   "questionWiseResult": [
                       {"id": "q1", "obtainedScore": 18, "maxScore": 20, "weightage": 100,
                        "videoUrl": "https://cdn/x.webm",
                        "result": {"transcript": "hello", "relevancy": "High"}}]},
        "violations": {"tabSwitching": 1},
    },
    "normalizedScores": {"technical": 82, "communication": None, "confidence": 68,
                         "fluency": None, "grammar": None, "pronunciation": None,
                         "vocabulary": None},
    "videoRefs": [{"questionId": "q1", "videoUrl": "https://cdn/x.webm", "fetchedAt": "t"}],
    "upstreamHash": "abc",
    "error": None,
}


def _client(db):
    app.dependency_overrides[reports_api._db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(reports_api._db, None)


def _seeded_client(db):
    import asyncio

    asyncio.get_event_loop().run_until_complete(db["reports"].insert_one(dict(STORED)))
    return _client(db)


def test_existing_report_200_and_lookup():
    import asyncio

    db = mongomock_motor.AsyncMongoMockClient()["t"]
    asyncio.get_event_loop().run_until_complete(db["reports"].insert_one(dict(STORED)))
    app.dependency_overrides[reports_api._db] = lambda: db
    try:
        res = TestClient(app).get("/api/reports/real-iv-1")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)
    assert res.status_code == 200  # 1/2/3
    body = res.json()
    assert body["interviewId"] == "real-iv-1"  # 2
    assert body["report"] == STORED["normalized"]  # 8
    assert body["normalizedScores"] == STORED["normalizedScores"]  # 9
    assert body["videoRefs"] == STORED["videoRefs"]  # 10
    assert body["responseId"] is None  # 7 (real interview + null responseId valid)
    assert "raw" not in body and "rawResponse" not in body and "_id" not in body  # 13
    text = res.text
    for secret in ("x-access-key", "x-secret-key", "mongodb://", "MIGRATION", "password"):
        assert secret not in text  # 13


def test_primehire_never_called_on_hit(monkeypatch):
    import asyncio

    import httpx

    db = mongomock_motor.AsyncMongoMockClient()["t"]
    asyncio.get_event_loop().run_until_complete(db["reports"].insert_one(dict(STORED)))
    app.dependency_overrides[reports_api._db] = lambda: db

    def _boom(*a, **k):
        raise AssertionError("PrimeHire must not be contacted")

    monkeypatch.setattr(httpx, "AsyncClient", _boom)  # 4
    try:
        res = TestClient(app).get("/api/reports/real-iv-1")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)
    assert res.status_code == 200


def test_not_found_404():
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    app.dependency_overrides[reports_api._db] = lambda: db
    try:
        res = TestClient(app).get("/api/reports/does-not-exist")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)
    assert res.status_code == 404  # 5
    assert res.json()["detail"]["code"] == "REPORT_NOT_FOUND"


def test_mock_id_400():
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    app.dependency_overrides[reports_api._db] = lambda: db
    try:
        res = TestClient(app).get("/api/reports/int-abc123")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)
    assert res.status_code == 400  # 6
    assert res.json()["detail"]["code"] == "MOCK_ID"


def test_missing_optionals_and_nulls():
    import asyncio
    import copy

    partial = copy.deepcopy(STORED)
    partial["interviewId"] = "real-iv-2"
    partial["normalizedScores"] = {k: None for k in partial["normalizedScores"]}
    partial["videoRefs"] = []
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    asyncio.get_event_loop().run_until_complete(db["reports"].insert_one(partial))
    app.dependency_overrides[reports_api._db] = lambda: db
    try:
        res = TestClient(app).get("/api/reports/real-iv-2")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)
    assert res.status_code == 200  # 11
    assert all(v is None for v in res.json()["normalizedScores"].values())
    assert res.json()["videoRefs"] == []


def test_mongo_failure_controlled_5xx():
    class Broken:
        def __getattr__(self, _):
            raise ConnectionError("mongo down")

    app.dependency_overrides[reports_api._db] = lambda: Broken()
    try:
        res = TestClient(app).get("/api/reports/real-iv-1")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)
    assert res.status_code == 500  # 12
    assert "Traceback" not in res.text


def test_candidate_report_relationship():
    import asyncio

    from bson import ObjectId

    db = mongomock_motor.AsyncMongoMockClient()["t"]
    cid = ObjectId()
    loop = asyncio.get_event_loop()
    loop.run_until_complete(db["candidates"].insert_one(
        {"_id": cid, "primehire": {"interviewId": "real-iv-1"}}))
    stored = dict(STORED, candidateId=str(cid))
    loop.run_until_complete(db["reports"].insert_one(stored))
    app.dependency_overrides[reports_api._db] = lambda: db
    try:
        res = TestClient(app).get("/api/reports/real-iv-1")
    finally:
        app.dependency_overrides.pop(reports_api._db, None)
    assert res.status_code == 200  # 14
    assert res.json()["candidateId"] == str(cid)
