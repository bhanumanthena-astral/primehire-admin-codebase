"""Jobs specification regressions: local import, roles, lifecycle, conflicts."""
import io
import pytest
import mongomock_motor
from docx import Document
from fastapi.testclient import TestClient
from app.main import app
from app.security.deps import get_db
from app.services.jd_local import extract_local_fields
from app.services.job_intake import intake_error
from app.services.jd_validate import sanitize_jd_html
from tests.conftest import auth_headers, post_job, job_payload, ensure_user


@pytest.fixture
def client():
    db = mongomock_motor.AsyncMongoMockClient()['jobs_completion']
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


def test_local_conflicts_and_missing():
    parsed = extract_local_fields('Job Title: Engineer\nJob Title: Manager\nExperience: 2–5 years\nPython and SQL')
    assert 'jobTitle' not in parsed
    assert parsed['minExperience'] == '2'
    assert parsed['keywords'] == ['Python', 'SQL']
    assert 'assigneeText' not in parsed
    assert parsed['warnings']


def test_sanitizer():
    html = sanitize_jd_html('<h2>Role</h2><script>alert(1)</script><p onclick="x">Build &amp; test</p><a href="javascript:x">Link</a>')
    assert 'script' not in html and 'onclick' not in html and 'javascript' not in html
    assert '<h2>Role</h2>' in html and '&amp;' in html


@pytest.mark.parametrize('status', ['DRAFT','ON_HOLD','CLOSED','ARCHIVED'])
def test_intake_blocks_non_open(status):
    assert intake_error({'lifecycleStatus':status})


def test_publish_hold_resume_and_conflict(client):
    headers = auth_headers()
    job = post_job(client, headers, headers, 'COMPLETE-1')
    path = f'/api/jobs/{job["jobId"]}'
    for state in ['OPEN','ON_HOLD','OPEN']:
        result = client.post(path+'/lifecycle', json={'status':state}, headers=headers)
        assert result.status_code == 200, result.text
        assert result.json()['lifecycleStatus'] == state
    stale = client.put(path, json={'keywords':['Java'], 'expectedUpdatedAt':job['updatedAt']}, headers=headers)
    assert stale.status_code == 409
    assert client.get(path, headers=headers).json()['keywords'] != ['Java']


def test_viewer_and_recruiter_permissions(client):
    admin = auth_headers()
    job = post_job(client, admin, admin, 'COMPLETE-2')
    viewer = auth_headers(role='viewer', user_id=job['assigneeUserId'])
    recruiter = auth_headers(role='recruiter', user_id=job['assigneeUserId'])
    assert client.get('/api/jobs', headers=viewer).status_code == 200
    assert client.get(f'/api/jobs/{job["jobId"]}/detail', headers=viewer).json()['applications'] == []
    assert client.post(f'/api/jobs/{job["jobId"]}/lifecycle', json={'status':'OPEN'}, headers=viewer).status_code == 403
    assert client.post(f'/api/jobs/{job["jobId"]}/lifecycle', json={'status':'OPEN'}, headers=recruiter).status_code == 403
    assert client.get('/api/jobs', headers=auth_headers(org_id='other')).json() == []


def test_upload_never_calls_llm(client, monkeypatch):
    import app.services.llm.jd_extract as jd_provider
    async def forbidden(*args, **kwargs):
        raise AssertionError('JD import must never call a model')
    monkeypatch.setattr(jd_provider, 'extract_jd_fields', forbidden)
    doc = Document()
    doc.add_paragraph('Job Title: Backend Engineer')
    doc.add_paragraph('Company Name: Demo Labs')
    doc.add_paragraph('Minimum Experience: 2')
    doc.add_paragraph('Maximum Experience: 5')
    doc.add_paragraph('Job Description: Build reliable Python and SQL services with automated testing for the platform team.')
    buf = io.BytesIO(); doc.save(buf)
    result = client.post('/api/jobs/parse-jd', data={'mode':'document'},
        files={'file':('job.docx',buf.getvalue(),'application/octet-stream')}, headers=auth_headers())
    assert result.status_code == 200, result.text
    parsed = result.json()
    assert parsed['templateVersion'] == 'local-v1'
    assert parsed['review']['values']['title'] == 'Backend Engineer'
    assert 'assigneeUserId' in parsed['review']['missingFields']
    assert parsed['aiExtract'] is None
    assert client.get('/api/jobs', headers=auth_headers()).json() == []


def test_generated_reference_and_retry_idempotency(client):
    headers = auth_headers()
    owner = ensure_user(client, headers)
    payload = job_payload(assignee_user_id=owner)
    payload.pop('jobKey')
    headers['Idempotency-Key'] = 'same-human-submission'
    first = client.post('/api/jobs', json=payload, headers=headers)
    second = client.post('/api/jobs', json=payload, headers=headers)
    assert first.status_code == second.status_code == 201
    assert first.json()['jobId'] == second.json()['jobId']
    assert first.json()['jobKey'].startswith('JOB-')
    assert len(client.get('/api/jobs', headers=headers).json()) == 1
    changed = client.post('/api/jobs', json={**payload,'title':'Different Engineer'}, headers=headers)
    assert changed.status_code == 409


def test_search_modes_and_owner_name(client):
    headers = auth_headers()
    post_job(client, headers, headers, 'SEARCH-A', 'Backend Engineer')
    post_job(client, headers, headers, 'SEARCH-B', 'Senior Backend Engineer', jobRole='Platform Engineer')
    assert len(client.get('/api/jobs?q=Backend&searchMode=starts_with', headers=headers).json()) == 1
    assert len(client.get('/api/jobs?q=Backend&searchMode=contains', headers=headers).json()) == 2
    assert len(client.get('/api/jobs?q=Backend Engineer&searchMode=exact', headers=headers).json()) == 1
    assert len(client.get('/api/jobs?q=Assignee', headers=headers).json()) == 2


@pytest.mark.asyncio
async def test_utc_auto_close_does_not_reinterpret_organization_timezone():
    from datetime import datetime, timezone
    from app.services.auto_close import auto_close_due_jobs
    db = mongomock_motor.AsyncMongoMockClient()['utc_close']
    await db['organizations'].insert_one({'orgId':'india','settings':{'timezone':'Asia/Kolkata'}})
    await db['jobs'].insert_one({'orgId':'india','jobId':'utc-job','lifecycleStatus':'OPEN',
        'datesVersion':'utc-v1','closesAt':datetime(2026,10,13,13,tzinfo=timezone.utc)})
    early = await auto_close_due_jobs(db, now=datetime(2026,10,13,12,tzinfo=timezone.utc))
    assert early['closed'] == 0
    due = await auto_close_due_jobs(db, now=datetime(2026,10,13,13,tzinfo=timezone.utc))
    assert due['closed'] == 1


@pytest.mark.asyncio
async def test_date_migration_preserves_legacy_boundary_and_is_idempotent():
    import importlib
    from datetime import datetime, timezone
    migration = importlib.import_module('migrations.versions.004_jobs_completion')
    db = mongomock_motor.AsyncMongoMockClient()['date_migration']
    await db['organizations'].insert_one({'orgId':'india','settings':{'timezone':'Asia/Kolkata'}})
    await db['jobs'].insert_one({'orgId':'india','jobId':'old', 'closesAt':datetime(2026,10,13,13,tzinfo=timezone.utc)})
    first = await migration.upgrade(db)
    second = await migration.upgrade(db)
    job = await db['jobs'].find_one({'jobId':'old'})
    assert first['normalizedLegacyDates'] == 1 and second['normalizedLegacyDates'] == 0
    assert job['closesAt'].hour == 7 and job['closesAt'].minute == 30
    assert job['datesVersion'] == 'utc-v1'


@pytest.mark.asyncio
async def test_migration_dry_run_never_writes():
    from migrations.runner import run_migrations
    db = mongomock_motor.AsyncMongoMockClient()['migration_dry']
    await db['jobs'].insert_one({'orgId':'default','jobId':'old'})
    result = await run_migrations(db, dry_run=True)
    assert any(r['version'] == '004_jobs_completion' for r in result)
    assert 'datesVersion' not in await db['jobs'].find_one({'jobId':'old'})
    assert await db['migrations'].count_documents({}) == 0


@pytest.mark.asyncio
async def test_application_total_and_pagination_are_not_truncated(client):
    from datetime import datetime, timezone
    headers = auth_headers()
    job = post_job(client, headers, headers, 'PAGED-JOB')
    db = app.dependency_overrides[get_db]()
    async def seed():
        await db['applications'].insert_many([{'orgId':'default','jobId':job['jobId'],
            'applicationId':f'application-{i:03}', 'applicantId':f'applicant-{i:03}',
            'status':'active','currentStage':'PARSED','createdAt':datetime(2026,1,1,tzinfo=timezone.utc)} for i in range(205)])
    await seed()
    first = client.get(f'/api/jobs/{job["jobId"]}/detail',headers=headers).json()
    second = client.get(f'/api/jobs/{job["jobId"]}/detail?applicationsSkip=20',headers=headers).json()
    assert first['counts']['total'] == 205 and first['counts']['active'] == 205
    assert len(first['applications']) == len(second['applications']) == 20
    assert {a['applicationId'] for a in first['applications']}.isdisjoint(a['applicationId'] for a in second['applications'])
    counts = client.get('/api/jobs/application-counts',params={'jobIds':job['jobId']},headers=headers).json()['counts']
    assert counts[job['jobId']] == 205


def test_unzoned_api_dates_use_organization_timezone(client):
    headers = auth_headers()
    owner = ensure_user(client, headers)
    payload = job_payload(assignee_user_id=owner, openedAt='2026-01-01T09:00:00',closesAt='2027-12-31T18:00:00')
    created = client.post('/api/jobs',json=payload,headers=headers)
    assert created.status_code == 201
    assert created.json()['openedAt'].startswith('2026-01-01T03:30:00')
    assert created.json()['closesAt'].startswith('2027-12-31T12:30:00')
