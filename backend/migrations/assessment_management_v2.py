"""009: additive V2-only assessment listing/owner indexes; no legacy backfill."""
from app.models.assessment_management import INDEXES
from app.models.recruitment import now


async def upgrade(db, *, dry_run=False):
    plan = {'version': '009_assessment_management_v2', 'collection': 'assessments',
            'backfill': False, 'indexes': [options['name'] for _, options in INDEXES]}
    if dry_run:
        return plan
    if db.name != 'primehire_admin_v2':
        raise RuntimeError('Refusing assessment migration outside the V2 database')
    for keys, options in INDEXES:
        await db['assessments'].create_index(keys, **options)
    await db['migrations'].update_one({'version': plan['version']},
        {'$setOnInsert': {'appliedAt': now()}}, upsert=True)
    return {**plan, 'status': 'applied'}
