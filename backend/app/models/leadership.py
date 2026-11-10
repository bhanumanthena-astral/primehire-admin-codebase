"""Bounded analytics reads with explicit field projection and tenant scope."""
from fastapi import HTTPException

ROLE_LIMIT = 500
RECORD_LIMIT = 20000
EVENT_LIMIT = 60000


async def portfolio(db, org_id, job_id=None):
    jobs = await db.jobs.find({'orgId': org_id}, {
        '_id': 0, 'jobId': 1, 'title': 1, 'department': 1, 'lifecycleStatus': 1,
        'status': 1, 'positionsTotal': 1, 'positionsFilled': 1, 'createdAt': 1,
        'closesAt': 1,
    }).sort([('createdAt', -1), ('jobId', 1)]).limit(ROLE_LIMIT + 1).to_list(ROLE_LIMIT + 1)
    limited = len(jobs) > ROLE_LIMIT
    jobs = jobs[:ROLE_LIMIT]
    choices = [{'jobId': row['jobId'], 'title': row.get('title') or 'Untitled role'} for row in jobs]
    if job_id:
        selected = await db.jobs.find_one({'orgId': org_id, 'jobId': job_id}, {
            '_id': 0, 'jobId': 1, 'title': 1, 'department': 1, 'lifecycleStatus': 1,
            'status': 1, 'positionsTotal': 1, 'positionsFilled': 1, 'createdAt': 1, 'closesAt': 1})
        if not selected:
            raise HTTPException(404, 'Role not found')
        jobs, limited = [selected], False
    ids = [row['jobId'] for row in jobs]
    scope = {'orgId': org_id, 'jobId': {'$in': ids}}
    applications = await db.applications.find(scope, {
        '_id': 0, 'applicationId': 1, 'jobId': 1, 'createdAt': 1, 'currentStage': 1,
        'assessment.sentAt': 1, 'assessment.startedAt': 1, 'assessment.submittedAt': 1,
        'assessment.completedAt': 1, 'assessment.submissionTimeSource': 1,
        'assessment.state': 1, 'assessment.score': 1,
    }).sort([('createdAt', -1), ('applicationId', 1)]).limit(RECORD_LIMIT + 1).to_list(RECORD_LIMIT + 1)
    app_limited = len(applications) > RECORD_LIMIT
    applications = applications[:RECORD_LIMIT]
    app_ids = [row['applicationId'] for row in applications]
    # Legacy stage_history has no orgId: only join through this tenant's applications.
    history = await db.stage_history.find({'applicationId': {'$in': app_ids}, '$or': [
        {'orgId': org_id}, {'orgId': {'$exists': False}}]}, {
        '_id': 0, 'applicationId': 1, 'toStage': 1, 'transitionAt': 1,
    }).sort('transitionAt', -1).limit(EVENT_LIMIT + 1).to_list(EVENT_LIMIT + 1)
    interviews = await db.recruit_interviews.find({**scope, 'applicationId': {'$in': app_ids}}, {
        '_id': 0, 'applicationId': 1, 'round': 1, 'status': 1, 'createdAt': 1,
        'startsAt': 1, 'endsAt': 1,
    }).sort('createdAt', -1).limit(EVENT_LIMIT + 1).to_list(EVENT_LIMIT + 1)
    reviews = await db.recruit_reviews.find({'orgId': org_id, 'applicationId': {'$in': app_ids},
        'applied': True, 'decision': 'advance'}, {
        '_id': 0, 'applicationId': 1, 'round': 1, 'createdAt': 1,
    }).sort('createdAt', -1).limit(EVENT_LIMIT + 1).to_list(EVENT_LIMIT + 1)
    return dict(jobs=jobs, choices=choices, applications=applications,
                history=history[:EVENT_LIMIT], interviews=interviews[:EVENT_LIMIT], reviews=reviews[:EVENT_LIMIT],
                limited=limited or app_limited or any(len(rows) > EVENT_LIMIT for rows in [history, interviews, reviews]),
                scope=scope)
