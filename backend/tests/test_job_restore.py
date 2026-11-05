"""Archived-job restoration is Super Admin-only, org-scoped and audited."""
from datetime import datetime,timedelta,timezone
from unittest.mock import AsyncMock

from tests.test_jobs_e2e import client,mock_db
from tests.conftest import auth_headers,post_job


def archived(client):
    headers=auth_headers()
    job=post_job(client,headers,headers,'RESTORE-TEST',lifecycleStatus='OPEN')
    response=client.post(f"/api/jobs/{job['jobId']}/archive",headers=headers)
    assert response.status_code==200
    return response.json()


def future():
    return {'closesAt':(datetime.now(timezone.utc)+timedelta(days=30)).isoformat()}


def test_super_admin_can_restore_archived_job_and_audit(client,mock_db):
    job=archived(client)
    response=client.post(f"/api/jobs/{job['jobId']}/reopen",headers=auth_headers(),json=future())
    assert response.status_code==200,response.text
    restored=response.json()
    assert restored['lifecycleStatus']=='OPEN'
    assert restored['archivedAt'] is None and restored['closedAt'] is None
    assert restored['jobId']==job['jobId'] and restored['assigneeUserId']==job['assigneeUserId']
    activity=client.get(f"/api/jobs/{job['jobId']}/activity",headers=auth_headers()).json()['items']
    event=next(row for row in activity if row['action']=='job.restore')
    assert event['details']['from']=='ARCHIVED' and event['details']['to']=='OPEN'


def test_archived_restore_does_not_grant_admin_or_staff_extra_access(client):
    job=archived(client)
    for role in ['admin','hr','recruiter','technical_interviewer','managerial_interviewer','viewer']:
        response=client.post(f"/api/jobs/{job['jobId']}/reopen",headers=auth_headers(role=role),json=future())
        assert response.status_code==403,(role,response.text)
    assert client.get(f"/api/jobs/{job['jobId']}",headers=auth_headers()).json()['lifecycleStatus']=='ARCHIVED'


def test_restore_rejects_other_org_and_expired_closing_date(client):
    job=archived(client)
    path=f"/api/jobs/{job['jobId']}/reopen"
    assert client.post(path,headers=auth_headers(org_id='other'),json=future()).status_code==404
    assert client.post(path,headers=auth_headers(),json={'closesAt':'2020-01-01T00:00:00Z'}).status_code==422
    assert client.get(f"/api/jobs/{job['jobId']}",headers=auth_headers()).json()['lifecycleStatus']=='ARCHIVED'


def test_restore_detects_concurrent_change_without_false_audit(client,monkeypatch):
    job=archived(client)
    from app.models.hiring import JobRepository
    monkeypatch.setattr(JobRepository,'update',AsyncMock(return_value=None))
    response=client.post(f"/api/jobs/{job['jobId']}/reopen",headers=auth_headers(),json=future())
    assert response.status_code==409
    activity=client.get(f"/api/jobs/{job['jobId']}/activity",headers=auth_headers()).json()['items']
    assert not any(row['action']=='job.restore' for row in activity)
