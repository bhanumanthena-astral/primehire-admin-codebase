from datetime import timedelta
from tests.test_candidate_management import module, client, headers
from app.models.recruitment import now
from unittest.mock import AsyncMock

BASE='/api/job-assessments/job'

def payload(ids=None):
    return {'assessmentId':'ASSESS-one','applicationIds':ids or ['app0'],'startDate':(now()+timedelta(hours=1)).isoformat(),'endDate':(now()+timedelta(days=1)).isoformat(),'confirmed':True}

async def test_link_existing_and_assign_job_candidates_without_duplicates(module,db):
    response=await module.post(BASE+'/link',headers=headers(),json={'assessmentId':'ASSESS-one','expectedAssessmentId':None})
    assert response.status_code==200,response.text
    assert (await db['jobs'].find_one({'jobId':'job'}))['assessmentJobId']=='ASSESS-one'
    assigned=await module.post(BASE+'/assign',headers=headers(),json=payload(['app0','app1','app0']))
    assert assigned.status_code==200,assigned.text
    assert assigned.json()['assigned']==2
    repeated=await module.post(BASE+'/assign',headers=headers(),json=payload(['app0','app1']))
    assert repeated.json()['assigned']==0
    assert all(row['status']=='skipped' for row in repeated.json()['items'])
    assert await db['candidate_assignments'].count_documents({})==2

async def test_link_rejects_expired_draft_wrong_org_and_stale_selection(module,db):
    await db['assessments'].update_one({'jobId':'ASSESS-one'},{'$set':{'publicationState':'draft'}})
    assert (await module.post(BASE+'/link',headers=headers(),json={'assessmentId':'ASSESS-one'})).status_code==409
    await db['assessments'].update_one({'jobId':'ASSESS-one'},{'$set':{'publicationState':'published','windowEnd':now()-timedelta(days=1)}})
    assert (await module.post(BASE+'/link',headers=headers(),json={'assessmentId':'ASSESS-one'})).status_code==409
    assert (await module.post(BASE+'/link',headers=headers(org='other',uid='other-superadmin'),json={'assessmentId':'ASSESS-one'})).status_code==404
    await db['jobs'].update_one({'jobId':'job'},{'$set':{'assessmentJobId':'changed'}})
    assert (await module.post(BASE+'/link',headers=headers(),json={'assessmentId':'ASSESS-one'})).status_code==409

async def test_assignment_validates_job_membership_window_and_confirmation(module,db):
    await module.post(BASE+'/link',headers=headers(),json={'assessmentId':'ASSESS-one'})
    response=await module.post(BASE+'/assign',headers=headers(),json=payload(['not-this-job','app0']))
    assert response.json()['assigned']==1
    assert response.json()['items'][0]['status']=='failed'
    invalid=await module.post(BASE+'/assign',headers=headers(),json={**payload(['app1']),'startDate':(now()-timedelta(hours=1)).isoformat()})
    assert invalid.status_code==422
    assert (await module.post(BASE+'/assign',headers=headers(),json={**payload(),'confirmed':False})).status_code==422
    assert (await module.post(BASE+'/assign',headers=headers('viewer'),json=payload())).status_code==403
    assert await db['candidate_assignments'].count_documents({})==1


async def test_sync_checks_provider_immediately_and_saves_zero_without_an_external_worker(module,db,monkeypatch):
    from app.services import assessment_flow
    await db['applications'].update_one({'orgId':'default','applicationId':'app0'},{'$set':{
        'currentStage':'SHORTLISTED','assessment':{'state':'link_created','interviewId':'synthetic-interview'}}})
    status=AsyncMock(return_value={'submitted':True,'reportAvailable':True,'submittedAt':now().isoformat()})
    report=AsyncMock(return_value={'report':{'overall_score':0,'question_wise_result':[]}})
    monkeypatch.setattr(assessment_flow,'get_interview_status',status)
    monkeypatch.setattr(assessment_flow,'get_report_envelope',report)
    response=await module.post(BASE+'/sync',headers=headers())
    assert response.status_code==200,response.text
    assert response.json()['checked']==1
    saved=await db['applications'].find_one({'orgId':'default','applicationId':'app0'})
    assert saved['assessment']['score']==0
    assert saved['assessment']['state']=='completed'
    assert saved['currentStage']=='ASSESSMENT_COMPLETED'
    status.assert_awaited_once();report.assert_awaited_once()


async def test_background_sweep_respects_cooldown_while_manual_sync_can_force_a_check(module,db):
    from app.services.assessment_flow import enqueue_sync_sweep
    await db['applications'].update_one({'orgId':'default','applicationId':'app0'},{'$set':{
        'currentStage':'SHORTLISTED','assessment':{'state':'link_created','interviewId':'synthetic-interview','syncedAt':now().isoformat()}}})
    assert await enqueue_sync_sweep(db,org_id='default',job_id='job',force=False)==0
    assert await enqueue_sync_sweep(db,org_id='default',job_id='job',force=True)==1
    await db['applications'].update_one({'applicationId':'app0'},{'$set':{'assessment.syncedAt':(now()-timedelta(minutes=5)).isoformat()}})
    assert await enqueue_sync_sweep(db,org_id='default',job_id='job',force=False)==1
