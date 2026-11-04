"""V2-only assessment configuration; legacy CRUD and candidate scheduling remain intact."""
import re
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from ..config import settings
from ..security.deps import get_db, require_permission
from ..security.rate_limit import limiter
from ..models.assessment_management import AssessmentManagementRepository, scope, public
from ..models.recruitment import now
from ..schemas.assessment_management import SaveDraft, PublishDraft, CsvText, ConfirmCsv
from ..services import assessment_management as service

router = APIRouter(prefix='/api/assessment-management', tags=['assessment-management'])


def database(db=Depends(get_db)):
    if settings.mongodb_database != 'primehire_admin_v2':
        raise HTTPException(404, 'Assessment Management V2 is not enabled on this database')
    if db is None:
        raise HTTPException(503, 'Database unavailable')
    return db


async def can_write(db, user):
    if user.impersonating or 'assessments.manage' not in user.permissions:
        return False
    if user.role in {'super_admin', 'admin'}:
        return True
    actor = await db['users'].find_one({'orgId': user.org_id, 'userId': user.user_id}, {'jobAccess': 1})
    access = (actor or {}).get('jobAccess')
    return access is None or bool(set(access) & {'edit', 'create'})


async def writable(db, user, row=None):
    if not await can_write(db, user) or row and user.role not in {'super_admin', 'admin'} and row.get('createdBy') != user.user_id:
        raise HTTPException(403, 'You do not have permission to change this assessment')
    limit = limiter.check(f'assessment-management:{user.org_id}:{user.user_id}', 60, 60)
    if not limit.allowed:
        raise HTTPException(429, 'Too many changes; retry shortly', headers={'Retry-After': str(limit.retry_after)})


async def serialize(db, user, row):
    manage = await can_write(db, user) and (user.role in {'super_admin', 'admin'} or row.get('createdBy') == user.user_id)
    result = public(row, manage)
    for field in ['createdBy', 'updatedBy']:
        actor = await db['users'].find_one({'orgId': user.org_id, 'userId': row.get(field)}, {'name': 1}) if row.get(field) else None
        result[field + 'Name'] = (actor or {}).get('name')
    return result


@router.get('/capabilities')
async def capabilities(user=Depends(require_permission('assessments.view')), db=Depends(database)):
    return {'enabled': True, 'canManage': await can_write(db, user),
        'roundTypes': ['BASIC', 'TECHNICAL', 'HR'], 'languages': ['ENGLISH', 'DUTCH'],
        'publishedEditingSupported': False, 'maxCsvRows': 1000, 'maxCsvGroups': 100}


@router.get('')
async def listing(search: str = Query('', max_length=100), assessmentId: str | None = Query(None, max_length=100), language: Literal['ENGLISH', 'DUTCH'] | None = None,
    roundType: Literal['BASIC', 'TECHNICAL', 'HR'] | None = None,
    status: Literal['Draft', 'Scheduled', 'Active', 'Completed', 'Inactive'] | None = None,
    startsFrom: datetime | None = None, startsTo: datetime | None = None,
    endsFrom: datetime | None = None, endsTo: datetime | None = None,
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100),
    user=Depends(require_permission('assessments.view')), db=Depends(database)):
    filters = [{'jobId': assessmentId}] if assessmentId else []
    if search:
        regex = {'$regex': re.escape(search), '$options': 'i'}
        filters.append({'$or': [{'jobId': regex}, {'jobDescription': regex}, {'jobTitle': regex}]})
    if language:
        filters.append({'language': {'$in': [language, language.lower(), 'en' if language == 'ENGLISH' else 'nl']}})
    if roundType:
        filters.append({'roundType': roundType})
    clock = now()
    if status == 'Draft':
        filters.append({'publicationState': 'draft'})
    elif status:
        filters.append({'publicationState': {'$nin': ['draft', 'publishing', 'uncertain']}})
        if status == 'Inactive':
            filters.append({'isActive': False})
        else:
            filters.append({'isActive': {'$ne': False}})
            if status == 'Scheduled':
                filters.append({'windowStart': {'$gt': clock}})
            elif status == 'Completed':
                filters.append({'windowEnd': {'$lte': clock}})
            else:
                filters.append({'windowStart': {'$lte': clock}, 'windowEnd': {'$gt': clock}})
    for field, lower, upper in [('windowStart', startsFrom, startsTo), ('windowEnd', endsFrom, endsTo)]:
        if any(value and not value.tzinfo for value in [lower, upper]):
            raise HTTPException(422, 'Filter dates must include a timezone')
        if lower and upper and lower >= upper:
            return {'items': [], 'total': 0}
        if lower or upper:
            filters.append({field: {**({'$gte': lower} if lower else {}), **({'$lt': upper} if upper else {})}})
    query = {'$and': [scope(user), *filters]}
    rows = await db['assessments'].find(query).sort([('createdAt', -1), ('jobId', 1)]).skip(skip).limit(limit).to_list(limit)
    return {'items': [await serialize(db, user, row) for row in rows], 'total': await db['assessments'].count_documents(query)}


@router.post('/csv/validate')
async def csv_preview(payload: CsvText, user=Depends(require_permission('assessments.manage')), db=Depends(database)):
    await writable(db, user)
    return await service.preview_csv(db, user, payload.text)


@router.post('/csv/import')
async def csv_import(payload: ConfirmCsv, user=Depends(require_permission('assessments.manage')), db=Depends(database)):
    await writable(db, user)
    return await service.import_csv(db, user, payload)


@router.post('', status_code=201)
async def create(payload: SaveDraft, user=Depends(require_permission('assessments.manage')), db=Depends(database)):
    await writable(db, user)
    return await service.save(db, user, payload)


@router.get('/{key}')
async def detail(key: str, user=Depends(require_permission('assessments.view')), db=Depends(database)):
    row = await AssessmentManagementRepository(db, user).get(key)
    return await serialize(db, user, row)


@router.put('/{key}')
async def edit(key: str, payload: SaveDraft, user=Depends(require_permission('assessments.manage')), db=Depends(database)):
    row = await AssessmentManagementRepository(db, user).get(key)
    await writable(db, user, row)
    return await service.save(db, user, payload, key)


@router.post('/{key}/publish')
async def publish(key: str, payload: PublishDraft, user=Depends(require_permission('assessments.manage')), db=Depends(database)):
    row = await AssessmentManagementRepository(db, user).get(key)
    await writable(db, user, row)
    return await service.publish(db, user, key, payload)
