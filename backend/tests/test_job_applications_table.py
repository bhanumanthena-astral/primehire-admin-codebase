"""Job directory pagination, private scope and assessment display regressions."""
import pytest
from tests.test_recruitment import client, headers
from app.services.job_applications import assessment_result, interview_round

@pytest.mark.parametrize('assessment,expected',[
    ({'score':0},'0'),({'score':78},'78'),({'reportPending':True,'submittedAt':'2026-01-01'},'Report pending'),
    ({'submittedAt':'2026-01-01'},'Assessment submitted'),({'state':'email_sent'},'Assessment link sent'),
    ({'state':'email_queued'},'Invitation queued'),({},'Not invited'),
])
def test_assessment_display(assessment,expected):
    assert assessment_result({'assessment':assessment})['label']==expected

@pytest.mark.parametrize('stage,expected',[('ROUND1_SCHEDULED','Technical'),('ROUND2_PENDING_ASSIGNMENT','Managerial'),('HR_ROUND','HR'),('ASSESSMENT_SENT','Assessment'),('PARSED','Not in an interview round')])
def test_round_display(stage,expected):
    assert interview_round({'currentStage':stage})==expected

async def test_all_applicants_have_contacts_and_pagination(client,db):
    for number in range(55):
        await db['applications'].insert_one({'orgId':'default','jobId':'job','applicationId':f'table-{number:03}','applicantId':'person0','status':'active','currentStage':'HR_ROUND','assessment':{'score':0,'link':'https://private.test/link','password':'do-not-return'}})
    first=await client.get('/api/jobs/job/applications?limit=50',headers=headers())
    assert first.status_code==200
    body=first.json()
    assert len(body['items'])==50
    second=await client.get('/api/jobs/job/applications?skip=50&limit=50',headers=headers())
    assert len(second.json()['items'])==body['total']-50
    assert {r['applicationId'] for r in body['items']}.isdisjoint(r['applicationId'] for r in second.json()['items'])
    row=next(r for r in body['items'] if r['applicationId'].startswith('table-'))
    assert row['name']=='Synthetic Candidate 0'
    assert row['email']=='person0@example.test'
    assert row['phone']=='9876543210'
    assert row['round']=='HR'
    assert row['assessment']['score']==0
    assert 'do-not-return' not in first.text and 'private.test' not in first.text

async def test_job_directory_rejects_other_jobs_tenants_and_viewers(client,db):
    await db['jobs'].insert_one({'orgId':'default','jobId':'private-job','assigneeUserId':'somebody-else','lifecycleStatus':'OPEN'})
    assert (await client.get('/api/jobs/private-job/applications',headers=headers('recruiter'))).status_code==404
    assert (await client.get('/api/jobs/job/applications',headers=headers(org='other'))).status_code==404
    await db['jobs'].update_one({'jobId':'job'},{'$set':{'assigneeUserId':'viewer'}})
    assert (await client.get('/api/jobs/job/applications',headers=headers('viewer'))).status_code==403
