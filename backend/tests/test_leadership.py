"""Leadership is read-only, tenant-isolated, and honest about timing evidence."""
from datetime import datetime, timedelta, timezone

import mongomock_motor
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.security.deps import get_db
from app.security.roles import get_permissions_for_role
from app.services.leadership import dashboard, distribution, hours
from tests.conftest import auth_headers

STAMP = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)


@pytest.fixture
def db():
    return mongomock_motor.AsyncMongoMockClient()['leadership_test']


async def seed(db):
    await db.jobs.insert_many([
        {'orgId': 'default', 'jobId': 'job-a', 'title': 'Engineer', 'lifecycleStatus': 'OPEN', 'positionsTotal': 5, 'positionsFilled': 1, 'createdAt': STAMP-timedelta(days=40)},
        {'orgId': 'default', 'jobId': 'job-b', 'title': 'Designer', 'lifecycleStatus': 'ARCHIVED', 'positionsTotal': 2},
        {'orgId': 'other', 'jobId': 'secret', 'title': 'PRIVATE OTHER ORG', 'lifecycleStatus': 'OPEN'},
    ])
    await db.applications.insert_many([
        {'orgId': 'default', 'jobId': 'job-a', 'applicationId': 'a', 'currentStage': 'HR_ROUND', 'createdAt': STAMP-timedelta(days=10), 'intakeItemId': 'i',
         'assessment': {'sentAt': STAMP-timedelta(days=7), 'startedAt': STAMP-timedelta(days=7,hours=-6), 'submittedAt': STAMP-timedelta(days=6), 'score': 0, 'link': 'PRIVATE LINK', 'password': 'PRIVATE PASSWORD'}},
        {'orgId': 'default', 'jobId': 'job-a', 'applicationId': 'b', 'currentStage': 'HR_ROUND', 'createdAt': STAMP-timedelta(days=8)},
        {'orgId': 'default', 'jobId': 'job-a', 'applicationId': 'c', 'currentStage': 'ASSESSMENT_COMPLETED', 'createdAt': STAMP-timedelta(days=4),
         'assessment': {'sentAt': STAMP-timedelta(days=3), 'submittedAt': STAMP-timedelta(days=2), 'score': 75}},
        {'orgId': 'default', 'jobId': 'job-b', 'applicationId': 'd', 'currentStage': 'HIRED', 'createdAt': STAMP-timedelta(days=50)},
        {'orgId': 'other', 'jobId': 'secret', 'applicationId': 'x', 'currentStage': 'HR_ROUND', 'createdAt': STAMP},
    ])
    await db.resume_intake_items.insert_many([
        {'orgId': 'default', 'jobId': 'job-a', 'intakeItemId': 'i', 'createdAt': STAMP-timedelta(days=10), 'status': 'completed', 'atsState': 'done', 'profile': {'email': 'PRIVATE EMAIL'}},
        {'orgId': 'default', 'jobId': 'job-a', 'intakeItemId': 'deleted', 'createdAt': STAMP, 'status': 'deleted'},
    ])
    await db.stage_history.insert_many([
        {'applicationId': 'a', 'toStage': 'ASSESSMENT_COMPLETED', 'transitionAt': STAMP-timedelta(days=6)},
        {'applicationId': 'a', 'toStage': 'HR_ROUND', 'transitionAt': STAMP-timedelta(days=3)},
        {'applicationId': 'a', 'orgId': 'other', 'toStage': 'HR_ROUND', 'transitionAt': STAMP-timedelta(hours=1)},
        {'applicationId': 'b', 'toStage': 'HR_ROUND', 'transitionAt': STAMP-timedelta(days=4)},
    ])
    await db.recruit_reviews.insert_many([
        {'orgId': 'default', 'applicationId': 'a', 'round': 'managerial', 'decision': 'advance', 'applied': True, 'createdAt': STAMP-timedelta(days=4), 'comments': 'PRIVATE REVIEW'},
        {'orgId': 'default', 'applicationId': 'b', 'round': 'managerial', 'decision': 'advance', 'applied': True, 'createdAt': STAMP-timedelta(days=4)},
        {'orgId': 'other', 'applicationId': 'b', 'round': 'managerial', 'decision': 'advance', 'applied': True, 'createdAt': STAMP-timedelta(hours=1)},
    ])
    await db.recruit_interviews.insert_many([
        {'orgId': 'default', 'jobId': 'job-a', 'applicationId': 'a', 'round': 'hr', 'status': 'scheduled', 'createdAt': STAMP-timedelta(days=3), 'startsAt': STAMP+timedelta(days=5)},
        {'orgId': 'default', 'jobId': 'job-a', 'applicationId': 'b', 'round': 'hr', 'status': 'cancelled', 'createdAt': STAMP-timedelta(days=3)},
    ])


@pytest.mark.asyncio
async def test_snapshot_timing_and_no_candidate_data(db):
    await seed(db)
    result = await dashboard(db, 'default', stamp=STAMP)
    assert result['summary']['openRoles'] == 1
    assert result['summary']['openPositions'] == 4
    assert result['summary']['resumesUploaded'] == 4  # Intake + 3 pre-intake applications.
    assert result['summary']['assessmentsCompleted'] == 2  # Score zero counts.
    assert result['summary']['resumesInWindow'] == 3
    assert sum(row['resumes'] for row in result['trend']) == 3
    assert sum(row['assessments'] for row in result['trend']) == 2  # Includes a submission without stage history.
    timing = {row['key']: row for row in result['timing']}
    assert timing['assessmentResponse']['medianHours'] == 6
    assert timing['assessmentResponse']['samples'] == 1
    assert timing['assessmentResponse']['eligible'] == 2
    assert timing['hrScheduling']['medianHours'] == 24  # Created date, not interview start.
    assert timing['hrScheduling']['waiting'] == 1
    assert timing['hrScheduling']['overdue'] == 1
    assert timing['hrScheduling']['samples'] == 1
    hr = next(row for row in result['aging'] if row['key'] == 'hr')
    assert hr['over72'] == 2  # Foreign org event cannot reset age.
    encoded = str(result)
    assert 'PRIVATE' not in encoded and 'password' not in encoded
    assert len(result['roles']) == 2


@pytest.mark.asyncio
async def test_live_workflow_stages_and_provider_dates_reconcile_per_role(db):
    await seed(db)
    await db.applications.update_one({'applicationId': 'a'}, {'$set': {
        'assessment.submittedAt': STAMP-timedelta(days=5), 'assessment.submissionTimeSource': 'provider'}})
    for stage in ['RESUME_UPLOADED', 'REJECTION_PENDING_HR_REVIEW', 'TALENT_POOL']:
        await db.applications.insert_one({'orgId': 'default', 'jobId': 'job-a',
            'applicationId': stage, 'currentStage': stage, 'createdAt': STAMP})
    await db.applications.insert_one({'orgId': 'default', 'jobId': 'job-a', 'applicationId': 'started',
        'currentStage': 'ASSESSMENT_SENT', 'assessment': {'sentAt': STAMP-timedelta(days=2), 'state': 'in_progress'}})
    result = await dashboard(db, 'default', stamp=STAMP)
    counts = {row['key']: row['count'] for row in result['stages']}
    assert counts['resume'] == counts['rejectionReview'] == counts['talentPool'] == 1
    assert counts['rejected'] == counts['other'] == 0
    assert all(count == sum(role['stages'][key] for role in result['roles']) for key, count in counts.items())
    trend = {row['date']: row['assessments'] for row in result['trend']}
    assert trend['2026-11-04'] == 1 and trend['2026-11-03'] == 0
    assert sum(trend.values()) == result['summary']['assessmentsCompleted'] == 2
    assert result['timing'][0]['waiting'] == 0  # A known start with no clock time is already attempted.


@pytest.mark.asyncio
async def test_period_only_changes_activity_and_timing_cohort(db):
    await seed(db)
    result = await dashboard(db, 'default', days=7, job_id='job-a', stamp=STAMP)
    assert result['summary']['resumesUploaded'] == 3
    assert result['summary']['resumesInWindow'] == 1
    assert result['timing'][0]['eligible'] == 1  # Seven calendar days, not rolling 168h.
    assert result['timing'][0]['samples'] == 0
    assert result['timing'][0]['medianHours'] is None
    assert len(result['roles']) == 1
    with pytest.raises(Exception) as error:
        await dashboard(db, 'default', job_id='secret', stamp=STAMP)
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_repeated_approval_uses_latest_and_unknown_history_stays_unknown(db):
    await seed(db)
    await db.recruit_reviews.insert_one({'orgId': 'default', 'applicationId': 'a', 'round': 'managerial', 'decision': 'advance', 'applied': True, 'createdAt': STAMP-timedelta(days=1)})
    result = await dashboard(db, 'default', stamp=STAMP)
    metric = next(row for row in result['timing'] if row['key'] == 'hrScheduling')
    assert metric['samples'] == 0 and metric['waiting'] == 2 and metric['overdue'] == 1
    assert next(row for row in result['aging'] if row['key'] == 'assessment')['unknown'] == 1


def test_percentiles_and_invalid_dates():
    assert distribution([0,10,20,30])['medianHours'] == 15
    assert distribution([0,10,20,30])['p90Hours'] == 27
    assert distribution([])['medianHours'] is None
    assert hours('invalid', STAMP) is None
    assert hours(STAMP, STAMP-timedelta(hours=1)) is None


def test_leadership_role_permissions_and_api_guards(db):
    assert get_permissions_for_role('leadership') == frozenset({'leadership.view', 'google.connect'})
    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as client:
            headers = auth_headers(role='leadership')
            response = client.get('/api/leadership/dashboard', headers=headers)
            assert response.status_code == 200, response.text
            assert response.headers['Cache-Control'] == 'no-store'
            for period in [7, 30, 90, 180]:
                assert client.get(f'/api/leadership/dashboard?days={period}', headers=headers).status_code == 200
            assert client.get('/api/leadership/dashboard').status_code == 401
            for role in ['hr','recruiter','viewer','technical_interviewer','managerial_interviewer']:
                assert client.get('/api/leadership/dashboard', headers=auth_headers(role=role)).status_code == 403
            for path in ['/api/users', '/api/jobs', '/api/applicants', '/api/applications', '/api/diagnostics', '/api/recruitment/applications']:
                assert client.get(path, headers=headers).status_code == 403, path
            assert client.get('/api/leadership/dashboard?days=365', headers=headers).status_code == 422
            assert client.get('/api/leadership/dashboard?jobId=%24ne', headers=headers).status_code == 422
            invitation = client.post('/api/users', headers=auth_headers(role='admin'), json={'email':'leader@example.test', 'name':'Leader', 'role':'leadership'})
            assert invitation.status_code == 201, invitation.text
            assert invitation.json()['user']['role'] == 'leadership'
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_record_caps_are_disclosed(db, monkeypatch):
    from app.models import leadership as repository
    await seed(db)
    monkeypatch.setattr(repository, 'RECORD_LIMIT', 1)
    result = await dashboard(db, 'default', stamp=STAMP)
    assert result['quality']['limited'] is True
    assert result['quality']['applicationsAnalyzed'] == 1
    assert result['summary']['resumesUploaded'] == 4  # Snapshot not limited by timing cap.


@pytest.mark.asyncio
async def test_dashboard_real_postgres_when_validation_is_enabled():
    from tests.postgres_support import validation_database, dispose
    database = validation_database()
    if database is None:
        pytest.skip('Explicit private PostgreSQL validation environment required')
    try:
        await seed(database)
        result = await dashboard(database, 'default', stamp=STAMP)
        assert result['summary']['resumesUploaded'] == 4
        assert result['summary']['assessmentsCompleted'] == 2
        assert result['summary']['linksUnsent'] == 0
        assert next(row for row in result['timing'] if row['key'] == 'hrScheduling')['medianHours'] == 24
        assert 'PRIVATE' not in str(result)
    finally:
        dispose(database)
