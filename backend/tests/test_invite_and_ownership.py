"""Invitation onboarding and same-organization ownership boundaries."""
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import mongomock_motor
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models.user import utcnow
from app.security.deps import get_db
from app.security.passwords import verify_password
from app.security.rate_limit import limiter
from app.security.tokens import hash_token
from tests.conftest import auth_headers, job_payload

PASSWORD = 'Fictional-invite-test-2026!'

@pytest.fixture
def client():
    database = mongomock_motor.AsyncMongoMockClient()['onboarding']
    app.dependency_overrides[get_db] = lambda: database
    limiter.reset('invite:testclient')
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    limiter.reset('invite:testclient')

def invite(client, email='hr@example.test', role='hr'):
    response = client.post('/api/users', headers=auth_headers(),
        json={'email':email,'name':'Invited user','role':role})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body['user']['passwordSetupRequired']
    return body['user'], parse_qs(urlparse(body['inviteUrl']).fragment)['token'][0]

def setup(client, token, password=PASSWORD):
    return client.post('/api/auth/accept-invite', json={'token':token,'newPassword':password})

def test_setup_then_login_and_replay_denied(client):
    user, token = invite(client)
    assert setup(client, token).status_code == 200
    assert setup(client, token).status_code == 400
    database = app.dependency_overrides[get_db]()
    saved = client.portal.call(database['users'].find_one, {'userId':user['userId']})
    assert saved['passwordHash'] != PASSWORD
    assert verify_password(PASSWORD, saved['passwordHash'])
    stored = client.portal.call(database['invitations'].find_one, {'userId':user['userId']})
    assert stored['tokenHash'] == hash_token(token)
    assert token not in str(stored)
    result = client.post('/api/auth/login', json={'email':user['email'],'password':PASSWORD})
    assert result.status_code == 200, result.text
    assert result.json()['user']['role'] == 'hr'
    assert not result.json()['user']['passwordSetupRequired']
    assert 'passwordHash' not in result.text

def test_weak_password_preserves_invitation_and_reissue_revokes_old(client):
    user, token = invite(client)
    assert setup(client, token, 'password12345').status_code == 422
    result = client.post(f"/api/users/{user['userId']}/invite", headers=auth_headers())
    assert result.status_code == 200
    new_token = parse_qs(urlparse(result.json()['inviteUrl']).fragment)['token'][0]
    assert setup(client, token).status_code == 400
    assert setup(client, new_token).status_code == 200
    assert client.post(f"/api/users/{user['userId']}/invite", headers=auth_headers()).status_code == 409

@pytest.mark.parametrize('condition', ['expired','deactivated','wrong_kind','unknown'])
def test_invalid_invites_cannot_set_password(client, condition):
    user, token = invite(client)
    database = app.dependency_overrides[get_db]()
    if condition == 'expired':
        client.portal.call(database['invitations'].update_one, {'userId':user['userId']}, {'$set':{'expiresAt':utcnow()-timedelta(seconds=1)}})
    elif condition == 'deactivated':
        client.put(f"/api/users/{user['userId']}", headers=auth_headers(), json={'isActive':False})
    elif condition == 'wrong_kind':
        client.portal.call(database['invitations'].update_one, {'userId':user['userId']}, {'$set':{'kind':'reset'}})
    else:
        token = 'unknown-token-with-enough-length'
    assert setup(client, token).status_code == 400
    saved = client.portal.call(database['users'].find_one, {'userId':user['userId']})
    assert not saved['passwordHash']

def test_invite_throttles_and_management_requires_admin(client):
    user, _ = invite(client)
    assert client.post(f"/api/users/{user['userId']}/invite", headers=auth_headers(role='hr')).status_code == 403
    assert client.post(f"/api/users/{user['userId']}/invite", headers=auth_headers(org_id='other')).status_code == 404
    for _ in range(10):
        assert setup(client, 'invalid-token-with-enough-length').status_code == 400
    result = setup(client, 'invalid-token-with-enough-length')
    assert result.status_code == 429
    assert 'Retry-After' in result.headers


def test_regular_admin_cannot_take_over_pending_super_admin(client):
    user, token = invite(client, 'pending-admin@example.test', 'super_admin')
    response = client.post(f"/api/users/{user['userId']}/invite",headers=auth_headers(role='admin'))
    assert response.status_code == 403
    assert setup(client,token).status_code == 200

def test_hr_jobs_and_related_resumes_are_owner_scoped(client):
    admin = auth_headers()
    first, _ = invite(client)
    second, _ = invite(client, 'other@example.test')
    a = auth_headers(role='hr', user_id=first['userId'])
    b = auth_headers(role='hr', user_id=second['userId'])
    jobs = []
    for index, user in enumerate([first,second]):
        response = client.post('/api/jobs', headers=admin, json=job_payload(f'OWNER-{index}', assignee_user_id=user['userId']))
        assert response.status_code == 201, response.text
        jobs.append(response.json())
    own, foreign = jobs
    assert [j['jobId'] for j in client.get('/api/jobs',headers=a).json()] == [own['jobId']]
    assert len(client.get('/api/jobs',headers=admin).json()) == 2
    assert client.get(f"/api/jobs?assignee={second['userId']}",headers=a).json() == []
    for suffix in ['', '/detail', '/activity', '/notifications']:
        assert client.get(f"/api/jobs/{foreign['jobId']}{suffix}",headers=a).status_code == 404
    for method, suffix, body in [('put','',{'title':'Intrusion'}), ('post','/lifecycle',{'status':'OPEN'}), ('post','/assign',{'email':first['email']})]:
        assert getattr(client,method)(f"/api/jobs/{foreign['jobId']}{suffix}",headers=a,json=body).status_code in (403,404)
    assert client.post('/api/jobs',headers=a,json=job_payload('SPOOF',assignee_user_id=second['userId'])).status_code == 403
    assert client.post(f"/api/jobs/{own['jobId']}/assign",headers=a,json={'email':second['email']}).status_code == 403
    directory = client.get('/api/users/directory',headers=a).json()
    assert [u['userId'] for u in directory] == [first['userId']]
    database = app.dependency_overrides[get_db]()
    client.portal.call(database['resume_batches'].insert_one, {'batchId':'private-batch','orgId':'default','jobKey':foreign['jobKey'],'jobId':foreign['jobId']})
    client.portal.call(database['resume_files'].insert_one, {'fileId':'private-file','orgId':'default','jobId':foreign['jobId']})
    assert client.get('/api/resumes/batches',headers=a).json() == []
    assert client.get('/api/resumes/batches/private-batch',headers=a).status_code == 404
    assert client.get('/api/resumes/files/private-file/download',headers=a).status_code == 404
    assert client.get(f"/api/jobs/{foreign['jobId']}",headers=b).status_code == 200
    from app.models.hiring import ApplicationRepository
    application = client.portal.call(ApplicationRepository(database).create, {
        'orgId':'default','jobId':foreign['jobId'],'applicantId':'foreign-candidate',
        'candidateKey':None,'matchScore':None,'scoreBreakdown':{}})
    app_id = application['applicationId']
    assert client.get('/api/applications',headers=a).json() == []
    assert client.get(f"/api/applications?job_id={foreign['jobId']}",headers=a).status_code == 404
    for suffix in ['', '/history']:
        assert client.get(f'/api/applications/{app_id}{suffix}',headers=a).status_code == 404
    assert client.post(f'/api/applications/{app_id}/transition',headers=a,json={'toStage':'PARSED','reason':'forbidden'}).status_code == 404
    assert client.post(f'/api/applications/{app_id}/request-assessment',headers=a).status_code == 404
    bulk = client.post('/api/applications/send-assessments',headers=a,json={'applicationIds':[app_id]})
    assert bulk.json()['accepted'] == 0
    assert bulk.json()['items'][0]['result'] == 'failed'
    assert client.post('/api/admin/sync-sweep',headers=a).status_code == 403
    assert len(client.get('/api/applications',headers=b).json()) == 1

@pytest.mark.parametrize('role',['technical_interviewer','managerial_interviewer'])
def test_interviewer_can_onboard_without_jobs_access(client, role):
    user, token = invite(client, f'{role}@example.test',role)
    assert setup(client,token).status_code == 200
    response = client.post('/api/auth/login',json={'email':user['email'],'password':PASSWORD})
    assert response.status_code == 200
    assert client.get('/api/jobs',headers={'Authorization':f"Bearer {response.json()['accessToken']}"}).status_code == 403
