import pytest

from app.config import settings
from tests.test_auth_api import client, mock_db, _create_test_user


async def test_production_password_reset_cannot_return_account_reset_token(client, mock_db, monkeypatch):
    user = await _create_test_user(mock_db, email='reset-boundary@example.test')
    monkeypatch.setattr(settings, 'env', 'production')
    response = client.post('/api/auth/reset-password-request', json={
        'email': 'reset-boundary@example.test', 'orgId': user['orgId'],
    })
    assert response.status_code == 503
    assert 'resetUrl' not in response.json()
    assert await mock_db.invitations.count_documents({'kind': 'password_reset'}) == 0
    assert (await mock_db.users.find_one({'userId': user['userId']}))['passwordHash'] == user['passwordHash']
