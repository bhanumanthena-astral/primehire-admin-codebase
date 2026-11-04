"""Read actual assessment reports through an authorized job/application pair."""
import asyncio
import re
from fastapi import HTTPException
from . import candidate_management as candidates
from .primehire_api import get_report_envelope
from .resume_intake_projection import project_management_profile
from ..security.job_permissions import require_job_access


async def read_report(db, user, job_id, application_id):
    job = await db['jobs'].find_one({'$and': [await candidates.job_scope(db, user), {'jobId': job_id}]})
    if not job:
        raise HTTPException(404, 'Job not found or not accessible')
    await require_job_access(db, user, 'view', job)
    application = await db['applications'].find_one({
        'orgId': user.org_id, 'jobId': job_id, 'applicationId': application_id,
    })
    if not application:
        raise HTTPException(404, 'Candidate application not found in this job')
    person = await candidates.person(db, user, application['applicantId'])
    assessment = application.get('assessment') or {}
    interview_id = assessment.get('interviewId')
    if not isinstance(interview_id, str) or not re.fullmatch(r'[\w-]{1,200}', interview_id, re.ASCII):
        raise HTTPException(409, 'The assessment report is not available yet')
    try:
        report = await asyncio.wait_for(get_report_envelope(interview_id=interview_id, timeout_s=5), timeout=18)
    except (asyncio.TimeoutError, RuntimeError):
        raise HTTPException(503, 'Assessment report service is temporarily unavailable. Please retry.') from None
    if not report:
        raise HTTPException(409, 'The assessment report is still pending. Sync results and retry when it is ready.')
    # Reuse central contact projection, including nested free text. Never return
    # raw provider envelopes. Read-through capture retains immutable source versions
    # without modifying candidate, application, assessment scores, or hiring stages.
    projected = project_management_profile(report)
    from .reporting import capture,detail
    try:
        record=await capture(db,application,job,report,report_available=True,submitted=True,reason='Authorized job report synchronization')
    except ValueError:
        raise HTTPException(502,'The provider report does not match the selected application') from None
    contract=await detail(db,user,record['reportId'])
    # Older clients may still read the legacy report shape. Keep direct media URLs
    # private; the current viewer loads video through the authorized report endpoint.
    def strip_media(value):
        if isinstance(value,dict):return {key:strip_media(part) for key,part in value.items() if key not in {'videoUrl','video_url','videoAnswer','video_answer'}}
        if isinstance(value,list):return [strip_media(part) for part in value]
        return value
    projected=strip_media(projected)
    await candidates.audit(db, user, 'assessment_report_viewed', person['applicantId'], {'applicationId': application_id, 'jobId': job_id})
    return {
        'applicationId': application_id,
        'candidate': project_management_profile(candidates.profile(person)),
        'assessment': {'id': assessment.get('assessmentId') or job.get('assessmentJobId'),
                       'jobTitle': job.get('title', 'Assessment'),
                       'roundType': job.get('assessmentRoundType') or 'TECHNICAL'},
        'report': projected,
        'reportContract':contract,
    }
