"""Personal reviewer analytics stay separate from the application handoff stage."""
from datetime import datetime, timedelta, timezone
from tests.test_recruitment import client, headers, create, review


async def test_reviewer_summary_counts_only_own_interviews_after_managerial_handoff(client, db):
    technical = await create(client)
    assert (await review(client, db, technical)).status_code == 200
    managerial = await create(client, round='managerial')
    assert (await review(client, db, managerial)).status_code == 200
    await create(client, round='hr')
    for role, own_round in [('technical_interviewer', 'technical'), ('managerial_interviewer', 'managerial')]:
        response = await client.get('/api/recruitment/tracker', headers=headers(role))
        assert response.status_code == 200, response.text
        tracker = response.json()
        assert tracker['stages']['HR_ROUND'] == 1  # Application's next step remains unchanged.
        assert {key: value for key, value in tracker['reviewerSummary'].items() if key != 'today'} == {'assigned': 1, 'upcoming': 0,
            'pendingReview': 0, 'completed': 1, 'advanced': 1, 'held': 0}
        assert {item['round'] for item in tracker['interviews']} == {own_round}
        completed = await client.get('/api/recruitment/interviews?bucket=completed', headers=headers(role))
        assert completed.status_code == 200
        assert completed.json()['total'] == 1
        assert completed.json()['items'][0]['round'] == own_round
    assert (await client.get('/api/recruitment/tracker', headers=headers())).json()['reviewerSummary'] is None


async def test_summary_is_page_independent_and_job_org_assignment_scoped(client, db, monkeypatch):
    from app.api import recruitment
    clock = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(recruitment, 'now', lambda: clock)
    await create(client)
    # Seed only isolated synthetic bookings to exercise aggregation across pages.
    template = await db['recruit_interviews'].find_one({'interviewerId': 'technical_interviewer'})
    template.pop('_id')
    await db['recruit_interviews'].delete_many({})
    records = [
        ('today-start', 'technical_interviewer', 'default', clock.replace(hour=0, minute=0) - timedelta(hours=5, minutes=30), 'scheduled'),
        ('today-last', 'technical_interviewer', 'default', clock.replace(hour=18, minute=29), 'scheduled'),
        ('tomorrow', 'technical_interviewer', 'default', clock.replace(hour=18, minute=30), 'scheduled'),
        ('cancelled', 'technical_interviewer', 'default', clock, 'cancelled'),
        ('different-user', 'second-tech', 'default', clock, 'scheduled'),
        ('different-org', 'technical_interviewer', 'other', clock, 'scheduled'),
    ]
    for key, interviewer, org, start, status in records:
        await db['recruit_interviews'].insert_one({**template, 'interviewId': key, 'active': False,
            'orgId': org, 'interviewerId': interviewer, 'startsAt': start, 'endsAt': start + timedelta(minutes=30), 'status': status})
    response = await client.get('/api/recruitment/tracker', headers=headers('technical_interviewer'))
    assert response.status_code == 200, response.text
    summary = response.json()['reviewerSummary']
    assert summary == {'assigned': 3, 'today': 2, 'upcoming': 2, 'pendingReview': 1, 'completed': 0, 'advanced': 0, 'held': 0}
    today = await client.get('/api/recruitment/interviews?bucket=today&limit=1', headers=headers('technical_interviewer'))
    assert today.status_code == 200, today.text
    assert today.json()['total'] == 2
    assert len(today.json()['items']) == 1
    assert today.json()['items'][0]['interviewId'] == 'today-start'
    missing_job = await client.get('/api/recruitment/tracker?jobId=unassigned', headers=headers('technical_interviewer'))
    assert missing_job.json()['reviewerSummary']['assigned'] == 0
    other_org = await client.get('/api/recruitment/tracker', headers=headers('technical_interviewer', org='other-org'))
    assert other_org.json()['reviewerSummary']['assigned'] == 0
