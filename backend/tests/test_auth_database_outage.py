"""Network failures are availability errors, never bad-password responses."""
import pytest
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError, AutoReconnect
from app.main import app
from app.security.deps import get_db


class UnavailableDatabase:
    def __init__(self, error):
        self.error = error

    def __getitem__(self, key):
        return self

    async def find_one(self, *args, **kwargs):
        raise self.error('SSL handshake failed: private-database-host')


@pytest.mark.parametrize('error', [ServerSelectionTimeoutError, AutoReconnect])
@pytest.mark.parametrize('path', ['/api/auth/login', '/api/auth/refresh'])
def test_auth_database_failure_returns_safe_retryable_503(error, path):
    app.dependency_overrides[get_db] = lambda: UnavailableDatabase(error)
    try:
        client = TestClient(app)
        response = client.post(path, json={'email': 'outage@example.test', 'password': 'Test-only-password-123!'},
            headers={'X-Refresh-Token': 'test-only-refresh-token'})
        assert response.status_code == 503
        assert response.headers['Retry-After'] == '5'
        assert response.json()['detail'] == 'The database is temporarily unavailable. Please try again shortly.'
        assert 'private-database-host' not in response.text
        assert 'set-cookie' not in response.headers
    finally:
        app.dependency_overrides.pop(get_db, None)
