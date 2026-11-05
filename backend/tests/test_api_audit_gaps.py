from datetime import timedelta

from app.models.recruitment import now
from tests.test_recruitment import client, headers


async def test_report_capabilities_and_application_history_contract(client):
    response = await client.get('/api/reporting/capabilities', headers=headers())
    assert response.status_code == 200, response.text
    assert response.json()['enabled'] is True
    response = await client.get('/api/reporting/applications/app0', headers=headers())
    assert response.status_code == 200, response.text
    assert response.json()['application']['applicationId'] == 'app0'
    denied = await client.get('/api/reporting/applications/app0', headers=headers('hr', org='other'))
    assert denied.status_code in {403, 404}


async def test_google_config_and_super_admin_capacity_contract(client):
    config = await client.get('/api/auth/google/config')
    assert config.status_code == 200
    assert isinstance(config.json()['enabled'], bool)
    capacity = await client.get('/api/diagnostics/capacity', headers=headers())
    assert capacity.status_code == 200, capacity.text
    assert isinstance(capacity.json()['enabled'], bool)
    assert (await client.get('/api/diagnostics/capacity', headers=headers('hr'))).status_code == 403


async def test_password_reset_invalid_token_and_unknown_account(client, db):
    response = await client.post('/api/auth/reset-password-request', json={'email': 'unknown-audit@example.test', 'orgId': 'default'})
    assert response.status_code == 200
    assert response.json()['resetUrl'] == ''
    response = await client.post('/api/auth/reset-password', json={'token': 'invalid-audit-token', 'newPassword': 'Synthetic-password-20!'})
    assert response.status_code == 400
    assert await db.invitations.count_documents({}) == 0


async def test_view_as_and_session_revocation_are_scoped(client, db):
    view = await client.post('/api/auth/view-as', headers=headers(), json={'targetUserId': 'viewer', 'reason': 'Synthetic audit inspection'})
    assert view.status_code == 200, view.text
    assert view.json()['impersonating']['userId'] == 'viewer'
    assert (await client.post('/api/auth/view-as', headers=headers('hr'), json={'targetUserId': 'viewer', 'reason': 'Synthetic denied inspection'})).status_code == 403
    await db.sessions.insert_one({'sessionId': 'audit-own', 'userId': 'super_admin', 'createdAt': now(), 'expiresAt': now()+timedelta(hours=1), 'revokedAt': None})
    assert (await client.delete('/api/auth/sessions/audit-own', headers=headers('hr'))).status_code == 404
    assert (await client.delete('/api/auth/sessions/audit-own', headers=headers())).status_code == 200
    assert (await db.sessions.find_one({'sessionId': 'audit-own'}))['revokedAt'] is not None
