from unittest.mock import AsyncMock
import pytest
from app.services.assessment_assignment_sync import attach_attempt, reconcile_assignments
from app.services import assessment_flow, reporting


async def seed(db):
    await db.jobs.insert_one({'orgId':'default','jobId':'job','assessmentJobId':'assessment','title':'Engineer'})
    await db.applications.insert_one({'orgId':'default','applicationId':'app','applicantId':'person','jobId':'job','currentStage':'PARSED'})
    assignment={'orgId':'default','assignmentId':'assignment','applicationId':'app','candidateId':'person',
        'jobId':'job','assessmentId':'assessment','interviewId':'attempt','status':'Generated'}
    await db.candidate_assignments.insert_one(assignment)
    return assignment


async def test_generated_assignment_is_linked_and_completed_from_provider_evidence(db, monkeypatch):
    assignment=await seed(db)
    await reconcile_assignments(db,org_id='default',job_id='job')
    app=await db.applications.find_one({'applicationId':'app'})
    assert app['assessment']['interviewId']=='attempt'
    assert app['currentStage']=='PARSED'  # Link creation alone cannot claim completion.
    assert await attach_attempt(db,assignment)
    assert await db.background_jobs.count_documents({'kind':'assessment_sync'})==1
    monkeypatch.setattr(assessment_flow,'get_interview_status',AsyncMock(return_value={'submitted':True,'reportAvailable':True}))
    monkeypatch.setattr(assessment_flow,'get_report_envelope',AsyncMock(return_value={'report':{'score':28}}))
    monkeypatch.setattr(assessment_flow,'extract_scores',lambda _: {'technical':28})
    monkeypatch.setattr(reporting,'capture',AsyncMock(return_value={}))
    result=await assessment_flow.handle_assessment_sync(db,{'orgId':'default','payload':{'applicationId':'app'}})
    assert result=={'completed':True,'score':28}
    app=await db.applications.find_one({'applicationId':'app'})
    assert app['currentStage']=='ASSESSMENT_COMPLETED'
    assert app['assessment']['score']==28 and app['assessment']['status']=='Completed'


async def test_assignment_cannot_replace_another_attempt_or_cross_candidate_scope(db):
    assignment=await seed(db)
    assert not await attach_attempt(db,{**assignment,'orgId':'other'})
    assert not await attach_attempt(db,{**assignment,'candidateId':'other'})
    await db.applications.update_one({'applicationId':'app'},{'$set':{'assessment':{'interviewId':'existing','score':91}}})
    assert not await attach_attempt(db,assignment)
    assert (await db.applications.find_one({'applicationId':'app'}))['assessment']=={'interviewId':'existing','score':91}
    assert await db.background_jobs.count_documents({})==0
