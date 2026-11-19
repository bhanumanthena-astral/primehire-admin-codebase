"""Bounded repair of machine-generated suggestions; never changes hiring decisions."""
import hashlib
from datetime import datetime, timezone
from .resume_extract import deterministic_parse, PARSER_VERSION, TAXONOMY_VERSION
from .resume_intake_ats import score, job_fingerprint
from .resume_intake_selection import snapshot
from .resume_intake import get_limits
from ..schemas.resume_intake import CandidateProfile
from ..models.resume_intake import IntakeRepository, fenced_claim, now
from ..models.hiring import AuditLogRepository


def eligible(item):
    if item.get('status') not in {'review_required','duplicate_suspected','confirmation_paused'}:
        return False
    if item.get('reviewedBy') or item.get('confirmedAt') or item.get('applicationId') or item.get('applicantId') or not item.get('rawText'):
        return False
    if item.get('parserVersion') == PARSER_VERSION:
        return False
    expiry=item.get('retentionUntil')
    if expiry:
        if isinstance(expiry,str):expiry=datetime.fromisoformat(expiry.replace('Z','+00:00'))
        if expiry.replace(tzinfo=expiry.tzinfo or timezone.utc)<=now():return False
    return True


async def repair_job(db,job_key,*,apply=False,expected_count=None):
    jobs=await db.jobs.find({'$or':[{'jobKey':job_key},{'jobId':job_key}]}).limit(2).to_list(2)
    if len(jobs)!=1:raise ValueError('Expected exactly one reference job')
    job=jobs[0];org=job['orgId']
    rows=await db.resume_intake_items.find({'orgId':org,'jobId':job['jobId']}).limit(1001).to_list(1001)
    if len(rows)>1000:raise ValueError('Repair is limited to 1000 records for one job')
    candidates=[row for row in rows if eligible(row)]
    result={'scanned':len(rows),'eligible':len(candidates),'updated':0,'skipped':0,'mode':'apply' if apply else 'dry-run'}
    if not apply:return result
    if expected_count is None or expected_count!=len(candidates):raise ValueError('Eligible count changed; inspect a new dry-run before applying')
    limits=await get_limits(db,org);repo=IntakeRepository(db);batches=set()
    for original in candidates:
        async with fenced_claim(db,org,['item:'+original['_id']]):
            item=await repo.get_item(original['_id'],org)
            if not item or item.get('revision')!=original.get('revision') or not eligible(item):
                result['skipped']+=1;continue
            parsed=deterministic_parse(item['rawText'])
            skills=parsed['skills'][:150]
            profile=CandidateProfile.model_validate({**item['profile'],'skills':skills,'skillEvidence':[e for e in parsed.get('skillEvidence',[]) if e['skill'] in skills]}).model_dump(mode='json')
            ats=score(profile,item['rawText'],job,limits)
            ats.update(evaluatedAt=now().isoformat(),localOverall=ats['overall'],llmScore=None,llmReasons=[],llmStatus='not_requested',needsReview=False)
            updated={**item,'profile':profile}
            changes={'profile':profile,'parserVersion':PARSER_VERSION,'taxonomyVersion':TAXONOMY_VERSION,'ats':ats,'atsState':'done','atsStale':False,'atsError':None,'atsPreviewHash':snapshot(updated,job),'atsPreviewJobHash':job_fingerprint(job),'atsPreviewTextHash':hashlib.sha256(item['rawText'].encode()).hexdigest(),'atsUpdatedAt':now()}
            if item.get('ats'):changes['atsBeforeSkillRepair']=item['ats']
            if len(parsed['skills'])>150:changes['warnings']=list(dict.fromkeys(item.get('warnings',[])+['Skills exceeded the 150-skill profile limit; review the retained skills against the resume.']))
            await repo.patch_item(item['_id'],org,changes,item['revision'])
            await db.resume_files.update_one({'orgId':org,'fileId':item['_id']},{'$set':{'parsedJson.skills':skills,'parsedJson.skillEvidence':profile['skillEvidence']}})
            await AuditLogRepository(db).log(org_id=org,actor_user_id='system:skill-parser-repair',action='resume_intake.skills_repaired',resource_type='resume_intake_item',resource_id=item['_id'],details={'jobId':job['jobId'],'parserVersion':PARSER_VERSION,'beforeSkillCount':len(item['profile'].get('skills',[])),'afterSkillCount':len(skills)})
            result['updated']+=1;batches.add(item['batchId'])
    for batch in batches:
        if await repo.get_batch(batch,org):await repo.refresh_summary(batch,org)
    return result
