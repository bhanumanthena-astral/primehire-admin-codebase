"""Directory list APIs: pagination, filters, failure control."""

import mongomock_motor
from fastapi.testclient import TestClient

import app.api.directory as directory_api
from app.main import app


def _client(db):
    app.dependency_overrides[directory_api._db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(directory_api._db, None)


def _seed(db):
    import asyncio

    loop = asyncio.get_event_loop()
    loop.run_until_complete(db["assessments"].insert_many([
        {"jobId": "JOB-1", "jobTitle": "A", "questions": []},
        {"jobId": "JOB-2", "jobTitle": "B", "questions": []},
    ]))
    loop.run_until_complete(db["candidates"].insert_many([
        {"candidateKey": "CAND-1", "assessmentId": "JOB-1", "email": "a@x.com",
         "primehire": {"interviewId": "iv-1"}},
        {"candidateKey": "CAND-2", "assessmentId": "JOB-1", "email": "b@x.com",
         "primehire": {"interviewId": "iv-2"}},
        {"candidateKey": "CAND-3", "assessmentId": "JOB-2", "email": "c@x.com",
         "primehire": {"interviewId": "iv-3"}},
    ]))


def test_list_assessments_paginated():
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed(db)
    app.dependency_overrides[directory_api._db] = lambda: db
    try:
        client = TestClient(app)
        full = client.get("/api/assessments")
        assert full.status_code == 200
        assert full.json()["total"] == 2 and len(full.json()["items"]) == 2
        page = client.get("/api/assessments?limit=1&skip=1")
        assert len(page.json()["items"]) == 1 and page.json()["total"] == 2
        assert "raw" not in page.text and "x-access-key" not in page.text
    finally:
        app.dependency_overrides.pop(directory_api._db, None)


def test_list_candidates_all_and_filtered():
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    _seed(db)
    app.dependency_overrides[directory_api._db] = lambda: db
    try:
        client = TestClient(app)
        all_c = client.get("/api/candidates")
        assert all_c.json()["total"] == 3
        filt = client.get("/api/candidates?assessment_id=JOB-1")
        body = filt.json()
        assert body["total"] == 2 and all(c["assessmentId"] == "JOB-1" for c in body["items"])
        assert "password" not in filt.text
    finally:
        app.dependency_overrides.pop(directory_api._db, None)


def test_directory_mongo_failure_5xx():
    class Broken:
        def __getattr__(self, _):
            raise ConnectionError("mongo down")

    app.dependency_overrides[directory_api._db] = lambda: Broken()
    try:
        client = TestClient(app)
        assert client.get("/api/assessments").status_code == 500
        assert client.get("/api/candidates").status_code == 500
    finally:
        app.dependency_overrides.pop(directory_api._db, None)
