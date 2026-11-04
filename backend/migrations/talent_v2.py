"""008: V2-only talent matching indexes, no legacy collection backfill."""

from datetime import datetime, timezone

from app.db.mongodb import TALENT_INDEXES as INDEXES


async def upgrade(db, *, dry_run=False):
    if dry_run:
        return {
            "version": "008_talent_v2",
            "collections": list(INDEXES),
            "backfill": False,
        }
    for collection, specs in INDEXES.items():
        for keys, options in specs:
            await db[collection].create_index(keys, **options)
    await db["migrations"].update_one(
        {"version": "008_talent_v2"},
        {"$setOnInsert": {"appliedAt": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"version": "008_talent_v2", "status": "applied"}
