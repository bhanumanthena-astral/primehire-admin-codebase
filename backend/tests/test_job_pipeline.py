import mongomock_motor
from app.services.job_pipeline import pipeline_counts, pipeline_details


async def test_counts_intake_without_double_counting_created_profiles_and_keeps_milestones():
    db = mongomock_motor.AsyncMongoMockClient()['pipeline_test']
    for key, state, ats in [('i1','completed','done'),('i2','review_required','queued'),('i3','uploaded',None),('i4','deleted','done')]:
        await db['resume_intake_items'].insert_one({'_id':key,'orgId':'org','jobId':'job','status':state,'atsState':ats})
    await db['applications'].insert_many([
        {'orgId':'org','jobId':'job','applicationId':'a1','intakeItemId':'i1','currentStage':'ROUND1_SCHEDULED','assessment':{'score':0,'state':'completed','link':'https://example.test/1'}},
        {'orgId':'org','jobId':'job','applicationId':'a2','currentStage':'HR_ROUND','matchScore':75},
        {'orgId':'org','jobId':'job','applicationId':'a3','intakeItemId':'i2','currentStage':'SHORTLISTED','assessment':{'state':'email_sent'}},
        {'orgId':'org','jobId':'job','applicationId':'a4','intakeItemId':'i3','currentStage':'SHORTLISTED','assessment':{'state':'link_created','link':'https://example.test/4'}},
        {'orgId':'other','jobId':'job','applicationId':'foreign','currentStage':'ROUND2_SCHEDULED'},
    ])
    await db['stage_history'].insert_many([
        {'orgId':'org','applicationId':'a2','toStage':'ASSESSMENT_COMPLETED'},
        {'orgId':'org','applicationId':'a2','toStage':'ASSESSMENT_COMPLETED'},
        {'orgId':'other','applicationId':'a4','toStage':'ASSESSMENT_COMPLETED'},
    ])
    result = await pipeline_counts(db,'org',['job','empty'])
    assert result['job'] == {'resumesUploaded':4,'atsTotal':3,'atsScored':2,'atsProcessing':1,
        'linksGenerated':2,'linksSent':3,'assessmentsCompleted':2,'technical':1,'managerial':0,'hr':1}
    assert all(value == 0 for value in result['empty'].values())
    assert 'foreign' not in result

    # Every selectable stage must enumerate exactly the records in its counter.
    for stage in ['resumesUploaded','atsTotal','linksSent','assessmentsCompleted','technical','managerial','hr']:
        detail = await pipeline_details(db, 'org', 'job', stage)
        assert detail['total'] == result['job'][stage]
        assert len(detail['items']) == result['job'][stage]
        assert all('foreign' not in row['id'] for row in detail['items'])
        assert all('link' not in row and 'password' not in row for row in detail['items'])
    completed = await pipeline_details(db, 'org', 'job', 'assessmentsCompleted')
    assert next(row for row in completed['items'] if row['id'] == 'application:a1')['assessment']['score'] == 0


async def test_details_page_across_intake_and_legacy_profiles_without_duplicates():
    db = mongomock_motor.AsyncMongoMockClient()['pipeline_pages']
    await db['resume_intake_items'].insert_many([
        {'_id':f'i{i:02}','orgId':'org','jobId':'job','profile':{'name':f'Person {i}'},'atsState':'done','ats':{'overall':0}}
        for i in range(27)
    ])
    await db['applications'].insert_many([
        {'orgId':'org','jobId':'job','applicationId':'legacy','applicantId':'p1','matchScore':70},
        {'orgId':'org','jobId':'job','applicationId':'created','applicantId':'p2','intakeItemId':'i00'},
        {'orgId':'org','jobId':'other-job','applicationId':'unrelated','applicantId':'p3'},
    ])
    await db['applicants'].insert_one({'orgId':'org','applicantId':'p1','name':'Legacy person','email':'private@example.test'})
    for stage in ['resumesUploaded','atsTotal']:
        first = await pipeline_details(db,'org','job',stage,0,25)
        second = await pipeline_details(db,'org','job',stage,25,25)
        assert first['total'] == second['total'] == 28
        assert len(first['items']) == 25 and len(second['items']) == 3
        assert len({row['id'] for row in first['items'] + second['items']}) == 28
        assert second['items'][-1]['name'] == 'Legacy person'
        assert 'email' not in second['items'][-1]
        assert first['items'][0]['atsScore'] == 0
        assert (await pipeline_details(db,'org','job',stage,28,25))['items'] == []
