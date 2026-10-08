"""Mail templates API: shared server-truth storage for all users."""

import asyncio

import mongomock_motor
from fastapi.testclient import TestClient

import app.api.templates as templates_api
from app.main import app


def _get(db, path):
    app.dependency_overrides[templates_api._db] = lambda: db
    try:
        return TestClient(app).get(path)
    finally:
        app.dependency_overrides.pop(templates_api._db, None)


def _send(db, method, path, body=None):
    app.dependency_overrides[templates_api._db] = lambda: db
    try:
        client = TestClient(app)
        if method == "POST":
            return client.post(path, json=body)
        return client.put(path, json=body)
    finally:
        app.dependency_overrides.pop(templates_api._db, None)


def _db():
    return mongomock_motor.AsyncMongoMockClient()["t"]


def test_empty_list():
    res = _get(_db(), "/api/templates")
    assert res.status_code == 200
    assert res.json() == {"items": [], "total": 0}


def test_create_and_list_roundtrip():
    db = _db()
    res = _send(db, "POST", "/api/templates", {
        "id": "tpl-invite", "name": "Invite", "type": "STANDARD_INVITATION",
        "subject": "Hi", "body": "Hello {{candidate_name}}",
    })
    assert res.status_code == 201
    body = res.json()
    assert body["id"] == "tpl-invite"
    assert body["name"] == "Invite"
    assert "_id" not in body

    listed = _get(db, "/api/templates").json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == "tpl-invite"


def test_duplicate_id_409():
    db = _db()
    payload = {"id": "tpl-x", "name": "X", "type": "CUSTOM",
               "subject": "s", "body": "b"}
    assert _send(db, "POST", "/api/templates", payload).status_code == 201
    res = _send(db, "POST", "/api/templates", payload)
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "DUPLICATE_KEY"


def test_update_existing():
    db = _db()
    _send(db, "POST", "/api/templates", {
        "id": "tpl-x", "name": "X", "type": "CUSTOM", "subject": "s", "body": "b"})
    res = _send(db, "PUT", "/api/templates/tpl-x", {"subject": "New subject"})
    assert res.status_code == 200
    assert res.json()["subject"] == "New subject"
    assert res.json()["body"] == "b"  # untouched fields preserved


def test_update_missing_404():
    res = _send(_db(), "PUT", "/api/templates/tpl-nope", {"subject": "s"})
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "TEMPLATE_NOT_FOUND"


def test_get_single_by_public_id():
    db = _db()
    _send(db, "POST", "/api/templates", {
        "id": "tpl-custom-1", "name": "C", "type": "CUSTOM",
        "subject": "Hi", "body": "Hello {{candidate_name}}, {{link}} {{password}}"})
    res = _get(db, "/api/templates/tpl-custom-1")
    assert res.status_code == 200
    assert res.json()["id"] == "tpl-custom-1"
    assert "{{candidate_name}}" in res.json()["body"]
    assert "{{link}}" in res.json()["body"]
    assert "{{password}}" in res.json()["body"]


def test_get_single_by_mongo_id():
    """The mongoId from a create response resolves the same document."""
    db = _db()
    created = _send(db, "POST", "/api/templates", {
        "id": "tpl-custom-2", "name": "C", "type": "CUSTOM",
        "subject": "Hi", "body": "b"}).json()
    res = _get(db, f"/api/templates/{created['mongoId']}")
    assert res.status_code == 200
    assert res.json()["id"] == "tpl-custom-2"
    assert res.json()["mongoId"] == created["mongoId"]


def test_get_single_missing_404_not_500():
    res = _get(_db(), "/api/templates/tpl-nope")
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "TEMPLATE_NOT_FOUND"


def test_update_by_mongo_id_same_doc_no_duplicate():
    """PUT with the create-response mongoId updates the same document."""
    db = _db()
    created = _send(db, "POST", "/api/templates", {
        "id": "tpl-custom-3", "name": "C", "type": "CUSTOM",
        "subject": "s", "body": "Hello {{candidate_name}}"}).json()
    res = _send(db, "PUT", f"/api/templates/{created['mongoId']}",
                {"subject": "New subject"})
    assert res.status_code == 200
    assert res.json()["id"] == "tpl-custom-3"
    assert res.json()["subject"] == "New subject"
    assert res.json()["body"] == "Hello {{candidate_name}}"
    assert _get(db, "/api/templates").json()["total"] == 1


def test_create_validation_422():
    res = _send(_db(), "POST", "/api/templates", {"name": "No id"})
    assert res.status_code == 422


def test_seed_two_defaults_visible_to_all():
    """Two users (two reads) see the same server list after seeding."""
    db = _db()
    for tpl in ({"id": "tpl-invite", "name": "I", "type": "STANDARD_INVITATION",
                 "subject": "s", "body": "b"},
                {"id": "tpl-reminder", "name": "R", "type": "REMINDER",
                 "subject": "s", "body": "b"}):
        assert _send(db, "POST", "/api/templates", tpl).status_code == 201
    first = _get(db, "/api/templates").json()
    second = _get(db, "/api/templates").json()
    assert first == second
    assert {t["id"] for t in first["items"]} == {"tpl-invite", "tpl-reminder"}


def test_delete_existing():
    db = _db()
    _send(db, "POST", "/api/templates", {
        "id": "tpl-gone", "name": "G", "type": "CUSTOM", "subject": "s", "body": "b"})
    app.dependency_overrides[templates_api._db] = lambda: db
    try:
        res = TestClient(app).delete("/api/templates/tpl-gone")
    finally:
        app.dependency_overrides.pop(templates_api._db, None)
    assert res.status_code == 200
    assert res.json() == {"deleted": "tpl-gone"}
    assert _get(db, "/api/templates").json()["total"] == 0


def test_delete_missing_404():
    app.dependency_overrides[templates_api._db] = lambda: _db()
    try:
        res = TestClient(app).delete("/api/templates/tpl-nope")
    finally:
        app.dependency_overrides.pop(templates_api._db, None)
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "TEMPLATE_NOT_FOUND"


def test_mongo_failure_controlled_5xx():
    class Broken:
        def __getattr__(self, _):
            raise ConnectionError("mongo down")

    app.dependency_overrides[templates_api._db] = lambda: Broken()
    try:
        res = TestClient(app).get("/api/templates")
    finally:
        app.dependency_overrides.pop(templates_api._db, None)
    assert res.status_code == 500
    assert "Traceback" not in res.text
