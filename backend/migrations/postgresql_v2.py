"""Explicit PostgreSQL cutover initialization; source MongoDB stays untouched."""
from app.db.mongodb import INDEXES, ensure_indexes
from deploy.runtime import v2_index_specs


async def upgrade(db, *, dry_run=False):
    if getattr(db, 'backend', None) != 'postgresql':
        raise RuntimeError('This migration requires a PostgreSQL V2 target')
    report = {'version': 'postgresql_v2_001', 'backend': 'postgresql',
              'collections': sorted(INDEXES), 'additiveOnly': True}
    if dry_run:
        return {**report, 'status': 'pending'}
    from app.db import mongodb
    original = mongodb.INDEXES
    try:
        mongodb.INDEXES = v2_index_specs(original)
        await ensure_indexes(db)
    finally:
        mongodb.INDEXES = original
    from app.models.recruitment import now
    await db['migrations'].update_one({'version': report['version']},
        {'$setOnInsert': {'appliedAt': now(), 'backend': 'postgresql'}}, upsert=True)
    return {**report, 'status': 'applied'}
