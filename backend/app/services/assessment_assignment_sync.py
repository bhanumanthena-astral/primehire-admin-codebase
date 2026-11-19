"""Connect generated candidate assignments to their exact job application."""
from ..models.jobs import BackgroundJobRepository
from ..models.recruitment import now


async def attach_attempt(db, assignment):
    org, key = assignment['orgId'], assignment.get('applicationId')
    attempt = assignment.get('interviewId')
    if not key or not attempt or assignment.get('status') != 'Generated':
        return False
    query = {'orgId': org, 'applicationId': key, 'applicantId': assignment['candidateId'], 'jobId': assignment.get('jobId')}
    app = await db.applications.find_one(query)
    if not app:
        return False
    job = await db.jobs.find_one({'orgId': org, 'jobId': app['jobId']})
    if not job or job.get('assessmentJobId') not in {None, '', assignment['assessmentId']}:
        return False
    previous = app.get('assessment') or {}
    if previous.get('interviewId') not in {None, '', attempt}:
        return False  # Never replace another attempt or its report.
    if not previous.get('interviewId'):
        result = await db.applications.update_one({**query, '$or': [
            {'assessment.interviewId': None}, {'assessment.interviewId': ''}]}, {'$set': {
                'assessment.interviewId': attempt, 'assessment.assessmentId': assignment['assessmentId'],
                'assessment.assignmentId': assignment['assignmentId'],
                'assessment.state': 'link_created', 'assessment.status': 'Link ready',
                'assessment.windowStart': assignment.get('startDate'), 'assessment.windowEnd': assignment.get('endDate')}})
        if not result.matched_count:
            return False
    await BackgroundJobRepository(db).enqueue(org_id=org, kind='assessment_sync', entity_type='application',
        entity_key=key, payload={'applicationId': key})
    await db.candidate_assignments.update_one({'orgId': org, 'assignmentId': assignment['assignmentId'],
        'interviewId': attempt}, {'$set': {'applicationLinkedAt': now()}})
    return True


async def reconcile_assignments(db, *, org_id=None, job_id=None, limit=50):
    query = {'status': 'Generated', 'interviewId': {'$exists': True, '$nin': [None, '']},
             'applicationId': {'$exists': True, '$nin': [None, '']}, 'applicationLinkedAt': None}
    if org_id:
        query['orgId'] = org_id
    if job_id:
        query['jobId'] = job_id
    async for assignment in db.candidate_assignments.find(query).limit(limit):
        await attach_attempt(db, assignment)
