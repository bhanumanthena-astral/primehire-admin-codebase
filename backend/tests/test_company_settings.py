"""Company credentials and permission ceilings, with no live provider calls."""
import json
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security.deps import get_db
from app.security.tokens import create_access_token
from app.security.roles import get_permissions_for_role, effective_permissions
from app.services.company_settings import mail_configuration, CompanyMailError
from app.services import email_send, recruitment_worker
from app.services.outbox_crypto import encrypt_body
from app.models.outbox import EmailOutboxRepository


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr(settings, 'jwt_secret', 'company-settings-test-secret-at-least-32-characters')
    monkeypatch.setattr(settings, 'outbox_encryption_key', Fernet.generate_key().decode())
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.pop(get_db, None)


def headers(role='super_admin', org='alpha', impersonating=None):
    token = create_access_token(user_id=role, org_id=org, role=role, session_id='company-test',
                                **({'impersonating': impersonating} if impersonating else {}))
    return {'Authorization': 'Bearer ' + token}


async def seed(db):
    for org in ['alpha', 'beta', 'default']:
        await db.organizations.insert_one({'orgId': org, 'name': org.title()})
        for role in ['admin', 'hr']:
            await db.users.insert_one({'orgId': org, 'userId': role, 'role': role, 'isActive': True, 'name': role.title(), 'email': f'{role}@{org}.test'})


def payload(org='alpha', revision=0, permissions=None):
    return {'expectedRevision': revision,
            'enabledPermissions': sorted(get_permissions_for_role('admin')) if permissions is None else permissions,
            'email': {'mode': 'custom', 'fromAddress': f'hr@{org}.test', 'fromName': org.title(),
                      'apiKey': f'{org}-synthetic-secret'}}


@pytest.mark.asyncio
async def test_super_admin_only_and_encrypted_write_only_keys(client, db):
    await seed(db)
    path = '/api/companies/alpha/settings'
    for role in ['admin', 'hr']:
        assert client.get(path, headers=headers(role)).status_code == 403
        assert client.put(path, headers=headers(role), json=payload()).status_code == 403
    assert client.get(path).status_code == 401
    assert client.put(path, headers=headers(impersonating='view-as'), json=payload()).status_code == 403
    assert client.put('/api/companies/missing/settings', headers=headers(), json=payload()).status_code == 404
    result = client.put(path, headers=headers(), json=payload())
    assert result.status_code == 200, result.text
    assert result.json()['email']['apiKeyConfigured'] is True
    assert 'secret' not in result.text and 'apiKeyEncrypted' not in result.text
    stored = await db.company_settings.find_one({'_id': 'alpha'})
    assert 'alpha-synthetic-secret' not in json.dumps(stored, default=str)
    assert (await mail_configuration(db, 'alpha')).api_key == 'Zoho-enczapikey alpha-synthetic-secret'
    assert 'secret' not in repr(await mail_configuration(db, 'alpha'))
    assert 'apiKeyEncrypted' not in client.get('/api/companies', headers=headers()).text
    audit = await db.audit_log.find_one({'action': 'company.settings.updated'})
    assert 'secret' not in json.dumps(audit, default=str)
    assert not (await db.organizations.find_one({'orgId': 'alpha'})).get('settings', {}).get('email')
    assert client.put(path, headers=headers(), json=payload()).status_code == 409
    edit = payload(revision=1)
    edit['email']['apiKey'] = ''
    assert client.put(path, headers=headers(), json=edit).status_code == 200
    assert (await mail_configuration(db, 'alpha')).api_key.endswith('alpha-synthetic-secret')
    edit['expectedRevision'] = 2
    edit['email'] = {'mode': 'disabled', 'clearApiKey': True}
    assert client.put(path, headers=headers(), json=edit).json()['email']['apiKeyConfigured'] is False
    with pytest.raises(CompanyMailError):
        await mail_configuration(db, 'alpha')


@pytest.mark.asyncio
async def test_company_policy_enforced_on_real_routes_and_workers(client, db):
    await seed(db)
    assert client.put('/api/companies/alpha/settings', headers=headers(), json=payload(permissions=['jobs.view'])).status_code == 200
    # The same role in another company keeps its permissions.
    assert client.get('/api/users', headers=headers('admin')).status_code == 403
    assert client.get('/api/users', headers=headers('admin', 'beta')).status_code == 200
    assert client.post('/api/jobs', headers=headers('admin'), json={}).status_code == 403
    assert client.post('/api/jobs', headers=headers('hr'), json={}).status_code == 403
    assert client.get('/api/users', headers=headers()).status_code == 200
    assert await effective_permissions(db, {'role': 'admin', 'orgId': 'alpha'}) == {'jobs.view'}
    assert 'jobs.manage' in await effective_permissions(db, {'role': 'admin', 'orgId': 'beta'})
    invalid = payload(revision=1, permissions=['roles.assign_admin'])
    assert client.put('/api/companies/alpha/settings', headers=headers(), json=invalid).status_code == 422


@pytest.mark.asyncio
async def test_no_cross_company_fallback_and_invalid_ciphertext(client, db, monkeypatch):
    await seed(db)
    assert await mail_configuration(db, 'default') is None
    monkeypatch.setattr(settings, 'zeptomail_api_key', 'platform-canary')
    with pytest.raises(CompanyMailError):
        await mail_configuration(db, 'beta')
    assert client.put('/api/companies/alpha/settings', headers=headers(), json=payload()).status_code == 200
    record = await db.company_settings.find_one({'_id': 'alpha'})
    await db.company_settings.insert_one({**record, '_id': 'beta', 'orgId': 'beta'})
    with pytest.raises(CompanyMailError):
        await mail_configuration(db, 'beta')
    monkeypatch.setattr(settings, 'outbox_encryption_key', '')
    result = client.put('/api/companies/alpha/settings', headers=headers(), json=payload(revision=1))
    assert result.status_code == 503 and 'synthetic-secret' not in result.text
    assert (await db.company_settings.find_one({'_id': 'alpha'}))['revision'] == 1


@pytest.mark.asyncio
async def test_each_company_provider_request_uses_own_sender_and_key(client, db, monkeypatch):
    from datetime import datetime, timezone, timedelta
    await seed(db)
    requests = []
    class Provider:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            requests.append(kwargs)
            import httpx
            return httpx.Response(200, json={'message': 'accepted'})
    monkeypatch.setattr(email_send.httpx, 'AsyncClient', Provider)
    monkeypatch.setattr(settings, 'email_dry_run', False)
    monkeypatch.setattr(email_send, 'recipient_allowed', lambda _: True)
    monkeypatch.setattr(recruitment_worker, 'recipient_allowed', lambda _: True)
    monkeypatch.setattr(settings, 'recruitment_email_dry_run', False)
    for org in ['alpha', 'beta']:
        assert client.put(f'/api/companies/{org}/settings', headers=headers(), json=payload(org)).status_code == 200
        repo = EmailOutboxRepository(db)
        msg = await repo.enqueue(org_id=org, kind='test', entity_type='test', entity_key=org,
            to_email='candidate@example.test', to_name='Candidate', subject='Test',
            payload_encrypted=encrypt_body(json.dumps({'to': 'candidate@example.test', 'html': 'Hello'})), dedupe_key=org)
        assert await email_send.process_email_job(db, {'orgId': org, 'payload': {'messageId': msg['messageId']}}) == {'sent': 'zepto'}
        assert requests[-1]['headers']['Authorization'] == f'Zoho-enczapikey {org}-synthetic-secret'
        assert requests[-1]['json']['from'] == {'address': f'hr@{org}.test', 'name': org.title()}
        await db.recruit_interviews.insert_one({'orgId': org, 'interviewId': org,
            'status': 'scheduled', 'endsAt': datetime.now(timezone.utc) + timedelta(hours=1)})
        recruitment_repo = recruitment_worker.RecruitmentOutbox(db)
        invitation = await recruitment_repo.enqueue(org_id=org, kind='recruit_invite', entity_type='interview',
            entity_key=org, to_email='candidate@example.test', to_name='Candidate', subject='Interview',
            payload_encrypted=recruitment_worker.encrypt_recruitment_body(json.dumps({'to': 'candidate@example.test', 'html': 'Interview'})))
        invitation['interviewRevision'] = 1
        await recruitment_worker.deliver(db, invitation)
        assert (await recruitment_repo.get(invitation['messageId'], org))['status'] == 'sent'
        assert requests[-1]['headers']['Authorization'] == f'Zoho-enczapikey {org}-synthetic-secret'
        assert requests[-1]['json']['from']['address'] == f'hr@{org}.test'
    # The manual assessment API uses the same company's settings.
    result = client.post('/api/send-email', headers=headers('admin', 'beta'), json={
        'toEmail': 'candidate@example.test', 'toName': 'Candidate', 'subject': 'Test', 'htmlBody': 'Hi'})
    assert result.status_code == 200, result.text
    assert requests[-1]['json']['from']['address'] == 'hr@beta.test'
