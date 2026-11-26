from tests.test_recruitment import client, headers, schedule


async def assign(client, **extra):
    return await client.put('/api/recruitment/access/technical_interviewer', headers=headers(), json={
        'visibleFields': ['assessment', 'skills'], 'reviewJobIds': ['job'],
        'portalName': 'Backend Developer', 'reason': 'Assign assessment review', **extra})


async def test_developer_review_handoff(client, db):
    tech = headers('technical_interviewer')
    assert (await client.get('/api/recruitment/applications', headers=tech)).json()['total'] == 3
    assert (await client.post('/api/recruitment/applications/app0/shortlist', headers=tech)).status_code == 403
    assert (await assign(client)).status_code == 200
    assert (await client.get('/api/recruitment/capabilities', headers=tech)).json()['portalName'] == 'Backend Developer'
    jobs = (await client.get('/api/recruitment/jobs', headers=tech)).json()['items']
    assert jobs[0]['jdText'] == 'Build Python services'
    assert (await client.get('/api/recruitment/applications', headers=tech)).json()['total'] == 3
    pending = '/api/recruitment/applications?schedulingRound=technical'
    assert (await client.get(pending, headers=headers())).json()['total'] == 0
    blocked = await client.post('/api/recruitment/interviews', headers=headers(), json=schedule())
    assert blocked.status_code == 409, blocked.text
    response = await client.post('/api/recruitment/applications/app0/shortlist', headers=tech)
    assert response.status_code == 200, response.text
    assert (await client.post('/api/recruitment/applications/app0/shortlist', headers=tech)).status_code == 409
    rows = (await client.get(pending, headers=headers())).json()['items']
    assert len(rows) == 1 and rows[0]['developerShortlist']['userId'] == 'technical_interviewer'
    assert await db.stage_history.count_documents({'applicationId': 'app0', 'toStage': 'ROUND1_PENDING_ASSIGNMENT'}) == 1
    await db.users.insert_one({'orgId':'default','userId':'second-tech','role':'technical_interviewer','isActive':True})
    wrong = await client.post('/api/recruitment/interviews', headers=headers('admin'), json=schedule(interviewerId='second-tech'))
    assert wrong.status_code == 422
    assert (await client.get(pending, headers=headers('admin'))).json()['total'] == 1
    booked = await client.post('/api/recruitment/interviews', headers=headers(), json=schedule())
    assert booked.status_code == 201, booked.text


async def test_review_scope_and_revocation(client, db):
    from app.services.reporting import scope, catalog_scope
    from types import SimpleNamespace
    from app.security.roles import get_permissions_for_role
    await assign(client)
    await db.jobs.insert_one({'orgId': 'other', 'jobId': 'secret', 'title': 'Secret'})
    assert (await assign(client, reviewJobIds=['secret'], expectedRevision=1)).status_code == 422
    assert (await client.post('/api/recruitment/applications/app0/shortlist', headers=headers('managerial_interviewer'))).status_code in {403, 404}
    actor = SimpleNamespace(role='technical_interviewer', org_id='default', user_id='technical_interviewer', permissions=get_permissions_for_role('technical_interviewer'))
    assert await db.applications.count_documents(await scope(db, actor)) == 3
    await db.report_catalog.insert_one({'orgId':'default','jobId':'job','applicationId':'app0','reportId':'r'})
    assert await db.report_catalog.count_documents(await catalog_scope(db, actor)) == 1
    assert (await assign(client, reviewJobIds=[], expectedRevision=1)).status_code == 200
    # The independent job assignment continues to grant read-only report access.
    assert await db.applications.count_documents(await scope(db, actor)) == 3
    await db.jobs.update_one({'jobId': 'job'}, {'$unset': {'assignedDeveloperUserId': ''}})
    assert await db.applications.count_documents(await scope(db, actor)) == 0
    assert (await client.post('/api/recruitment/applications/app0/shortlist', headers=headers('technical_interviewer'))).status_code == 404


async def test_assessment_permission_required(client):
    await assign(client, visibleFields=['skills'])
    assert (await client.post('/api/recruitment/applications/app0/shortlist', headers=headers('technical_interviewer'))).status_code == 403
