"""Module 4 V2-only API. Legacy candidate/assessment CRUD is untouched."""
import re
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from ..config import settings
from ..security.deps import get_db, require_permission as role_permission
from ..security.rate_limit import limiter
from ..schemas.candidate_management import ProfileUpdate, AssignmentCreate, AssignmentDates, Revision
from ..services import candidate_management as service
from ..services.resume_intake_projection import project_management_profile

router = APIRouter(prefix='/api/candidate-management', tags=['candidate-management'])


def require_permission(name):
    async def guard(user=Depends(role_permission(name)),db=Depends(get_db)):
        if settings.mongodb_database=='primehire_admin_v2' and db is not None:
            actor=await db['users'].find_one({'orgId':user.org_id,'userId':user.user_id},{'role':1,'isActive':1})
            if not actor or actor.get('role')!=user.role or not actor.get('isActive',True):
                raise HTTPException(401,'Your account changed. Sign in again')
        return user
    return guard


def database(db=Depends(get_db)):
    if settings.mongodb_database != 'primehire_admin_v2': raise HTTPException(404,'Candidate Management V2 is not enabled')
    if db is None: raise HTTPException(503,'Database unavailable')
    return db


def no_store(response: Response):
    response.headers['Cache-Control']='no-store'
    response.headers['Referrer-Policy']='no-referrer'


async def writable(db, user):
    if not await service.can_manage(db,user): raise HTTPException(403,'Candidate editing and assessment assignment permission is required')
    result=limiter.check(f'candidate-management:{user.org_id}:{user.user_id}',60,60)
    if not result.allowed: raise HTTPException(429,'Too many changes; retry shortly',headers={'Retry-After':str(result.retry_after)})


@router.get('/capabilities')
async def capabilities(user=Depends(require_permission('candidates.view')), db=Depends(database)):
    return {'enabled':True,'canManage':await service.can_manage(db,user),'timezone':'Asia/Kolkata',
        'headlineMax':250,'summaryMax':5000,'automaticInvitations':False}


@router.get('/jobs')
async def jobs(search: str=Query('',max_length=100),skip:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100),
    user=Depends(require_permission('candidates.view')),db=Depends(database)):
    query={'$and':[await service.job_scope(db,user)]}
    if search: query['$and'].append({'title':{'$regex':re.escape(search),'$options':'i'}})
    rows=await db['jobs'].find(query,{'jobId':1,'title':1}).sort('title',1).skip(skip).limit(limit).to_list(limit)
    return {'items':[{'jobId':r['jobId'],'title':r.get('title',r['jobId'])} for r in rows],'total':await db['jobs'].count_documents(query)}


@router.get('/assessments')
async def assessments(search:str=Query('',max_length=100),skip:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100),
    user=Depends(require_permission('candidates.manage')),db=Depends(database)):
    from ..models.assessment_management import scope
    from ..models.recruitment import now
    await writable(db,user)
    query={'$and':[scope(user),{'publicationState':{'$nin':['draft','publishing','uncertain']},'isActive':{'$ne':False}},
        {'$or':[{'windowEnd':{'$gt':now()}},{'windowEnd':None}]}]}
    if search: query['$and'].append({'$or':[{field:{'$regex':re.escape(search),'$options':'i'}} for field in ['jobId','jobTitle']]})
    rows=await db['assessments'].find(query).sort('jobId',1).skip(skip).limit(limit).to_list(limit)
    return {'items':[{'assessmentId':r['jobId'],'title':r.get('jobTitle') or r['jobId'],'roundType':r.get('roundType'),
        'language':r.get('language'),'startDate':r.get('windowStart') or r.get('startDate'),
        'endDate':r.get('windowEnd') or r.get('endDate'),'questionCount':len(r.get('questions') or [])} for r in rows],
        'total':await db['assessments'].count_documents(query)}


@router.get('')
async def listing(response:Response, search:str=Query('',max_length=100),jobId:str|None=Query(None,max_length=100),
    assessmentStatus:Literal['Unassigned','Assigned','Generated','Scheduled','Expired','Failed','Uncertain','Revoked']|None=None,
    skip:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100),
    user=Depends(require_permission('candidates.view')),db=Depends(database)):
    no_store(response)
    query={'$and':[await service.people_scope(db,user,jobId)]}
    if search: query['$and'].append({'$or':[{f:{'$regex':re.escape(search),'$options':'i'}} for f in ['name','email','applicantId']]})
    if assessmentStatus:
        from ..models.recruitment import now
        assignment_query=await service.assignment_scope(db,user)
        if assessmentStatus=='Expired': assignment_query.update(endDate={'$lte':now()},status={'$ne':'Revoked'})
        elif assessmentStatus=='Scheduled': assignment_query.update(startDate={'$gt':now()},endDate={'$gt':now()},status='Generated')
        elif assessmentStatus!='Unassigned': assignment_query.update(status=assessmentStatus,endDate={'$gt':now()})
        if assessmentStatus=='Generated': assignment_query['startDate']={'$lte':now()}
        ids=await service.bounded_ids(db['candidate_assignments'].find(assignment_query,{'candidateId':1}),'candidateId')
        query['$and'].append({'applicantId':{'$nin' if assessmentStatus=='Unassigned' else '$in':ids}})
    rows=await db['applicants'].find(query,{'resume':0}).sort([('createdAt',-1),('applicantId',1)]).skip(skip).limit(limit).to_list(limit)
    output=[]
    for row in rows:
        applications=await service.application_rows(db,user,row['applicantId'],limit=3)
        assignments=await db['candidate_assignments'].find(await service.assignment_scope(db,user,row['applicantId'])).sort('createdAt',-1).limit(3).to_list(3)
        output.append({'candidateId':row['applicantId'],'profile':project_management_profile(service.profile(row)),
            'applicationDate':row.get('createdAt'),'applications':applications['items'],'applicationCount':applications['total'],
            'assessmentStatuses':list(dict.fromkeys(service.assignment_public(a)['status'] for a in assignments)) or ['Unassigned']})
    return {'items':output,'total':await db['applicants'].count_documents(query),'skip':skip,'limit':limit}


@router.get('/{key}')
async def detail(key:str,response:Response,user=Depends(require_permission('candidates.view')),db=Depends(database)):
    no_store(response)
    row=await service.person(db,user,key)
    manage=await service.can_manage(db,user)
    return {'candidateId':key,'profile':project_management_profile(service.profile(row)),'revision':row.get('profileRevision',0),
        'createdAt':row.get('createdAt'),'updatedAt':row.get('updatedAt'),'canManage':manage}


@router.post('/{key}/reveal')
async def reveal(key:str,response:Response,user=Depends(require_permission('candidates.manage')),db=Depends(database)):
    no_store(response);await writable(db,user)
    row=await service.person(db,user,key)
    await service.audit(db,user,'contact_revealed',key)
    return {'profile':service.profile(row),'revision':row.get('profileRevision',0),'updatedAt':service.utc(row.get('updatedAt'))}


@router.put('/{key}')
async def edit(key:str,payload:ProfileUpdate,response:Response,user=Depends(require_permission('candidates.manage')),db=Depends(database)):
    no_store(response);await writable(db,user)
    row=await service.update_profile(db,user,key,payload)
    return {'candidateId':key,'profile':project_management_profile(service.profile(row)), 'revision':row['profileRevision'],
        'canManage':True,'updatedAt':row['updatedAt']}


@router.get('/{key}/applications')
async def applications(key:str,skip:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100),
    user=Depends(require_permission('candidates.view')),db=Depends(database)):
    await service.person(db,user,key)
    return await service.application_rows(db,user,key,skip,limit)


@router.get('/{key}/assignments')
async def assignments(key:str,response:Response,skip:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100),
    user=Depends(require_permission('candidates.view')),db=Depends(database)):
    no_store(response);await service.person(db,user,key)
    manage=await service.can_manage(db,user)
    query=await service.assignment_scope(db,user,key)
    rows=await db['candidate_assignments'].find(query).sort([('createdAt',-1),('assignmentId',1)]).skip(skip).limit(limit).to_list(limit)
    return {'items':[service.assignment_public(r,manage) for r in rows],'total':await db['candidate_assignments'].count_documents(query)}


@router.post('/{key}/assignments',status_code=201)
async def assign(key:str,payload:AssignmentCreate,response:Response,user=Depends(require_permission('candidates.manage')),db=Depends(database)):
    no_store(response);await writable(db,user)
    return service.assignment_public(await service.create_assignment(db,user,key,payload),True)


@router.put('/{key}/assignments/{assignment_id}/dates')
async def dates(key:str,assignment_id:str,payload:AssignmentDates,user=Depends(require_permission('candidates.manage')),db=Depends(database)):
    await writable(db,user)
    return service.assignment_public(await service.edit_dates(db,user,key,assignment_id,payload),True)


@router.get('/{key}/resume')
async def resume(key:str,user=Depends(require_permission('candidates.manage')),db=Depends(database)):
    await writable(db,user);await service.person(db,user,key)
    query={'orgId':user.org_id,'applicantId':key,'status':{'$ne':'deleted'},'scanStatus':'clean','storageKey':{'$exists':True}}
    if user.role not in service.ADMIN:
        query['jobId']={'$in':await service.bounded_ids(db['jobs'].find(await service.job_scope(db,user),{'jobId':1}),'jobId')}
    item=await db['resume_intake_items'].find_one(query,sort=[('createdAt',-1)])
    if not item: raise HTTPException(404,'No authorized original resume is available')
    from ..services.storage import resolve_storage_key
    try:
        path=resolve_storage_key(item['storageKey'])
        if not path.is_file(): raise ValueError
    except ValueError: raise HTTPException(404,'Original resume is unavailable') from None
    await service.audit(db,user,'resume_downloaded',key)
    return FileResponse(path,filename=item.get('fileName','resume'),media_type='application/octet-stream',
        headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})


@router.post('/{key}/assignments/{assignment_id}/generate-link')
async def generate(key:str,assignment_id:str,payload:Revision,response:Response,user=Depends(require_permission('candidates.manage')),db=Depends(database)):
    no_store(response);await writable(db,user)
    return await service.generate_link(db,user,key,assignment_id,payload)


@router.get('/assessment-assignments/{assessment_id}')
async def assessment_assignments(assessment_id:str,skip:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100),
    user=Depends(require_permission('candidates.view')),db=Depends(database)):
    from ..models.assessment_management import AssessmentManagementRepository
    await AssessmentManagementRepository(db,user).get(assessment_id)
    query={**await service.assignment_scope(db,user),'assessmentId':assessment_id}
    if user.role not in service.ADMIN:
        query['candidateId']={'$in':await service.bounded_ids(db['applicants'].find(await service.people_scope(db,user),{'applicantId':1}),'applicantId')}
    rows=await db['candidate_assignments'].find(query).sort([('createdAt',-1),('assignmentId',1)]).skip(skip).limit(limit).to_list(limit)
    return {'items':[service.assignment_public(r) for r in rows],'total':await db['candidate_assignments'].count_documents(query)}
