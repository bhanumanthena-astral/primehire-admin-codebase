"""Synthetic Google integration: no Google accounts, paid calls, or live credentials."""
import json
import logging
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit
from unittest.mock import AsyncMock

import httpx
import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.main import app
from app.config import settings, Settings, validate_settings
from app.security.deps import get_db
from app.security.tokens import create_access_token, hash_token
from app.models.user import utcnow
from app.services import google_oauth as oauth, google_calendar as calendar
from migrations.google_workspace_v2 import upgrade
from tests.test_recruitment import client as recruitment_client, headers
from tests.test_recruitment import schedule as scheduling_body


@pytest.fixture
async def google(db, monkeypatch):
    from app.security.rate_limit import limiter
    for path in ['/api/auth/google/start','/api/auth/google/callback','/api/auth/google/complete','/api/google/calendar/connect']:
        limiter.reset('google-auth:127.0.0.1:'+path)
    monkeypatch.setattr(settings, 'google_oauth_enabled', True)
    monkeypatch.setattr(settings, 'google_client_id', 'synthetic.apps.googleusercontent.com')
    monkeypatch.setattr(settings, 'google_client_secret', 'synthetic-client-secret')
    monkeypatch.setattr(settings, 'google_redirect_uri', 'http://localhost:3000/api/auth/google/callback')
    monkeypatch.setattr(settings, 'google_token_encryption_key', Fernet.generate_key().decode())
    monkeypatch.setattr(settings, 'google_login_org_id', 'default')
    await upgrade(db)


@pytest.fixture
async def client(db, google):
    app.dependency_overrides[get_db] = lambda: db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost:3000') as value:
        yield value
    app.dependency_overrides.clear()


async def user(db, uid='member', email='member@gmail.com', role='technical_interviewer', org='default', mfa=False):
    row={'orgId':org,'userId':uid,'email':email,'name':'Synthetic Member','role':role,'isActive':True,
         'mfa':{'enabled':mfa},'passwordHash':'placeholder'}
    await db['users'].insert_one(row)
    return row


async def connection(db, uid='member', org='default'):
    await db['google_connections'].insert_one({'orgId':org,'userId':uid,'subject':'google-sub-'+uid,
        'email':'member@gmail.com','status':'connected','scopes':[oauth.CALENDAR_SCOPE],
        'accessTokenEncrypted':oauth.encrypt('synthetic-access'),
        'refreshTokenEncrypted':oauth.encrypt('synthetic-refresh'),'expiresAt':utcnow()+timedelta(hours=1)})


def claims(email='member@gmail.com', subject='subject-member'):
    return {'sub':subject,'email':email,'email_verified':True}


def exchange(monkeypatch, identity=None, scope='openid email profile'):
    post=AsyncMock(return_value={'id_token':'synthetic-id-token','access_token':'synthetic-access',
        'refresh_token':'synthetic-refresh','expires_in':3600,'scope':scope})
    monkeypatch.setattr(oauth,'post_token',post)
    monkeypatch.setattr(oauth,'verify_identity',AsyncMock(return_value=identity or claims()))
    return post


async def begin(client, path='/api/auth/google/start', headers=None):
    response=await client.post(path,json={'returnTo':'/reports'},headers=headers)
    assert response.status_code==200,response.text
    params=parse_qs(urlsplit(response.json()['authorizationUrl']).query)
    return params


async def finish(client, params):
    return await client.get('/api/auth/google/callback',params={'state':params['state'][0],'code':'synthetic-code'})


async def test_login_uses_pkce_one_use_browser_binding_and_no_tokens_in_redirect(client,db,monkeypatch):
    await user(db)
    post=exchange(monkeypatch)
    params=await begin(client)
    assert params['code_challenge_method']==['S256']
    assert oauth.CALENDAR_SCOPE not in params['scope'][0]
    assert 'access_type' not in params
    state=await db['google_oauth_tickets'].find_one({'_id':hash_token(params['state'][0])})
    assert state['verifier']!='synthetic-code'
    response=await finish(client,params)
    assert response.status_code==303 and response.headers['location']=='/auth/google/complete'
    assert 'synthetic' not in response.headers['location']
    assert post.call_args.args[0]['code_verifier']==oauth.decrypt(state['verifier'])
    complete=await client.post('/api/auth/google/complete')
    assert complete.status_code==200,complete.text
    assert complete.json()['user']['role']=='technical_interviewer'
    assert complete.json()['returnTo']=='/reports'
    assert 'primehire_refresh_token=' in complete.headers['set-cookie']
    assert (await client.post('/api/auth/google/complete')).status_code==400
    assert await db['sessions'].count_documents({})==1
    # The same authorization state cannot be exchanged a second time.
    await finish(client,params)
    assert post.await_count==1


async def test_browser_binding_rejects_stolen_state_without_consuming_owner_state(client,db,monkeypatch):
    await user(db)
    post=exchange(monkeypatch)
    params=await begin(client)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:3000') as attacker:
        await finish(attacker,params)
        error=await attacker.post('/api/auth/google/complete')
        assert error.status_code==400
    assert post.await_count==0
    await finish(client,params)
    assert (await client.post('/api/auth/google/complete')).status_code==200


@pytest.mark.parametrize('email,role,mfa,expected',[
    ('member@gmail.com','super_admin',False,400),
    ('member@gmail.com','super_admin',True,200),
    ('member@example.test','technical_interviewer',False,400),
])
async def test_mfa_preserved_and_non_authoritative_email_requires_explicit_link(client,db,monkeypatch,email,role,mfa,expected):
    await user(db,email=email,role=role,mfa=mfa)
    exchange(monkeypatch,claims(email=email))
    params=await begin(client)
    await finish(client,params)
    response=await client.post('/api/auth/google/complete')
    assert response.status_code==expected,response.text
    if mfa:
        assert response.json()['mfaRequired'] is True
        assert 'accessToken' not in response.json()
    assert await db['sessions'].count_documents({})==0


async def test_no_auto_registration_or_cross_org_matching(client,db,monkeypatch):
    await user(db,org='another')
    exchange(monkeypatch)
    await finish(client,await begin(client))
    response=await client.post('/api/auth/google/complete')
    assert response.status_code==400
    assert await db['users'].count_documents({})==1
    assert await db['google_identities'].count_documents({})==0


async def test_calendar_incremental_consent_encrypted_tokens_and_self_only_status(client,db,monkeypatch):
    await user(db)
    await db['sessions'].insert_one({'orgId':'default','userId':'member','sessionId':'fixture',
        'expiresAt':utcnow()+timedelta(days=1),'revokedAt':None})
    exchange(monkeypatch,scope='openid email profile '+oauth.CALENDAR_SCOPE)
    params=await begin(client,'/api/google/calendar/connect',headers(uid='member',role='technical_interviewer'))
    assert oauth.CALENDAR_SCOPE in params['scope'][0]
    assert params['access_type']==['offline']
    await finish(client,params)
    response=await client.post('/api/auth/google/complete')
    assert response.json()['calendarConnected'] is True,response.text
    row=await db['google_connections'].find_one({'userId':'member'})
    assert row['refreshTokenEncrypted']!='synthetic-refresh'
    assert oauth.decrypt(row['refreshTokenEncrypted'])=='synthetic-refresh'
    status=await client.get('/api/google/calendar',headers=headers(uid='member',role='technical_interviewer'))
    assert status.json()['connected'] is True
    assert 'Token' not in status.text and 'subject' not in status.text
    other=await client.get('/api/google/calendar',headers=headers(uid='other',role='technical_interviewer',org='other'))
    assert other.json()['connected'] is False


async def test_connect_rechecks_revoked_session_and_rejects_wrong_google_account(client,db,monkeypatch):
    await user(db)
    await db['sessions'].insert_one({'orgId':'default','userId':'member','sessionId':'fixture',
        'expiresAt':utcnow()+timedelta(days=1),'revokedAt':None})
    exchange(monkeypatch,claims(email='someoneelse@gmail.com'),scope=oauth.CALENDAR_SCOPE)
    params=await begin(client,'/api/google/calendar/connect',headers(uid='member',role='technical_interviewer'))
    await finish(client,params)
    assert (await client.post('/api/auth/google/complete')).status_code==400
    assert await db['google_connections'].count_documents({})==0
    params=await begin(client,'/api/google/calendar/connect',headers(uid='member',role='technical_interviewer'))
    await db['sessions'].update_one({'sessionId':'fixture'},{'$set':{'revokedAt':utcnow()}})
    await finish(client,params)
    assert (await client.post('/api/auth/google/complete')).status_code==400


async def test_denied_calendar_consent_never_stores_grant(client,db,monkeypatch):
    await user(db)
    await db['sessions'].insert_one({'orgId':'default','userId':'member','sessionId':'fixture',
        'expiresAt':utcnow()+timedelta(days=1),'revokedAt':None})
    exchange(monkeypatch)
    await finish(client,await begin(client,'/api/google/calendar/connect',headers(uid='member',role='technical_interviewer')))
    assert (await client.post('/api/auth/google/complete')).status_code==400
    assert await db['google_connections'].count_documents({})==0


async def test_id_token_signature_issuer_audience_expiry_and_nonce(google,monkeypatch):
    private=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    key=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    key['kid']='synthetic-key'
    monkeypatch.setattr(oauth,'_jwks',[key]);monkeypatch.setattr(oauth,'_jwks_until',utcnow()+timedelta(hours=1))
    data={**claims(),'aud':settings.google_client_id,'iss':'https://accounts.google.com',
          'iat':utcnow(),'exp':utcnow()+timedelta(minutes=5),'nonce':'nonce'}
    def sign(values):return jwt.encode(values,private,algorithm='RS256',headers={'kid':'synthetic-key'})
    assert (await oauth.verify_identity(sign(data),'nonce'))['sub']=='subject-member'
    for change in [{'aud':'wrong'},{'iss':'https://attacker.test'},{'nonce':'wrong'},
                   {'exp':utcnow()-timedelta(minutes=5)},{'email_verified':False}]:
        with pytest.raises(HTTPException):
            await oauth.verify_identity(sign({**data,**change}),'nonce')


def slot():
    start=(utcnow()+timedelta(days=3)).replace(hour=10,minute=0,second=0,microsecond=0)
    return start,start+timedelta(hours=1)


@pytest.mark.parametrize('kind,available',[('overlap',False),('boundary',True),('all_day',False),
    ('transparent',True),('cancelled',True),('declined',True),('other_day',True)])
async def test_calendar_blocks_only_overlaps_not_other_meetings(google,db,monkeypatch,kind,available):
    await user(db);await connection(db)
    start,end=slot()
    event={'id':'other-meeting','start':{'dateTime':start.isoformat()},'end':{'dateTime':end.isoformat()}}
    if kind=='boundary':event['start']['dateTime']=end.isoformat();event['end']['dateTime']=(end+timedelta(hours=1)).isoformat()
    if kind=='all_day':event.update(start={'date':start.date().isoformat()},end={'date':(start+timedelta(days=1)).date().isoformat()})
    if kind=='transparent':event['transparency']='transparent'
    if kind=='cancelled':event['status']='cancelled'
    if kind=='declined':event['attendees']=[{'self':True,'responseStatus':'declined'}]
    if kind=='other_day':event.update(start={'dateTime':(start-timedelta(days=1)).isoformat()},end={'dateTime':(end-timedelta(days=1)).isoformat()})
    call=AsyncMock(return_value={'timeZone':'Asia/Kolkata','items':[event]})
    monkeypatch.setattr(calendar,'request',call)
    result=await calendar.check_availability(db,'default','member',start,end)
    assert result['available'] is available
    assert call.call_args.kwargs['params']['singleEvents']=='true'
    assert 'summary' not in call.call_args.kwargs['params']['fields']


async def test_reschedule_excludes_own_event_but_not_other_events(google,db,monkeypatch):
    await user(db);await connection(db)
    start,end=slot()
    own=calendar.event_id('default','interview','member','google-sub-member')
    event={'id':own,'start':{'dateTime':start.isoformat()},'end':{'dateTime':end.isoformat()}}
    fake=AsyncMock(return_value={'items':[event]});monkeypatch.setattr(calendar,'request',fake)
    existing={'interviewId':'interview','interviewerId':'member'}
    assert (await calendar.check_availability(db,'default','member',start,end,existing=existing))['available'] is True
    fake.return_value={'items':[event,{**event,'id':'other'}]}
    assert (await calendar.check_availability(db,'default','member',start,end,existing=existing))['available'] is False


async def test_unconnected_is_not_free_and_usage_budget_is_shared(google,db,monkeypatch):
    await user(db)
    with pytest.raises(HTTPException):await oauth.access_token(db,'default','member')
    monkeypatch.setattr(settings,'google_calendar_daily_limit',2)
    await calendar.budget(db,'one');await calendar.budget(db,'two')
    with pytest.raises(HTTPException) as exc:await calendar.budget(db,'three')
    assert exc.value.status_code==429


async def test_refresh_expiry_wipes_revoked_grants(google,db,monkeypatch):
    await user(db);await connection(db)
    await db['google_connections'].update_one({'userId':'member'},{'$set':{'expiresAt':utcnow()-timedelta(minutes=1)}})
    monkeypatch.setattr(oauth,'post_token',AsyncMock(side_effect=HTTPException(401,'Reconnect your Google account')))
    with pytest.raises(HTTPException):await oauth.access_token(db,'default','member')
    row=await db['google_connections'].find_one({'userId':'member'})
    assert row['status']=='reconnect_required' and 'refreshTokenEncrypted' not in row


def booking():
    start,end=slot()
    return {'orgId':'default','interviewId':'interview','interviewerId':'member','status':'scheduled',
            'round':'technical','startsAt':start,'endsAt':end,'scheduleRevision':1,'reminderMinutes':15}


async def test_outbox_event_creation_is_idempotent_and_has_private_reminder(google,db,monkeypatch):
    await user(db);await connection(db)
    row=booking();await db['recruit_interviews'].insert_one(row)
    monkeypatch.setattr(calendar,'check_availability',AsyncMock(return_value={'available':True}))
    calls=AsyncMock(side_effect=[None,{'id':'new'}]);monkeypatch.setattr(calendar,'request',calls)
    await calendar.enqueue(db,row)
    assert (await calendar.sync_interview(db,row))['status']=='synced'
    body=calls.call_args.kwargs['body']
    assert body['reminders']=={'useDefault':False,'overrides':[{'method':'popup','minutes':15}]}
    assert body['visibility']=='private' and 'attendees' not in body
    assert calls.call_args.kwargs['params']['sendUpdates']=='none'
    await calendar.sync_interview(db,row)
    assert calls.await_count==2
    stored=await db['recruit_interviews'].find_one({'interviewId':'interview'})
    assert stored['googleCalendarStatus']=='synced'


async def test_transient_failure_retries_and_stale_booking_intent_is_discarded(google,db,monkeypatch):
    await user(db);await connection(db)
    row=booking();await db['recruit_interviews'].insert_one(row)
    monkeypatch.setattr(calendar,'check_availability',AsyncMock(side_effect=HTTPException(503,'Google Calendar is unavailable')))
    await calendar.enqueue(db,row)
    assert (await calendar.sync_interview(db,row))['status']=='pending'
    job=await db['google_calendar_outbox'].find_one()
    assert job['attempts']==1 and job['status']=='pending'
    await db['recruit_interviews'].update_one({'interviewId':'interview'},{'$set':{'scheduleRevision':2}})
    await db['google_calendar_outbox'].update_one({'_id':job['_id']},{'$set':{'nextAttemptAt':utcnow()-timedelta(seconds=1)}})
    await calendar.tick(db)
    assert (await db['google_calendar_outbox'].find_one())['status']=='obsolete'


async def test_cancel_deletes_only_owned_events(google,db,monkeypatch):
    await user(db);await connection(db)
    row=booking();row['status']='cancelled';row['googleCalendar']={'eventId':calendar.event_id('default','interview','member','google-sub-member'),'userId':'member','subject':'google-sub-member'}
    await db['recruit_interviews'].insert_one(row)
    calls=AsyncMock(return_value={'extendedProperties':{'private':{'eliteInterview':'some-other-interview','eliteOrg':'default'}}})
    monkeypatch.setattr(calendar,'request',calls)
    await calendar.enqueue(db,row)
    result=await calendar.sync_interview(db,row)
    assert result['status']=='needs_attention' and calls.await_count==1
    calls.reset_mock();calls.side_effect=[{'extendedProperties':{'private':{'eliteInterview':'interview','eliteOrg':'default'}}},{}]
    await calendar.enqueue(db,row)
    assert (await calendar.sync_interview(db,row))['status']=='removed'
    assert calls.call_args.args[3]=='DELETE'


async def test_google_conflict_prevents_local_booking(recruitment_client,db,google,monkeypatch):
    start,end=slot()
    monkeypatch.setattr(calendar,'check_availability',AsyncMock(return_value={'available':False,'message':'overlapping meeting'}))
    response=await recruitment_client.post('/api/recruitment/interviews',headers=headers(),json={
        'applicationId':'app0','round':'technical','interviewerId':'technical_interviewer',
        'startsAt':start.isoformat(),'endsAt':end.isoformat(),'reason':'Schedule technical interview'})
    assert response.status_code==409,response.text
    assert await db['recruit_interviews'].count_documents({})==0


def test_safe_returns_config_validation_and_access_log_redaction():
    from app.security.google_logging import GoogleCallbackFilter
    for value in ['//attacker.test','/\\attacker.test','https://attacker.test','/%2f%2fattacker.test','/auth/google/complete']:
        assert oauth.return_path(value)=='/'
    record=logging.LogRecord('uvicorn.access',20,'',0,'%s %s',('GET','/api/auth/google/callback?code=secret&state=secret'),None)
    GoogleCallbackFilter().filter(record)
    assert 'secret' not in record.getMessage()
    target=Settings(_env_file=None,google_oauth_enabled=True,mongodb_database='primehire_admin_v2')
    with pytest.raises(RuntimeError):validate_settings(target)
    target.google_client_id='synthetic';target.google_client_secret='synthetic';target.google_token_encryption_key=Fernet.generate_key().decode()
    validate_settings(target)
    target.google_redirect_uri='http://attacker.test/api/auth/google/callback'
    with pytest.raises(RuntimeError):validate_settings(target)


async def test_real_schedule_reschedule_reassign_cancel_journey(recruitment_client,db,google,monkeypatch):
    await connection(db,uid='technical_interviewer')
    await user(db,uid='second-tech',email='second@gmail.com')
    await connection(db,uid='second-tech')
    events={}
    async def provider(_db,org,uid,method,*,event_id='',params=None,body=None,allow=()):
        if method=='GET' and not event_id:
            return {'timeZone':'UTC','items':[event for (owner,_),event in events.items() if owner==uid]}
        key=(uid,event_id or body['id'])
        if method=='GET':return events.get(key)
        if method=='POST':events[key]=dict(body);return events[key]
        if method=='PATCH':events[key].update(body);return events[key]
        if method=='DELETE':events.pop(key,None);return {}
        raise AssertionError('Unexpected Calendar operation')
    fake=AsyncMock(side_effect=provider);monkeypatch.setattr(calendar,'request',fake)
    body=scheduling_body();response=await recruitment_client.post('/api/recruitment/interviews',headers=headers(),json=body)
    assert response.status_code==201,response.text
    row=response.json();key=row['interviewId']
    assert row['googleCalendarStatus']=='synced' and len(events)==1
    assert 'googleCalendar' not in row  # Provider subject/mapping remain private.
    start=(utcnow()+timedelta(days=4)).replace(microsecond=0)
    body.update(startsAt=start.isoformat(),endsAt=(start+timedelta(hours=1)).isoformat(),expectedRevision=row['revision'])
    response=await recruitment_client.put('/api/recruitment/interviews/'+key,headers=headers(),json=body)
    assert response.status_code==200,response.text
    row=response.json();assert row['googleCalendarStatus']=='synced' and len(events)==1
    assert next(iter(events.values()))['start']['dateTime']==start.isoformat()
    body.update(interviewerId='second-tech',expectedRevision=row['revision'])
    response=await recruitment_client.put('/api/recruitment/interviews/'+key,headers=headers(),json=body)
    assert response.status_code==200,response.text
    row=response.json();assert row['googleCalendarStatus']=='synced' and len(events)==1
    assert next(iter(events))[0]=='second-tech'
    response=await recruitment_client.post('/api/recruitment/interviews/'+key+'/cancel',headers=headers(),
        json={'expectedRevision':row['revision'],'reason':'Manager cancelled this interview'})
    assert response.status_code==200,response.text
    assert response.json()['googleCalendarStatus']=='removed' and events=={}


async def test_missing_connection_allows_manual_booking_without_calling_google(recruitment_client,db,google,monkeypatch):
    post=AsyncMock();monkeypatch.setattr(oauth,'post_token',post)
    response=await recruitment_client.post('/api/recruitment/interviews',headers=headers(),json=scheduling_body())
    assert response.status_code==201,response.text
    assert response.json()['googleCalendarStatus']=='not_connected'
    assert await db['recruit_interviews'].count_documents({})==1
    assert await db['google_calendar_outbox'].count_documents({})==0
    post.assert_not_called()


async def test_calendar_http_wrapper_fixed_endpoint_and_quota_failure(google,db,monkeypatch):
    await user(db);await connection(db)
    original=httpx.AsyncClient
    seen=[]
    def provider(request):
        seen.append(request)
        return httpx.Response(429,json={'error':{'message':'sensitive provider detail'}})
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original(**kwargs,transport=httpx.MockTransport(provider)))
    with pytest.raises(HTTPException) as exc:await calendar.request(db,'default','member','GET',params={'singleEvents':'true'})
    assert exc.value.status_code==503 and 'sensitive' not in str(exc.value.detail)
    assert str(seen[0].url).startswith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')
    assert seen[0].headers['authorization']=='Bearer synthetic-access'


async def test_cancel_recovers_provider_write_before_mapping_acknowledgement(google,db,monkeypatch):
    await user(db);await connection(db)
    row=booking();row['status']='cancelled'
    await db['recruit_interviews'].insert_one(row)
    fake=AsyncMock(side_effect=[{'extendedProperties':{'private':{'eliteInterview':'interview','eliteOrg':'default'}}},{}])
    monkeypatch.setattr(calendar,'request',fake)
    await calendar.enqueue(db,row)
    assert (await calendar.sync_interview(db,row))['status']=='removed'
    assert fake.call_args.args[3]=='DELETE'


async def test_worker_does_not_create_calendar_events_for_completed_interviews(google,db,monkeypatch):
    await user(db);await connection(db)
    row=booking();await calendar.enqueue(db,row)
    row['status']='completed';await db['recruit_interviews'].insert_one(row)
    fake=AsyncMock();monkeypatch.setattr(calendar,'request',fake)
    await calendar.tick(db)
    assert (await db['google_calendar_outbox'].find_one())['status']=='obsolete'
    fake.assert_not_called()


@pytest.mark.parametrize('role', ['admin', 'super_admin'])
async def test_admin_can_schedule_and_reschedule_without_google_connection(recruitment_client, db, google, monkeypatch, role):
    provider = AsyncMock(side_effect=AssertionError('An unconnected interviewer must not call Google'))
    monkeypatch.setattr(calendar, 'request', provider)
    response = await recruitment_client.post('/api/recruitment/interviews', headers=headers(role), json=scheduling_body())
    assert response.status_code == 201, response.text
    row = response.json()
    assert row['googleCalendarStatus'] == 'not_connected'
    assert await db['google_calendar_outbox'].count_documents({}) == 0
    payload = scheduling_body(expectedRevision=row['revision'], reason='Candidate requested a different time')
    start = aware_time(payload['startsAt']) + timedelta(hours=2)
    payload.update(startsAt=start.isoformat(), endsAt=(start+timedelta(hours=1)).isoformat())
    response = await recruitment_client.put('/api/recruitment/interviews/'+row['interviewId'], headers=headers(role), json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['googleCalendarStatus'] == 'not_connected'
    provider.assert_not_called()


def aware_time(value):
    from datetime import datetime
    return datetime.fromisoformat(value)


@pytest.mark.parametrize('state,scopes', [('missing', []), ('reconnect_required', [oauth.CALENDAR_SCOPE]), ('connected', ['openid', 'email'])])
async def test_missing_or_expired_calendar_grant_allows_manual_scheduling_without_claiming_free(google, db, monkeypatch, state, scopes):
    await user(db)
    if state != 'missing':
        await db['google_connections'].insert_one({'orgId':'default','userId':'member','status':state,'scopes':scopes})
    provider = AsyncMock();monkeypatch.setattr(calendar,'request',provider)
    result = await calendar.check_availability(db,'default','member',*slot())
    assert result['status'] == 'not_connected' and result['available'] is None
    provider.assert_not_called()


async def test_staff_connection_badges_are_scoped_minimal_and_selected_user_survives_filtering(recruitment_client, db, google):
    await connection(db,uid='technical_interviewer')
    await user(db,uid='unconnected')
    await connection(db,uid='unconnected',org='another-org')
    response = await recruitment_client.get('/api/recruitment/staff?role=technical_interviewer',headers=headers())
    assert response.status_code == 200
    people={row['userId']:row for row in response.json()['items']}
    assert people['technical_interviewer']['googleCalendarConnected'] is True
    assert people['unconnected']['googleCalendarConnected'] is False
    assert set(people['technical_interviewer']) == {'userId','name','role','googleCalendarConnected'}
    response=await recruitment_client.get('/api/recruitment/staff?role=technical_interviewer&search=absent&selectedUserId=technical_interviewer',headers=headers('admin'))
    assert response.json()['items'] == []
    assert response.json()['selected']['googleCalendarConnected'] is True
    response=await recruitment_client.get('/api/recruitment/staff?role=hr&selectedUserId=technical_interviewer',headers=headers())
    assert response.json()['selected'] is None
    response=await recruitment_client.get('/api/recruitment/staff?selectedUserId=other-tech',headers=headers())
    assert response.json()['selected'] is None
    response=await recruitment_client.get('/api/recruitment/staff',headers=headers('technical_interviewer'))
    assert response.status_code == 403


async def test_manually_scheduled_interviewer_can_connect_later_and_sync_on_reschedule(recruitment_client, db, google, monkeypatch):
    response=await recruitment_client.post('/api/recruitment/interviews',headers=headers(),json=scheduling_body())
    assert response.status_code == 201,response.text
    row=response.json();assert row['googleCalendarStatus']=='not_connected'
    await connection(db,uid='technical_interviewer')
    async def provider(_db,_org,_uid,method,**kwargs):
        if method=='GET' and not kwargs.get('event_id'):return {'items':[]}
        if method=='GET':return None
        return {'id':kwargs['body']['id']}
    monkeypatch.setattr(calendar,'request',provider)
    response=await recruitment_client.put('/api/recruitment/interviews/'+row['interviewId'],headers=headers(),
        json=scheduling_body(expectedRevision=row['revision'],reason='Interviewer connected their calendar'))
    assert response.status_code == 200,response.text
    assert response.json()['googleCalendarStatus']=='synced'
