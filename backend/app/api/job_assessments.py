"""Link accessible published assessments and assign this job's candidates."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from ..api.candidate_management import database
from ..security.deps import require_permission
from ..security.job_permissions import require_job_access
from ..services import candidate_management as service
from ..schemas.candidate_management import AssignmentCreate
from ..models.recruitment import lease, now

router = APIRouter(prefix='/api/job-assessments', tags=['job-assessments'])


@router.get('/{job_id}/applications/{application_id}/report')
async def candidate_report(job_id: str, application_id: str, response: Response,
    user=Depends(require_permission('candidates.manage')), db=Depends(database)):
    response.headers['Cache-Control'] = 'no-store'
    from ..security.rate_limit import limiter
    budget = limiter.check(f'assessment-report:{user.org_id}:{user.user_id}', 30, 60)
    if not budget.allowed:
        raise HTTPException(429, 'Too many report requests. Please retry shortly.', headers={'Retry-After': str(budget.retry_after)})
    from ..services.job_candidate_reports import read_report
    return await read_report(db, user, job_id, application_id)


class Link(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assessmentId: str = Field(min_length=1, max_length=100)
    expectedAssessmentId: str | None = None


class Assign(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assessmentId: str = Field(min_length=1, max_length=100)
    applicationIds: list[str] = Field(min_length=1, max_length=50)
    startDate: datetime
    endDate: datetime
    confirmed: bool = False


async def writable_job(db, user, job_id):
    if not await service.can_manage(db, user):
        raise HTTPException(403, 'Candidate assignment permission is required')
    job = await db['jobs'].find_one({'$and': [await service.job_scope(db, user), {'jobId': job_id}]})
    if not job:
        raise HTTPException(404, 'Job not found or not accessible')
    await require_job_access(db, user, 'edit', job)
    if job.get('lifecycleStatus') in {'CLOSED', 'ARCHIVED', 'ON_HOLD'}:
        raise HTTPException(409, 'Reopen this job before assigning assessments')
    return job


@router.post('/{job_id}/link')
async def link(job_id: str, payload: Link, user=Depends(require_permission('candidates.manage')), db=Depends(database)):
    async with lease(db, user.org_id, [f'job-assessment:{job_id}']):
        job = await writable_job(db, user, job_id)
        if (job.get('assessmentJobId') or None) != (payload.expectedAssessmentId or None):
            raise HTTPException(409, 'The linked assessment changed. Refresh the job and try again')
        assessment = await service.assessment_for(db, user, payload.assessmentId)
        await db['jobs'].update_one({'orgId': user.org_id, 'jobId': job_id}, {'$set': {
            'assessmentJobId': payload.assessmentId, 'assessmentRoundType': assessment['roundType'], 'updatedAt': now()}})
        await service.audit(db, user, 'job_assessment_linked', job_id, {'assessmentId': payload.assessmentId, 'previousAssessmentId': job.get('assessmentJobId')})
    return {'assessmentId': payload.assessmentId, 'roundType': assessment['roundType']}


@router.post('/{job_id}/assign')
async def assign(job_id: str, payload: Assign, user=Depends(require_permission('candidates.manage')), db=Depends(database)):
    if not payload.confirmed:
        raise HTTPException(422, 'Review and confirm candidate assignments')
    items = []
    async with lease(db, user.org_id, [f'job-assessment:{job_id}']):
        job = await writable_job(db, user, job_id)
        if job.get('assessmentJobId') != payload.assessmentId:
            raise HTTPException(409, 'The job assessment changed. Refresh before assigning candidates')
        assessment = await service.assessment_for(db, user, payload.assessmentId)
        # Validate once before starting, so invalid windows never partially assign.
        from pydantic import ValidationError
        try:
            window = AssignmentCreate(assessmentId=payload.assessmentId, startDate=payload.startDate, endDate=payload.endDate, confirmed=True)
        except ValidationError:
            raise HTTPException(422, 'Supply valid timezone-aware assignment dates') from None
        service.validate_dates(window, assessment)
        for key in dict.fromkeys(payload.applicationIds):
            row = await db['applications'].find_one({'orgId': user.org_id, 'jobId': job_id, 'applicationId': key})
            if not row:
                items.append({'applicationId': key, 'status': 'failed', 'reason': 'Application does not belong to this job'})
                continue
            if row.get('status') in {'rejected', 'withdrawn', 'hired'} or row.get('currentStage') in {'REJECTED', 'WITHDRAWN', 'HIRED'}:
                items.append({'applicationId': key, 'status': 'skipped', 'reason': 'Candidate is no longer active for this job'})
                continue
            existing = await db['candidate_assignments'].find_one({'orgId': user.org_id, 'candidateId': row['applicantId'], 'assessmentId': payload.assessmentId})
            if existing:
                items.append({'applicationId': key, 'status': 'skipped', 'reason': 'Assessment already assigned'})
                continue
            request = window.model_copy(update={'applicationId': key})
            try:
                assignment = await service.create_assignment(db, user, row['applicantId'], request)
                items.append({'applicationId': key, 'status': 'assigned', 'assignmentId': assignment['assignmentId']})
            except HTTPException as exc:
                items.append({'applicationId': key, 'status': 'failed', 'reason': str(exc.detail)})
    return {'items': items, 'assigned': sum(item['status'] == 'assigned' for item in items)}


@router.post('/{job_id}/sync')
async def sync_results(job_id: str, user=Depends(require_permission('candidates.manage')), db=Depends(database)):
    job = await db['jobs'].find_one({'$and':[await service.job_scope(db,user),{'jobId':job_id}]})
    if not job:
        raise HTTPException(404,'Job not found or not accessible')
    from ..services.assessment_flow import enqueue_sync_sweep,process_requested_assessments
    count = await enqueue_sync_sweep(db,limit=50,org_id=user.org_id,job_id=job_id)
    rows=await db['applications'].find({'orgId':user.org_id,'jobId':job_id,
        'assessment.interviewId':{'$exists':True,'$nin':[None,'']},
        'currentStage':{'$nin':['REJECTED','WITHDRAWN','HIRED','TALENT_POOL']},
        '$or':[{'assessment.score':None},{'assessment.reportPending':True}]}).sort('assessment.syncedAt',1).limit(50).to_list(50)
    outcomes=await process_requested_assessments(db,user.org_id,[row['applicationId'] for row in rows])
    return {'queued':count,'checked':sum(bool(row and row.get('status')=='done') for row in outcomes),
        'failed':sum(bool(row and row.get('status') in {'pending','dead'}) for row in outcomes)}
