"""Admin sees all jobs; staff see only their own assignments."""
from .deps import CurrentUser

def owner_scope(user: CurrentUser) -> str | None:
    return None if user.role in {"super_admin", "admin"} else user.user_id

def job_repository(db, user):
    from ..models.hiring import JobRepository
    return JobRepository(db, owner_id=owner_scope(user))


async def visible_applications(db, user, documents):
    if owner_scope(user) is None:
        return documents
    if 'jobs.view' not in user.permissions:
        return []
    jobs = job_repository(db, user)
    return [doc for doc in documents if await jobs.get_by_id(doc.get('jobId', ''), user.org_id)]


async def can_access_application(db, user, application_id):
    from ..models.hiring import ApplicationRepository
    document = await ApplicationRepository(db).get_by_id(application_id, user.org_id)
    return bool(document and await visible_applications(db, user, [document]))
