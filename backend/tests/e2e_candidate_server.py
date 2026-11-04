"""Candidate Management browser fixture; synthetic data, no external calls."""
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import timedelta
sys.path.insert(0,str(Path(__file__).parent))
import e2e_server as base
from cryptography.fernet import Fernet
from app.config import settings
from app.models.recruitment import now
from app.models.candidate_management import INDEXES
from app.services import candidate_management as service

settings.mongodb_database='primehire_admin_v2'
settings.outbox_encryption_key=Fernet.generate_key().decode()
settings.allowed_origins='http://127.0.0.1:4177'

async def fake_provider(row,assessment):
    return {'link':'https://assessment.example.test/opaque-session','interviewId':'fixture-only','password':'Fixture-code-only'}
service.create_provider_link=fake_provider

@asynccontextmanager
async def lifespan(app):
    async with base.lifespan(app):
        from app.api.directory import _db
        app.dependency_overrides[_db]=lambda:base.db
        for collection,entries in INDEXES.items():
            for keys,options in entries: await base.db[collection].create_index(keys,**options)
        job=await base.db['jobs'].find_one({'assigneeUserId':'browser-hr'})
        for i in range(23):
            await base.db['applicants'].insert_one({'orgId':'default','applicantId':f'browser-person-{i:02}',
                'name':'Synthetic Candidate '+chr(65+i),'email':f'fixture{i}@example.test','phone':f'98765432{i:02}',
                'phoneDigits':[f'98765432{i:02}'],'createdAt':now()-timedelta(minutes=i),'profile':{
                    'skills':['Python','SQL'],'experienceYears':4.25,'currentDesignation':'Backend Engineer',
                    'currentLocation':'Hyderabad','summary':'Builds reliable services.'},'allowedUserIds':['browser-viewer'] if i==0 else []})
            await base.db['applications'].insert_one({'orgId':'default','applicantId':f'browser-person-{i:02}',
                'applicationId':f'browser-app-{i:02}','jobId':job['jobId'],'createdAt':now(),'currentStage':'SHORTLISTED'})
        await base.db['assessments'].insert_one({'orgId':'default','jobId':'BROWSER-ASSESS','jobTitle':'Browser Technical Assessment',
            'createdBy':'browser-admin','allowedUserIds':['browser-hr'],'publicationState':'published','isActive':True,
            'roundType':'TECHNICAL','language':'ENGLISH','windowStart':now()-timedelta(days=1),'windowEnd':now()+timedelta(days=10),
            'questions':[{'id':'q_1','text':'Explain Python','type':'SPEAK_TO_ANSWER','maxDuration':120,'maxScore':10,'weightage':100,'referenceAnswer':'A programming language'}]})
        yield
base.app.router.lifespan_context=lifespan
if __name__=='__main__':
    import uvicorn
    uvicorn.run(base.app,host='127.0.0.1',port=8006)
