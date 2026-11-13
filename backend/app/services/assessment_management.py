"""Draft, CSV and human-confirmed publication around the existing POST contract."""
import hashlib
import json
import httpx
from fastapi import HTTPException
from ..config import settings
from ..models.assessment_management import AssessmentManagementRepository, public
from ..models.hiring import AuditLogRepository
from ..models.recruitment import now
from ..schemas.assessment_management import AssessmentConfig
from .assessment_csv import parse_csv
from .primehire_api import _base_and_headers, UpstreamError
from .primehire_service import auth_headers

_publication_connection = None


def configure_publication(base_url, access_key, secret_key):
    """V2 launcher reuses the existing form's server credentials in memory only."""
    global _publication_connection
    if access_key and secret_key:
        _publication_connection = (base_url.rstrip('/'), auth_headers(access_key, secret_key))


async def audit(db, user, action, key, details=None):
    await AuditLogRepository(db).log(org_id=user.org_id, actor_user_id=user.user_id,
        action='assessment_management.' + action, resource_type='assessment', resource_id=key,
        details=details or {})


async def save(db, user, payload, key=None, source_group=None):
    repo = AssessmentManagementRepository(db, user)
    config = payload.config
    if key:
        previous = await repo.get(key)
        if previous.get('publicationState') != 'draft':
            raise HTTPException(409, 'Published questions are locked. Create a new draft to change the configuration.')
        if key != config.jobId or previous['roundType'] != config.roundType:
            raise HTTPException(422, 'Assessment ID and round type cannot change during editing')
        if not payload.expectedRevision:
            raise HTTPException(422, 'The saved revision is required')
        if await db['candidates'].find_one({'orgId': user.org_id, 'assessmentId': key}):
            raise HTTPException(409, 'An assessment with candidate assignments cannot be edited')
        changes = config.model_dump(mode='json')
        changes.update(windowStart=config.startDate, windowEnd=config.endDate)
        changes['configHash'] = hashlib.sha256(json.dumps(config.model_dump(mode='json'), sort_keys=True).encode()).hexdigest()
        row = await repo.update(key, payload.expectedRevision, changes)
    else:
        row = await repo.create(config, source_group)
    await audit(db, user, 'updated' if key else 'created', config.jobId,
                {'revision': row['revision'], 'questionCount': len(config.questions)})
    return public(row, True)


async def preview_csv(db, user, text):
    result = parse_csv(text, user.org_id)
    if result['fileErrors']:
        return result
    ids = [group['config']['jobId'] for group in result['groups'] if group['config']]
    existing = {row['jobId'] async for row in db['assessments'].find(
        {'orgId': user.org_id, 'jobId': {'$in': ids}}, {'jobId': 1}).limit(100)}
    for group in result['groups']:
        if group['config'] and group['config']['jobId'] in existing:
            group.update(status='duplicate', config=None)
            for row in result['rows']:
                if row.get('groupId') == group['groupId']:
                    row.update(status='duplicate', errors=[{'field': 'Assessment', 'reason': 'Already imported; open the saved assessment to review its questions'}])
    return result


async def import_csv(db, user, payload):
    result = await preview_csv(db, user, payload.text)
    if result['previewHash'] != payload.previewHash:
        raise HTTPException(409, 'The file changed. Validate and preview it again.')
    if result['fileErrors']:
        raise HTTPException(422, '; '.join(result['fileErrors']))
    from ..schemas.assessment_management import SaveDraft
    summary = {'totalRows': len(result['rows']), 'totalGroups': len(result['groups']),
        'imported': 0, 'failed': 0, 'duplicates': 0, 'items': [], 'rows': result['rows']}
    for group in result['groups']:
        item = {'groupId': group['groupId'], 'rows': group['rows'], 'status': group['status']}
        if group['status'] == 'valid':
            try:
                row = await save(db, user, SaveDraft(config=AssessmentConfig.model_validate(group['config'])), source_group=group['groupId'])
                item.update(status='imported', assessmentId=row['id'])
                summary['imported'] += 1
            except HTTPException as error:
                item.update(status='duplicate' if error.status_code == 409 else 'failed', reason=error.detail)
                summary['duplicates' if error.status_code == 409 else 'failed'] += 1
            except Exception:
                item.update(status='failed', reason='Could not save this group. Successful groups are preserved; retry this file safely.')
                summary['failed'] += 1
        else:
            summary['duplicates' if group['status'] == 'duplicate' else 'failed'] += 1
        for row in summary['rows']:
            if row.get('groupId') == group['groupId']:
                row['status'] = item['status']
        summary['items'].append(item)
    await audit(db, user, 'csv_import', result['previewHash'], {key: summary[key] for key in ['totalRows', 'totalGroups', 'imported', 'failed', 'duplicates']})
    return summary


def upstream_payload(config):
    questions = []
    for question in config.questions:
        value = {'id': question.id, 'question': question.text, 'type': question.type, 'max_duration': question.maxDuration}
        if question.type == 'MCQ':
            value['options'] = [{'id': chr(65 + index), 'data': option} for index, option in enumerate(question.options)]
            value['correct_option_id'] = chr(65 + question.options.index(question.correctOption))
        elif config.roundType == 'BASIC':
            value['criteria'] = question.criteria or question.referenceAnswer
        else:
            value['answer'] = question.referenceAnswer
        if config.roundType != 'HR':
            # Keep whole-valued scoring fields identical to the provider example.
            def number(item):
                return int(item) if item is not None and float(item).is_integer() else item
            value.update(max_score=number(question.maxScore), weightage=number(question.weightage))
        questions.append(value)
    return {'job_id': config.jobId, 'job_title': config.jobTitle, 'job_description': config.jobDescription,
        'language': config.language, 'round_type': config.roundType, 'questions': questions,
        'start_date': config.startDate.isoformat(), 'end_date': config.endDate.isoformat()}


def provider_connection():
    """Share the current V2 provider account without copying credentials."""
    return _publication_connection or _base_and_headers()


def provider_error(response, headers):
    """Expose validation messages, never echoed request inputs or credentials."""
    try:
        body = response.json()
    except ValueError:
        return ''
    if not isinstance(body, dict):
        return ''
    detail = body.get('detail') or body.get('message') or body.get('error')
    if isinstance(detail, list):
        detail = '; '.join('.'.join(str(part) for part in item.get('loc', [])) + ': ' + str(item.get('msg', 'Invalid value'))
            for item in detail[:8] if isinstance(item, dict))
    if not isinstance(detail, str):
        return ''
    import re
    # Some gateways return entire payloads or HTML as their error. Do not echo them.
    if '<html' in detail.lower() or 'x-access-key' in detail.lower() or 'x-secret-key' in detail.lower():
        return ''
    for key, value in headers.items():
        if key.lower() in {'x-access-key', 'x-secret-key', 'authorization'} and value:
            detail = detail.replace(value, '[REDACTED]')
    detail = re.sub(r'[\r\n\x00-\x1f]+', ' ', detail)
    return detail[:600]


async def create_upstream(config):
    try:
        base, headers = provider_connection()
    except UpstreamError:
        raise HTTPException(503, 'PrimeHire credentials are not configured. The draft is preserved.') from None
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(base + '/assessment', headers=headers, json=upstream_payload(config))
    except (httpx.TimeoutException, httpx.TransportError):
        raise HTTPException(504, 'Publication outcome is unconfirmed. Check with the provider before retrying; the saved configuration is preserved.') from None
    if response.status_code >= 500 or response.status_code == 409:
        raise HTTPException(504, 'Publication outcome requires provider reconciliation. Automatic retry is blocked to prevent duplicate creation.')
    if not response.is_success:
        reason = provider_error(response, headers)
        suffix = f' Reason: {reason}' if reason else ''
        raise HTTPException(502, f'PrimeHire refused publication (HTTP {response.status_code}). The draft is preserved.{suffix}')
    try:
        body = response.json()
    except ValueError:
        raise HTTPException(504, 'Provider response was unclear. Publication requires reconciliation before retrying.') from None
    if isinstance(body, dict) and (str(body.get('status', '')).upper() in {'ERROR', 'FAILED'} or body.get('success') is False):
        raise HTTPException(502, 'PrimeHire rejected the configuration. The draft is preserved.')


async def publish(db, user, key, payload):
    repo = AssessmentManagementRepository(db, user)
    row = await repo.get(key)
    if row.get('publicationState') == 'published':
        return public(row, True)  # Idempotent repeated confirmation; no upstream call.
    if row.get('publicationState') != 'draft':
        raise HTTPException(409, 'Publication is already running or requires provider reconciliation. Do not create a duplicate.')
    config = AssessmentConfig.model_validate({field: row[field] for field in AssessmentConfig.model_fields})
    if config.endDate <= now():
        raise HTTPException(422, 'The assessment window has ended. Edit the draft dates before publishing.')
    row = await repo.update(key, payload.expectedRevision, {'publicationState': 'publishing', 'publishStartedAt': now()})
    try:
        await create_upstream(config)
    except HTTPException as error:
        await repo.update(key, row['revision'], {'publicationState': 'uncertain' if error.status_code == 504 else 'draft', 'publishError': error.detail}, phase='publishing')
        await audit(db, user, 'publication_failed', key, {'uncertain': error.status_code == 504})
        raise
    row = await repo.update(key, row['revision'], {'publicationState': 'published', 'isActive': True, 'publishedAt': now(), 'publishError': None}, phase='publishing')
    await audit(db, user, 'published', key, {'revision': row['revision']})
    return public(row, True)
