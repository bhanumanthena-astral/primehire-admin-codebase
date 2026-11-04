"""Meta template adapter. Credentials stay server-side; uncertain sends never retry."""
import re
import math
from urllib.parse import urlsplit
import httpx
from fastapi import HTTPException
from ..config import settings
from ..models.recruitment import now
from ..models.jobs import BackgroundJobRepository


def configuration():
    ready = bool(settings.whatsapp_access_token and re.fullmatch(r'\d+', settings.whatsapp_phone_number_id)
        and re.fullmatch(r'v\d+\.\d+', settings.whatsapp_graph_version)
        and re.fullmatch(r'[a-z0-9_]+', settings.whatsapp_template_name)
        and math.isfinite(settings.whatsapp_price_per_message) and settings.whatsapp_price_per_message > 0)
    return {'configured': ready, 'price': settings.whatsapp_price_per_message,
            'currency': settings.whatsapp_currency}


async def queue(db, user, job, application_ids):
    config = configuration()
    approval = job.get('whatsappApproval') or {}
    if not config['configured'] or not approval.get('enabled') or approval.get('price') != config['price'] or approval.get('currency') != config['currency']:
        raise HTTPException(409, 'WhatsApp requires configured Meta credentials, pricing and current manager approval.')
    results = []
    for key in dict.fromkeys(application_ids):
        application = await db['applications'].find_one({'orgId': user.org_id, 'jobId': job['jobId'], 'applicationId': key})
        if not application:
            results.append({'applicationId': key, 'status': 'skipped', 'reason': 'Application not found for this job.'})
            continue
        if not (application.get('assessment') or {}).get('link'):
            results.append({'applicationId': key, 'status': 'skipped', 'reason': 'Generate the assessment link first.'})
            continue
        await BackgroundJobRepository(db).enqueue(org_id=user.org_id, kind='whatsapp_invite', entity_type='application',
            entity_key=key, payload={'applicationId': key, 'actorUserId': user.user_id}, max_attempts=1)
        results.append({'applicationId': key, 'status': 'queued'})
    return {'items': results}


async def deliver(db, job):
    org, key = job['orgId'], job['payload']['applicationId']
    application = await db['applications'].find_one({'orgId': org, 'applicationId': key})
    if not application:
        return {'skipped': 'Application removed'}
    query = {'orgId': org, 'applicationId': key}
    previous = application.get('whatsappInvite') or {}
    if previous.get('status') in {'sending', 'accepted', 'uncertain'}:
        return {'skipped': 'Already attempted; reconcile before sending again'}
    hiring_job = await db['jobs'].find_one({'orgId': org, 'jobId': application['jobId']}) or {}
    actor = await db['users'].find_one({'orgId': org, 'userId': job['payload']['actorUserId'], 'isActive': True})
    approval = hiring_job.get('whatsappApproval') or {}
    config = configuration()
    if not actor or actor.get('role') not in {'super_admin', 'admin', 'hr', 'recruiter'} or not config['configured'] or not approval.get('enabled') or approval.get('price') != config['price'] or approval.get('currency') != config['currency']:
        return {'skipped': 'Delivery configuration, actor or manager approval is unavailable'}
    if actor.get('role') not in {'super_admin', 'admin'} and actor['userId'] not in {hiring_job.get('createdBy'), hiring_job.get('assigneeUserId')}:
        return {'skipped': 'Sender no longer owns this job'}
    person = await db['applicants'].find_one({'orgId': org, 'applicantId': application['applicantId']}) or {}
    phone = str(person.get('phone') or (person.get('profile') or {}).get('phone') or '')
    link = (application.get('assessment') or {}).get('link', '')
    if not re.fullmatch(r'\+[1-9]\d{6,14}', phone) or urlsplit(link).scheme != 'https':
        await db['applications'].update_one(query, {'$set': {'whatsappInvite': {'status': 'failed', 'reason': 'International phone number or HTTPS assessment link is missing.'}}})
        return {'failed': 'Invalid phone or link'}
    claimed = await db['applications'].update_one({**query, 'whatsappInvite.status': {'$nin': ['sending', 'accepted', 'uncertain']}},
        {'$set': {'whatsappInvite': {'status': 'sending', 'attemptedAt': now(), 'price': config['price'], 'currency': config['currency']}}})
    if not claimed.modified_count:
        return {'skipped': 'Another worker claimed delivery'}
    payload = {'messaging_product': 'whatsapp', 'to': phone[1:], 'type': 'template', 'template': {
        'name': settings.whatsapp_template_name, 'language': {'code': settings.whatsapp_template_language},
        'components': [{'type': 'body', 'parameters': [{'type': 'text', 'text': hiring_job.get('title', 'Assessment')}, {'type': 'text', 'text': link}]}]}}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f'https://graph.facebook.com/{settings.whatsapp_graph_version}/{settings.whatsapp_phone_number_id}/messages',
                headers={'Authorization': f'Bearer {settings.whatsapp_access_token}'}, json=payload)
        messages = response.json().get('messages', []) if response.is_success else []
        state = {'status': 'accepted', 'messageId': messages[0]['id']} if messages and messages[0].get('id') else {'status': 'failed', 'reason': 'Meta rejected the message; inspect provider configuration.'}
    except Exception:
        state = {'status': 'uncertain', 'reason': 'Provider outcome unknown. Reconcile in Meta before retrying.'}
    await db['applications'].update_one(query, {'$set': {'whatsappInvite': {**state, 'attemptedAt': now(), 'price': config['price'], 'currency': config['currency']}}})
    return state
