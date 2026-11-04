"""010: additive Candidate Management indexes, never V1 data."""
from app.models.candidate_management import INDEXES
from app.models.recruitment import now


async def upgrade(db, *, dry_run=False):
    plan = {'version':'010_candidate_management_v2','backfill':False,
        'indexes':{collection:[options['name'] for _,options in entries] for collection,entries in INDEXES.items()}}
    if dry_run:
        return plan
    if db.name != 'primehire_admin_v2':
        raise RuntimeError('Refusing Candidate Management migration outside V2')
    for collection, entries in INDEXES.items():
        for keys, options in entries:
            await db[collection].create_index(keys, **options)
    await db['migrations'].update_one({'version':plan['version']},{'$setOnInsert':{'appliedAt':now()}},upsert=True)
    return {**plan,'status':'applied'}
