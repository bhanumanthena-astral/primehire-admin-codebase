"""Synthetic reports: scope/projection, pending responses and bounded failures."""
from unittest.mock import AsyncMock
import pytest
from tests.test_candidate_management import module, client, headers
from app.services import job_candidate_reports as reports

BASE='/api/job-assessments/job/applications/app0/report'


async def ready(db):
    await db['applications'].update_one({'applicationId':'app0'}, {'$set':{
        'assessment':{'interviewId':'synthetic-report-id','score':0,'state':'completed'},
    }})


async def test_report_uses_server_application_and_masks_nested_contacts(module, db, monkeypatch):
    await ready(db)
    provider=AsyncMock(return_value={'overallScore':0,'email':'private@example.test',
        'feedback':[{'text':'Contact private@example.test or +919876543210'}]})
    monkeypatch.setattr(reports,'get_report_envelope',provider)
    before=await db['applications'].find_one({'applicationId':'app0'})
    response=await module.get(BASE,headers=headers())
    assert response.status_code==200,response.text
    assert response.headers['cache-control']=='no-store'
    assert response.json()['applicationId']=='app0'
    assert response.json()['report']['overallScore']==0
    assert 'private@example.test' not in response.text and '+919876543210' not in response.text
    provider.assert_awaited_once_with(interview_id='synthetic-report-id',timeout_s=5)
    assert (await db['applications'].find_one({'applicationId':'app0'}))==before
    assert await db['background_jobs'].count_documents({})==0


async def test_wrong_job_org_and_revoked_job_access_never_query_provider(module,db,monkeypatch):
    await ready(db)
    provider=AsyncMock(return_value={'overallScore':84})
    monkeypatch.setattr(reports,'get_report_envelope',provider)
    assert (await module.get(BASE.replace('/job/','/other-job/'),headers=headers())).status_code==404
    assert (await module.get(BASE,headers=headers('super_admin',uid='other-superadmin',org='other'))).status_code==404
    await db['users'].update_one({'userId':'recruiter'},{'$set':{'jobAccess':[]}})
    assert (await module.get(BASE,headers=headers('recruiter'))).status_code==404
    provider.assert_not_awaited()


@pytest.mark.parametrize('role',['viewer','technical_interviewer','managerial_interviewer'])
async def test_report_requires_candidate_management_permission(module,role):
    assert (await module.get(BASE,headers=headers(role))).status_code==403


async def test_assignee_can_read_only_their_job_report(module,db,monkeypatch):
    await ready(db)
    monkeypatch.setattr(reports,'get_report_envelope',AsyncMock(return_value={'overallScore':0}))
    assert (await module.get(BASE,headers=headers('recruiter'))).status_code==200
    assert (await module.get(BASE,headers=headers('hr'))).status_code==404
    await db['jobs'].update_one({'jobId':'job'},{'$set':{'assigneeUserId':'hr'}})
    assert (await module.get(BASE,headers=headers('hr'))).status_code==200


async def test_pending_report_and_timeout_have_clear_errors_without_fabricated_scores(module,db,monkeypatch):
    provider=AsyncMock(return_value=None)
    monkeypatch.setattr(reports,'get_report_envelope',provider)
    assert (await module.get(BASE,headers=headers())).status_code==409
    provider.assert_not_awaited()
    await ready(db)
    response=await module.get(BASE,headers=headers())
    assert response.status_code==409 and 'pending' in response.json()['detail']
    provider.side_effect=TimeoutError('Synthetic provider timeout')
    response=await module.get(BASE,headers=headers())
    assert response.status_code==503 and 'Synthetic' not in response.text


async def test_report_availability_projection_preserves_zero_score(module,db):
    await ready(db)
    response=await module.get('/api/recruitment/applications?jobId=job',headers=headers())
    assert response.status_code==200
    row=next(row for row in response.json()['items'] if row['applicationId']=='app0')
    assert row['assessment']['reportAvailable'] is True
    assert row['assessment']['score']==0
    assert 'interviewId' not in row['assessment']
