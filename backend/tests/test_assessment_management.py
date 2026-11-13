"""Module 3 uses synthetic in-memory data and a fake publication adapter only."""
import asyncio
import csv
import io
from copy import deepcopy
from datetime import timedelta
import pytest
from fastapi import HTTPException
from app.config import settings
from app.models.recruitment import now
from app.services.assessment_csv import HEADERS, OPTIONAL, parse_csv
from tests.test_recruitment import client, headers


@pytest.fixture
async def module_client(client, monkeypatch):
    monkeypatch.setattr(settings, 'mongodb_database', 'primehire_admin_v2')
    yield client


def config(key='JOB-test'):
    start=now()+timedelta(days=1)
    return {'jobId':key,'jobTitle':'Synthetic Backend Assessment','jobDescription':'Build Python services',
        'language':'ENGLISH','roundType':'TECHNICAL','startDate':start.isoformat(),'endDate':(start+timedelta(days=2)).isoformat(),
        'questions':[{'id':'q_1','text':'Explain dictionaries','type':'SPEAK_TO_ANSWER','maxDuration':120,
            'maxScore':10,'weightage':100,'referenceAnswer':'A mapping from keys to values'}]}


def csv_text(rows=None, headers=None):
    columns=headers or HEADERS+OPTIONAL
    output=io.StringIO();writer=csv.writer(output);writer.writerow(columns)
    for row in rows or [{}]:
        values={'Assessment Group ID':'sample-group','Job Description':'Python, services\nand APIs','Language Selection':'English',
            'Round Type':'TECHNICAL','Start Date':'2027-01-01','End Date':'2027-02-01','Question Type':'SPEAK_TO_ANSWER',
            'Max Duration (Seconds)':'120','Max Score':'10','Weightage (%)':'100','Question Prompt / Text':'Explain a dictionary',
            'Expected Reference Answer':'A key-value mapping',**row}
        writer.writerow([values.get(column,'') for column in columns])
    return output.getvalue()


def test_csv_quotes_bom_grouping_mcq_and_ist():
    text=csv_text([{'Weightage (%)':'50'},{'Weightage (%)':'50','Question Type':'MCQ','Option A':'List','Option B':'Dictionary',
        'Correct Answer':'B','Expected Reference Answer':'Dictionary'}])
    result=parse_csv('\ufeff'+text,'default')
    assert not result['fileErrors']
    assert len(result['groups'])==1
    group=result['groups'][0]
    assert group['status']=='valid'
    assert len(group['config']['questions'])==2
    assert group['config']['questions'][1]['correctOption']=='Dictionary'
    assert group['config']['startDate'].endswith('+05:30')
    assert 'services\nand APIs' in group['config']['jobDescription']


@pytest.mark.parametrize('row',[
    {'End Date':'2027-01-01'}, {'Start Date':'2027-02-30'}, {'Language Selection':'French'},
    {'Round Type':'MANAGERIAL'}, {'Question Type':'ESSAY'}, {'Max Duration (Seconds)':'0'},
    {'Max Duration (Seconds)':'1.5'}, {'Max Score':'-1'}, {'Weightage (%)':'NaN'},
    {'Question Prompt / Text':''}, {'Expected Reference Answer':''}, {'Weightage (%)':'101'},
    {'Question Type':'MCQ'},
])
def test_invalid_csv_values_block_group(row):
    result=parse_csv(csv_text([row]),'default')
    assert result['groups'][0]['status']=='invalid'
    assert result['rows'][0]['errors']


def test_invalid_question_or_inconsistent_header_blocks_entire_group():
    result=parse_csv(csv_text([{'Weightage (%)':'50'},{'Weightage (%)':'50','Question Prompt / Text':''}]),'default')
    assert all(row['status']=='invalid' for row in result['rows'])
    result=parse_csv(csv_text([{'Weightage (%)':'50'},{'Weightage (%)':'50','Language Selection':'Dutch'}],headers=['Assessment Group ID']+HEADERS+OPTIONAL),'default')
    assert result['groups'][0]['status']=='invalid'
    assert any(error['field']=='Language Selection' for row in result['rows'] for error in row['errors'])


@pytest.mark.parametrize('text',['','Job Description\nOnly description','"broken',csv_text(headers=HEADERS+['Job Description'])])
def test_invalid_csv_structure(text):
    assert parse_csv(text,'default')['fileErrors']


async def test_preview_confirm_partial_import_and_replay(module_client,db,monkeypatch):
    from app.services import assessment_management as service
    calls=[]
    async def forbidden(*args):calls.append(args);raise AssertionError('Import must not publish')
    monkeypatch.setattr(service,'create_upstream',forbidden)
    text=csv_text([{}, {'Job Title':'Invalid assessment','Question Prompt / Text':''}])
    body={'text':text}
    preview=(await module_client.post('/api/assessment-management/csv/validate',json=body,headers=headers())).json()
    assert await db['assessments'].count_documents({})==0
    body.update(previewHash=preview['previewHash'],confirmed=True)
    imported=await module_client.post('/api/assessment-management/csv/import',json=body,headers=headers())
    assert imported.status_code==200,imported.text
    assert imported.json()['imported']==1
    assert imported.json()['failed']==1
    again=await module_client.post('/api/assessment-management/csv/import',json=body,headers=headers())
    assert again.json()['imported']==0 and again.json()['duplicates']==1
    assert await db['assessments'].count_documents({})==1
    assert not calls
    assert await db['audit_log'].count_documents({'action':'assessment_management.csv_import'})==2
    bad=await module_client.post('/api/assessment-management/csv/import',json={**body,'previewHash':'0'*64},headers=headers())
    assert bad.status_code==409


async def test_csv_without_group_id_imports_every_question_and_replay_is_safe(module_client,db):
    assert 'Assessment Group ID' not in HEADERS+OPTIONAL
    text=csv_text([{'Weightage (%)':'50'}, {'Weightage (%)':'50','Question Prompt / Text':'Explain a list'}])
    preview=(await module_client.post('/api/assessment-management/csv/validate',json={'text':text},headers=headers())).json()
    assert not preview['fileErrors'] and len(preview['groups'])==1
    assert preview['groups'][0]['groupId']=='Assessment 1'
    assert len(preview['groups'][0]['config']['questions'])==2
    body={'text':text,'previewHash':preview['previewHash'],'confirmed':True}
    imported=await module_client.post('/api/assessment-management/csv/import',json=body,headers=headers())
    assert imported.status_code==200 and imported.json()['imported']==1
    saved=await db.assessments.find_one({})
    assert [q['text'] for q in saved['questions']]==['Explain a dictionary','Explain a list']
    repeated=await module_client.post('/api/assessment-management/csv/import',json=body,headers=headers())
    assert repeated.json()['duplicates']==1 and await db.assessments.count_documents({})==1
    assert 'Group ID' not in str(repeated.json())


def test_csv_automatically_separates_assessments_by_existing_details():
    result=parse_csv(csv_text([{}, {'Job Title':'Different role'}]),'default')
    assert not result['fileErrors'] and len(result['groups'])==2
    assert all(group['status']=='valid' for group in result['groups'])
    assert result['groups'][0]['config']['jobId']!=result['groups'][1]['config']['jobId']


async def test_draft_edit_conflicts_validation_failure_and_immutable_identity(module_client,db):
    base='/api/assessment-management'
    created=await module_client.post(base,json={'config':config()},headers=headers())
    assert created.status_code==201,created.text
    record=created.json()
    changed=config();changed['jobTitle']='Revised assessment'
    saved=await module_client.put(base+'/JOB-test',json={'config':changed,'expectedRevision':1},headers=headers())
    assert saved.status_code==200 and saved.json()['revision']==2
    assert (await module_client.put(base+'/JOB-test',json={'config':changed,'expectedRevision':1},headers=headers())).status_code==409
    invalid=deepcopy(changed);invalid['questions'][0]['maxDuration']=-1
    assert (await module_client.put(base+'/JOB-test',json={'config':invalid,'expectedRevision':2},headers=headers())).status_code==422
    assert (await module_client.get(base+'/JOB-test',headers=headers())).json()['jobTitle']=='Revised assessment'
    changed['jobId']='JOB-altered'
    assert (await module_client.put(base+'/JOB-test',json={'config':changed,'expectedRevision':2},headers=headers())).status_code==422
    assert (await module_client.post(base,json={'config':config()},headers=headers())).status_code==409


async def test_publish_is_human_confirmed_single_call_and_locks_questions(module_client,db,monkeypatch):
    from app.services import assessment_management as service
    calls=[]
    async def publish(value):calls.append(service.upstream_payload(value))
    monkeypatch.setattr(service,'create_upstream',publish)
    base='/api/assessment-management'
    await module_client.post(base,json={'config':config()},headers=headers())
    assert (await module_client.post(base+'/JOB-test/publish',json={'expectedRevision':1},headers=headers())).status_code==422
    body={'expectedRevision':1,'confirmed':True}
    response=await module_client.post(base+'/JOB-test/publish',json=body,headers=headers())
    assert response.status_code==200,response.text
    assert response.json()['publicationState']=='published' and not response.json()['canEdit']
    assert (await module_client.post(base+'/JOB-test/publish',json=body,headers=headers())).status_code==200
    assert len(calls)==1 and calls[0]['questions'][0]['answer']=='A mapping from keys to values'
    assert (await module_client.put(base+'/JOB-test',json={'config':config(),'expectedRevision':3},headers=headers())).status_code==409
    assert await db['recruit_email_outbox'].count_documents({})==0


@pytest.mark.parametrize('code,phase',[(502,'draft'),(504,'uncertain')])
async def test_publication_failure_preserves_saved_config_and_blocks_uncertain_retry(module_client,db,monkeypatch,code,phase):
    from app.services import assessment_management as service
    calls=[]
    async def fail(value):calls.append(value);raise HTTPException(code,'Synthetic publication failure')
    monkeypatch.setattr(service,'create_upstream',fail)
    base='/api/assessment-management'
    await module_client.post(base,json={'config':config()},headers=headers())
    response=await module_client.post(base+'/JOB-test/publish',json={'expectedRevision':1,'confirmed':True},headers=headers())
    assert response.status_code==code
    row=(await module_client.get(base+'/JOB-test',headers=headers())).json()
    assert row['questions'][0]['text']==config()['questions'][0]['text'] and row['publicationState']==phase
    if phase=='uncertain':
        assert (await module_client.post(base+'/JOB-test/publish',json={'expectedRevision':row['revision'],'confirmed':True},headers=headers())).status_code==409
        assert len(calls)==1


async def test_recruiter_owner_readonly_sharing_and_cross_org_access(module_client,db):
    base='/api/assessment-management'
    assert (await module_client.post(base,json={'config':config()},headers=headers('recruiter'))).status_code==201
    assert (await module_client.get(base,headers=headers('recruiter'))).json()['total']==1
    assert (await module_client.get(base,headers=headers('hr'))).json()['total']==0
    assert (await module_client.get(base+'/JOB-test',headers=headers(org='other'))).status_code==404
    assert (await module_client.post(base,json={'config':config('JOB-other')},headers=headers('viewer'))).status_code==403
    await db['assessments'].update_one({'jobId':'JOB-test'},{'$set':{'allowedUserIds':['viewer','hr']}})
    shared=(await module_client.get(base+'/JOB-test',headers=headers('viewer'))).json()
    assert not shared['canEdit'] and not shared['canPublish']
    assert (await module_client.put(base+'/JOB-test',json={'config':config(),'expectedRevision':1},headers=headers('hr'))).status_code==403
    await db['users'].update_one({'userId':'recruiter'},{'$set':{'jobAccess':['view','upload']}})
    assert (await module_client.post(base,json={'config':config('JOB-other')},headers=headers('recruiter'))).status_code==403


async def test_v1_feature_guard_and_scoped_pagination_filters(module_client,db,monkeypatch):
    base='/api/assessment-management'
    await module_client.post(base,json={'config':config()},headers=headers())
    for index in range(25):
        row=await db['assessments'].find_one({'jobId':'JOB-test'});row.pop('_id')
        await db['assessments'].insert_one({**row,'jobId':f'JOB-{index:02}','language':'DUTCH' if index<5 else 'ENGLISH'})
    response=await module_client.get(base+'?limit=20',headers=headers())
    assert response.json()['total']==26 and len(response.json()['items'])==20
    assert len((await module_client.get(base+'?limit=20&skip=20',headers=headers())).json()['items'])==6
    assert (await module_client.get(base+'?language=DUTCH&status=Draft',headers=headers())).json()['total']==5
    assert (await module_client.get(base+'?search=%24ne',headers=headers())).json()['total']==0
    assert (await module_client.get(base+'?startsFrom=2028-01-01T00:00:00Z&startsTo=2027-01-01T00:00:00Z',headers=headers())).json()['total']==0
    assert (await module_client.get(base+'?status=Cancelled',headers=headers())).status_code==422
    monkeypatch.setattr(settings,'mongodb_database','primehire_admin')
    assert (await module_client.get(base,headers=headers())).status_code==404


async def test_simultaneous_publication_only_sends_one_upstream_request(module_client,monkeypatch):
    from app.services import assessment_management as service
    entered=asyncio.Event();release=asyncio.Event();calls=[]
    async def slow(value):
        calls.append(value);entered.set();await release.wait()
    monkeypatch.setattr(service,'create_upstream',slow)
    base='/api/assessment-management'
    await module_client.post(base,json={'config':config()},headers=headers())
    body={'expectedRevision':1,'confirmed':True}
    first=asyncio.create_task(module_client.post(base+'/JOB-test/publish',json=body,headers=headers()))
    await asyncio.wait_for(entered.wait(),5)
    second=await module_client.post(base+'/JOB-test/publish',json=body,headers=headers())
    assert second.status_code==409
    release.set()
    assert (await first).status_code==200
    assert len(calls)==1


@pytest.mark.parametrize('status,code',[(201,None),(400,502),(409,504),(500,504),(200,502)])
async def test_publication_adapter_uses_existing_contract_and_safe_failures(monkeypatch,status,code):
    from app.services import assessment_management as service
    from app.schemas.assessment_management import AssessmentConfig
    import httpx
    calls=[]
    monkeypatch.setattr(service,'_base_and_headers',lambda:('https://provider.invalid',{'x-test':'fixture'}))
    class FakeClient:
        def __init__(self,**kwargs):assert kwargs['timeout']==60
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            calls.append((url,kwargs['json']))
            return httpx.Response(status,json={'status':'ERROR' if status==200 else 'SUCCESS'})
    monkeypatch.setattr(service.httpx,'AsyncClient',FakeClient)
    if code:
        with pytest.raises(HTTPException) as error:await service.create_upstream(AssessmentConfig.model_validate(config()))
        assert error.value.status_code==code
    else:
        await service.create_upstream(AssessmentConfig.model_validate(config()))
    assert len(calls)==1 and calls[0][0].endswith('/assessment')
    assert calls[0][1]['questions'][0]['type']=='SPEAK_TO_ANSWER'


async def test_timezone_status_filters_and_hr_payload(module_client,db):
    from app.services.assessment_management import upstream_payload
    from app.schemas.assessment_management import AssessmentConfig
    value=config();value.update(roundType='HR');value['questions'][0].pop('weightage');value['questions'][0].pop('maxScore')
    value['questions'][0].update(type='MCQ',options=['A','B'],correctOption='B')
    question=upstream_payload(AssessmentConfig.model_validate(value))['questions'][0]
    assert question['correct_option_id']=='B' and 'answer' not in question and 'weightage' not in question and 'max_score' not in question
    await module_client.post('/api/assessment-management',json={'config':config()},headers=headers())
    for key,start,end,active in [('future',1,2,True),('current',-1,1,True),('ended',-2,-1,True),('inactive',1,2,False)]:
        row=await db['assessments'].find_one({'jobId':'JOB-test'});row.pop('_id')
        await db['assessments'].insert_one({**row,'jobId':'JOB-'+key,'publicationState':'published','isActive':active,
            'windowStart':now()+timedelta(days=start),'windowEnd':now()+timedelta(days=end)})
    for status,key in [('Scheduled','future'),('Active','current'),('Completed','ended'),('Inactive','inactive')]:
        response=await module_client.get('/api/assessment-management?status='+status,headers=headers())
        assert response.status_code==200
        assert [row['id'] for row in response.json()['items']]==['JOB-'+key]


async def test_body_size_limit_and_v2_only_migration(module_client,db):
    response=await module_client.post('/api/assessment-management/csv/validate',content=b'x',
        headers={**headers(),'Content-Length':str(5*1024*1024),'Content-Type':'application/json'})
    assert response.status_code==413
    from migrations.assessment_management_v2 import upgrade
    plan=await upgrade(db,dry_run=True)
    assert plan['backfill'] is False
    with pytest.raises(RuntimeError):await upgrade(db)
    if getattr(type(db), 'backend', None) == 'postgresql':
        from copy import copy
        v2=copy(db)
        v2.name='primehire_admin_v2'
    else:
        v2=db.client['primehire_admin_v2']
    await upgrade(v2)
    await upgrade(v2)
    assert await v2['migrations'].count_documents({'version':'009_assessment_management_v2'})==1


def test_malformed_row_blocks_its_identified_group_and_limits_are_bounded():
    source=csv_text([{'Weightage (%)':'50'},{'Weightage (%)':'50'}])
    lines=source.splitlines(keepends=True)
    # Append an extra field to the last record; both question rows stay blocked.
    source=source.rstrip('\r\n')+',extra\r\n'
    result=parse_csv(source,'default')
    assert result['groups'][0]['status']=='invalid'
    assert all(row['status']=='invalid' for row in result['rows'])
    assert parse_csv('x'*2_000_001,'default')['fileErrors']


async def test_job_workspace_assessment_filter_is_exact(module_client):
    for key in ["JOB-workspace", "JOB-workspace-other"]:
        response = await module_client.post("/api/assessment-management", json={"config": config(key)}, headers=headers())
        assert response.status_code == 201
    response = await module_client.get("/api/assessment-management?assessmentId=JOB-workspace", headers=headers())
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == "JOB-workspace"


@pytest.mark.parametrize('body,expected',[
    ({'detail':'Some attributes are missing in request body'},'Some attributes are missing'),
    ({'detail':[{'loc':['body','questions',0,'answer'],'msg':'Field required','input':{'secret':'never echo'}}]},'body.questions.0.answer: Field required'),
    ({'detail':'<html>gateway diagnostic</html>'},''),
    ({'detail':'invalid fixture-secret'},'[REDACTED]'),
])
def test_provider_validation_reason_is_safe_and_actionable(body,expected):
    import httpx
    from app.services.assessment_management import provider_error
    message=provider_error(httpx.Response(400,json=body),{'x-secret-key':'fixture-secret'})
    assert expected in message
    assert 'never echo' not in message and 'fixture-secret' not in message

async def test_validation_failure_preserves_reason_in_saved_draft(module_client,db,monkeypatch):
    from app.services import assessment_management as service
    async def refused(config):
        raise HTTPException(502,'PrimeHire refused publication (HTTP 400). The draft is preserved. Reason: Some attributes are missing in request body')
    monkeypatch.setattr(service,'create_upstream',refused)
    await module_client.post('/api/assessment-management',json={'config':config()},headers=headers())
    failed=await module_client.post('/api/assessment-management/JOB-test/publish',json={'expectedRevision':1,'confirmed':True},headers=headers())
    assert failed.status_code==502
    record=(await module_client.get('/api/assessment-management/JOB-test',headers=headers())).json()
    assert record['publicationState']=='draft'
    assert 'Some attributes are missing' in record['publishError']
    assert len(record['questions'])==1


def test_provider_documented_basic_spoken_and_mcq_contract():
    from app.services.assessment_management import upstream_payload
    from app.schemas.assessment_management import AssessmentConfig
    value=config()
    value['roundType']='BASIC'
    value['questions']=[
        {'id':'q_1','text':'Describe solving a problem.','type':'SPEAK_TO_ANSWER','maxDuration':120,'referenceAnswer':'fallback rubric','criteria':'Structured thinking and ownership','maxScore':100.0,'weightage':50.0},
        {'id':'q_2','text':'Which describes a sprint?','type':'MCQ','maxDuration':120,'referenceAnswer':'A fixed iteration','options':['A fixed iteration','An indefinite phase'],'correctOption':'A fixed iteration','maxScore':100.0,'weightage':50.0}]
    payload=upstream_payload(AssessmentConfig.model_validate(value))
    spoken,mcq=payload['questions']
    assert spoken['criteria']=='Structured thinking and ownership' and 'answer' not in spoken
    assert mcq['correct_option_id']=='A' and mcq['options']==[{'id':'A','data':'A fixed iteration'},{'id':'B','data':'An indefinite phase'}]
    assert 'answer' not in mcq and 'correctOption' not in mcq
    assert type(mcq['max_score']) is int and type(mcq['weightage']) is int
    assert payload['job_id']=='JOB-test' and payload['round_type']=='BASIC'


def test_technical_mcq_answer_maps_to_matching_option_id():
    from app.services.assessment_management import upstream_payload
    from app.schemas.assessment_management import AssessmentConfig
    value=config()
    value['questions'][0].update(type='MCQ',options=['Open AI','Anthropic'],correctOption='Anthropic')
    payload=upstream_payload(AssessmentConfig.model_validate(value))
    assert payload['questions'][0]['correct_option_id']=='B'
    assert 'answer' not in payload['questions'][0]
