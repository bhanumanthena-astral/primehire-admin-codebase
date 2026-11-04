"""Private primary-calendar availability and durable, idempotent interview events.

The save path checks availability before booking. Event delivery uses an outbox;
temporary failures stay visible and are retried by the recruitment worker.
"""
import hashlib
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..config import settings
from ..models.user import utcnow
from ..models.recruitment import aware, lease
from . import google_oauth as oauth

BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'


def connected_query(org, uid):
    """A calendar grant, not Google sign-in alone; never expose its credentials."""
    return {'orgId': org, 'userId': uid, 'status': 'connected', 'scopes': oauth.CALENDAR_SCOPE}


def manual_availability():
    return {'status': 'not_connected', 'available': None,
            'message': 'This interviewer has no connected Google Calendar. You can schedule manually and connect it later.'}


async def budget(db, uid):
    """Shared OAuth client budget, not an in-process or per-organization counter."""
    clock = utcnow()
    project = hashlib.sha256(settings.google_client_id.encode()).hexdigest()[:24]
    for suffix, maximum, expiry in [
        (f'day:{clock:%Y%m%d}', settings.google_calendar_daily_limit, clock + timedelta(days=2)),
        (f'minute:{clock:%Y%m%d%H%M}', 100, clock + timedelta(minutes=2)),
        (f'user:{uid}:{clock:%Y%m%d%H%M}', 20, clock + timedelta(minutes=2)),
    ]:
        key = f'{project}:{suffix}'
        try:
            await db['google_calendar_usage'].update_one({'_id': key}, {'$setOnInsert': {'count': 0, 'expiresAt': expiry}}, upsert=True)
        except DuplicateKeyError:
            pass
        result = await db['google_calendar_usage'].find_one_and_update(
            {'_id': key, 'count': {'$lt': maximum}}, {'$inc': {'count': 1}}, return_document=ReturnDocument.AFTER)
        if not result:
            raise HTTPException(429, 'Elite HR Google Calendar request limit reached. Try again later; no paid quota is enabled.')


async def request(db, org, uid, method, *, event_id='', params=None, body=None, allow=()):
    token = await oauth.access_token(db, org, uid)
    await budget(db, uid)
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.request(method, BASE + ('/' + quote(event_id, safe='') if event_id else ''),
                headers={'Authorization': f'Bearer {token}'}, params=params, json=body)
    except httpx.HTTPError:
        raise HTTPException(503, 'Google Calendar is unavailable. Please retry.') from None
    if response.status_code == 401:
        await db['google_connections'].update_one({'orgId': org, 'userId': uid},
            {'$set': {'expiresAt': utcnow() - timedelta(seconds=1)}})
        raise HTTPException(503, 'Google Calendar authorization expired. Retry, or reconnect your account.')
    if response.status_code in allow:
        return None
    if response.status_code in {403, 429}:
        raise HTTPException(503, 'Google Calendar permission or quota is unavailable. Check the connection and retry later.')
    if not 200 <= response.status_code < 300:
        raise HTTPException(503, 'Google Calendar could not update the interview. Retry shortly.')
    if response.status_code == 204:
        return {}
    try:
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except ValueError:
        raise HTTPException(503, 'Google Calendar returned an invalid response') from None


def event_time(value, zone):
    if value.get('dateTime'):
        result = datetime.fromisoformat(value['dateTime'].replace('Z', '+00:00'))
        if result.tzinfo is None:
            result = result.replace(tzinfo=ZoneInfo(value.get('timeZone') or zone))
        return result.astimezone(timezone.utc)
    return datetime.combine(datetime.fromisoformat(value['date']).date(), time(), ZoneInfo(zone)).astimezone(timezone.utc)


async def check_availability(db, org, uid, start, end, *, existing=None):
    if not oauth.configured():
        return {'status': 'not_configured', 'available': None,
                'message': 'Google Calendar is not configured. Calendar availability and reminders are unavailable.'}
    connection = await db['google_connections'].find_one(connected_query(org, uid), {'subject': 1})
    if not connection:
        return manual_availability()
    excluded = set()
    if existing and existing.get('interviewerId') == uid:
        if connection:
            # Covers a successful provider write followed by an interrupted local acknowledgement.
            excluded.add(event_id(org, existing['interviewId'], uid, connection['subject']))
        mapping = existing.get('googleCalendar') or {}
        if mapping.get('userId') == uid:
            excluded.add(mapping.get('eventId'))
    page = None
    for _ in range(4):
        params = {'timeMin': aware(start).isoformat(), 'timeMax': aware(end).isoformat(),
                  'singleEvents': 'true', 'showDeleted': 'false', 'maxResults': 250,
                  'fields': 'timeZone,nextPageToken,items(id,status,transparency,start,end,attendees(self,responseStatus))'}
        if page:
            params['pageToken'] = page
        try:
            result = await request(db, org, uid, 'GET', params=params)
        except HTTPException as exc:
            # Consent may be revoked or expire between the picker and this check.
            if exc.status_code == 409 and not await db['google_connections'].find_one(connected_query(org, uid), {'_id': 1}):
                return manual_availability()
            raise
        try:
            zone = result.get('timeZone', 'UTC')
            for event in result.get('items', []):
                if (event.get('id') in excluded or event.get('status') == 'cancelled'
                        or event.get('transparency') == 'transparent'
                        or any(a.get('self') and a.get('responseStatus') == 'declined' for a in event.get('attendees', []))):
                    continue
                if event_time(event['start'], zone) < aware(end) and event_time(event['end'], zone) > aware(start):
                    return {'status': 'busy', 'available': False,
                            'message': 'The assigned interviewer has an overlapping Google Calendar meeting. Choose another time.'}
        except (ValueError, KeyError, TypeError):
            raise HTTPException(503, 'Google Calendar availability could not be verified') from None
        page = result.get('nextPageToken')
        if not page:
            return {'status': 'free', 'available': True,
                    'message': 'No overlapping meetings on the assigned interviewer’s primary Google Calendar.'}
    raise HTTPException(503, 'Google Calendar availability exceeded the safe page limit. Please retry.')


def event_id(org, interview, uid, subject):
    # Google IDs accept lower-case base32hex; hexadecimal is a valid subset.
    return 'e' + hashlib.sha256(f'{org}:{interview}:{uid}:{subject}'.encode()).hexdigest()


def event_body(row, identifier):
    return {'id': identifier, 'summary': f"Elite HR — {row['round'].title()} interview",
            'description': 'Interview scheduled in Elite HR.' + (f"\nJoin: {row['meetingLink']}" if row.get('meetingLink') else ''),
            'location': row.get('location', ''),
            'start': {'dateTime': aware(row['startsAt']).isoformat()},
            'end': {'dateTime': aware(row['endsAt']).isoformat()},
            'visibility': 'private', 'transparency': 'opaque',
            'reminders': {'useDefault': False, 'overrides': [{'method': 'popup', 'minutes': row.get('reminderMinutes', 15)}]},
            'extendedProperties': {'private': {'eliteInterview': row['interviewId'], 'eliteOrg': row['orgId']}}}


async def assigned_mapping(db, row):
    connection = await db['google_connections'].find_one({'orgId': row['orgId'], 'userId': row['interviewerId']})
    if not connection:
        return None
    return {'eventId': event_id(row['orgId'], row['interviewId'], row['interviewerId'], connection['subject']),
            'userId': row['interviewerId'], 'subject': connection['subject']}


def owns(event, row):
    private = (event.get('extendedProperties') or {}).get('private') or {}
    return private.get('eliteInterview') == row['interviewId'] and private.get('eliteOrg') == row['orgId']


async def remove(db, row, mapping):
    if not mapping or not mapping.get('eventId'):
        return
    uid = mapping['userId']
    connection = await db['google_connections'].find_one({'orgId': row['orgId'], 'userId': uid})
    if not connection or connection.get('subject') != mapping.get('subject'):
        raise HTTPException(409, 'Reconnect the original interviewer’s Google Calendar to remove the previous event')
    event = await request(db, row['orgId'], uid, 'GET', event_id=mapping['eventId'], allow=(404, 410))
    if event is None or event.get('status') == 'cancelled':
        return
    if not owns(event, row):
        raise HTTPException(409, 'The Google event identity changed. Administrator review is required.')
    await request(db, row['orgId'], uid, 'DELETE', event_id=mapping['eventId'], params={'sendUpdates': 'none'}, allow=(404, 410))


async def enqueue(db, row):
    """Queue before local commit, under the interview lease; workers validate revision."""
    if not oauth.configured() and not row.get('googleCalendar'):
        return
    if (not row.get('googleCalendar') and not row.get('googleCalendarPrevious')
            and not await db['google_connections'].find_one(connected_query(row['orgId'], row['interviewerId']), {'_id': 1})):
        return
    query = {'orgId': row['orgId'], 'interviewId': row['interviewId'],
             'scheduleRevision': row.get('scheduleRevision', 1),
             'action': 'delete' if row['status'] == 'cancelled' else 'upsert'}
    await db['google_calendar_outbox'].update_one(query, {'$set': {
        'status': 'pending', 'nextAttemptAt': utcnow(), 'attempts': 0, 'createdAt': utcnow()}}, upsert=True)


async def sync_interview(db, row):
    """Caller owns interview lease. Errors are retained, bounded and user-visible."""
    query = {'orgId': row['orgId'], 'interviewId': row['interviewId'],
             'scheduleRevision': row.get('scheduleRevision', 1),
             'action': 'delete' if row['status'] == 'cancelled' else 'upsert'}
    job = await db['google_calendar_outbox'].find_one(query)
    if not job or job.get('status') == 'done':
        return {'status': row.get('googleCalendarStatus', 'not_configured')}
    attempts = job.get('attempts', 0) + 1
    try:
        if row['status'] == 'cancelled':
            await remove(db, row, row.get('googleCalendar'))
            await remove(db, row, row.get('googleCalendarPrevious'))
            # A provider write may have succeeded just before a process crash,
            # before its local mapping could be acknowledged.
            assigned = await assigned_mapping(db, row)
            if assigned and assigned != row.get('googleCalendar') and assigned != row.get('googleCalendarPrevious'):
                await remove(db, row, assigned)
            changes = {'googleCalendarStatus': 'removed', 'googleCalendarError': None}
        else:
            connection = await db['google_connections'].find_one({'orgId': row['orgId'], 'userId': row['interviewerId']})
            if not connection or connection.get('status') != 'connected':
                raise HTTPException(409, 'The assigned interviewer must reconnect Google Calendar')
            subject = connection['subject']
            async with lease(db, 'google-calendar-global', ['subject:' + hashlib.sha256(subject.encode()).hexdigest()]):
                available = await check_availability(db, row['orgId'], row['interviewerId'], row['startsAt'], row['endsAt'], existing=row)
                if available['available'] is not True:
                    raise HTTPException(409, available['message'])
                identifier = event_id(row['orgId'], row['interviewId'], row['interviewerId'], subject)
                old = await request(db, row['orgId'], row['interviewerId'], 'GET', event_id=identifier, allow=(404, 410))
                if old and old.get('status') == 'cancelled':
                    raise HTTPException(409, 'The Google Calendar event was deleted outside Elite HR. Schedule a new interview to create a new reminder.')
                if old and not owns(old, row):
                    raise HTTPException(409, 'The Google event identity changed. Administrator review is required.')
                body = event_body(row, identifier)
                if old and old.get('status') != 'cancelled':
                    body.pop('id')
                    result = await request(db, row['orgId'], row['interviewerId'], 'PATCH', event_id=identifier, body=body, params={'sendUpdates': 'none'})
                else:
                    result = await request(db, row['orgId'], row['interviewerId'], 'POST', body=body, params={'sendUpdates': 'none'}, allow=(409,))
                    if result is None:  # A retry after a successful provider write.
                        result = await request(db, row['orgId'], row['interviewerId'], 'GET', event_id=identifier)
                        if result.get('status') == 'cancelled' or not owns(result, row):
                            raise HTTPException(409, 'The Google event identity changed. Administrator review is required.')
                mapping = {'eventId': identifier, 'userId': row['interviewerId'], 'subject': subject}
                # Persist new mapping before deleting a previous interviewer's event.
                changes = {'googleCalendar': mapping, 'googleCalendarStatus': 'synced',
                           'googleCalendarError': None, 'googleCalendarSyncedAt': utcnow()}
                await db['recruit_interviews'].update_one({'orgId': row['orgId'], 'interviewId': row['interviewId']}, {'$set': changes})
                previous = row.get('googleCalendarPrevious')
                if previous and previous != mapping:
                    await remove(db, row, previous)
        await db['recruit_interviews'].update_one({'orgId': row['orgId'], 'interviewId': row['interviewId']},
            {'$set': changes, '$unset': {'googleCalendarPrevious': ''}})
        await db['google_calendar_outbox'].update_one(query, {'$set': {'status': 'done', 'attempts': attempts}})
        return {'status': changes['googleCalendarStatus']}
    except HTTPException as exc:
        message = str(exc.detail)
        state = 'conflict' if exc.status_code == 409 and 'overlapping' in message else 'needs_attention' if exc.status_code in {401, 409} else 'pending'
        await db['recruit_interviews'].update_one({'orgId': row['orgId'], 'interviewId': row['interviewId']},
            {'$set': {'googleCalendarStatus': state, 'googleCalendarError': message}})
        await db['google_calendar_outbox'].update_one(query, {'$set': {
            'status': 'needs_attention' if state != 'pending' or attempts >= 6 else 'pending',
            'attempts': attempts, 'lastError': message,
            'nextAttemptAt': utcnow() + timedelta(seconds=min(3600, 30 * 2 ** min(attempts, 6)))}})
        return {'status': state, 'message': message}


async def tick(db):
    for job in [r async for r in db['google_calendar_outbox'].find({'status': 'pending', 'nextAttemptAt': {'$lte': utcnow()}}).limit(10)]:
        try:
            async with lease(db, job['orgId'], [f"interview:{job['interviewId']}"]):
                row = await db['recruit_interviews'].find_one({'orgId': job['orgId'], 'interviewId': job['interviewId']})
                if (not row or row.get('scheduleRevision', 1) != job['scheduleRevision']
                        or row.get('status') not in {'scheduled', 'cancelled'}
                        or ('delete' if row['status'] == 'cancelled' else 'upsert') != job['action']):
                    await db['google_calendar_outbox'].update_one({'_id': job['_id']}, {'$set': {'status': 'obsolete'}})
                    continue
                if row['status'] != 'cancelled' and aware(row['endsAt']) <= utcnow():
                    await db['google_calendar_outbox'].update_one({'_id': job['_id']}, {'$set': {'status': 'needs_attention'}})
                    await db['recruit_interviews'].update_one({'_id': row['_id']}, {'$set': {
                        'googleCalendarStatus': 'needs_attention', 'googleCalendarError': 'Calendar reminder was not delivered before the interview ended.'}})
                    continue
                await sync_interview(db, row)
        except HTTPException:
            continue  # Lease contention; another save or worker owns this interview.
