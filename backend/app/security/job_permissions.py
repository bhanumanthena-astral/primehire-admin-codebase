"""Optional V2 user and assignment access; existing records retain role defaults."""
from fastapi import HTTPException

ALL_JOB_ACCESS = frozenset({'view', 'edit', 'create', 'upload'})


def job_access(role, configured=None):
    defaults = ALL_JOB_ACCESS if role in {'super_admin','admin','hr','recruiter'} else frozenset({'view'}) if role == 'viewer' else frozenset()
    if role in {'super_admin','admin'} or configured is None:
        return defaults
    return defaults.intersection(configured)


async def require_job_access(db, user, action, job=None):
    if user.role in {'super_admin','admin'}:
        return
    record = await db['users'].find_one({'userId':user.user_id,'orgId':user.org_id})
    allowed = job_access(user.role, (record or {}).get('jobAccess'))
    if action not in allowed or (job and job.get('assigneeAccess') is not None and action not in job['assigneeAccess']):
        raise HTTPException(status_code=403,detail='Your administrator has not granted this job access')
    if job and action in {'edit','upload'} and job.get('lifecycleStatus') != 'OPEN':
        raise HTTPException(status_code=409,detail='This job is not open; only an administrator can change it')


def require_job_admin(user):
    if user.role not in {'super_admin','admin'}:
        raise HTTPException(status_code=403,detail='Only an administrator can change job status or assignments')
