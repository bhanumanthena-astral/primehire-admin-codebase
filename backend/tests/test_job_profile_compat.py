"""Existing applicant profile reads must accept additive Module 2/4 metadata."""
from datetime import timedelta
from tests.test_resume_intake_v2 import client, headers
from app.models.resume_intake import now

async def seed(db):
    stamp=now()
    await db['applicants'].insert_one({'applicantId':'profile-person','orgId':'default','email':'person@example.test','phone':'+919876543210','name':'Profile Person',
        'createdAt':stamp,'updatedAt':stamp,'retentionUntil':stamp+timedelta(days=90),
        'profile':{'name':'Profile Person','email':'person@example.test'},'intakeManaged':True,'profileRevision':2,
        'resume':{'parsedJson':{'skills':['Python']}}})
    await db['applications'].insert_one({'applicationId':'profile-app','applicantId':'profile-person','orgId':'default','jobId':'a',
        'currentStage':'HR_ROUND','stageEnteredAt':stamp,'status':'active','candidateKey':None,'assignedReviewers':[],
        'matchScore':82,'scoreBreakdown':{'ats':{'overall':82}},'createdAt':stamp,'updatedAt':stamp,
        'intakeItemId':'private-item','applicationSource':'local','whatsappInvite':{'status':'accepted','messageId':'private-message'}})

async def test_profile_accepts_v2_documents_without_exposing_internal_metadata(client,db):
    await seed(db)
    response=await client.get('/api/applicants/profile-person/profile',headers=headers())
    assert response.status_code==200
    data=response.json()
    assert data['applicant']['name']=='Profile Person'
    assert data['applicant']['email']!='person@example.test'
    assert data['applicant']['retentionUntil']
    assert data['applications'][0]['matchScore']==82
    assert 'intakeManaged' not in data['applicant'] and 'profileRevision' not in data['applicant']
    assert 'intakeItemId' not in data['applications'][0] and 'whatsappInvite' not in data['applications'][0]

async def test_profile_honors_tenant_and_job_visibility(client,db):
    await seed(db)
    response=await client.get('/api/applicants/profile-person/profile',headers=headers(role='recruiter'))
    assert response.status_code==200
    assert response.json()['applications']==[]
    other=await client.get('/api/applicants/profile-person/profile',headers=headers(role='hr',org='other',uid='other'))
    assert other.status_code==404
