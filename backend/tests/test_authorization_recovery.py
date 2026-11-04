from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pymongo.errors import AutoReconnect
from app.security.deps import get_current_user
from app.security.tokens import create_access_token


def credentials():
    return HTTPAuthorizationCredentials(scheme='Bearer',credentials=create_access_token(user_id='test-user',org_id='default',role='admin',session_id='test-session'))

def database(users,sessions):
    return {'users':type('Collection',(),{'find_one':users})(),'sessions':type('Collection',(),{'find_one':sessions})()}

async def test_transient_user_read_retries_then_authorizes():
    users=AsyncMock(side_effect=[AutoReconnect('temporary'),{'isActive':True}]);sessions=AsyncMock(return_value={'revokedAt':None})
    result=await get_current_user(credentials(),database(users,sessions))
    assert result.user_id=='test-user' and users.await_count==2 and sessions.await_count==1

async def test_retry_rechecks_user_and_rejects_revoked_session():
    users=AsyncMock(return_value={'isActive':True});sessions=AsyncMock(side_effect=[AutoReconnect('temporary'),{'revokedAt':'revoked'}])
    with pytest.raises(HTTPException) as error:await get_current_user(credentials(),database(users,sessions))
    assert error.value.status_code==401 and users.await_count==2 and sessions.await_count==2

async def test_persistent_database_failure_is_bounded_and_fail_closed():
    users=AsyncMock(side_effect=AutoReconnect('private-host'));sessions=AsyncMock()
    with pytest.raises(HTTPException) as error:await get_current_user(credentials(),database(users,sessions))
    assert error.value.status_code==503 and error.value.headers['Retry-After']=='1'
    assert users.await_count==2 and sessions.await_count==0 and 'private-host' not in error.value.detail

async def test_disabled_user_is_not_retried_or_authorized():
    users=AsyncMock(return_value={'isActive':False});sessions=AsyncMock()
    with pytest.raises(HTTPException) as error:await get_current_user(credentials(),database(users,sessions))
    assert error.value.status_code==401 and users.await_count==1 and sessions.await_count==0
