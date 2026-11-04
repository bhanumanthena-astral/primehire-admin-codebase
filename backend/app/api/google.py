"""Google login is public; Calendar connection is authenticated and self-only."""
from urllib.parse import urlsplit
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from ..config import settings
from ..security.deps import get_db, require_permission
from ..security.rate_limit import limiter
from ..security.tokens import (create_access_token, create_mfa_token, generate_opaque_token,
                               hash_token, REFRESH_TOKEN_LIFETIME, ACCESS_TOKEN_LIFETIME)
from ..models.user import SessionRepository, to_public_user, utcnow
from ..models.hiring import AuditLogRepository
from ..schemas.user import UserPublic
from ..schemas.google import GoogleStart, CalendarAvailability
from ..services import google_oauth as oauth

router = APIRouter(tags=['google'])


def public_guard(request):
    result = limiter.check(f"google-auth:{request.client.host if request.client else 'unknown'}:{request.url.path}", 20, 60)
    if not result.allowed:
        raise HTTPException(429, 'Too many Google sign-in attempts. Try again shortly.')
    if request.method == 'POST':
        target = urlsplit(settings.google_redirect_uri)
        origin = request.headers.get('origin')
        if origin and origin != f'{target.scheme}://{target.netloc}':
            raise HTTPException(403, 'Google sign-in must start from the configured application origin')


@router.get('/api/auth/google/config')
async def configuration():
    return {'enabled': oauth.configured()}


@router.post('/api/auth/google/start')
async def start(payload: GoogleStart, request: Request, response: Response, db: Any = Depends(get_db)):
    public_guard(request)
    url, binding = await oauth.start(db, payload.returnTo)
    oauth.cookie(response, oauth.STATE_COOKIE, binding)
    response.headers['Cache-Control'] = 'no-store'
    return {'authorizationUrl': url}


@router.get('/api/auth/google/callback')
async def callback(request: Request, db: Any = Depends(get_db)):
    public_guard(request)
    response = RedirectResponse('/auth/google/complete', status_code=303,
                                headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
    try:
        ticket = await oauth.callback(db, request.query_params.get('state'),
                                     request.cookies.get(oauth.STATE_COOKIE),
                                     request.query_params.get('code'), request.query_params.get('error'))
        oauth.cookie(response, oauth.COMPLETE_COOKIE, ticket, 120)
    except HTTPException as exc:
        # Store a bounded, safe error server-side; do not put identity/tokens in URLs.
        if db is None:
            return RedirectResponse('/login?google=unavailable', 303)
        from datetime import timedelta
        token = generate_opaque_token()
        await db['google_oauth_tickets'].insert_one({'_id': hash_token(token), 'kind': 'error',
            'message': exc.detail, 'expiresAt': utcnow() + timedelta(minutes=2)})
        oauth.cookie(response, oauth.COMPLETE_COOKIE, token, 120)
    response.delete_cookie(oauth.STATE_COOKIE, path=oauth.COOKIE_PATH)
    return response


@router.post('/api/auth/google/complete')
async def complete(request: Request, response: Response, db: Any = Depends(get_db)):
    public_guard(request)
    oauth.require_configured(db)
    ticket = request.cookies.get(oauth.COMPLETE_COOKIE)
    if ticket and len(ticket) <= 200:
        error = await db['google_oauth_tickets'].find_one_and_delete({
            '_id': hash_token(ticket), 'kind': 'error', 'expiresAt': {'$gt': utcnow()}})
        if error:
            raise HTTPException(400, error['message'])
    record, user = await oauth.consume(db, ticket)
    response.delete_cookie(oauth.COMPLETE_COOKIE, path=oauth.COOKIE_PATH)
    response.headers['Cache-Control'] = 'no-store'
    if record['intent'] == 'calendar':
        await AuditLogRepository(db).log(org_id=user['orgId'], actor_user_id=user['userId'],
            action='google.calendar_connected', resource_type='user', resource_id=user['userId'], details={})
        return {'calendarConnected': True, 'returnTo': record['returnTo']}
    if user.get('role') in {'admin', 'super_admin'} and not (user.get('mfa') or {}).get('enabled'):
        raise HTTPException(403, 'Enable two-factor authentication before using Google sign-in')
    if (user.get('mfa') or {}).get('enabled'):
        return {'mfaRequired': True, 'mfaToken': create_mfa_token(user_id=user['userId'], org_id=user['orgId']),
                'returnTo': record['returnTo']}
    refresh = generate_opaque_token()
    session = await SessionRepository(db).create_session(user_id=user['userId'], org_id=user['orgId'],
        refresh_token_hash=hash_token(refresh), device_info=request.headers.get('user-agent', ''),
        expires_at=utcnow() + REFRESH_TOKEN_LIFETIME)
    token = create_access_token(user_id=user['userId'], org_id=user['orgId'], role=user['role'], session_id=session['sessionId'])
    from .auth import _set_refresh_cookie
    _set_refresh_cookie(response, refresh)
    await db['users'].update_one({'orgId': user['orgId'], 'userId': user['userId']}, {'$set': {'lastLoginAt': utcnow()}})
    await AuditLogRepository(db).log(org_id=user['orgId'], actor_user_id=user['userId'],
        action='auth.google_login', resource_type='user', resource_id=user['userId'], details={})
    return {'accessToken': token, 'tokenType': 'bearer', 'expiresIn': int(ACCESS_TOKEN_LIFETIME.total_seconds()),
            'user': UserPublic(**to_public_user(user)), 'returnTo': record['returnTo']}


@router.get('/api/google/calendar')
async def status(user=Depends(require_permission('google.connect')), db: Any = Depends(get_db)):
    if db is None:
        raise HTTPException(503, 'Database unavailable')
    row = await db['google_connections'].find_one({'orgId': user.org_id, 'userId': user.user_id}) or {}
    return {'enabled': oauth.configured(), 'status': row.get('status', 'not_connected'),
            'calendar': 'primary', 'connected': row.get('status') == 'connected',
            'email': row.get('email') if not user.impersonating else None}


@router.post('/api/google/calendar/connect')
async def connect(payload: GoogleStart, request: Request, response: Response,
                  user=Depends(require_permission('google.connect')), db: Any = Depends(get_db)):
    public_guard(request)
    url, binding = await oauth.start(db, payload.returnTo, actor=user)
    oauth.cookie(response, oauth.STATE_COOKIE, binding)
    return {'authorizationUrl': url}


@router.delete('/api/google/calendar')
async def disconnect(user=Depends(require_permission('google.connect')), db: Any = Depends(get_db)):
    from ..security.recruitment import writable
    from ..models.recruitment import lease
    writable(user)
    if db is None:
        raise HTTPException(503, 'Database unavailable')
    async with lease(db, user.org_id, [f'google-token:{user.user_id}']):
        query = {'orgId': user.org_id, 'userId': user.user_id}
        row = await db['google_connections'].find_one(query)
        # Local credentials are erased even if the provider's revoke endpoint is down.
        if row:
            await db['google_connections'].delete_one(query)
            import httpx
            try:
                async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                    await client.post('https://oauth2.googleapis.com/revoke',
                                      data={'token': oauth.decrypt(row.get('refreshTokenEncrypted') or row['accessTokenEncrypted'])})
            except (httpx.HTTPError, HTTPException, KeyError):
                pass
        await AuditLogRepository(db).log(org_id=user.org_id, actor_user_id=user.user_id,
            action='google.calendar_disconnected', resource_type='user', resource_id=user.user_id, details={})
    return {'disconnected': True, 'message': 'Existing Google events remain. Reconnect to update or remove them from Elite HR.'}


@router.post('/api/google/calendar/availability')
async def availability(payload: CalendarAvailability,
                       user=Depends(require_permission('recruitment.manage')), db: Any = Depends(get_db)):
    from ..security.recruitment import enabled, app_allowed, writable
    from ..models.recruitment import RecruitmentRepository
    from ..services.google_calendar import check_availability
    enabled(db)
    writable(user)
    application = await app_allowed(db, user, payload.applicationId)
    existing = None
    if payload.interviewId:
        existing = await RecruitmentRepository(db, user.org_id).interview(payload.interviewId)
        if existing['applicationId'] != application['applicationId']:
            raise HTTPException(404, 'Interview not found')
    if not await db['users'].find_one({'orgId': user.org_id, 'userId': payload.interviewerId,
        'isActive': True, 'role': {'$in': ['hr', 'technical_interviewer', 'managerial_interviewer']}}):
        raise HTTPException(404, 'Interviewer not found')
    return await check_availability(db, user.org_id, payload.interviewerId, payload.startsAt, payload.endsAt, existing=existing)


@router.post('/api/google/calendar/interviews/{key}/retry')
async def retry(key: str, user=Depends(require_permission('recruitment.manage')), db: Any = Depends(get_db)):
    from ..security.recruitment import enabled, interview_allowed, writable
    from ..models.recruitment import RecruitmentRepository, lease
    from ..services.google_calendar import enqueue, sync_interview
    enabled(db)
    writable(user)
    async with lease(db, user.org_id, [f'interview:{key}']):
        row = await RecruitmentRepository(db, user.org_id).interview(key)
        await interview_allowed(db, user, row)
        if row['status'] not in {'scheduled', 'cancelled'}:
            raise HTTPException(409, 'Only scheduled or cancelled interviews can sync their calendar')
        await AuditLogRepository(db).log(org_id=user.org_id, actor_user_id=user.user_id,
            action='google.calendar_retry', resource_type='interview', resource_id=key, details={})
        await enqueue(db, row)
        return await sync_interview(db, row)
