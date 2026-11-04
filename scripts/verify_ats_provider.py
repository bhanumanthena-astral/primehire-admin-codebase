"""One real ATS request using synthetic stripped data and an in-memory audit DB."""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import settings
from app.schemas.resume_intake import CandidateProfile, IntakeSettings
from app.services.resume_intake_llm import evaluate
import mongomock_motor


async def main():
    if not settings.openrouter_api_key or not settings.openrouter_model:
        raise SystemExit('Configure OPENROUTER_API_KEY and OPENROUTER_MODEL on the backend first.')
    db=mongomock_motor.AsyncMongoMockClient()['synthetic_provider_smoke']
    profile=CandidateProfile(name='Synthetic Candidate',skills=['Python','SQL'],experienceYears=4,
        currentDesignation='Backend Engineer',education=['B.Tech'],summary='Builds tested backend services.').model_dump(mode='json')
    job={'title':'Backend Engineer','jobRole':'Backend Engineer','keywords':['Python','SQL'],
        'minExperienceYears':2,'maxExperienceYears':6,'jdText':'Build Python services with SQL databases and automated tests.'}
    result=await evaluate(db,'synthetic-test',profile,'Synthetic resume text',job,IntakeSettings(),'synthetic-application')
    print(json.dumps({'providerConfigured':True,'llmStatus':result['llmStatus'],
        'usedLocalFallback':result['llmStatus']!='done','auditEvents':await db['llm_runs'].count_documents({}),
        'providerErrorCodes':[row.get('error') async for row in db['llm_runs'].find({}, {'error':1})],
        'internalErrorType':result.get('llmErrorCode')}))
    if result['llmStatus']!='done':raise SystemExit(2)


asyncio.run(main())
