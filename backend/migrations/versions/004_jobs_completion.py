"""Normalize legacy wall-clock records to equivalent UTC instants once."""
async def upgrade(db):
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    converted = 0
    async for job in db['jobs'].find({'datesVersion': {'$exists': False}}):
        org = await db['organizations'].find_one({'orgId':job['orgId']})
        try:
            zone = ZoneInfo(((org or {}).get('settings') or {}).get('timezone') or 'UTC')
        except (ValueError, KeyError):
            zone = ZoneInfo('UTC')
        values = {'datesVersion':'utc-v1'}
        for field in ['openedAt','closesAt']:
            value = job.get(field)
            if isinstance(value,str):
                value = datetime.fromisoformat(value.replace('Z','+00:00'))
            if isinstance(value,datetime):
                wall = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
                values[field] = wall.replace(tzinfo=zone).astimezone(timezone.utc)
        await db['jobs'].update_one({'_id':job['_id']}, {'$set':values})
        converted += 1
    owners = 0
    async for job in db['jobs'].find({'assigneeName': {'$exists': False}}):
        user = await db['users'].find_one({'orgId': job['orgId'], 'userId': job.get('assigneeUserId')})
        if user:
            await db['jobs'].update_one({'_id': job['_id']}, {'$set': {'assigneeName': user.get('name', '')}})
            owners += 1
    return {'normalizedLegacyDates': converted, 'ownerSnapshots': owners}
