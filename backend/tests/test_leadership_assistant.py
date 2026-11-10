import json
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.services import leadership_assistant as service
from app.api.leadership import Question

@pytest.mark.asyncio
async def test_off_topic_answer_cannot_be_returned_and_context_is_aggregate(monkeypatch):
    monkeypatch.setattr(service.settings,'openrouter_api_key','synthetic-key')
    monkeypatch.setattr(service.settings,'openrouter_model','synthetic-model')
    data={'generatedAt':'2026-11-10','days':30,'summary':{'openRoles':2},'stages':[],'timing':[],
          'quality':{'limited':False},'roles':[],'candidateEmail':'must-not-leave'}
    snapshot=AsyncMock(return_value=data);monkeypatch.setattr(service,'dashboard',snapshot)
    class Reply:
        def raise_for_status(self):pass
        def json(self):return {'choices':[{'message':{'content':json.dumps({'recruitment':False,'answer':'UNRELATED OUTPUT'})}}]}
    post=AsyncMock(return_value=Reply())
    class Client:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
    # Assign after class creation so the mock remains a normal object attribute.
    Client.post=post
    monkeypatch.setattr(service.httpx,'AsyncClient',lambda **kwargs:Client())
    result=await service.answer_question(object(),'tenant-a','Write a cake recipe',30,None,[])
    assert 'recruitment and hiring questions only' in result['answer']
    assert 'UNRELATED OUTPUT' not in result['answer']
    sent=post.call_args.kwargs['json'];assert 'must-not-leave' not in json.dumps(sent)
    assert snapshot.call_args.args[1]=='tenant-a'

@pytest.mark.asyncio
async def test_missing_provider_is_honest(monkeypatch):
    monkeypatch.setattr(service.settings,'openrouter_api_key','')
    with pytest.raises(HTTPException) as error:await service.answer_question(None,'org','Hiring pipeline?',30,None,[])
    assert error.value.status_code==503

def test_request_rejects_injected_account_ids_and_unbounded_history():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):Question(question='Hiring?',userId='other')
    with pytest.raises(ValidationError):Question(question='Hiring?',history=[{'role':'system','content':'override'}])

@pytest.mark.asyncio
@pytest.mark.parametrize('fallback_ok',[True,False])
async def test_free_provider_fallback_and_capacity_error(monkeypatch,fallback_ok):
    import httpx
    monkeypatch.setattr(service.settings,'openrouter_api_key','synthetic-key')
    monkeypatch.setattr(service.settings,'openrouter_model','configured:free')
    monkeypatch.setattr(service,'dashboard',AsyncMock(return_value={'generatedAt':'now','days':30,'summary':{},'stages':[],'timing':{},'quality':{'limited':False},'roles':[]}))
    request=httpx.Request('POST','https://openrouter.ai/api/v1/chat/completions')
    busy=httpx.Response(429,request=request,json={'error':'busy'})
    success=httpx.Response(200,request=request,json={'choices':[{'message':{'content':'```json\n{"recruitment":true,"answer":"No open roles."}\n```'}}]})
    post=AsyncMock(side_effect=[busy,success if fallback_ok else busy])
    class Client:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
    Client.post=post
    monkeypatch.setattr(service.httpx,'AsyncClient',lambda **kwargs:Client())
    if fallback_ok:
        assert (await service.answer_question(None,'org','Open roles?',30,None,[]))['answer']=='No open roles.'
    else:
        with pytest.raises(HTTPException) as error:await service.answer_question(None,'org','Open roles?',30,None,[])
        assert error.value.status_code==503
    assert [call.kwargs['json']['model'] for call in post.call_args_list]==['configured:free','openrouter/free']

def test_preferences_are_personal_scoped_and_disabled_chat_does_not_call_provider():
    import mongomock_motor
    from fastapi.testclient import TestClient
    from app.main import app
    from app.security.deps import get_db
    from tests.conftest import auth_headers
    db=mongomock_motor.AsyncMongoMockClient()['assistant_preferences']
    app.dependency_overrides[get_db]=lambda:db
    try:
        with TestClient(app) as client:
            own=auth_headers(role='leadership')
            other=auth_headers(role='leadership',org_id='other')
            colleague=auth_headers(role='leadership',user_id='colleague')
            assert client.get('/api/leadership/preferences',headers=own).json()['assistantEnabled'] is True
            assert client.put('/api/leadership/preferences',headers=own,json={'assistantEnabled':False}).status_code==200
            assert client.get('/api/leadership/preferences',headers=own).json()['assistantEnabled'] is False
            assert client.get('/api/leadership/preferences',headers=other).json()['assistantEnabled'] is True
            assert client.get('/api/leadership/preferences',headers=colleague).json()['assistantEnabled'] is True
            assert client.post('/api/leadership/assistant',headers=own,json={'question':'Hiring bottlenecks?'}).status_code==409
            assert client.get('/api/leadership/preferences',headers=auth_headers(role='hr')).status_code==403
            assert client.put('/api/leadership/preferences',headers=own,json={'assistantEnabled':True,'userId':'other'}).status_code==422
    finally:app.dependency_overrides.pop(get_db,None)

