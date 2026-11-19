"""Human-selected ATS bands before candidate creation; extraction remains local."""
import hashlib
import math
from fastapi import HTTPException
from ..models.resume_intake import IntakeRepository, fenced_claim, now
from ..models.jobs import BackgroundJobRepository
from .resume_intake_ats import job_fingerprint, profile_fingerprint

SCOREABLE={'review_required','duplicate_suspected','confirmation_paused'}


def snapshot(item,job,profile=None):
    values=[profile_fingerprint(profile or item.get('profile',{})),job_fingerprint(job),hashlib.sha256(item['rawText'].encode()).hexdigest() if 'rawText' in item else item.get('atsPreviewTextHash',hashlib.sha256(b'').hexdigest())]
    return hashlib.sha256(':'.join(values).encode()).hexdigest()


def selection(item,batch,job,profile=None):
    policy=batch.get('atsRange')
    result={'range':policy,'rangeRevision':batch.get('atsRangeRevision',0),'eligible':False,'state':'range_required'}
    if item.get('status') in {'completed','duplicate'}:
        return {**result,'state':'already_created'}
    if not policy:return result
    score=(item.get('ats') or {}).get('overall')
    fresh=(item.get('atsState')=='done' and not item.get('atsStale') and item.get('atsPreviewHash')==snapshot(item,job,profile))
    if not fresh or isinstance(score,bool) or not isinstance(score,(int,float)) or not math.isfinite(score) or not 0<=score<=100:
        return {**result,'state':'score_failed' if item.get('atsState')=='failed' else 'pending'}
    state='below' if score<policy['minimum'] else 'above' if score>policy['maximum'] else 'within'
    return {**result,'state':state,'eligible':state=='within','score':score}


def require_selection(item,batch,job,profile=None,expected_range_revision=None):
    result=selection(item,batch,job,profile)
    if not result['range']:raise HTTPException(409,'Select and save the ATS score range for this upload batch before creating candidates.')
    if expected_range_revision is not None and expected_range_revision!=result['rangeRevision']:
        raise HTTPException(409,'The ATS range changed. Review the current range before confirming.')
    if result['state'] in {'pending','score_failed'}:
        raise HTTPException(409,'Save any profile corrections and finish ATS scoring before confirming this candidate.')
    if not result['eligible']:
        raise HTTPException(422,f"ATS {result.get('score',0)}% is outside the selected {result['range']['minimum']}–{result['range']['maximum']}% range. The resume is retained; adjust the range to include it.")
    return result


async def enqueue_score(db, item, job, *, retry=False, _attempt=0):
    if item.get('status') not in SCOREABLE or item.get('scanStatus') != 'clean':
        return
    desired = snapshot(item, job)
    if item.get('atsState') == 'done' and item.get('atsPreviewHash') == desired and not item.get('atsStale') and not retry:
        return
    generation = item.get('atsGeneration', 0)
    # Reconciliation must not turn a just-completed score back into queued.
    # Re-enqueue the existing intent without modifying an already queued/scoring item.
    if retry or item.get('atsState') not in {'queued', 'scoring'}:
        generation += 1
        outcome = await db['resume_intake_items'].update_one({
            '_id':item['_id'], 'orgId':item['orgId'], 'revision':item['revision'],
            'atsState':item.get('atsState'), 'atsGeneration':item.get('atsGeneration'),
        }, {'$set':{'atsState':'queued','atsGeneration':generation,'atsError':None,'atsStale':True}})
        if not outcome.matched_count:
            if _attempt >= 2:
                raise HTTPException(409, 'Resume scoring changed concurrently. Retry shortly.')
            fresh = await IntakeRepository(db).get_item(item['_id'], item['orgId'])
            if fresh:
                return await enqueue_score(db, fresh, job, retry=retry, _attempt=_attempt+1)
            return
    queued = await BackgroundJobRepository(db).enqueue(
        org_id=item['orgId'], kind='resume_intake_score', entity_type='resume_intake_item',
        entity_key=item['_id'], payload={'itemId':item['_id']},
        dedupe_key=f"{item['orgId']}:resume_intake_score:{item['_id']}:{desired}:{generation}")
    if queued['status'] in {'done','dead'}:
        await db['background_jobs'].update_one({'orgId':item['orgId'],'jobId':queued['jobId'],
            'status':queued['status']},{'$set':{'status':'pending','attempts':0,'runAfter':now(),'leaseUntil':None,'lastError':None}})


async def score_batch(db,job):
    batch_id=job['payload']['batchId'];org=job['orgId']
    batch=await IntakeRepository(db).get_batch(batch_id,org)
    if not batch:return {'skipped':'batch unavailable'}
    target=await db['jobs'].find_one({'orgId':org,'jobId':batch['jobId']})
    if not target:return {'skipped':'job unavailable'}
    count=0
    async for item in db['resume_intake_items'].find({'orgId':org,'batchId':batch_id,'status':{'$in':list(SCOREABLE)},'scanStatus':'clean'}).limit(5500):
        await enqueue_score(db,item,target);count+=1
    await db['resume_intake_batches'].update_one({'_id':batch_id,'orgId':org,'atsRangeRevision':batch.get('atsRangeRevision')},{'$set':{'atsScoringRequested':False}})
    await IntakeRepository(db).refresh_summary(batch_id,org)
    return {'queued':count}


async def score_item(db,job):
    org,item_id=job['orgId'],job['payload']['itemId'];repo=IntakeRepository(db)
    async with fenced_claim(db,org,['item:'+item_id]):
        item=await repo.get_item(item_id,org)
        if not item or item.get('status') not in SCOREABLE or item.get('scanStatus')!='clean':return {'skipped':'not ready'}
        if item.get('retentionUntil') and item['retentionUntil'].replace(tzinfo=now().tzinfo)<=now():return {'skipped':'expired retention'}
        batch=await repo.get_batch(item['batchId'],org)
        if not batch:return {'skipped':'batch unavailable'}
        target=await db['jobs'].find_one({'orgId':org,'jobId':item['jobId']})
        if not target:return {'skipped':'job unavailable'}
        desired=snapshot(item,target)
        if item.get('atsState')=='done' and item.get('atsPreviewHash')==desired and not item.get('atsStale'):return {'cached':True}
        await repo.items.update_one({'_id':item_id,'orgId':org},{'$set':{'atsState':'scoring','atsError':None}})
        try:
            from .resume_intake_llm import evaluate
            from .resume_intake import get_limits
            result=await evaluate(db,org,item['profile'],item.get('rawText',''),target,await get_limits(db,org),'intake:'+item_id)
            result['evaluatedAt']=now().isoformat()
            await repo.items.update_one({'_id':item_id,'orgId':org,'revision':item['revision']},{'$set':{
                'ats':result,'atsState':'done','atsStale':False,'atsError':None,'atsPreviewHash':desired,
                'atsPreviewJobHash':job_fingerprint(target),'atsPreviewTextHash':hashlib.sha256(item.get('rawText','').encode()).hexdigest(),'atsUpdatedAt':now()}})
        except Exception:
            await repo.items.update_one({'_id':item_id,'orgId':org,'revision':item['revision']},{'$set':{'atsState':'failed','atsError':'ATS evaluation failed. Your resume is retained; retry scoring.'}})
            raise RuntimeError('ATS preview failed; candidate creation was not performed') from None
    await repo.refresh_summary(item['batchId'],org)
    return {'scored':True}


async def resume_ats(db, target, *, batch_id=None):
    """Explicit scoring recovery; ranges and candidate creation stay human-gated."""
    org=target['orgId']
    scope={'orgId':org,'jobId':target['jobId']}
    if batch_id:scope['_id']=batch_id
    result={'queued':0,'batches':0,'alreadyScored':0,'notReady':0}
    async for batch in db['resume_intake_batches'].find(scope).limit(5500):
        query={'orgId':org,'batchId':batch['_id'],'status':{'$in':list(SCOREABLE)},'scanStatus':'clean',
            '$or':[{'retentionUntil':None},{'retentionUntil':{'$gt':now()}}]}
        total=await db['resume_intake_items'].count_documents(query)
        fresh={'atsState':'done','atsStale':{'$ne':True},'atsPreviewJobHash':job_fingerprint(target)}
        done=await db['resume_intake_items'].count_documents({**query,**fresh})
        result['alreadyScored']+=done
        if not batch.get('imported'):
            result['notReady']+=total-done
            continue
        if total==done:continue
        await db['resume_intake_batches'].update_one({'_id':batch['_id'],'orgId':org},{'$set':{'atsScoringRequested':True}})
        task=await BackgroundJobRepository(db).enqueue(org_id=org,kind='resume_intake_score_batch',
            entity_type='resume_intake_batch',entity_key=batch['_id'],payload={'batchId':batch['_id']},
            dedupe_key=f"{org}:resume-ats:{batch['_id']}")
        if task['status'] in {'done','dead'}:
            await db['background_jobs'].update_one({'orgId':org,'jobId':task['jobId'],'status':task['status']},
                {'$set':{'status':'pending','attempts':0,'runAfter':now(),'leaseUntil':None,'lastError':None}})
        result['queued']+=total-done
        result['batches']+=1
    return result
