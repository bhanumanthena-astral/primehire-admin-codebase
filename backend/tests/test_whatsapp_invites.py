"""Meta delivery tests use synthetic data and never contact Meta."""
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from tests.test_recruitment import client, headers
from app.config import settings
from app.services import whatsapp_invites as service

@pytest.fixture
def configured(monkeypatch):
    for key,value in {'whatsapp_access_token':'test-token','whatsapp_phone_number_id':'1234','whatsapp_graph_version':'v99.0','whatsapp_template_name':'assessment_invite','whatsapp_price_per_message':1.25,'whatsapp_currency':'INR'}.items():
        monkeypatch.setattr(settings,key,value)

async def seed(db):
    await db['users'].insert_one({'orgId':'org','userId':'creator','isActive':True,'role':'recruiter'})
    await db['jobs'].insert_one({'orgId':'org','jobId':'job','createdBy':'creator','title':'Engineer','whatsappApproval':{'enabled':True,'price':1.25,'currency':'INR'}})
    await db['applicants'].insert_one({'orgId':'org','applicantId':'person','phone':'+919876543210'})
    await db['applications'].insert_one({'orgId':'org','jobId':'job','applicationId':'app','applicantId':'person','assessment':{'link':'https://example.com/assessment'}})
    return {'orgId':'org','payload':{'applicationId':'app','actorUserId':'creator'}}

async def test_default_disabled_and_changed_price_blocks_queue(db,monkeypatch,configured):
    user=SimpleNamespace(org_id='org',user_id='creator')
    with pytest.raises(HTTPException):
        await service.queue(db,user,{'jobId':'job'},['app'])
    job={'jobId':'job','whatsappApproval':{'enabled':True,'price':1,'currency':'INR'}}
    with pytest.raises(HTTPException):
        await service.queue(db,user,job,['app'])

async def test_meta_template_and_duplicate_guard(db,configured,monkeypatch):
    job=await seed(db); calls=[]
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            calls.append((url,kwargs))
            return SimpleNamespace(is_success=True,json=lambda:{'messages':[{'id':'wamid.test'}]})
    monkeypatch.setattr(service.httpx,'AsyncClient',Client)
    assert (await service.deliver(db,job))['status']=='accepted'
    assert (await service.deliver(db,job))['skipped']
    assert len(calls)==1
    assert calls[0][1]['json']['to']=='919876543210'
    assert calls[0][1]['json']['template']['components'][0]['parameters'][1]['text']=='https://example.com/assessment'

async def test_unknown_provider_outcome_is_not_resent(db,configured,monkeypatch):
    job=await seed(db)
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,*args,**kwargs):raise TimeoutError()
    monkeypatch.setattr(service.httpx,'AsyncClient',Client)
    assert (await service.deliver(db,job))['status']=='uncertain'
    assert (await service.deliver(db,job))['skipped']

async def test_cross_job_application_is_not_queued(db,configured):
    await seed(db)
    user=SimpleNamespace(org_id='org',user_id='creator')
    result=await service.queue(db,user,{'jobId':'other','whatsappApproval':{'enabled':True,'price':1.25,'currency':'INR'}},['app'])
    assert result['items'][0]['status']=='skipped'
    assert await db['background_jobs'].count_documents({})==0


async def test_manager_approval_and_creator_send_permissions(client, db, configured):
    route='/api/jobs/job/whatsapp'
    body={'enabled':True,'expectedPrice':1.25,'currency':'INR'}
    denied=await client.put(route,json=body,headers=headers('recruiter'))
    assert denied.status_code==403
    stale=await client.put(route,json={**body,'expectedPrice':1},headers=headers())
    assert stale.status_code==409
    approved=await client.put(route,json=body,headers=headers())
    assert approved.status_code==200
    caps=await client.get(route,headers=headers('recruiter'))
    assert caps.json()['enabled'] is True
    missing_consent=await client.post(route+'/send',json={'applicationIds':['a']},headers=headers('recruiter'))
    assert missing_consent.status_code==422
    other=await client.get('/api/jobs/other/whatsapp',headers=headers('recruiter'))
    assert other.status_code==404
