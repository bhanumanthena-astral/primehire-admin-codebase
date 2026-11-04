"""Application-bound report catalog, immutable versions and traceable snapshots."""
import asyncio
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from fastapi import HTTPException
from pymongo import ReturnDocument
from ..models.recruitment import now, lease, clean
from ..models.hiring import AuditLogRepository
from ..models.jobs import BackgroundJobRepository
from ..security.job_permissions import require_job_access
from ..security.recruitment import fields_for, project_candidate, project_application
from .candidate_management import job_scope, bounded_ids, utc
from .resume_intake_projection import project_management_profile
from .report_content import presentation, generation_status, obj

ROUNDS={'BASIC','TECHNICAL','MIXED','HR','UNKNOWN'}
STATUSES={'Not Started','Processing','Completed','Partial','Failed','Archived','Invalidated'}
METADATA=['reportId','candidateId','candidateName','applicationId','jobId','jobTitle','roundId','roundType',
    'attemptId','version','status','generatedAt','generatedBy','capturedAt','updatedAt','roundCompletedAt','generationReason']


def stable(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'primehire-reports:'+':'.join(map(str,parts))))


async def audit(db,user,action,key,details=None):
    await AuditLogRepository(db).log(org_id=user.org_id,actor_user_id=user.user_id,
        action='reports.'+action,resource_type='report',resource_id=key,
        details={'role':user.role,**(details or {})})


async def scope(db,user):
    if 'reports.view' not in user.permissions:raise HTTPException(403,'Report access is not permitted')
    if 'assessment' not in await fields_for(db,user):raise HTTPException(403,'Assessment evidence access has been removed')
    if user.role in {'super_admin','admin'}:return {'orgId':user.org_id}
    jobs=await bounded_ids(db.jobs.find(await job_scope(db,user),{'jobId':1}),'jobId')
    assigned=await bounded_ids(db.recruit_interviews.find({'orgId':user.org_id,'interviewerId':user.user_id,
        'status':{'$ne':'cancelled'}},{'applicationId':1}),'applicationId')
    return {'orgId':user.org_id,'$or':[{'jobId':{'$in':jobs}},{'applicationId':{'$in':assigned}}]}


async def application_for(db,user,key):
    app=await db.applications.find_one({'$and':[await scope(db,user),{'applicationId':key}]})
    if not app:raise HTTPException(404,'Report application not found or not accessible')
    job=await db.jobs.find_one({'orgId':user.org_id,'jobId':app['jobId']})
    if not job:raise HTTPException(404,'Report job not found')
    if user.role in {'super_admin','admin'} or job.get('assigneeUserId')==user.user_id:
        await require_job_access(db,user,'view',job)
    return app,job


async def catalog_scope(db,user):
    base=await scope(db,user)
    if user.role in {'super_admin','admin'}:return base
    jobs=await bounded_ids(db.jobs.find(await job_scope(db,user),{'jobId':1}),'jobId')
    permitted=[{'jobId':{'$in':jobs}}]
    async for assignment in db.recruit_interviews.find({'orgId':user.org_id,'interviewerId':user.user_id,'status':{'$ne':'cancelled'}}).limit(5000):
        cutoff=utc(assignment.get('startsAt') or assignment.get('createdAt'))
        pin=assignment.get('reportSummarySnapshot') or {}
        evidence=[]
        if cutoff:evidence.append({'roundCompletedAt':{'$ne':None,'$lte':cutoff}})
        if pin.get('sourceReportId'):evidence.append({'reportId':pin['sourceReportId']})
        if evidence:permitted.append({'applicationId':assignment['applicationId'],'$or':evidence})
    return {'$and':[base,{'$or':permitted}]}


async def series_for(db,user,key):
    series=await db.report_catalog.find_one({'$and':[await catalog_scope(db,user),{'reportId':key}]})
    if not series:raise HTTPException(404,'Report not found or not accessible')
    app,job=await application_for(db,user,series['applicationId'])
    if series['candidateId']!=app['applicantId'] or series['jobId']!=app['jobId']:
        raise HTTPException(404,'Report context no longer matches its application')
    return series,app,job


def public_metadata(row,series,app):
    result={key:row.get(key) for key in METADATA}
    control=row.get('controlStatus') or (series.get('controlStatus') if row.get('version')==series.get('version') else None)
    result['generationStatus']=row.get('status')
    result['status']=control or row.get('status')
    result['isCurrent']=row.get('version')==series.get('version') and result['status'] not in {'Archived','Invalidated'}
    result['isOfficialAttempt']=row.get('attemptId')==(app.get('assessment') or {}).get('interviewId')
    result['syncError']=series.get('syncError')
    result['canView']=result['status'] in {'Completed','Partial','Archived','Invalidated'}
    return clean(result)


def verify_source(app,job,payload):
    from .report_normalize import deep_camel
    source=deep_camel(obj(payload));source=obj(source.get('data')) or source
    details=obj(source.get('interviewDetails'))
    assessment=app.get('assessment') or {}
    interview=details.get('interviewId')
    if interview and str(interview)!=str(assessment.get('interviewId')):
        raise ValueError('Report interview does not match its application')
    candidate=details.get('candidateId')
    expected={str(value) for value in [app['applicantId'],assessment.get('providerCandidateId')] if value}
    if candidate and assessment.get('providerCandidateId') and str(candidate) not in expected:
        raise ValueError('Report candidate does not match its application')
    provider_job=details.get('jobId')
    expected_jobs={str(value) for value in [job.get('jobId'),job.get('jobKey'),job.get('assessmentJobId'),assessment.get('assessmentId')] if value}
    if provider_job and expected_jobs and str(provider_job) not in expected_jobs:
        raise ValueError('Report assessment does not match its application')


async def capture(db,app,job,payload=None,*,report_available=False,submitted=False,reason='Provider result synchronization',actor='system',status_override=None):
    """Idempotent per attempt. Never updates previous version evidence or summaries."""
    assessment=app.get('assessment') or {}
    attempt=str(assessment.get('interviewId') or '')
    if not attempt:return None
    if not re.fullmatch(r'[\w-]{1,200}',attempt,re.ASCII):raise ValueError('Invalid assessment attempt reference')
    org=app['orgId'];key=stable(org,app['applicationId'],attempt)
    if payload:verify_source(app,job,payload)
    from .report_normalize import deep_camel
    source=deep_camel(obj(payload));source=obj(source.get('data')) or source
    details=obj(source.get('interviewDetails'))
    round_type=str(details.get('roundType') or assessment.get('roundType') or job.get('assessmentRoundType') or 'UNKNOWN').upper()
    if round_type not in ROUNDS:round_type='UNKNOWN'
    content=presentation(payload,round_type)
    status=status_override or generation_status(payload,content,report_available=report_available,submitted=submitted)
    fingerprint=hashlib.sha256(json.dumps({'status':status,'content':content},sort_keys=True,default=str).encode()).hexdigest()
    async with lease(db,org,['report:'+key]):
        previous=await db.report_catalog.find_one({'_id':key,'orgId':org})
        if previous and previous.get('fingerprint')==fingerprint:return previous
        # A transient pending response cannot replace a valid stored report.
        if previous and previous.get('status') in {'Completed','Partial'} and not payload:
            return previous
        version=(previous or {}).get('version',0)+1
        person=await db.applicants.find_one({'orgId':org,'applicantId':app['applicantId']},{'name':1,'profile.name':1}) or {}
        stamp=now()
        record={'reportId':key,'orgId':org,'candidateId':app['applicantId'],
            'candidateName':person.get('name') or obj(person.get('profile')).get('name') or 'Candidate',
            'applicationId':app['applicationId'],'jobId':app['jobId'],'jobTitle':job.get('title','Job'),
            'roundId':str(assessment.get('roundId') or attempt),'roundType':round_type,'attemptId':attempt,
            'version':version,'status':status,'roundCompletedAt':utc(details.get('submittedAt') or assessment.get('submittedAt')),
            'generatedAt':utc(source.get('generatedAt') or obj(source.get('report')).get('generatedAt')) ,
            'capturedAt':stamp,'generatedBy':str(source.get('generatedBy') or 'Assessment provider'), 'updatedAt':stamp,
            'generationReason':reason,'fingerprint':fingerprint,'content':content,'source':source,
            'createdAt':(previous or {}).get('createdAt',stamp)}
        version_id=f'{key}:{version}'
        await db.report_versions.update_one({'_id':version_id},{'$setOnInsert':record},upsert=True)
        snapshot={field:record.get(field) for field in METADATA}
        snapshot.update(summaryId=stable(key,version,'summary'),orgId=org,sourceReportId=key,sourceReportVersion=version,
            sourceRoundId=record['roundId'],sourceAttemptId=attempt,summaryStatus=status,summaryGeneratedAt=stamp,
            snapshot={field:content[field] for field in ['overview','feedback','skillProfile','communication','aiSummary','proctoring','schemaSupported']})
        await db.report_summaries.update_one({'_id':snapshot['summaryId']},{'$setOnInsert':snapshot},upsert=True)
        catalog={field:value for field,value in record.items() if field not in {'content','source'}}
        if previous and previous.get('controlStatus'):catalog['controlStatus']=previous['controlStatus']
        await db.report_catalog.update_one({'_id':key},{'$set':catalog,'$unset':{'syncError':''}},upsert=True)
        await AuditLogRepository(db).log(org_id=org,actor_user_id=actor,action='reports.version_captured',
            resource_type='report',resource_id=key,details={'version':version,'applicationId':app['applicationId'],'status':status,'reason':reason})
    return catalog


async def queue_sync(db,user,*,application_id=None,job_id=None):
    if 'reports.refresh' not in user.permissions or user.impersonating:raise HTTPException(403,'Report refresh is not permitted')
    query={'$and':[await scope(db,user),{'assessment.interviewId':{'$type':'string','$ne':''}},
        *([{'applicationId':application_id}] if application_id else []),*([{'jobId':job_id}] if job_id else [])]}
    rows=await db.applications.find(query).sort('assessment.reportSyncedAt',1).limit(51).to_list(51)
    # Bounded batch, never a synchronous fan-out into the provider.
    count=0
    for app in rows[:50]:
        await application_for(db,user,app['applicationId'])
        job=await db.jobs.find_one({'orgId':user.org_id,'jobId':app['jobId']})
        assessment=app.get('assessment') or {}
        await capture(db,app,job,submitted=bool(assessment.get('submittedAt') or assessment.get('score') is not None),reason='Report refresh requested')
        dedupe=f"report-sync:{user.org_id}:{app['applicationId']}:{assessment['interviewId']}"
        existing=await db.background_jobs.find_one({'orgId':user.org_id,'dedupeKey':dedupe})
        if existing and existing.get('status') in {'done','dead'}:
            await db.background_jobs.update_one({'_id':existing['_id'],'status':existing['status']},{'$set':{'status':'pending','attempts':0,'runAfter':now(),'leaseUntil':None,'lastError':None}})
        else:
            await BackgroundJobRepository(db).enqueue(org_id=user.org_id,kind='report_sync',entity_type='application',
                entity_key=app['applicationId'],payload={'applicationId':app['applicationId'],'attemptId':assessment['interviewId']},dedupe_key=dedupe)
        count+=1
    await audit(db,user,'sync_requested',application_id or job_id or 'catalog',{'queued':count})
    return {'queued':count,'hasMore':len(rows)>50}


async def sync_report(db,task):
    from .primehire_api import get_interview_status,get_report_envelope
    org=task['orgId'];payload=task['payload']
    app=await db.applications.find_one({'orgId':org,'applicationId':payload['applicationId']})
    if not app or obj(app.get('assessment')).get('interviewId')!=payload['attemptId']:return {'skipped':'assessment changed'}
    job=await db.jobs.find_one({'orgId':org,'jobId':app['jobId']})
    if not job:return {'skipped':'job unavailable'}
    key=stable(org,app['applicationId'],payload['attemptId'])
    try:
        status=await asyncio.wait_for(get_interview_status(interview_id=payload['attemptId'],timeout_s=8),timeout=30)
        raw=None
        if status.get('submitted') or status.get('reportAvailable'):
            raw=await asyncio.wait_for(get_report_envelope(interview_id=payload['attemptId'],timeout_s=8),timeout=30)
        record=await capture(db,app,job,raw,submitted=status.get('submitted',False),report_available=status.get('reportAvailable',False))
        await db.applications.update_one({'orgId':org,'applicationId':app['applicationId']},{'$set':{'assessment.reportSyncedAt':now()}})
        return {'reportId':key,'version':record.get('version'),'status':record.get('status')}
    except Exception:
        await db.report_catalog.update_one({'_id':key,'orgId':org},{'$set':{'syncError':'Report synchronization is temporarily unavailable. Retry the sync.','updatedAt':now()}})
        raise RuntimeError('Report synchronization unavailable') from None


async def listing(db,user,*,q='',round_type=None,status=None,job_id=None,application_id=None,generated_from=None,generated_to=None,sort='updatedAt',order='desc',skip=0,limit=25):
    query={'$and':[await catalog_scope(db,user)]}
    conditions=query['$and']
    if q:
        pattern={'$regex':re.escape(q),'$options':'i'}
        conditions.append({'$or':[{field:pattern} for field in ['reportId','candidateId','candidateName','applicationId','jobTitle','roundType','attemptId']]})
    for field,value in [('roundType',round_type),('jobId',job_id),('applicationId',application_id)]:
        if value:conditions.append({field:value})
    if status:
        conditions.append({'controlStatus':status} if status in {'Archived','Invalidated'} else {'status':status,'controlStatus':{'$nin':['Archived','Invalidated']}})
    if generated_from or generated_to:
        conditions.append({'generatedAt':{**({'$gte':generated_from} if generated_from else {}),**({'$lt':generated_to} if generated_to else {})}})
    # Recheck catalog joins before search pagination/counting: orphaned or mismatched
    # application pointers must not leak metadata or inflate a visible total.
    pipeline=[{'$match':query},{'$lookup':{'from':'applications','localField':'applicationId','foreignField':'applicationId','as':'owner'}},
        {'$match':{'$expr':{'$gt':[{'$size':{'$filter':{'input':'$owner','as':'app','cond':{'$and':[
            {'$eq':['$$app.orgId',user.org_id]},{'$eq':['$$app.jobId','$jobId']},{'$eq':['$$app.applicantId','$candidateId']}]}}}},0]}}},
        {'$addFields':{'effectiveStatus':{'$ifNull':['$controlStatus','$status']}}},
        {'$facet':{'items':[{'$sort':{('effectiveStatus' if sort=='status' else sort):1 if order=='asc' else -1,'reportId':1}},{'$skip':skip},{'$limit':limit}],
            'total':[{'$count':'count'}]}}]
    pages=await db.report_catalog.aggregate(pipeline).to_list(1)
    page=pages[0] if pages else {'items':[],'total':[]}
    result=[]
    for row in page['items']:
        app=next(app for app in row['owner'] if app['orgId']==user.org_id and app['jobId']==row['jobId'] and app['applicantId']==row['candidateId'])
        result.append(public_metadata(row,row,app))
    return {'items':result,'total':page['total'][0]['count'] if page['total'] else 0,'skip':skip,'limit':limit}



async def detail(db,user,key,version=None):
    series,app,job=await series_for(db,user,key)
    selected=version or series['version']
    row=await db.report_versions.find_one({'orgId':user.org_id,'reportId':key,'version':selected})
    if not row:raise HTTPException(404,'Report version not found')
    metadata=public_metadata(row,series,app)
    versions=[public_metadata(item,series,app) async for item in db.report_versions.find({'orgId':user.org_id,'reportId':key},{'content':0,'source':0}).sort('version',-1).limit(200)]
    content=dict(row['content']);content.pop('media',None)
    if metadata['status'] in {'Not Started','Processing','Failed'}:content=None
    if content:content=project_management_profile(content)
    await audit(db,user,'viewed',key,{'version':selected,'applicationId':app['applicationId']})
    return {'metadata':metadata,'versions':versions,'content':content,
        'summaryId':stable(key,selected,'summary'),'canExport':'reports.export' in user.permissions,
        'canRefresh':'reports.refresh' in user.permissions and not user.impersonating,
        'canManageVersions':'reports.manage_versions' in user.permissions and not user.impersonating,
        'versionCount':await db.report_versions.count_documents({'orgId':user.org_id,'reportId':key})}


async def application_history(db,user,key):
    app,job=await application_for(db,user,key)
    person=await db.applicants.find_one({'orgId':user.org_id,'applicantId':app['applicantId']}) or {}
    fields=await fields_for(db,user)
    rows=await db.report_catalog.find({'$and':[await catalog_scope(db,user),{'applicationId':key}]}).sort('createdAt',1).to_list(200)
    summaries=[]
    async for row in db.report_summaries.find({'orgId':user.org_id,'applicationId':key,'candidateId':app['applicantId'],'jobId':app['jobId'],'sourceReportId':{'$in':[row['reportId'] for row in rows]}}).sort('summaryGeneratedAt',1).limit(200):
        summaries.append(await summary_for(db,user,row['summaryId']))
    reviews=[]
    if 'previousReviews' in fields:
        review_query={'orgId':user.org_id,'applicationId':key}
        if user.role not in {'super_admin','admin','recruiter'} and job.get('assigneeUserId')!=user.user_id:
            assignments=await db.recruit_interviews.find({'orgId':user.org_id,'applicationId':key,'interviewerId':user.user_id,'status':{'$ne':'cancelled'}}).to_list(100)
            cutoffs=[utc(row.get('createdAt') or row.get('startsAt')) for row in assignments]
            cutoffs=[value for value in cutoffs if value]
            permitted=[{'interviewId':{'$in':[row['interviewId'] for row in assignments]}}]
            if cutoffs:permitted.append({'createdAt':{'$lte':max(cutoffs)}})
            review_query['$or']=permitted
        reviews=[project_management_profile(clean(row)) async for row in db.recruit_reviews.find(review_query).sort('createdAt',1).limit(100)]
    await audit(db,user,'application_history_viewed',key)
    return {'application':project_application(app,fields),'candidate':project_candidate(person,fields),
        'job':{'jobId':job['jobId'],'title':job.get('title','Job')},
        'reports':[public_metadata(row,row,app) for row in rows], 'summaries':summaries,'humanEvaluations':reviews}


async def summary_for(db,user,key):
    summary=await db.report_summaries.find_one({'orgId':user.org_id,'summaryId':key})
    if not summary:raise HTTPException(404,'Previous round summary not found')
    series,app,_=await series_for(db,user,summary['sourceReportId'])
    if summary['applicationId']!=app['applicationId'] or summary['candidateId']!=app['applicantId'] or summary['jobId']!=app['jobId']:
        raise HTTPException(404,'Summary context does not match its source report')
    await audit(db,user,'summary_viewed',summary['sourceReportId'],{'summaryId':key,'version':summary['sourceReportVersion']})
    series=await db.report_catalog.find_one({'orgId':user.org_id,'reportId':summary['sourceReportId']})
    version=await db.report_versions.find_one({'orgId':user.org_id,'reportId':summary['sourceReportId'],'version':summary['sourceReportVersion']},{'controlStatus':1}) or {}
    result=project_management_profile(clean(summary))
    result['sourceValidity']=version.get('controlStatus') or (series.get('controlStatus') if summary['sourceReportVersion']==series['version'] else None)
    result['sourceIsCurrent']=summary['sourceReportVersion']==series['version'] and not result['sourceValidity']
    return result


async def pin_snapshot(db,app):
    attempt=obj(app.get('assessment')).get('interviewId')
    if not attempt:return {'status':'Unavailable','reason':'No assessment attempt is linked to this application.'}
    key=stable(app['orgId'],app['applicationId'],attempt)
    series=await db.report_catalog.find_one({'_id':key,'orgId':app['orgId']})
    if not series:return {'status':'Unavailable','reason':'Previous round report has not been synchronized.'}
    if series.get('controlStatus') in {'Archived','Invalidated'}:
        return {'status':series['controlStatus'],'reason':'The previous round report is not a current valid report.'}
    if series['status'] not in {'Completed','Partial'}:
        return {'status':series['status'],'reason':'Previous round report is not ready.'}
    return {'status':series['status'],'summaryId':stable(key,series['version'],'summary'),
        'sourceReportId':key,'sourceReportVersion':series['version'],'capturedAt':now()}


async def interview_snapshot(db,user,key,*,refresh=False):
    interview=await db.recruit_interviews.find_one({'orgId':user.org_id,'interviewId':key})
    if not interview:raise HTTPException(404,'Interview not found')
    app,_=await application_for(db,user,interview['applicationId'])
    if user.role not in {'super_admin','admin','recruiter'} and interview.get('interviewerId')!=user.user_id:
        raise HTTPException(404,'Interview not found')
    fields=await fields_for(db,user)
    if 'previousReviews' not in fields and user.role not in {'technical_interviewer'}:
        raise HTTPException(403,'Previous round summary access has been removed')
    reference=interview.get('reportSummarySnapshot') or {'status':'Unavailable','reason':'No source report snapshot was captured for this interview.'}
    if refresh:
        if user.impersonating:raise HTTPException(403,'View-as sessions are read-only')
        async with lease(db,user.org_id,['interview:'+key]):
            fresh=await db.recruit_interviews.find_one({'orgId':user.org_id,'interviewId':key})
            if fresh.get('status')!='scheduled' or await db.recruit_reviews.find_one({'orgId':user.org_id,'interviewId':key}):
                raise HTTPException(409,'Submitted interview history cannot be rewritten')
            reference=await pin_snapshot(db,app)
            await db.recruit_interviews.update_one({'orgId':user.org_id,'interviewId':key},{'$set':{'reportSummarySnapshot':reference}})
            await audit(db,user,'interview_snapshot_refreshed',key,reference)
    summary=await summary_for(db,user,reference['summaryId']) if reference.get('summaryId') else None
    return {'reference':clean(reference),'summary':summary,'canRefresh':interview.get('status')=='scheduled' and not user.impersonating}


async def control_version(db,user,key,version,action,reason):
    if 'reports.manage_versions' not in user.permissions or user.impersonating:raise HTTPException(403,'Report version management is not permitted')
    series,app,_=await series_for(db,user,key)
    async with lease(db,user.org_id,['report:'+key]):
        series=await db.report_catalog.find_one({'orgId':user.org_id,'reportId':key})
        if series['version']!=version:raise HTTPException(409,'Current report version changed. Refresh before continuing.')
        target={'archive':'Archived','invalidate':'Invalidated','restore':None}[action]
        before=series.get('controlStatus')
        await db.report_catalog.update_one({'_id':series['_id']},{'$set':{'controlStatus':target,'updatedAt':now()}})
        await db.report_versions.update_one({'orgId':user.org_id,'reportId':key,'version':version},{'$set':{'controlStatus':target}})
        await audit(db,user,action,key,{'version':version,'previous':before,'new':target,'reason':reason})
    return {'status':target or series['status']}


async def versions_page(db,user,key,skip=0,limit=50):
    series,app,_=await series_for(db,user,key)
    query={'orgId':user.org_id,'reportId':key}
    rows=await db.report_versions.find(query,{'content':0,'source':0}).sort('version',-1).skip(skip).limit(limit).to_list(limit)
    return {'items':[public_metadata(row,series,app) for row in rows],'total':await db.report_versions.count_documents(query),'skip':skip,'limit':limit}
