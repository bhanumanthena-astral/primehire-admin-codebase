"""Job-scoped intake totals and current interview occupancy, batched per page."""


def nonempty(field):
    return {'$ne': [{'$ifNull': [field, None]}, None]}


def application_conditions():
    completed = {'$or': [
        nonempty('$assessment.submittedAt'), nonempty('$assessment.completedAt'), nonempty('$assessment.score'),
        {'$in': ['$assessment.state', ['completed', 'report_pending']]},
        {'$in': ['$assessment.status', ['completed', 'Completed', 'COMPLETED', 'Report pending', 'report_pending']]},
        {'$eq': ['$currentStage', 'ASSESSMENT_COMPLETED']},
        {'$in': ['ASSESSMENT_COMPLETED', '$history.toStage']},
    ]}
    sent = {'$or': [completed, nonempty('$assessment.sentAt'),
        {'$in': ['$assessment.state', ['email_sent']]},
        {'$in': ['$assessment.status', ['sent', 'email_sent', 'link_sent']]},
        {'$eq': ['$currentStage', 'ASSESSMENT_SENT']},
        {'$in': ['ASSESSMENT_SENT', '$history.toStage']}]}
    legacy = {'$eq': [{'$ifNull': ['$intakeItemId', None]}, None]}
    return {
        'resumesUploaded': legacy,
        'atsTotal': {'$and': [legacy, {'$or': [nonempty('$matchScore'), nonempty('$scoreBreakdown.ats')]}]},
        'linksSent': sent, 'assessmentsCompleted': completed,
        'technical': {'$in': ['$currentStage', ['ROUND1_PENDING_ASSIGNMENT', 'ROUND1_SCHEDULED', 'ROUND1_REVIEW_PENDING']]},
        'managerial': {'$in': ['$currentStage', ['ROUND2_PENDING_ASSIGNMENT', 'ROUND2_SCHEDULED', 'ROUND2_REVIEW_PENDING']]},
        'hr': {'$eq': ['$currentStage', 'HR_ROUND']},
    }


def scoped_history(org_id):
    return [
        {'$lookup': {'from': 'stage_history', 'localField': 'applicationId', 'foreignField': 'applicationId', 'as': 'history'}},
        {'$addFields': {'history': {'$filter': {'input': '$history', 'as': 'entry',
            'cond': {'$eq': [{'$ifNull': ['$$entry.orgId', org_id]}, org_id]}}}}},
    ]


async def pipeline_counts(db, org_id, job_ids):
    keys = ['resumesUploaded', 'atsTotal', 'atsScored', 'atsProcessing', 'linksGenerated',
            'linksSent', 'assessmentsCompleted', 'technical', 'managerial', 'hr']
    result = {key: dict.fromkeys(keys, 0) for key in job_ids}
    if not result:
        return result
    scope = {'orgId': org_id, 'jobId': {'$in': list(result)}}
    def tally(condition):
        return {'$sum': {'$cond': [condition, 1, 0]}}
    async for row in db['resume_intake_items'].aggregate([
        {'$match': {**scope, 'status': {'$ne': 'deleted'}}},
        {'$group': {'_id': '$jobId', 'resumesUploaded': {'$sum': 1},
                    'atsScored': tally({'$eq': ['$atsState', 'done']}),
                    'atsProcessing': tally({'$in': ['$atsState', ['queued', 'scoring']]})}},
    ]):
        result[row['_id']].update({key: row[key] for key in ['resumesUploaded', 'atsScored', 'atsProcessing']})
    conditions = application_conditions()
    async for row in db['applications'].aggregate([
        {'$match': scope},
        *scoped_history(org_id),
        {'$group': {'_id': '$jobId', 'legacyResumes': tally(conditions['resumesUploaded']),
            'legacyAts': tally(conditions['atsTotal']),
            'linksGenerated': tally(nonempty('$assessment.link')), 'linksSent': tally(conditions['linksSent']),
            'assessmentsCompleted': tally(conditions['assessmentsCompleted']),
            'technical': tally(conditions['technical']),
            'managerial': tally(conditions['managerial']),
            'hr': tally(conditions['hr'])}},
    ]):
        values = result[row['_id']]
        values['resumesUploaded'] += row.pop('legacyResumes')
        values['atsScored'] += row.pop('legacyAts')
        values.update({key: value for key, value in row.items() if key != '_id'})
    for values in result.values():
        values['atsTotal'] = values['atsScored'] + values['atsProcessing']
    return result


async def pipeline_details(db, org_id, job_id, stage, skip=0, limit=25):
    """Page the exact records counted by a funnel stage, without contact/secrets."""
    from .job_applications import assessment_result

    scope = {'orgId': org_id, 'jobId': job_id}
    condition = application_conditions()[stage]
    items = []
    intake_total = 0
    if stage in {'resumesUploaded', 'atsTotal'}:
        query = {**scope, 'status': {'$ne': 'deleted'}}
        if stage == 'atsTotal':
            query['atsState'] = {'$in': ['done', 'queued', 'scoring']}
        intake_total = await db['resume_intake_items'].count_documents(query)
        projection = {'profile.name': 1, 'fileName': 1, 'status': 1, 'atsState': 1, 'ats.overall': 1}
        if skip < intake_total:
            rows = await db['resume_intake_items'].find(query, projection).sort([('createdAt', -1), ('_id', 1)]).skip(skip).limit(limit).to_list(limit)
            for row in rows:
                items.append({'id': 'resume:' + str(row['_id']),
                    'name': (row.get('profile') or {}).get('name') or 'Awaiting resume parsing',
                    'source': row.get('fileName') or 'Uploaded resume',
                    'status': row.get('status', 'uploaded'), 'atsState': row.get('atsState'),
                    'atsScore': (row.get('ats') or {}).get('overall'), 'assessment': None})
    # Intake records come first; pre-intake applications follow without duplication.
    app_skip = max(0, skip - intake_total)
    remaining = limit - len(items)
    stages = [{'$match': scope}]
    if stage not in {'resumesUploaded', 'atsTotal'}:
        stages += scoped_history(org_id)
    stages.append({'$match': {'$expr': condition}})
    # Keep only fields required for display. Links, passwords and contacts never leave this service.
    projection = {'_id': 0, 'applicationId': 1, 'applicantId': 1, 'currentStage': 1,
        'matchScore': 1, 'scoreBreakdown.ats': 1, 'assessment.score': 1,
        'assessment.status': 1, 'assessment.state': 1, 'assessment.submittedAt': 1,
        'assessment.completedAt': 1, 'assessment.sentAt': 1, 'assessment.reportPending': 1}
    data = [{'$sort': {'createdAt': -1, 'applicationId': 1}}, {'$skip': app_skip},
        {'$limit': max(1, remaining)}, {'$project': projection}]
    facets = await db['applications'].aggregate(stages + [{'$facet': {
        'count': [{'$count': 'total'}], 'items': data,
    }}]).to_list(1)
    facet = facets[0] if facets else {'count': [], 'items': []}
    rows = facet['items'] if remaining else []
    people = {row['applicantId']: row async for row in db['applicants'].find({
        'orgId': org_id, 'applicantId': {'$in': [row.get('applicantId') for row in rows]}},
        {'applicantId': 1, 'name': 1, 'profile.name': 1})}
    for row in rows:
        person = people.get(row.get('applicantId'), {})
        ats_score = row.get('matchScore')
        if ats_score is None:
            ats_score = (row.get('scoreBreakdown') or {}).get('ats')
        items.append({'id': 'application:' + row['applicationId'],
            'name': person.get('name') or (person.get('profile') or {}).get('name') or 'Unknown candidate',
            'source': 'Candidate profile', 'status': row.get('currentStage') or 'RESUME_REVIEWED',
            'atsScore': ats_score, 'atsState': 'done' if ats_score is not None else None,
            'assessment': assessment_result(row)})
    return {'items': items, 'total': intake_total + (facet['count'][0]['total'] if facet['count'] else 0),
        'skip': skip, 'limit': limit, 'stage': stage}
