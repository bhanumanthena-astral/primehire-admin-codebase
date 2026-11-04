"""Direct Google OAuth: browser-bound, single-use, PKCE and verified OIDC identity.

No provider credentials or application tokens are placed in browser URLs.
Only existing active organization members may sign in; roles come from Mongo.
"""
import base64
import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

import httpx
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from ..config import settings
from ..models.user import utcnow
from ..models.recruitment import aware, lease
from ..security.tokens import hash_token

CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
STATE_COOKIE = 'elite_google_state'
COMPLETE_COOKIE = 'elite_google_complete'
COOKIE_PATH = '/api/auth/google'
_jwks = None
_jwks_until = None


def configured():
    return bool(settings.google_oauth_enabled and settings.google_client_id
                and settings.google_client_secret and settings.google_token_encryption_key)


def require_configured(db):
    if not configured():
        raise HTTPException(503, 'Google sign-in is not configured. Ask your administrator to complete Google OAuth setup.')
    if db is None:
        raise HTTPException(503, 'Authorization service unavailable')


def encrypt(value):
    return Fernet(settings.google_token_encryption_key.encode()).encrypt(value.encode()).decode()


def decrypt(value):
    try:
        return Fernet(settings.google_token_encryption_key.encode()).decrypt(value.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        raise HTTPException(503, 'Google connection needs administrator attention') from None


def return_path(value):
    # Reject backslashes/control characters, scheme-relative URLs and callback loops.
    if (not value.startswith('/') or value.startswith('//') or '\\' in value
            or any(ord(c) < 32 for c in value) or urlsplit(value).netloc
            or '%' in value or value.startswith(('/api/', '/auth/', '/login'))):
        return '/'
    return value


def cookie(response, name, value, lifetime=600):
    response.set_cookie(name, value, max_age=lifetime, httponly=True,
                        secure=settings.is_production or settings.google_redirect_uri.startswith('https:'),
                        samesite='lax', path=COOKIE_PATH)


async def start(db, return_to, *, actor=None):
    require_configured(db)
    state, binding, verifier, nonce = (secrets.token_urlsafe(32) for _ in range(4))
    record = {'_id': hash_token(state), 'kind': 'state', 'binding': hash_token(binding),
              'verifier': encrypt(verifier), 'nonce': nonce, 'returnTo': return_path(return_to),
              'intent': 'calendar' if actor else 'login',
              'orgId': actor.org_id if actor else settings.google_login_org_id,
              'expiresAt': utcnow() + timedelta(minutes=10)}
    if actor:
        if actor.impersonating:
            raise HTTPException(403, 'View-as sessions cannot connect a Google account')
        await validate_session(db, actor.org_id, actor.user_id, actor.session_id)
        record.update(userId=actor.user_id, sessionId=actor.session_id)
    await db['google_oauth_tickets'].insert_one(record)
    params = {'client_id': settings.google_client_id, 'redirect_uri': settings.google_redirect_uri,
              'response_type': 'code', 'scope': 'openid email profile' + (' ' + CALENDAR_SCOPE if actor else ''),
              'state': state, 'nonce': nonce,
              'code_challenge': base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),
              'code_challenge_method': 'S256', 'prompt': 'consent' if actor else 'select_account'}
    if actor:
        params.update(access_type='offline', include_granted_scopes='true')
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode(params), binding


async def post_token(data):
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.post(TOKEN_URL, data={**data, 'client_id': settings.google_client_id,
                                                         'client_secret': settings.google_client_secret})
        body = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, 'Google authorization is temporarily unavailable') from None
    if response.status_code != 200 or not isinstance(body, dict):
        # Never relay provider payloads, tokens, or personal identifiers.
        if isinstance(body, dict) and body.get('error') == 'invalid_grant':
            raise HTTPException(401, 'Reconnect your Google account')
        raise HTTPException(503, 'Google authorization could not be completed')
    try:
        if (not isinstance(body.get('access_token'), str) or not body['access_token']
                or str(body.get('token_type', '')).lower() != 'bearer'
                or not 1 <= int(body.get('expires_in', 0)) <= 86400
                or (data.get('grant_type') == 'authorization_code' and not isinstance(body.get('id_token'), str))):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(503, 'Google authorization returned an invalid response') from None
    return body


async def verify_identity(raw, nonce):
    global _jwks, _jwks_until
    try:
        header = jwt.get_unverified_header(raw)
        if header.get('alg') != 'RS256' or not isinstance(header.get('kid'), str):
            raise ValueError()
        if not _jwks or not _jwks_until or utcnow() >= _jwks_until:
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                response = await client.get(JWKS_URL)
            response.raise_for_status()
            _jwks = response.json()['keys']
            _jwks_until = utcnow() + timedelta(minutes=30)
        key = next((k for k in _jwks if k.get('kid') == header['kid']), None)
        if not key:
            _jwks_until = None  # A rotated key may be fetched on the next attempt.
            raise ValueError()
        claims = jwt.decode(raw, jwt.PyJWK.from_dict(key).key, algorithms=['RS256'],
                            audience=settings.google_client_id,
                            issuer=['https://accounts.google.com', 'accounts.google.com'],
                            options={'require': ['exp', 'iat', 'iss', 'aud', 'sub', 'nonce']})
        if (not secrets.compare_digest(str(claims['nonce']), nonce)
                or claims.get('email_verified') is not True or not claims.get('email')
                or not isinstance(claims.get('sub'), str)
                or (claims.get('azp') and claims['azp'] != settings.google_client_id)):
            raise ValueError()
        if isinstance(claims['aud'], list) and len(claims['aud']) > 1 and claims.get('azp') != settings.google_client_id:
            raise ValueError()
        return claims
    except (jwt.PyJWTError, httpx.HTTPError, ValueError, KeyError, TypeError, StopIteration):
        raise HTTPException(401, 'Google identity could not be verified. Please sign in again.') from None


async def validate_session(db, org, uid, sid):
    user = await db['users'].find_one({'orgId': org, 'userId': uid, 'isActive': True})
    session = await db['sessions'].find_one({'orgId': org, 'userId': uid, 'sessionId': sid,
                                           'revokedAt': None, 'expiresAt': {'$gt': utcnow()}})
    if not user or not session:
        raise HTTPException(401, 'Sign in again before connecting Google Calendar')
    return user


async def link_identity(db, user, claims):
    query = {'orgId': user['orgId'], 'userId': user['userId']}
    current = await db['google_identities'].find_one(query)
    if current and current['subject'] != claims['sub']:
        raise HTTPException(409, 'Use the Google account already linked to your Elite HR account')
    try:
        await db['google_identities'].update_one({**query, 'subject': claims['sub']}, {'$setOnInsert': {
            **query, 'subject': claims['sub'], 'createdAt': utcnow()}}, upsert=True)
    except DuplicateKeyError:
        raise HTTPException(409, 'This Google account is already linked to another team member') from None


async def callback(db, state, binding, code, error):
    require_configured(db)
    if not state or not binding or len(state) > 200 or len(binding) > 200:
        raise HTTPException(400, 'Google sign-in expired. Please try again.')
    record = await db['google_oauth_tickets'].find_one_and_delete({
        '_id': hash_token(state), 'kind': 'state', 'binding': hash_token(binding),
        'expiresAt': {'$gt': utcnow()}})
    if not record:
        raise HTTPException(400, 'Google sign-in expired. Please try again.')
    if error or not code or len(code) > 4096:
        raise HTTPException(400, 'Google authorization was cancelled or denied')
    tokens = await post_token({'grant_type': 'authorization_code', 'code': code,
                              'redirect_uri': settings.google_redirect_uri, 'code_verifier': decrypt(record['verifier'])})
    claims = await verify_identity(tokens.get('id_token', ''), record['nonce'])
    org = record['orgId']
    if record['intent'] == 'calendar':
        user = await validate_session(db, org, record['userId'], record['sessionId'])
        identity = await db['google_identities'].find_one({'orgId': org, 'userId': user['userId']})
        if (identity and identity['subject'] != claims['sub']) or claims['email'].lower() != user['email'].lower():
            raise HTTPException(403, 'Connect the same Google account you use for your Elite HR account')
        if CALENDAR_SCOPE not in tokens.get('scope', '').split():
            raise HTTPException(403, 'Google Calendar permission was not granted. Please reconnect and allow Calendar access.')
        await link_identity(db, user, claims)
        query = {'orgId': org, 'userId': user['userId']}
        async with lease(db, org, [f"google-token:{user['userId']}"]):
            previous = await db['google_connections'].find_one(query) or {}
            refresh = tokens.get('refresh_token')
            if not refresh and not previous.get('refreshTokenEncrypted'):
                raise HTTPException(400, 'Google did not grant offline access. Reconnect and approve Calendar access.')
            values = {'subject': claims['sub'], 'email': claims['email'], 'status': 'connected',
                      'scopes': tokens['scope'].split(), 'accessTokenEncrypted': encrypt(tokens['access_token']),
                      'expiresAt': utcnow() + timedelta(seconds=int(tokens.get('expires_in', 3600))),
                      'updatedAt': utcnow()}
            if refresh:
                values['refreshTokenEncrypted'] = encrypt(refresh)
            await db['google_connections'].update_one(query, {'$set': values}, upsert=True)
    else:
        identity = await db['google_identities'].find_one({'orgId': org, 'subject': claims['sub']})
        user = await db['users'].find_one({'orgId': org, **(
            {'userId': identity['userId']} if identity else {'email': claims['email'].lower()}), 'isActive': True})
        if not user:
            raise HTTPException(403, 'Google sign-in is available to existing active team members only')
        # Google is not authoritative for third-party email ownership. Link those accounts
        # from an existing authenticated session instead of matching email alone.
        if not identity and not (claims.get('hd') or claims['email'].lower().endswith('@gmail.com')):
            raise HTTPException(403, 'Sign in with your password first, then connect your Google account')
        if user.get('role') in {'admin', 'super_admin'} and not (user.get('mfa') or {}).get('enabled'):
            raise HTTPException(403, 'Enable two-factor authentication using your existing sign-in before using Google sign-in')
        await link_identity(db, user, claims)
    ticket = secrets.token_urlsafe(32)
    await db['google_oauth_tickets'].insert_one({
        '_id': hash_token(ticket), 'kind': 'complete', 'orgId': org, 'userId': user['userId'],
        'intent': record['intent'], 'returnTo': record['returnTo'],
        **({'sessionId': record['sessionId']} if record['intent'] == 'calendar' else {}),
        'expiresAt': utcnow() + timedelta(minutes=2)})
    return ticket


async def consume(db, ticket):
    require_configured(db)
    if not ticket or len(ticket) > 200:
        raise HTTPException(400, 'Google sign-in expired. Please try again.')
    record = await db['google_oauth_tickets'].find_one_and_delete({
        '_id': hash_token(ticket), 'kind': 'complete', 'expiresAt': {'$gt': utcnow()}})
    if not record:
        raise HTTPException(400, 'Google sign-in expired. Please try again.')
    user = await db['users'].find_one({'orgId': record['orgId'], 'userId': record['userId'], 'isActive': True})
    if not user:
        raise HTTPException(403, 'This team member account is unavailable')
    if record['intent'] == 'calendar':
        await validate_session(db, record['orgId'], record['userId'], record['sessionId'])
    return record, user


async def access_token(db, org, uid):
    require_configured(db)
    query = {'orgId': org, 'userId': uid}
    if not await db['users'].find_one({**query, 'isActive': True}):
        raise HTTPException(409, 'The assigned interviewer is no longer active')
    async with lease(db, org, [f'google-token:{uid}']):
        row = await db['google_connections'].find_one(query)
        if not row or row.get('status') != 'connected' or CALENDAR_SCOPE not in row.get('scopes', []):
            raise HTTPException(409, 'No Google Calendar connection is available for this interviewer')
        if row.get('expiresAt') and aware(row['expiresAt']) > utcnow() + timedelta(seconds=60):
            return decrypt(row['accessTokenEncrypted'])
        try:
            tokens = await post_token({'grant_type': 'refresh_token', 'refresh_token': decrypt(row['refreshTokenEncrypted'])})
        except HTTPException as exc:
            if exc.status_code == 401:
                await db['google_connections'].update_one(query, {'$set': {'status': 'reconnect_required'},
                    '$unset': {'accessTokenEncrypted': '', 'refreshTokenEncrypted': ''}})
                raise HTTPException(409, 'The assigned interviewer must reconnect Google Calendar') from None
            raise
        values = {'accessTokenEncrypted': encrypt(tokens['access_token']),
                  'expiresAt': utcnow() + timedelta(seconds=int(tokens.get('expires_in', 3600)))}
        if tokens.get('refresh_token'):
            values['refreshTokenEncrypted'] = encrypt(tokens['refresh_token'])
        await db['google_connections'].update_one(query, {'$set': values})
        return tokens['access_token']
