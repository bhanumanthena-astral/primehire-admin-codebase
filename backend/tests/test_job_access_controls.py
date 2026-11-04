"""V2 account/assignment access and lifecycle authorization."""
import io
from docx import Document
import pytest
from app.config import settings
from tests.test_invite_and_ownership import client
from tests.conftest import auth_headers,job_payload

def account(client, access):
    response=client.post('/api/users',headers=auth_headers(),json={
        'email':'access@example.test','name':'Assignee','role':'recruiter','jobAccess':access})
    assert response.status_code==201,response.text
    return response.json()['user']

def create(client, user, state='OPEN', access=None):
    payload=job_payload('ACCESS-JOB',assignee_user_id=user['userId'],lifecycleStatus=state)
    if access is not None:payload['assigneeAccess']=access
    response=client.post('/api/jobs',headers=auth_headers(),json=payload)
    assert response.status_code==201,response.text
    return response.json()

def upload(client,job,headers):
    document=Document();document.add_paragraph('Fictional candidate resume with Python and SQL experience.')
    buffer=io.BytesIO();document.save(buffer)
    return client.post('/api/resumes/upload',headers=headers,data={'jobKey':job['jobKey'],'consent':'true'},files={'files':('resume.docx',buffer.getvalue(),'application/octet-stream')})

@pytest.fixture(autouse=True)
def isolated_storage(monkeypatch,tmp_path):
    monkeypatch.setattr(settings,'storage_dir',str(tmp_path/'storage'))
    monkeypatch.setattr(settings,'clamav_enabled',False)

def test_invited_permissions_and_immediate_revocation(client):
    user=account(client,['view','upload'])
    headers=auth_headers(role='recruiter',user_id=user['userId'])
    job=create(client,user)
    assert client.get('/api/jobs',headers=headers).status_code==200
    assert client.put(f"/api/jobs/{job['jobId']}",headers=headers,json={'keywords':['Java']}).status_code==403
    assert upload(client,job,headers).status_code==201
    assert client.post('/api/jobs',headers=headers,json=job_payload('OTHER',assignee_user_id=user['userId'])).status_code==403
    assert client.put(f"/api/users/{user['userId']}",headers=auth_headers(),json={'jobAccess':['view']}).status_code==200
    assert upload(client,job,headers).status_code==403
    assert client.put(f"/api/users/{user['userId']}",headers=headers,json={'jobAccess':['view','edit','create','upload']}).status_code==403
    assert client.put(f"/api/users/{user['userId']}",headers=auth_headers(),json={'jobAccess':[]}).status_code==200
    assert client.get('/api/jobs',headers=headers).status_code==403

@pytest.mark.parametrize('state',['DRAFT','ON_HOLD','CLOSED','ARCHIVED'])
def test_non_open_jobs_reject_assignee_mutations_and_upload(client,state):
    user=account(client,['view','edit','create','upload']);headers=auth_headers(role='recruiter',user_id=user['userId'])
    job=create(client,user,state)
    assert upload(client,job,headers).status_code==409
    assert client.put(f"/api/jobs/{job['jobId']}",headers=headers,json={'keywords':['Java']}).status_code==409
    response=client.post(f"/api/jobs/{job['jobId']}/lifecycle",headers=headers,json={'status':'OPEN'})
    assert response.status_code==403
    assert client.post('/api/admin/jobs/auto-close',headers=headers).status_code==403

def test_job_specific_access_caps_and_status_admin_only(client):
    user=account(client,['view','edit','upload']);headers=auth_headers(role='recruiter',user_id=user['userId'])
    job=create(client,user,access=['view'])
    assert upload(client,job,headers).status_code==403
    assert client.put(f"/api/jobs/{job['jobId']}",headers=headers,json={'keywords':['Java']}).status_code==403
    assert client.put(f"/api/jobs/{job['jobId']}",headers=headers,json={'assigneeAccess':['view','edit','upload']}).status_code==403
    assert client.put(f"/api/jobs/{job['jobId']}",headers=headers,json={'assigneeAccess':None}).status_code==403
    admin=auth_headers()
    assert client.put(f"/api/jobs/{job['jobId']}",headers=admin,json={'assigneeAccess':['view','edit','upload']}).status_code==200
    assert client.put(f"/api/jobs/{job['jobId']}",headers=headers,json={'keywords':['Java']}).status_code==200
    assert client.put(f"/api/jobs/{job['jobId']}",headers=headers,json={'assigneeAccess':None}).status_code==403
    assert client.post(f"/api/jobs/{job['jobId']}/lifecycle",headers=headers,json={'status':'ON_HOLD'}).status_code==403
    held=client.post(f"/api/jobs/{job['jobId']}/lifecycle",headers=admin,json={'status':'ON_HOLD'})
    assert held.status_code==200
    assert upload(client,job,headers).status_code==409
    assert client.post(f"/api/jobs/{job['jobId']}/lifecycle",headers=admin,json={'status':'OPEN'}).status_code==200
    assert client.put(f"/api/jobs/{job['jobId']}",headers=admin,json={'assigneeAccess':[]}).status_code==200
    assert client.get('/api/jobs',headers=headers).json()==[]
    assert client.get(f"/api/jobs/{job['jobId']}",headers=headers).status_code==404

def test_permissions_allowlist(client):
    response=client.post('/api/users',headers=auth_headers(),json={'email':'bad@example.test','name':'Bad','role':'recruiter','jobAccess':['users.manage']})
    assert response.status_code==422


def test_create_permission_does_not_grant_publish_permission(client):
    user=account(client,['view','create','upload'])
    headers=auth_headers(role='recruiter',user_id=user['userId'])
    payload=job_payload('DELEGATED-CREATE',assignee_user_id=user['userId'])
    assert client.post('/api/jobs',headers=headers,json=payload).status_code==201
    payload.update(jobKey='DIRECT-PUBLISH',lifecycleStatus='OPEN')
    assert client.post('/api/jobs',headers=headers,json=payload).status_code==403
