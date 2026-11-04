"""Candidates remain discoverable between interview rounds, before booking."""
from tests.test_recruitment import client, headers, create, review


async def queue(client, round_name, **params):
    response = await client.get('/api/recruitment/applications',
        params={'schedulingRound': round_name, **params}, headers=headers())
    assert response.status_code == 200, response.text
    return response.json()


async def test_each_round_handoff_stays_in_queue_until_scheduled(client, db):
    assert (await queue(client, 'technical'))['total'] == 3
    technical = await create(client)
    assert (await queue(client, 'technical'))['total'] == 2
    assert (await review(client, db, technical)).status_code == 200
    managerial_queue = await queue(client, 'managerial')
    assert [row['applicationId'] for row in managerial_queue['items']] == ['app0']
    assert managerial_queue['items'][0]['latestInterview']['interviewId'] == technical['interviewId']
    managerial = await create(client, round='managerial')
    assert (await queue(client, 'managerial'))['total'] == 0
    assert (await review(client, db, managerial)).status_code == 200
    hr_queue = await queue(client, 'hr', search='Synthetic Candidate 0')
    assert hr_queue['total'] == 1
    row = hr_queue['items'][0]
    assert row['currentStage'] == 'HR_ROUND'
    assert row['activeInterview'] is None
    assert row['latestInterview']['interviewId'] == managerial['interviewId']
    detail = await client.get('/api/recruitment/interviews/' + row['latestInterview']['interviewId'], headers=headers())
    assert detail.status_code == 200
    assert detail.json()['review']['round'] == 'managerial'
    assert detail.json()['previousReviews'][0]['round'] == 'technical'
    tracker = (await client.get('/api/recruitment/tracker', headers=headers())).json()
    assert tracker['schedulingPending'] == {'technical': 2, 'managerial': 0, 'hr': 1}
    hr = await create(client, round='hr')
    assert (await queue(client, 'hr'))['total'] == 0
    tracker = (await client.get('/api/recruitment/tracker', headers=headers())).json()
    assert tracker['stages']['HR_ROUND'] == 1
    assert tracker['schedulingPending']['hr'] == 0
    cancelled = await client.post('/api/recruitment/interviews/' + hr['interviewId'] + '/cancel',
        json={'expectedRevision': hr['revision'], 'reason': 'Candidate requested another interview slot'}, headers=headers())
    assert cancelled.status_code == 200, cancelled.text
    assert (await queue(client, 'hr'))['total'] == 1


async def test_queue_excludes_bookings_before_pagination_and_scopes_org_job_search(client, db):
    from app.models.recruitment import now
    # Use an explicit tied timestamp; real SQL inserts take longer than mock
    # inserts, so relying on all fixtures falling in one millisecond is flaky.
    await db.applications.update_many({'orgId': 'default'}, {'$set': {'currentStage': 'HR_ROUND', 'createdAt': now()}})
    await create(client, round='hr')
    # A booking in another organization must not hide our application.
    await db.recruit_interviews.insert_one({'orgId': 'other', 'applicationId': 'app1', 'status': 'scheduled'})
    result = await queue(client, 'hr', skip=1, limit=1)
    assert result['total'] == 2
    assert [row['applicationId'] for row in result['items']] == ['app2']
    assert (await queue(client, 'hr', search='Candidate 0'))['total'] == 0
    assert (await queue(client, 'hr', jobId='another-job'))['total'] == 0
    assert (await client.get('/api/recruitment/applications?schedulingRound=hr', headers=headers(org='other'))).json()['total'] == 0
    assert (await client.get('/api/recruitment/applications?schedulingRound=invalid', headers=headers())).status_code == 422
    # Scheduling readiness does not grant an unassigned interviewer access.
    assert (await client.get('/api/recruitment/applications?schedulingRound=hr', headers=headers('hr'))).json()['total'] == 0
    recruiter = await client.get('/api/recruitment/applications?schedulingRound=hr', headers=headers('recruiter'))
    assert recruiter.json()['total'] == 2


async def test_previous_interviewer_keeps_own_review_without_access_to_next_interview(client, db):
    technical = await create(client)
    assert (await review(client, db, technical)).status_code == 200
    await create(client, round='managerial')
    rows = (await client.get('/api/recruitment/applications', headers=headers('technical_interviewer'))).json()['items']
    assert rows[0]['latestInterview']['interviewId'] == technical['interviewId']
    assert rows[0]['activeInterview'] is None


async def test_legacy_scheduled_booking_without_active_flag_is_not_lost_or_queued(client, db):
    await db.applications.update_one({'applicationId': 'app0'}, {'$set': {'currentStage': 'HR_ROUND'}})
    hr = await create(client, round='hr')
    await db.recruit_interviews.update_one({'interviewId': hr['interviewId']}, {'$unset': {'active': ''}})
    assert (await queue(client, 'hr'))['total'] == 0
    rows = (await client.get('/api/recruitment/applications', headers=headers())).json()['items']
    card = next(row for row in rows if row['applicationId'] == 'app0')
    assert card['activeInterview']['interviewId'] == hr['interviewId']
