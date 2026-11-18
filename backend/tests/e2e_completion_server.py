"""Local-only completion browser fixture: fake providers, memory DB, dry-run mail.
Run with .venv-v2/Scripts/python.exe tests/e2e_completion_server.py; port 8008.
Never imported by production. Fixture controls exist only in this test process.
"""
import asyncio
import sys
import tempfile
from pathlib import Path
from datetime import timedelta
from contextlib import asynccontextmanager
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import e2e_recruitment_server as fixture
from app.config import settings
from app.models.recruitment import now
from app.models.hiring import JobRepository
from app.schemas.hiring import JobCreate
from app.services import assessment_flow, resume_intake_security, resume_intake_llm
from app.services.resume_intake_ats import score
from app.services.resume_intake_jobs import run_intake_workers
from app.services.worker import run_once
from app.models.resume_intake import ensure_intake_indexes
from migrations.hiring_workflow_v1 import upgrade

storage=tempfile.TemporaryDirectory(prefix='elitehr-completion-')
settings.storage_dir=storage.name
settings.resume_module_v2_enabled=True
settings.resume_kafka_enabled=False
settings.free_tier_guard_enabled=False
settings.resource_guard_enabled=False
settings.google_oauth_enabled=False
settings.email_dry_run=True
settings.recruitment_email_dry_run=True
settings.allowed_origins='http://127.0.0.1:4188'
settings.hiring_report_base_url='http://127.0.0.1:4188'
resume_intake_security.scan=lambda data:'clean'
resume_intake_security.scanner_ready=lambda:True
async def local_score(db,org,profile,text,job,limits,reference,**kwargs):
    result=score(profile,text,job,limits)
    result['llmStatus']='not_configured'
    return result
resume_intake_llm.evaluate=local_score
submitted=False
async def provider_interview(**kwargs):
    return {'interviewId':'synthetic-'+kwargs['candidate_id'],'link':'https://example.test/interview/'+kwargs['candidate_id'],'password':'Synthetic-only'}
async def provider_status(*args,**kwargs):
    return {'submitted':submitted,'reportAvailable':submitted,'started':submitted,'submittedAt':now().isoformat() if submitted else None}
async def provider_report(*args,**kwargs):
    return {'report':{'overall_score':84,'max_score':100,'overall_grade':'Good','overall_result':{'technical_analysis':{'overall_score':84,'max_score':100,'knowledge':90,'accuracy':78,'reasoning':84},'communication_analysis':{'overall_score':82,'max_score':100,'fluency':82,'grammar':80}},'question_wise_result':[{'id':'mcq1','question':'Who owns ChatGPT?','type':'MCQ','option_id':'A','correct_option_id':'B','options':['Google','OpenAI','Microsoft','Meta'],'is_result_generated':True,'obtained_score':0,'max_score':5},{'id':'technical1','question':'Explain a resilient service design.','is_result_generated':True,'obtained_score':8,'max_score':10,'result':{'transcript':'Use retries with bounded backoff and idempotency.','feedback':'Clear technical reasoning.','strengths':['Idempotent design'],'recommendations':['Describe failure recovery.']}}],'ai_summary':{'strengths':['Clear reasoning'],'areas_for_improvement':['More concrete examples'],'recommendations':['Practise service design.']}}}
assessment_flow.create_interview=provider_interview
assessment_flow.get_interview_status=provider_status
assessment_flow.get_report_envelope=provider_report
previous=fixture.base.app.router.lifespan_context
@asynccontextmanager
async def lifespan(app):
    async with previous(app):
        db=fixture.base.db
        await ensure_intake_indexes(db)
        await upgrade(db)
        job=JobCreate(companyName='Synthetic Company',jobRole='Backend Engineer',title='Completion Test Engineer',department='Engineering',minExperienceYears=1,maxExperienceYears=8,lifecycleStatus='OPEN',positionsTotal=3,closesAt='2027-12-31T00:00:00Z',assigneeUserId='browser-hr',jdHtml='<p>Build reliable Python and SQL backend services with testing, communication and system design.</p>')
        record=await JobRepository(db).create({**job.model_dump(),'jobId':'completion-job','jobKey':'COMPLETION-TEST','orgId':'default','createdBy':'browser-guided-admin','datesVersion':'utc-v1','assigneeEmail':'hr@example.com','assigneeName':'Demo HR','assessmentJobId':'ASSESS-COMPLETION','assessmentRoundType':'TECHNICAL'})
        await db.assessments.insert_one({'orgId':'default','jobId':'ASSESS-COMPLETION','jobTitle':'Completion Technical','roundType':'TECHNICAL','publicationState':'published','isActive':True,'createdBy':'browser-guided-admin','windowStart':now()-timedelta(days=1),'windowEnd':now()+timedelta(days=30)})
        for i in range(10):
            await db.applicants.insert_one({'orgId':'default','applicantId':f'completion-person{i}','name':f'Completion Candidate {i}','email':f'completion{i}@example.test','phone':f'90000000{i:02}','profile':{'skills':['Python','SQL'],'experienceYears':4,'education':['B.Tech'],'summary':'Synthetic backend engineer'},'createdAt':now(),'consent':{'given':True}})
            await db.applications.insert_one({'orgId':'default','applicationId':f'completion-app{i}','applicantId':f'completion-person{i}','jobId':record['jobId'],'currentStage':'SHORTLISTED','matchScore':70+i,'scoreBreakdown':{'ats':70+i,'skills':80,'keyword':75,'education':80,'role':80},'assessment':{},'createdAt':now()})
        await db.hiring_preferences.insert_one({'_id':'default','revision':1,'templates':[{'id':'reject','name':'Synthetic rejection','category':'rejection','subject':'Application update','body':'Thank you {{candidate_name}}.'}],'defaultRejectionId':'reject'})
        async def background():
            while True:
                await run_once(db,kinds=['assessment_send','email_send'])
                await asyncio.sleep(.1)
        tasks=[asyncio.create_task(background()),asyncio.create_task(run_intake_workers(db,concurrency=2,poll_seconds=.1))]
        try:yield
        finally:
            for task in tasks:task.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
            storage.cleanup()
fixture.base.app.router.lifespan_context=lifespan
@fixture.base.app.post('/__fixture__/complete-assessments')
async def complete_assessments():
    global submitted
    submitted=True
    return {'synthetic':True}
@fixture.base.app.post('/__fixture__/open-reviews')
async def open_reviews():
    await fixture.base.db.recruit_interviews.update_many({'status':'scheduled'},{'$set':{'startsAt':now()-timedelta(hours=1),'endsAt':now()-timedelta(minutes=30)}})
    return {'synthetic':True}
if __name__=='__main__':
    import uvicorn
    uvicorn.run(fixture.base.app,host='127.0.0.1',port=8008)
