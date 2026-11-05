"""Shared pytest fixtures: in-memory Mongo (mongomock-motor), no Atlas needed."""

import pytest
import mongomock_motor
import asyncio
import inspect
from app.config import settings
from app.security.tokens import create_access_token


@pytest.fixture(autouse=True)
def synchronous_fixture_loop(request):
    """Own the loop used by legacy synchronous Mongo seed helpers.

    pytest-asyncio 1.x no longer leaves a main-thread loop behind after async
    tests. Async tests retain the plugin's loop and its lifecycle unchanged.
    """
    if inspect.iscoroutinefunction(request.node.obj):
        yield
        return
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        yield
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()
        asyncio.set_event_loop(None)


@pytest.fixture()
def db():
    import os
    if os.environ.get('ELITEHR_TEST_POSTGRES_ENV'):
        from tests.postgres_support import validation_database, dispose
        database = validation_database()
        try:
            yield database
        finally:
            dispose(database)
    else:
        yield mongomock_motor.AsyncMongoMockClient()["testdb"]


@pytest.fixture(autouse=True)
def postgres_repository_compatibility(request, monkeypatch):
    """Opt-in replay of existing mock-seeded workflows against real PostgreSQL.

    Reference-comparison tests keep their independent mongomock oracle. Each
    replay uses a generated schema in the dedicated validation database only.
    """
    import os
    if (os.environ.get('ELITEHR_TEST_POSTGRES_COMPAT') != '1'
            or request.node.module.__name__.endswith('test_postgresql_v2')):
        yield
        return
    if not os.environ.get('ELITEHR_TEST_POSTGRES_ENV'):
        raise RuntimeError('PostgreSQL workflow replay needs the validation environment')
    from tests.postgres_support import validation_database, dispose
    databases = []
    class Client:
        def __init__(self, *args, **kwargs): self.databases = {}
        def __getitem__(self, name):
            if name not in self.databases:
                database = validation_database()
                database.name = name
                self.databases[name] = database
                databases.append(database)
            return self.databases[name]
        def __getattr__(self, name): return self[name]
        def get_database(self, name): return self[name]
        def close(self): pass
    monkeypatch.setattr(mongomock_motor, 'AsyncMongoMockClient', Client)
    try:
        yield
    finally:
        for database in databases:
            dispose(database)


@pytest.fixture(autouse=True)
def ensure_jwt_secret(monkeypatch):
    if not settings.jwt_secret or len(settings.jwt_secret) < 32:
        monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture(autouse=True)
def hermetic_llm_config(monkeypatch):
    """Tests never touch the real provider: blank ambient LLM credentials.

    A local backend/.env may hold a real OPENROUTER key (developer drills);
    without this guard every suite would spend quota and flake on 429s.
    Tests needing the LLM set key/model explicitly (or use the fake mode).
    """
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "openrouter_model", "")
    monkeypatch.setattr(settings, "resume_ats_model", "")
    monkeypatch.setattr(settings, "llm_fake_provider", "off")
    # Local PostgreSQL testing reuses real configured providers. Regression
    # tests must still remain hermetic; explicit synthetic test kwargs win.
    for field in ['primehire_access_key','primehire_secret_key','zeptomail_api_key','recruitment_zeptomail_api_key']:
        monkeypatch.setattr(settings,field,'')
        monkeypatch.setenv(field.upper(),'')
    monkeypatch.setattr(settings, "google_oauth_enabled", False)
    # Settings() constructed inside tests must not re-read the workstation's
    # newly enabled OAuth client from backend/.env. Explicit test kwargs win.
    monkeypatch.setenv('GOOGLE_OAUTH_ENABLED', 'false')
    for name in ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY']:
        monkeypatch.setenv(name, '')


@pytest.fixture(autouse=True)
def hermetic_database_config(monkeypatch):
    """TestClient startup must never connect to an ambient developer database."""
    monkeypatch.setattr(settings, "mongodb_uri", "")
    monkeypatch.setattr(settings, "database_backend", "mongodb")
    monkeypatch.setattr(settings, "postgres_url", "")
    monkeypatch.setenv('DATABASE_BACKEND','mongodb')
    monkeypatch.setenv('POSTGRES_URL','')
    for field in ['resume_module_v2_enabled','recruitment_portals_enabled','free_tier_guard_enabled','resume_kafka_enabled']:
        monkeypatch.setattr(settings,field,False)
        monkeypatch.setenv(field.upper(),'false')


@pytest.fixture()
def legacy_matching_intent(monkeypatch):
    """Opt in only legacy engine tests to matching, beyond parse-only intake.

    This seeds the persisted intent that a later explicit matching operation
    would supply. Production upload behavior and Module 2 remain unchanged.
    """
    from app.models.resume import ResumeFileRepository
    original = ResumeFileRepository.create
    async def matching_file(self, doc):
        return await original(self, {**doc, 'processingMode': 'matching'})
    monkeypatch.setattr(ResumeFileRepository, 'create', matching_file)


def auth_headers(role: str = "super_admin", user_id: str = "test-user", org_id: str = "default") -> dict[str, str]:
    """Helper returning Bearer authorization headers for test requests."""
    token = create_access_token(
        user_id=user_id,
        org_id=org_id,
        role=role,
        session_id="test-session",
    )
    return {"Authorization": f"Bearer {token}"}


def job_payload(job_key: str = "JOB-1", title: str = "Backend Dev",
                assignee_user_id: str | None = None, **overrides) -> dict:
    """Valid PRD requisition payload for POST /api/jobs (Slice 1 schema).

    Pass a real user id from ensure_user() — the API rejects unknown or
    deactivated assignees (PRD §21). Tests asserting 422 on OTHER fields
    may pass any string here only when the guard under test runs first
    (e.g. role-denied 403s).
    """
    payload = {
        "jobKey": job_key,
        "title": title,
        "companyName": "Elite HR",
        "jobRole": "Backend Engineer",
        "department": "Engineering",
        "minExperienceYears": 2,
        "maxExperienceYears": 5,
        "positionsTotal": 2,
        "keywords": ["Python", "SQL"],
        "closesAt": "2027-12-31T00:00:00Z",
        "assigneeUserId": assignee_user_id or "missing-assignee",
        "jdHtml": "<p>We are hiring a backend engineer with Python and SQL experience for our platform team.</p>",
    }
    payload.update(overrides)
    return payload


def ensure_user(client, sa_headers: dict, email: str | None = None, role: str = "hr") -> str:
    """Create a real org user via the API; returns its userId for assignee tests."""
    import uuid as _uuid

    res = client.post("/api/users", json={
        "email": email or f"assignee-{_uuid.uuid4().hex[:8]}@test.com",
        "name": "Assignee",
        "role": role,
    }, headers=sa_headers)
    assert res.status_code == 201, res.text
    return res.json()["user"]["userId"]


def ensure_hr_owner(client, sa_headers=None) -> str:
    """Persist the actor used by synthetic HR JWTs, so ownership is real."""
    from app.security.deps import get_db
    async def persist():
        database = client.app.dependency_overrides[get_db]()
        await database['users'].update_one({'userId':'test-user', 'orgId':'default'},
            {'$setOnInsert':{'email':'actor@example.test','name':'HR actor','role':'hr',
                            'isActive':True,'passwordHash':''}}, upsert=True)
    if client.portal:
        client.portal.call(persist)
    else:
        with client._portal_factory() as portal:
            portal.call(persist)
    return 'test-user'


def post_job(client, job_headers: dict, sa_headers: dict, job_key: str,
             title: str = "Backend Dev", **overrides) -> dict:
    """Create a job with a real assignee user; asserts 201. For negative
    tests, build the payload with job_payload() + ensure_user() instead."""
    uid = ensure_user(client, sa_headers)
    res = client.post("/api/jobs", json=job_payload(job_key, title, uid, **overrides),
                      headers=job_headers)
    assert res.status_code == 201, res.text
    return res.json()
