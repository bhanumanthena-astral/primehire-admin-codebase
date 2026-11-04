"""Module 3 browser fixture; fake external publication and in-memory DB only."""
import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager

sys.path.insert(0, str(Path(__file__).parent))
os.environ['MONGODB_DATABASE']='primehire_admin_v2'
import e2e_server as base
from app.config import settings
from app.services import assessment_management as service
from app.security.deps import get_db
from app.models.recruitment import now
from datetime import timedelta

settings.mongodb_database='primehire_admin_v2'
settings.recruitment_portals_enabled=True
settings.allowed_origins='http://127.0.0.1:4176'
settings.primehire_access_key=''
settings.primehire_secret_key=''

async def fake_publication(config):
    assert config.questions
service.create_upstream=fake_publication

@asynccontextmanager
async def lifespan(app):
    async with base.lifespan(app):
        # The existing legacy directory uses a separate _db dependency.
        from app.api.directory import _db
        app.dependency_overrides[_db]=lambda:base.db
        question={'id':'q_1','text':'Explain a dictionary','type':'SPEAK_TO_ANSWER','referenceAnswer':'A key-value mapping','maxDuration':120,'maxScore':10,'weightage':100}
        for index in range(22):
            await base.db['assessments'].insert_one({'orgId':'default','jobId':f'JOB-seeded-{index:02}',
                'jobTitle':f'Seeded Assessment {index:02}','jobDescription':'Build reliable services',
                'language':'ENGLISH','roundType':'TECHNICAL','startDate':'2027-01-01T00:00:00Z','endDate':'2027-01-31T00:00:00Z',
                'windowStart':now()+timedelta(days=20),'windowEnd':now()+timedelta(days=30),
                'questions':[question],'createdBy':'browser-admin','updatedBy':'browser-admin','createdAt':now(),
                'revision':1,'publicationState':'published' if index==0 else 'draft','isActive':index==0,
                'allowedUserIds':['browser-viewer'] if index==0 else []})
        from app.schemas.hiring import JobCreate
        from app.models.hiring import JobRepository
        from migrations.recruitment_v2 import upgrade as upgrade_recruitment
        await upgrade_recruitment(base.db)
        doc=JobCreate(companyName='Demo Labs',jobRole='Platform Engineer',title='Workspace Report Engineer',
            jobKey='WORKSPACE-REPORT',department='Engineering',minExperienceYears=2,maxExperienceYears=5,
            lifecycleStatus='OPEN',positionsTotal=2,closesAt='2027-12-31T00:00:00Z',assigneeUserId='browser-admin',
            jdHtml='<p>Build reliable Python services and collaborate with product and engineering teams.</p>')
        job=await JobRepository(base.db).create({**doc.model_dump(),'orgId':'default','createdBy':'browser-admin',
            'datesVersion':'utc-v1','assessmentJobId':'JOB-seeded-00','assessmentRoundType':'TECHNICAL'})
        for i in range(2):
            await base.db['applicants'].insert_one({'orgId':'default','applicantId':f'workspace-person{i}',
                'name':f'Workspace Candidate {i}','email':f'workspace{i}@example.test','phone':'9876543210',
                'profile':{'skills':['Python'],'experienceYears':4},'createdAt':now()})
            await base.db['applications'].insert_one({'orgId':'default','applicationId':f'workspace-app{i}',
                'applicantId':f'workspace-person{i}','jobId':job['jobId'],'matchScore':80+i,
                'currentStage':'ASSESSMENT_COMPLETED' if i==0 else 'SHORTLISTED',
                'assessment':{'score':84,'status':'completed','interviewId':'workspace-assessment-interview'} if i==0 else {},
                'createdAt':now()})
        from app.services import job_candidate_reports
        async def fake_report(**kwargs):
            assert kwargs['interview_id']=='workspace-assessment-interview'
            return {'interview_details':{'round_type':'TECHNICAL'},'report':{
                'overall_result':{'technical_analysis':{'overall_score':84}},
                'question_wise_result':[{'id':'q1','question':'Explain your approach to reliable services.',
                    'max_score':10,'obtained_score':8,'is_result_generated':True,'is_attempted':True,
                    'result':{'transcript':'Synthetic candidate response','technical_analysis':{'overall_score':80}}}]}}
        job_candidate_reports.get_report_envelope=fake_report
        yield

base.app.router.lifespan_context=lifespan
if __name__=='__main__':
    import uvicorn
    uvicorn.run(base.app,host='127.0.0.1',port=8005)
