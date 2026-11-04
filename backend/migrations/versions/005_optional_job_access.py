"""Optional V2 access settings. No record backfill or index changes required."""


async def upgrade(db):
    return {'changes':0,'optionalFields':['users.jobAccess','jobs.assigneeAccess'],
            'backfillRequired':False}
