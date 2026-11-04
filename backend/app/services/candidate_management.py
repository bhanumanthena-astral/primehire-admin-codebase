"""Module 4: person profiles and independent, human-confirmed assignments."""
import hashlib
import hmac
import httpx
import re
import secrets
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from ..models.hiring import AuditLogRepository
from ..models.recruitment import now, lease
from ..services.pii import phone_digits_variants
from ..services.resume_intake import matches
from ..services.resume_intake_projection import project_management_profile
from ..security.job_permissions import job_access
from ..config import settings

ADMIN = {'super_admin', 'admin'}
PROFILE_FIELDS = ['name','email','phone','currentLocation','preferredLocations','experienceYears','currentCompany',
    'currentDesignation','department','role','industry','skills','headline','summary','educationRecords','education']


def utc(value):
    if isinstance(value, str):
        try: value = datetime.fromisoformat(value.replace('Z','+00:00'))
        except ValueError: return None
    if not isinstance(value, datetime): return None
    return value.replace(tzinfo=timezone.utc) if not value.tzinfo else value.astimezone(timezone.utc)


async def audit(db, user, action, key, details=None):
    await AuditLogRepository(db).log(org_id=user.org_id, actor_user_id=user.user_id,
        action='candidate_management.'+action, resource_type='candidate', resource_id=key, details=details or {})


async def can_manage(db, user):
    if user.impersonating or 'candidates.manage' not in user.permissions: return False
    if user.role in ADMIN: return True
    actor = await db['users'].find_one({'orgId':user.org_id,'userId':user.user_id},{'jobAccess':1})
    return bool(job_access(user.role,(actor or {}).get('jobAccess')) & {'edit','create'})


async def job_scope(db, user):
    query = {'orgId':user.org_id}
    if user.role not in ADMIN:
        actor = await db['users'].find_one({'orgId':user.org_id,'userId':user.user_id},{'jobAccess':1})
        if 'view' not in job_access(user.role,(actor or {}).get('jobAccess')):
            return {**query,'jobId':{'$in':[]}}
        query.update(assigneeUserId=user.user_id)
        query['$or'] = [{'assigneeAccess':None},{'assigneeAccess':'view'}]
    return query


async def bounded_ids(cursor, field):
    rows = await cursor.limit(5001).to_list(5001)
    if len(rows) > 5000:
        raise HTTPException(422,'Narrow the job or assessment filter for this large workspace')
    return [row[field] for row in rows if row.get(field)]


async def people_scope(db, user, job_id=None):
    base = {'orgId':user.org_id}
    if user.role in ADMIN and not job_id: return base
    jobs = await bounded_ids(db['jobs'].find({'$and':[await job_scope(db,user),*([{'jobId':job_id}] if job_id else [])]},{'jobId':1}), 'jobId')
    ids = await bounded_ids(db['applications'].find({**base,'jobId':{'$in':jobs}},{'applicantId':1}),'applicantId')
    choices = [{'applicantId':{'$in':ids}}]
    if not job_id: choices += [{'createdBy':user.user_id},{'allowedUserIds':user.user_id}]
    return {**base,'$or':choices}


async def assignment_scope(db, user, key=None):
    query={'orgId':user.org_id}
    if key: query['candidateId']=key
    if user.role not in ADMIN:
        jobs=await bounded_ids(db['jobs'].find(await job_scope(db,user),{'jobId':1}),'jobId')
        query['$or']=[{'jobId':None},{'jobId':{'$in':jobs}}]
    return query


async def person(db, user, key):
    row = await db['applicants'].find_one({'$and':[await people_scope(db,user),{'applicantId':key}]})
    if not row: raise HTTPException(404,'Candidate not found or no longer accessible')
    return row


def profile(row):
    result = {key:value for key,value in (row.get('profile') or {}).items() if key in PROFILE_FIELDS}
    for key in ['name','email','phone']:
        result[key] = row.get(key) or result.get(key) or ''
    if result['email'].endswith('@placeholder.local'): result['email']=''
    # Existing intake education fields are displayed as structured records without
    # discarding the original free-text education during profile edits.
    if not result.get('educationRecords'):
        source = row.get('profile') or {}
        result['educationRecords'] = [dict(qualification=source[prefix+'Degree'],
            specialization=source.get(prefix+'Specialization',''), institution=source.get(prefix+'University',''),
            graduationYear=source.get(prefix+'GraduationYear')) for prefix in ['ug','pg','doctorate'] if source.get(prefix+'Degree')]
    return result


async def application_rows(db, user, key, skip=0, limit=20):
    query = {'orgId':user.org_id,'applicantId':key}
    if user.role not in ADMIN:
        query['jobId'] = {'$in':await bounded_ids(db['jobs'].find(await job_scope(db,user),{'jobId':1}),'jobId')}
    rows = await db['applications'].find(query).sort([('createdAt',-1),('applicationId',1)]).skip(skip).limit(limit).to_list(limit)
    jobs = {row['jobId']:row async for row in db['jobs'].find({'orgId':user.org_id,'jobId':{'$in':[r['jobId'] for r in rows]}},{'jobId':1,'title':1}).limit(limit)}
    return {'items':[{'applicationId':r['applicationId'],'jobId':r['jobId'],'jobTitle':jobs.get(r['jobId'],{}).get('title'),
        'stage':r.get('currentStage'),'applicationDate':r.get('createdAt')} for r in rows], 'total':await db['applications'].count_documents(query)}


def assignment_public(row, manage=False):
    start, end = utc(row.get('startDate')), utc(row.get('endDate'))
    status = row.get('status','Assigned')
    if status != 'Revoked' and end and end <= now(): status='Expired'
    if status == 'Generated' and start and start > now(): status='Scheduled'
    result = {key:row.get(key) for key in ['assignmentId','candidateId','assessmentId','assessmentTitle','applicationId','jobId','createdAt','updatedAt','assignedBy','startDate','endDate','revision']}
    for field in ['createdAt','updatedAt','startDate','endDate']:
        result[field]=utc(result.get(field))
    result.update(status=status, linkStatus='Revoked' if status=='Revoked' else 'Expired' if status=='Expired' else 'Generated' if row.get('shareToken') else 'Not Generated',
        canEditDates=manage and row.get('status') in {'Assigned','Failed'}, canGenerate=manage and row.get('status') in {'Assigned','Failed'} and status!='Expired')
    result['linkStatus']='Revoked' if status=='Revoked' else 'Expired' if status=='Expired' else 'Generated' if row.get('providerLinkEncrypted') else 'Not Generated'
    if manage and row.get('providerLinkEncrypted') and status not in {'Expired','Revoked'}:
        result['inviteLink']='/assessment-access#'+share_token(row['assignmentId'])
    if row.get('status') in {'Failed','Uncertain'}: result['error']=row.get('error')
    if row.get('status')=='Generating': result['error']='Link generation is running. If interrupted, reconcile with the provider before retrying.'
    return result


async def assessment_for(db, user, key):
    from ..models.assessment_management import scope
    row = await db['assessments'].find_one({'$and':[scope(user),{'jobId':key}]})
    if not row: raise HTTPException(404,'Assessment not found or unavailable to you')
    if row.get('publicationState') in {'draft','publishing','uncertain'} or row.get('isActive') is False:
        raise HTTPException(409,'Select an active, published assessment')
    end = utc(row.get('windowEnd') or row.get('endDate'))
    if end and end <= now(): raise HTTPException(409,'This assessment has ended')
    return row


def validate_dates(payload, assessment):
    if payload.startDate < now(): raise HTTPException(422,'Start Date and time must not be in the past')
    start = utc(assessment.get('windowStart') or assessment.get('startDate'))
    end = utc(assessment.get('windowEnd') or assessment.get('endDate'))
    if start and payload.startDate < start or end and payload.endDate > end:
        raise HTTPException(422,'Assignment dates must be inside the assessment availability window')


async def update_profile(db, user, key, payload):
    # Same candidate/contact leases used by intake confirmation; no new matching rule.
    from ..models.resume_intake import fenced_claim
    data = payload.profile.model_dump(mode='json')
    keys = ['candidate:'+key] + (['email:'+data['email']] if data['email'] else []) + ['phone:'+n for n in phone_digits_variants(data['phone'])]
    async with fenced_claim(db,user.org_id,keys):
        previous = await person(db,user,key)
        if previous.get('profileRevision',0) != payload.expectedRevision or utc(previous.get('updatedAt')) != utc(payload.expectedUpdatedAt):
            raise HTTPException(409,'Candidate changed. Refresh before saving; your edits have not been saved')
        if previous.get('email') and not previous['email'].endswith('@placeholder.local') and not data['email']:
            raise HTTPException(422,'Email is required for this candidate creation workflow')
        if any(p['applicantId'] != key for p in await matches(db,user.org_id,data)):
            raise HTTPException(409,'Another candidate matches this email or phone; resolve the duplicate before saving')
        merged = {**(previous.get('profile') or {}),**data}
        query = {'orgId':user.org_id,'applicantId':key,'updatedAt':payload.expectedUpdatedAt}
        query['$or'] = [{'profileRevision':payload.expectedRevision}] + ([{'profileRevision':{'$exists':False}}] if payload.expectedRevision==0 else [])
        updated = await db['applicants'].find_one_and_update(query,{'$set':{'name':data['name'],
            'email':data['email'] or f'phone-only-{key}@placeholder.local','phone':data['phone'],
            'phoneDigits':phone_digits_variants(data['phone']),'profile':merged,'updatedAt':now(),'updatedBy':user.user_id},
            '$inc':{'profileRevision':1}},return_document=ReturnDocument.AFTER)
        if not updated: raise HTTPException(409,'Candidate changed; refresh before saving')
        await audit(db,user,'profile_updated',key,{'revision':updated['profileRevision'],'fields':list(data)})
    return updated


def share_token(assignment_id):
    signature=hmac.new(settings.jwt_secret.encode(),('candidate-assessment:'+assignment_id).encode(),hashlib.sha256).hexdigest()
    return assignment_id+'.'+signature


async def create_provider_link(row, assessment):
    """One POST only: an ambiguous result must be reconciled, never blindly retried."""
    from .assessment_management import provider_connection
    from .primehire_api import parse_interview_record, UpstreamError
    from urllib.parse import urlsplit
    try: base, headers=provider_connection()
    except UpstreamError: raise HTTPException(503,'Assessment provider credentials are not configured') from None
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response=await client.post(base+'/interview',headers=headers,json={'job_id':row['assessmentId'],
                'round_type':assessment.get('roundType') or 'TECHNICAL','candidates':[{'candidate_id':row['candidateId'],
                'start_time':utc(row['startDate']).isoformat(),'end_time':utc(row['endDate']).isoformat()}]})
    except (httpx.TimeoutException,httpx.TransportError):
        raise HTTPException(504,'Provider outcome is uncertain. Reconcile before retrying to avoid duplicate interviews') from None
    if response.status_code>=500 or response.status_code==409:
        raise HTTPException(504,'Provider outcome requires reconciliation; automatic regeneration is blocked')
    if not response.is_success: raise HTTPException(502,f'Provider refused link generation (HTTP {response.status_code}); assignment is preserved')
    try:
        body=response.json()
        record=parse_interview_record(body, row['candidateId'])
        link=(record or {}).get('link','')
        parts=urlsplit(link)
        if parts.scheme!='https' or not parts.netloc or parts.username or parts.password: raise ValueError
    except (ValueError,TypeError,AttributeError):
        raise HTTPException(504,'Provider did not return a valid assessment link; reconcile before retrying') from None
    return record


async def generate_link(db,user,key,assignment_id,payload):
    from .candidate_link_crypto import encrypt_link, OutboxCryptoError
    row=await assignment_for(db,user,key,assignment_id)
    assessment=await assessment_for(db,user,row['assessmentId'])
    if row['status']=='Generated': return assignment_public(row,True)
    if utc(row['endDate'])<=now(): raise HTTPException(409,'This assignment has expired')
    try: encrypt_link('candidate-assessment-key-check')
    except OutboxCryptoError: raise HTTPException(503,'An existing outbox encryption key is required to protect assessment links') from None
    claimed=await db['candidate_assignments'].find_one_and_update({'orgId':user.org_id,'assignmentId':assignment_id,
        'revision':payload.expectedRevision,'status':{'$in':['Assigned','Failed']}},
        {'$set':{'status':'Generating','updatedAt':now()},'$inc':{'revision':1}},return_document=ReturnDocument.AFTER)
    if not claimed: raise HTTPException(409,'Assignment changed or link generation needs reconciliation; refresh before continuing')
    try:
        record=await create_provider_link(claimed,assessment)
        encrypted=encrypt_link(record['link'])
    except HTTPException as error:
        await db['candidate_assignments'].update_one({'orgId':user.org_id,'assignmentId':assignment_id,'revision':claimed['revision']},
            {'$set':{'status':'Uncertain' if error.status_code==504 else 'Failed','error':error.detail,'updatedAt':now()},'$inc':{'revision':1}})
        await audit(db,user,'link_failed',key,{'assignmentId':assignment_id,'uncertain':error.status_code==504})
        raise
    except Exception:
        await db['candidate_assignments'].update_one({'orgId':user.org_id,'assignmentId':assignment_id,'revision':claimed['revision']},
            {'$set':{'status':'Uncertain','error':'Link storage outcome requires reconciliation','updatedAt':now()},'$inc':{'revision':1}})
        raise HTTPException(503,'Link generation requires reconciliation; assignment is preserved') from None
    updated=await db['candidate_assignments'].find_one_and_update({'orgId':user.org_id,'assignmentId':assignment_id,'revision':claimed['revision']},
        {'$set':{'status':'Generated','providerLinkEncrypted':encrypted,'interviewId':record.get('interviewId'),
            'generatedAt':now(),'error':None,'updatedAt':now()},'$inc':{'revision':1}},return_document=ReturnDocument.AFTER)
    if not updated: raise HTTPException(409,'Assignment changed while generating its link; reconcile before retrying')
    await audit(db,user,'link_generated',key,{'assignmentId':assignment_id})
    # Provider password is returned to the authorized human once, never persisted.
    result=assignment_public(updated,True)
    if record.get('password'): result['accessCode']=record['password']
    return result


async def create_assignment(db, user, key, payload):
    await person(db,user,key)
    assessment = await assessment_for(db,user,payload.assessmentId)
    validate_dates(payload,assessment)
    application = None
    if payload.applicationId:
        application = await db['applications'].find_one({'orgId':user.org_id,'applicationId':payload.applicationId,'applicantId':key})
        if not application: raise HTTPException(422,'Select an application belonging to this candidate')
        job = await db['jobs'].find_one({'$and':[await job_scope(db,user),{'jobId':application['jobId']}]})
        if not job: raise HTTPException(404,'Associated job is not accessible')
        if job.get('assessmentJobId') and job['assessmentJobId'] != payload.assessmentId:
            raise HTTPException(422,'Select the assessment linked to this job')
    elif await db['applications'].find_one({'orgId':user.org_id,'applicantId':key}):
        raise HTTPException(422,'Select the correct job application for this candidate')
    row = {'assignmentId':'ASGN-'+uuid4().hex,'orgId':user.org_id,'candidateId':key,
        'assessmentId':payload.assessmentId,'assessmentTitle':assessment.get('jobTitle') or payload.assessmentId,
        'applicationId':payload.applicationId,'jobId':application['jobId'] if application else None,
        'startDate':payload.startDate,'endDate':payload.endDate,'status':'Assigned',
        'revision':1,'createdAt':now(),'updatedAt':now(),'assignedBy':user.user_id}
    # Mongo unique index is the final guard against concurrent duplicate assignment.
    try: await db['candidate_assignments'].insert_one(row)
    except DuplicateKeyError: raise HTTPException(409,'This assessment is already assigned to this candidate; repeat attempts are not enabled') from None
    await audit(db,user,'assessment_assigned',key,{'assignmentId':row['assignmentId'],'assessmentId':payload.assessmentId})
    return row


async def assignment_for(db, user, key, assignment_id):
    await person(db,user,key)
    row = await db['candidate_assignments'].find_one({'orgId':user.org_id,'candidateId':key,'assignmentId':assignment_id})
    if not row: raise HTTPException(404,'Assessment assignment not found')
    if row.get('jobId') and not await db['jobs'].find_one({'$and':[await job_scope(db,user),{'jobId':row['jobId']}]}) and user.role not in ADMIN:
        raise HTTPException(404,'Assessment assignment is no longer accessible')
    return row


async def edit_dates(db,user,key,assignment_id,payload):
    row = await assignment_for(db,user,key,assignment_id)
    assessment = await assessment_for(db,user,row['assessmentId'])
    validate_dates(payload,assessment)
    if row['status'] not in {'Assigned','Failed'}:
        raise HTTPException(409,'Dates are locked after link generation; the provider has no verified reschedule contract here')
    updated = await db['candidate_assignments'].find_one_and_update({'orgId':user.org_id,'assignmentId':assignment_id,
        'revision':payload.expectedRevision,'status':{'$in':['Assigned','Failed']}},
        {'$set':{'startDate':payload.startDate,'endDate':payload.endDate,'updatedAt':now()},'$inc':{'revision':1}},return_document=ReturnDocument.AFTER)
    if not updated: raise HTTPException(409,'Assignment changed; refresh before saving')
    await audit(db,user,'dates_updated',key,{'assignmentId':assignment_id,'revision':updated['revision']})
    return updated
