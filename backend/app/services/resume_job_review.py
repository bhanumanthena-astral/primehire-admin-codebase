"""Review all upload chunks of one job using an explicit, versioned ATS range."""
import hashlib
import json
from collections import Counter
from fastapi import HTTPException
from .resume_intake_selection import selection, SCOREABLE


async def batches_for(db, user, job_id):
    query = {'orgId': user.org_id, 'jobId': job_id}
    if user.role not in {'super_admin', 'admin'}:
        query['createdBy'] = user.user_id
    batches = await db['resume_intake_batches'].find(query).sort('_id', 1).limit(1001).to_list(1001)
    if len(batches) > 1000:
        raise HTTPException(422, 'This job has over 1,000 upload batches. Review individual batches.')
    return batches


def fingerprint(batches):
    values = [(b['_id'], b.get('atsRangeRevision', 0), b.get('atsRange'), bool(b.get('imported'))) for b in batches]
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


async def overview(db, user, job):
    batches = await batches_for(db, user, job['jobId'])
    by_id = {b['_id']: b for b in batches}
    counts = Counter()
    query = {'orgId': user.org_id, 'jobId': job['jobId'], 'batchId': {'$in': list(by_id)}}
    # Exclude source text/documents; snapshot uses the persisted text hash.
    async for item in db['resume_intake_items'].find(query, {'rawText': 0, 'confirmation': 0}):
        counts['total'] += 1
        state = item.get('status')
        if state in {'completed', 'duplicate'}:
            counts['created'] += 1
        elif state in SCOREABLE:
            decision = selection(item, by_id[item['batchId']], job)
            counts[decision['state']] += 1
            p = item.get('profile') or {}
            if len(p.get('name', '')) < 2 or not (p.get('email') or p.get('phone')):
                counts['needsCorrection'] += 1
        elif state == 'confirming':
            counts['creating'] += 1
        elif state != 'deleted':
            counts['needsAttention'] += 1
    policies = [b.get('atsRange') for b in batches]
    policy = policies[0] if policies and all(p == policies[0] for p in policies) else None
    return {'snapshot': fingerprint(batches), 'batches': len(batches), 'range': policy,
            'counts': dict(counts), 'running': any(b.get('bulkApprovalRunning') for b in batches),
            'importing': any(not b.get('imported') for b in batches)}
