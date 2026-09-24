"""Candidate write API: create/read/update/delete/bulk, conflict + validation guards."""

import mongomock_motor
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.api.candidates as candidates_api
from app.main import app


def _fresh_db():
    return mongomock_motor.AsyncMongoMockClient()["t"]


def _valid_candidate(**over):
    body = {
        "assessmentId": "JOB-1",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "phone": "1234567890",
        "startTime": "2026-01-01T09:00:00Z",
        "endTime": "2026-01-04T09:00:00Z",
    }
    body.update(over)
    return body


def test_create_assigns_key_and_quarantines_mock():
    db = _fresh_db()
    app.dependency_overrides[candidates_api._db] = lambda: db
    try:
        client = TestClient(app)
        res = client.post("/api/candidates", json=_valid_candidate())
        assert res.status_code == 201, res.text
        doc = res.json()
        assert doc["candidateKey"].startswith("CAND-")
        assert doc["isMock"] is True  # no PrimeHire linkage -> quarantined
        assert doc["id"]  # mongo ObjectId string, never the UI id
        assert "password" not in res.text and "rowLoading" not in res.text
    finally:
        app.dependency_overrides.pop(candidates_api._db, None)


def test_create_duplicate_key_conflicts():
    db = _fresh_db()
    app.dependency_overrides[candidates_api._db] = lambda: db
    try:
        client = TestClient(app)
        first = client.post("/api/candidates", json=_valid_candidate(candidateKey="CAND-X1"))
        assert first.status_code == 201, first.text
        dup = client.post("/api/candidates", json=_valid_candidate(candidateKey="CAND-X1"))
        assert dup.status_code == 409
        assert dup.json()["detail"]["code"] == "DUPLICATE_KEY"
    finally:
        app.dependency_overrides.pop(candidates_api._db, None)


def test_create_rejects_password_and_row_loading():
    db = _fresh_db()
    app.dependency_overrides[candidates_api._db] = lambda: db
    try:
        client = TestClient(app)
        assert client.post("/api/candidates",
                           json=_valid_candidate(password="x")).status_code == 422
        assert client.post("/api/candidates",
                           json=_valid_candidate(rowLoading=True)).status_code == 422
    finally:
        app.dependency_overrides.pop(candidates_api._db, None)


def test_get_update_delete_roundtrip():
    db = _fresh_db()
    app.dependency_overrides[candidates_api._db] = lambda: db
    try:
        client = TestClient(app)
        created = client.post("/api/candidates", json=_valid_candidate()).json()
        key = created["candidateKey"]

        got = client.get(f"/api/candidates/{key}")
        assert got.status_code == 200 and got.json()["email"] == "ada@example.com"
        assert client.get("/api/candidates/CAND-NOPE").status_code == 404

        upd = client.put(f"/api/candidates/{key}", json={
            "status": "INACTIVE",
            "phone": "999",
            "syncState": {"inviteSent": True, "reminderCount": 2},
            "primehire": {"interviewId": "iv-9"},
        })
        assert upd.status_code == 200, upd.text
        body = upd.json()
        assert body["status"] == "INACTIVE" and body["phone"] == "999"
        assert body["name"] == "Ada Lovelace"  # untouched fields preserved
        assert body["syncState"]["inviteSent"] is True
        assert body["primehire"]["interviewId"] == "iv-9"

        assert client.put("/api/candidates/CAND-NOPE", json={"status": "ACTIVE"}).status_code == 404
        assert client.put(f"/api/candidates/{key}", json={"password": "x"}).status_code == 422

        deleted = client.delete(f"/api/candidates/{key}")
        assert deleted.status_code == 200 and deleted.json() == {"deleted": key}
        assert client.get(f"/api/candidates/{key}").status_code == 404
        assert client.delete(f"/api/candidates/{key}").status_code == 404
    finally:
        app.dependency_overrides.pop(candidates_api._db, None)


def test_bulk_partial_success():
    db = _fresh_db()
    app.dependency_overrides[candidates_api._db] = lambda: db
    try:
        client = TestClient(app)
        # Malformed rows are rejected at request validation (whole-body 422).
        bad_schema = client.post("/api/candidates/bulk", json={"items": [
            _valid_candidate(email="one@example.com"),
            {"assessmentId": "JOB-1", "name": "No Email"},
        ]})
        assert bad_schema.status_code == 422
        # Well-formed rows get per-item isolation: a duplicate key fails
        # only its own row, the rest are created.
        res = client.post("/api/candidates/bulk", json={"items": [
            _valid_candidate(candidateKey="CAND-DUP", email="one@example.com"),
            _valid_candidate(candidateKey="CAND-DUP", email="two@example.com"),
            _valid_candidate(email="three@example.com"),
        ]})
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["created"] == 2 and body["failed"] == 1
        assert len(body["items"]) == 2 and len(body["errors"]) == 1
        assert body["errors"][0] == {"index": 1, "code": "DUPLICATE_KEY",
                                     "message": "Candidate 'CAND-DUP' already exists."}

        listed = client.get(f"/api/candidates/{body['items'][0]['candidateKey']}").json()
        assert listed["email"] == "one@example.com"
        assert client.get(f"/api/candidates/{body['items'][1]['candidateKey']}").status_code == 200
    finally:
        app.dependency_overrides.pop(candidates_api._db, None)


def test_bulk_empty_and_oversize_rejected():
    db = _fresh_db()
    app.dependency_overrides[candidates_api._db] = lambda: db
    try:
        client = TestClient(app)
        assert client.post("/api/candidates/bulk", json={"items": []}).status_code == 422
        big = {"items": [_valid_candidate(email=f"u{i}@x.com") for i in range(501)]}
        assert client.post("/api/candidates/bulk", json=big).status_code == 422
    finally:
        app.dependency_overrides.pop(candidates_api._db, None)


def test_candidates_mongo_unconfigured_503():
    def _boom():
        raise HTTPException(status_code=503, detail="MongoDB is not configured")

    app.dependency_overrides[candidates_api._db] = _boom
    try:
        client = TestClient(app)
        assert client.post("/api/candidates", json=_valid_candidate()).status_code == 503
        assert client.get("/api/candidates/CAND-X").status_code == 503
    finally:
        app.dependency_overrides.pop(candidates_api._db, None)
