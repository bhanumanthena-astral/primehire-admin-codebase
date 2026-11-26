"""Developer table selection and the admin scheduling handoff, without live mail."""
import pytest
from tests.test_recruitment import client, headers, schedule


async def reviewer(db):
    await db.recruit_profiles.insert_one({'orgId': 'default', 'userId': 'technical_interviewer',
        'reviewJobIds': ['job'], 'visibleFields': ['assessment', 'skills']})


async def test_bulk_shortlist_partial_results_and_admin_handoff(client, db):
    await reviewer(db)
    await db.applications.update_one({'applicationId': 'app2'}, {'$set': {'currentStage': 'REJECTED'}})
    response = await client.post('/api/recruitment/applications/shortlist-bulk',
        headers=headers('technical_interviewer'), json={'applicationIds': ['app0', 'app1', 'app0', 'app2', 'unknown']})
    assert response.status_code == 200, response.text
    assert response.json()['shortlistedIds'] == ['app0', 'app1']
    assert {row['applicationId'] for row in response.json()['failed']} == {'app2', 'unknown'}
    assert await db.stage_history.count_documents({'toStage': 'ROUND1_PENDING_ASSIGNMENT'}) == 2
    queue = await client.get('/api/recruitment/applications?developerShortlisted=true', headers=headers('admin'))
    assert queue.status_code == 200, queue.text
    assert queue.json()['total'] == 2
    assert all(row['developerShortlist']['userId'] == 'technical_interviewer' for row in queue.json()['items'])
    booked = await client.post('/api/recruitment/interviews', headers=headers('admin'), json=schedule())
    assert booked.status_code == 201, booked.text
    assert booked.json()['interviewerId'] == 'technical_interviewer'


async def test_bulk_shortlist_cannot_cross_assignment_or_organization(client, db):
    await reviewer(db)
    await db.jobs.insert_one({'orgId': 'default', 'jobId': 'unassigned', 'assignedDeveloperUserId': 'someone-else'})
    await db.applications.insert_one({'orgId': 'default', 'applicationId': 'unassigned-app', 'jobId': 'unassigned', 'currentStage': 'ASSESSMENT_COMPLETED'})
    await db.applications.insert_one({'orgId': 'other', 'applicationId': 'other-app', 'jobId': 'job', 'currentStage': 'ASSESSMENT_COMPLETED'})
    result = await client.post('/api/recruitment/applications/shortlist-bulk', headers=headers('technical_interviewer'),
        json={'applicationIds': ['unassigned-app', 'other-app']})
    assert result.status_code == 200
    assert result.json()['shortlistedIds'] == [] and len(result.json()['failed']) == 2
    assert await db.applications.count_documents({'developerShortlist': {'$exists': True}}) == 0


@pytest.mark.parametrize('ids', [[], ['app0']*101, [''], ['x'*101]])
async def test_bulk_shortlist_validates_bounded_ids(client, ids):
    result = await client.post('/api/recruitment/applications/shortlist-bulk', headers=headers('technical_interviewer'), json={'applicationIds': ids})
    assert result.status_code == 422


async def test_range_and_status_sort_use_displayed_values(client, db):
    await reviewer(db)
    for key, score, status in [('app0', 60, {'status': 'completed'}), ('app1', 90, {'state': 'pending'}), ('app2', None, {})]:
        assessment = {**status, **({'score': score} if score is not None else {})}
        await db.applications.update_one({'applicationId': key}, {'$set': {'assessment': assessment, 'matchScore': score}})
    for field in ['assessment', 'ats']:
        response = await client.get(f'/api/recruitment/applications?scoreField={field}&minimum=60&maximum=90&sortBy=score&descending=true&limit=1', headers=headers('technical_interviewer'))
        assert response.status_code == 200, response.text
        assert response.json()['total'] == 2
        assert response.json()['items'][0]['applicationId'] == 'app1'
    response = await client.get('/api/recruitment/applications?sortBy=status&descending=true', headers=headers('technical_interviewer'))
    assert response.status_code == 200, response.text
    assert [row['applicationId'] for row in response.json()['items']] == ['app1', 'app0', 'app2']


async def test_bulk_shortlist_respects_revoked_evidence_access(client, db):
    await reviewer(db)
    await db.recruit_profiles.update_one({'userId': 'technical_interviewer'}, {'$set': {'visibleFields': ['skills']}})
    result = await client.post('/api/recruitment/applications/shortlist-bulk', headers=headers('technical_interviewer'), json={'applicationIds': ['app0']})
    assert result.json()['shortlistedIds'] == []
    assert 'access' in result.json()['failed'][0]['message']
