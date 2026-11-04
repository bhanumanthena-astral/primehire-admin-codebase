"""011: additive ATS band lookup/recovery indexes; no resume/profile backfill."""
from app.models.recruitment import now

INDEXES = [
    ([('orgId', 1), ('batchId', 1), ('status', 1), ('atsState', 1), ('atsPreviewJobHash', 1), ('ats.overall', 1)], {'name': 'intake_ats_band'}),
    ([('atsState', 1), ('status', 1)], {'name': 'intake_ats_recovery'}),
]


async def upgrade(db, *, dry_run=False):
    if db.name != 'primehire_admin_v2':
        raise RuntimeError('Refusing ATS range migration outside V2')
    plan = {'version': '011_resume_ats_range_v2', 'backfill': False, 'indexes': [options['name'] for _, options in INDEXES]}
    if dry_run:
        return plan
    for keys, options in INDEXES:
        await db['resume_intake_items'].create_index(keys, **options)
    await db['migrations'].update_one({'version': plan['version']}, {'$setOnInsert': {'appliedAt': now(), 'additiveOnly': True}}, upsert=True)
    return {**plan, 'status': 'applied'}
