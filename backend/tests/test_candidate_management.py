"""Module 4: isolated Mongo fixtures and fake provider calls; no live data/email."""
import asyncio
from datetime import timedelta
from copy import deepcopy
import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from app.config import settings
from app.models.recruitment import now
from app.schemas.candidate_management import Profile
from app.services import candidate_management as service
from tests.test_recruitment import client,headers

BASE='/api/candidate-management'


@pytest.fixture
async def module(client,db,monkeypatch):
    monkeypatch.setattr(settings,'mongodb_database','primehire_admin_v2')
    # Use real unique indexes in the in-memory fixture.
    from app.models.candidate_management import INDEXES
    for collection,entries in INDEXES.items():
        for keys,options in entries: await db[collection].create_index(keys,**options)
    for i in range(3):
        phone='9876543210' if i==0 else '876543210'+str(i)
        await db['applicants'].update_one({'applicantId':f'person{i}'},{'$set':{'phone':phone,'phoneDigits':[phone]}})
    await db['users'].insert_one({'orgId':'other','userId':'other-superadmin','role':'super_admin','isActive':True})
    await db['assessments'].insert_one({'orgId':'default','jobId':'ASSESS-one','jobTitle':'Synthetic Technical',
        'roundType':'TECHNICAL','language':'ENGLISH','isActive':True,'publicationState':'published',
        'createdBy':'super_admin','allowedUserIds':['recruiter','hr'],'windowStart':now()-timedelta(days=1),'windowEnd':now()+timedelta(days=10)})
    yield client


def profile():
    return {'name':"Élodie O'Neill",'email':'person0@example.test','phone':'+91 (98765) 43210',
        'skills':['Python','SQL','python'],'preferredLocations':['Hyderabad','hyderabad'],'experienceYears':4.25,
        'summary':'Works on reliable services.','headline':'Backend engineer','educationRecords':[
            {'qualification':'B.Tech','institution':'Example University','graduationYear':2025}]}


def assignment(**patch):
    return {'assessmentId':'ASSESS-one','applicationId':'app0','startDate':(now()+timedelta(hours=1)).isoformat(),
        'endDate':(now()+timedelta(days=1)).isoformat(),'confirmed':True,**patch}


def test_unicode_profile_normalization():
    result=Profile.model_validate(profile())
    assert result.name=="Élodie O'Neill" and result.phone=='+919876543210'
    assert result.skills==['Python','SQL'] and result.preferredLocations==['Hyderabad']


@pytest.mark.parametrize('patch',[{'name':'Candidate 123'},{'name':'<script>'},{'name':'A'}, {'email':'bad'},
    {'phone':'1234'}, {'experienceYears':-1},{'experienceYears':51},{'experienceYears':1.234},{'experienceYears':True},
    {'experienceYears':'NaN'},{'skills':['']},{'skills':['a'*51]},{'skills':['JavaScript!']},
    {'currentCompany':'<b>Company</b>'},{'currentLocation':'A@B'},{'headline':'x'*251},{'summary':'x'*5001},
    {'educationRecords':[{'qualification':'B.Tech','institution':'University','graduationYear':1899}]},
    {'educationRecords':[{'qualification':'B.Tech','institution':'University','graduationYear':9999}]},
    {'candidateId':'changed'}])
def test_invalid_profile_fields(patch):
    with pytest.raises(ValidationError): Profile.model_validate({**profile(),**patch})


async def test_list_details_scope_masking_and_filters(module,db):
    result=await module.get(BASE,headers=headers())
    assert result.status_code==200,result.text
    assert result.json()['total']==3
    row=result.json()['items'][0]
    assert '***' in row['profile']['email'] and row['profile']['phone']!='9876543210'
    assert (await module.get(BASE+'?search=person0',headers=headers())).json()['total']==1
    assert (await module.get(BASE+'?jobId=missing',headers=headers())).json()['total']==0
    assert (await module.get(BASE+'?assessmentStatus=Unassigned',headers=headers())).json()['total']==3
    assert (await module.get(BASE+'?limit=1&skip=1',headers=headers())).json()['total']==3
    assert (await module.get(BASE+'/person0',headers=headers('recruiter'))).status_code==200
    assert (await module.get(BASE+'/person0',headers=headers('viewer'))).status_code==404
    await db['applicants'].update_one({'applicantId':'person0'},{'$set':{'allowedUserIds':['viewer']}})
    assert (await module.get(BASE+'/person0',headers=headers('viewer'))).json()['canManage'] is False
    assert (await module.get(BASE+'/person0',headers=headers(uid='other-superadmin',org='other'))).status_code==404
    for role in ['technical_interviewer','managerial_interviewer']:
        assert (await module.get(BASE,headers=headers(role))).status_code==403
    assert (await module.get(BASE+'/person0',headers=headers())).headers['cache-control']=='no-store'


async def test_profile_update_revision_duplicate_contacts_and_audit(module,db):
    revealed=await module.post(BASE+'/person0/reveal',json={},headers=headers())
    assert revealed.json()['profile']['email']=='person0@example.test'
    body={'profile':profile(),'expectedRevision':0}
    saved=await module.put(BASE+'/person0',json=body,headers=headers())
    assert saved.status_code==200,saved.text
    assert saved.json()['revision']==1
    assert (await db['applicants'].find_one({'applicantId':'person0'}))['profile']['skills']==['Python','SQL']
    assert (await module.put(BASE+'/person0',json=body,headers=headers())).status_code==409
    body['expectedRevision']=1;body['profile']['email']='person1@example.test'
    assert (await module.put(BASE+'/person0',json=body,headers=headers())).status_code==409
    body['profile']['email']='person0@example.test';body['profile']['phone']='123'
    assert (await module.put(BASE+'/person0',json=body,headers=headers())).status_code==422
    assert (await db['applicants'].find_one({'applicantId':'person0'}))['profileRevision']==1
    assert (await module.post(BASE+'/person0/reveal',json={},headers=headers('viewer'))).status_code==403
    audit=await db['audit_log'].find_one({'action':'candidate_management.profile_updated'})
    assert audit and 'person0@example.test' not in str(audit)


async def test_assignment_relationship_dates_and_duplicate(module,db):
    base=BASE+'/person0/assignments'
    body=assignment()
    for patch in [{'applicationId':'app1'},{'assessmentId':'missing'},{'applicationId':None},
        {'startDate':(now()-timedelta(hours=1)).isoformat()},{'endDate':body['startDate']}]:
        response=await module.post(base,json={**body,**patch},headers=headers())
        assert response.status_code in {404,422},response.text
    response=await module.post(base,json=body,headers=headers())
    assert response.status_code==201,response.text
    row=response.json()
    assert row['candidateId']=='person0' and row['applicationId']=='app0' and row['jobId']=='job'
    assert not row.get('inviteLink')
    assert (await module.post(base,json=body,headers=headers())).status_code==409
    assert (await module.get(BASE+'?assessmentStatus=Assigned',headers=headers())).json()['total']==1
    assert (await module.get(base,headers=headers())).json()['items'][0]['assignmentId']==row['assignmentId']
    dates={'startDate':(now()+timedelta(hours=2)).isoformat(),'endDate':body['endDate'],'expectedRevision':1}
    assert (await module.put(base+'/'+row['assignmentId']+'/dates',json=dates,headers=headers())).status_code==200
    assert (await module.put(base+'/'+row['assignmentId']+'/dates',json=dates,headers=headers())).status_code==409
    assert await db['outbox_messages'].count_documents({})==0


async def test_unavailable_assessment_and_permission_loss(module,db):
    await db['assessments'].update_one({'jobId':'ASSESS-one'},{'$set':{'publicationState':'draft'}})
    assert (await module.post(BASE+'/person0/assignments',json=assignment(),headers=headers())).status_code==409
    await db['users'].update_one({'userId':'recruiter'},{'$set':{'jobAccess':['view']}})
    assert (await module.post(BASE+'/person0/assignments',json=assignment(),headers=headers('recruiter'))).status_code==403
    await db['jobs'].update_one({'jobId':'job'},{'$set':{'assigneeUserId':'someone-else'}})
    assert (await module.get(BASE+'/person0',headers=headers('recruiter'))).status_code==404


async def test_generate_reuse_expiry_scope_and_no_password_storage(module,db,monkeypatch):
    calls=[]
    async def fake(row,assessment):
        calls.append(row['assignmentId']);return {'link':'https://assessment.example.test/session/opaque','interviewId':'real-id','password':'ephemeral-test-only'}
    monkeypatch.setattr(service,'create_provider_link',fake)
    row=(await module.post(BASE+'/person0/assignments',json=assignment(),headers=headers())).json()
    path=BASE+'/person0/assignments/'+row['assignmentId']+'/generate-link'
    generated=await module.post(path,json={'expectedRevision':1},headers=headers())
    assert generated.status_code==200,generated.text
    result=generated.json();assert result['accessCode']=='ephemeral-test-only'
    assert '/assessment-access#ASGN-' in result['inviteLink']
    assert 'person0' not in result['inviteLink']
    stored=await db['candidate_assignments'].find_one({'assignmentId':row['assignmentId']})
    assert 'ephemeral-test-only' not in str(stored) and 'https://' not in str(stored)
    again=(await module.post(path,json={'expectedRevision':1},headers=headers())).json()
    assert again['inviteLink']==result['inviteLink'] and len(calls)==1 and 'accessCode' not in again
    token=result['inviteLink'].split('#')[1]
    assert (await module.post('/api/candidate-access',json={'token':token})).status_code==403
    await db['candidate_assignments'].update_one({'assignmentId':row['assignmentId']},{'$set':{'startDate':now()-timedelta(minutes=1)}})
    access=await module.post('/api/candidate-access',json={'token':token})
    assert access.status_code==200 and access.json()['url'].startswith('https://')
    assert (await module.post('/api/candidate-access',json={'token':token[:-1]+('a' if token[-1]!='a' else 'b')})).status_code==404
    assert (await module.post(BASE+'/person1/assignments/'+row['assignmentId']+'/generate-link',json={'expectedRevision':1},headers=headers())).status_code==404
    await db['candidate_assignments'].update_one({'assignmentId':row['assignmentId']},{'$set':{'endDate':now()-timedelta(seconds=1)}})
    assert (await module.post('/api/candidate-access',json={'token':token})).status_code==410
    assert (await module.get(BASE+'/person0/assignments',headers=headers())).json()['items'][0]['linkStatus']=='Expired'


async def test_generation_failure_preserves_assignment_and_uncertain_is_not_retried(module,db,monkeypatch):
    calls=[]
    async def fail(row,assessment): calls.append(1);raise HTTPException(502,'Provider refused; retry allowed')
    monkeypatch.setattr(service,'create_provider_link',fail)
    row=(await module.post(BASE+'/person0/assignments',json=assignment(),headers=headers())).json()
    path=BASE+'/person0/assignments/'+row['assignmentId']+'/generate-link'
    assert (await module.post(path,json={'expectedRevision':1},headers=headers())).status_code==502
    stored=await db['candidate_assignments'].find_one({'assignmentId':row['assignmentId']})
    assert stored['status']=='Failed' and stored['revision']==3
    async def uncertain(row,assessment):calls.append(1);raise HTTPException(504,'Unknown result')
    monkeypatch.setattr(service,'create_provider_link',uncertain)
    assert (await module.post(path,json={'expectedRevision':3},headers=headers())).status_code==504
    assert (await module.post(path,json={'expectedRevision':5},headers=headers())).status_code==409
    assert len(calls)==2


async def test_v1_gate_and_index_migration(module,db,monkeypatch):
    from migrations.candidate_management_v2 import upgrade
    assert (await upgrade(db,dry_run=True))['backfill'] is False
    with pytest.raises(RuntimeError): await upgrade(db)
    monkeypatch.setattr(settings,'mongodb_database','primehire_admin')
    assert (await module.get(BASE,headers=headers())).status_code==404


async def test_changed_account_role_blocks_old_session(module,db):
    await db['users'].update_one({'userId':'recruiter'},{'$set':{'role':'viewer'}})
    assert (await module.get(BASE,headers=headers('recruiter'))).status_code==401


@pytest.mark.parametrize('status',[200,400,409,500])
async def test_provider_contract_interviews_response_and_safe_failures(monkeypatch,status):
    from app.services import assessment_management
    monkeypatch.setattr(assessment_management,'provider_connection',lambda:('https://provider.example.test',{'X-Test':'synthetic'}))
    calls=[]
    class Response:
        status_code=status
        is_success=status==200
        def json(self):return {'data':{'interviews':[{'id':'real-interview','candidate_id':'person','url':'https://assessment.example.test/opaque','password':'ephemeral'}]}}
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):calls.append((url,kwargs['json']));return Response()
    monkeypatch.setattr(service.httpx,'AsyncClient',Client)
    row={'assessmentId':'ASSESS-one','candidateId':'person','startDate':now(),'endDate':now()+timedelta(days=1)}
    if status==200:
        result=await service.create_provider_link(row,{'roundType':'TECHNICAL'});assert result['interviewId']=='real-interview'
    else:
        with pytest.raises(HTTPException) as error:await service.create_provider_link(row,{'roundType':'TECHNICAL'})
        assert error.value.status_code==(502 if status==400 else 504)
    assert len(calls)==1 and calls[0][1]['candidates'][0]['candidate_id']=='person'
    assert 'email' not in str(calls[0][1])


async def test_assessment_view_assignment_statuses_scope(module,db):
    await module.post(BASE+'/person0/assignments',json=assignment(),headers=headers())
    result=await module.get(BASE+'/assessment-assignments/ASSESS-one',headers=headers())
    assert result.status_code==200 and result.json()['total']==1
    assert 'inviteLink' not in result.json()['items'][0]
    assert (await module.get(BASE+'/assessment-assignments/ASSESS-one',headers=headers('viewer'))).status_code==404


def test_link_crypto_uses_existing_fallback_key_and_rejects_another_purpose(monkeypatch):
    from cryptography.fernet import Fernet
    from app.services.candidate_link_crypto import encrypt_link,decrypt_link,OutboxCryptoError
    key=Fernet.generate_key().decode()
    monkeypatch.setattr(settings,'outbox_encryption_key','')
    monkeypatch.setattr(settings,'recruitment_outbox_encryption_key',key)
    encrypted=encrypt_link('https://assessment.example.test/opaque')
    assert decrypt_link(encrypted)=='https://assessment.example.test/opaque'
    with pytest.raises(OutboxCryptoError):decrypt_link(Fernet(key.encode()).encrypt(b'not-an-assessment-link').decode())
    monkeypatch.setattr(settings,'recruitment_outbox_encryption_key','')
    with pytest.raises(OutboxCryptoError):encrypt_link('test')


async def test_concurrent_duplicate_assignment_is_atomic(module,db):
    results=await asyncio.gather(*[module.post(BASE+'/person0/assignments',json=assignment(),headers=headers()) for _ in range(2)])
    assert sorted(r.status_code for r in results)==[201,409]
    assert await db['candidate_assignments'].count_documents({})==1


async def test_revoked_and_disabled_assessment_access_is_denied(module,db,monkeypatch):
    async def fake(row,assessment):return {'link':'https://assessment.example.test/opaque','interviewId':'real-id'}
    monkeypatch.setattr(service,'create_provider_link',fake)
    row=(await module.post(BASE+'/person0/assignments',json=assignment(),headers=headers())).json()
    generated=(await module.post(BASE+'/person0/assignments/'+row['assignmentId']+'/generate-link',json={'expectedRevision':1},headers=headers())).json()
    token=generated['inviteLink'].split('#')[1]
    await db['candidate_assignments'].update_one({'assignmentId':row['assignmentId']},{'$set':{'startDate':now()-timedelta(minutes=1)}})
    await db['assessments'].update_one({'jobId':'ASSESS-one'},{'$set':{'isActive':False}})
    assert (await module.post('/api/candidate-access',json={'token':token})).status_code==410
    await db['assessments'].update_one({'jobId':'ASSESS-one'},{'$set':{'isActive':True}})
    await db['candidate_assignments'].update_one({'assignmentId':row['assignmentId']},{'$set':{'status':'Revoked'}})
    assert (await module.post('/api/candidate-access',json={'token':token})).status_code==410


def test_confirmed_edit_limits_allow_full_headline_and_summary():
    value=Profile.model_validate({**profile(),'headline':'a'*250,'summary':'a'*5000})
    assert len(value.headline)==250 and len(value.summary)==5000


async def test_profile_edit_cannot_overwrite_an_update_from_another_workflow(module,db):
    original=(await module.post(BASE+'/person0/reveal',json={},headers=headers())).json()
    await db['applicants'].update_one({'applicantId':'person0'},{'$set':{'updatedAt':now(),'profile.summary':'Updated elsewhere'}})
    result=await module.put(BASE+'/person0',json={'profile':profile(),'expectedRevision':original['revision'],'expectedUpdatedAt':original['updatedAt']},headers=headers())
    assert result.status_code==409
    assert (await db['applicants'].find_one({'applicantId':'person0'}))['profile']['summary']=='Updated elsewhere'
