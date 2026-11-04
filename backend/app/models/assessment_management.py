"""Additive V2 assessment metadata; never overwrites a published configuration."""
import hashlib
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from fastapi import HTTPException
from .recruitment import now, clean, aware

INDEXES = [([('orgId', 1), ('createdAt', -1), ('jobId', 1)], {'name': 'asm_v2_listing'}),
           ([('orgId', 1), ('createdBy', 1), ('createdAt', -1)], {'name': 'asm_v2_owner'})]


def scope(user):
    base = {'orgId': user.org_id}
    if user.role not in {'super_admin', 'admin'}:
        base['$or'] = [{'createdBy': user.user_id}, {'allowedUserIds': user.user_id}]
    return base


def public(row, can_manage):
    result = clean(row)
    phase = row.get('publicationState', 'published')
    status = 'Draft' if phase == 'draft' else 'Not available'
    if phase == 'published':
        if row.get('isActive') is False:
            status = 'Inactive'
        elif row.get('windowStart') and row.get('windowEnd'):
            status = 'Scheduled' if aware(row['windowStart']) > now() else 'Completed' if aware(row['windowEnd']) <= now() else 'Active'
    result.update(id=row['jobId'], status=status,
        canEdit=can_manage and phase == 'draft', canPublish=can_manage and phase == 'draft',
        revision=row.get('revision', 1), publicationState=phase)
    return result


class AssessmentManagementRepository:
    def __init__(self, db, user):
        self.db, self.user, self.collection = db, user, db['assessments']

    async def get(self, key):
        row = await self.collection.find_one({'$and': [scope(self.user), {'jobId': key}]})
        if not row:
            raise HTTPException(404, 'Assessment not found or not accessible')
        return row

    async def create(self, config, source_group=None):
        data = config.model_dump(mode='json')
        signature = hashlib.sha256(__import__('json').dumps(data, sort_keys=True).encode()).hexdigest()
        identity = hashlib.sha256((self.user.org_id + '\0' + config.jobId).encode()).hexdigest()
        row = {**data, '_id': 'assessment_v2:' + identity, 'orgId': self.user.org_id,
            'createdBy': self.user.user_id, 'updatedBy': self.user.user_id,
            'createdAt': now(), 'updatedAt': now(), 'revision': 1, 'publicationState': 'draft',
            'isActive': False, 'sourceGroupId': source_group, 'configHash': signature,
            'windowStart': config.startDate, 'windowEnd': config.endDate}
        try:
            # Legacy org/job index also protects IDs originating outside this module.
            if await self.collection.find_one({'orgId': self.user.org_id, 'jobId': config.jobId}):
                raise HTTPException(409, 'Assessment ID already exists; open it instead of creating a duplicate')
            await self.collection.insert_one(row)
        except DuplicateKeyError:
            raise HTTPException(409, 'Assessment ID already exists; open it instead of creating a duplicate') from None
        return row

    async def update(self, key, revision, changes, phase='draft'):
        row = await self.collection.find_one_and_update(
            {'$and': [scope(self.user), {'jobId': key, 'revision': revision, 'publicationState': phase}]},
            {'$set': {**changes, 'updatedAt': now(), 'updatedBy': self.user.user_id}, '$inc': {'revision': 1}},
            return_document=ReturnDocument.AFTER)
        if not row:
            raise HTTPException(409, 'Assessment changed or is locked. Reload the latest saved version before continuing.')
        return row
