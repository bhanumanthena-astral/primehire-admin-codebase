"""Multiple transport chunks must not limit one job's ATS review."""
from tests.test_resume_ats_range import client, headers, batch_rows, scored, drain, workbook
from tests.test_resume_intake_v2 import upload
from app.services.worker import run_once


async def make_two_batches(client, db):
    first, _ = await batch_rows(client, db)
    response = await upload(client, workbook([[f'Candidate {n}', f'other{n}@example.com', '', '', 'Python'] for n in [45, 70, 95]]),
        mode='excel', name='second.xlsx', key='second-upload-key', mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert response.status_code == 202, response.text
    await drain(db)
    return first, response.json()['batchId']


async def test_job_range_and_confirmation_cover_all_chunks_and_preserve_exclusions(client, db, scored):
    await make_two_batches(client, db)
    path = '/api/resume-intake/jobs/a/ats-review'
    before = (await client.get(path, headers=headers())).json()
    assert before['batches'] == 2 and before['counts']['range_required'] == 8
    body = {'minimum': 60, 'maximum': 90, 'expectedSnapshot': before['snapshot']}
    response = await client.put(path, json=body, headers=headers())
    assert response.status_code == 200, response.text
    assert await db.applications.count_documents({}) == 0
    assert (await client.put(path, json=body, headers=headers())).status_code == 409
    await drain(db, limit=150)
    ready = (await client.get(path, headers=headers())).json()
    assert ready['counts']['within'] == 3 and ready['counts']['below'] == 3 and ready['counts']['above'] == 2
    body['expectedSnapshot'] = ready['snapshot']
    assert (await client.post(path+'/confirm', json=body, headers=headers())).status_code == 422
    body['reviewed'] = True
    queued = await client.post(path+'/confirm', json=body, headers=headers())
    assert queued.status_code == 202 and queued.json()['batches'] == 2, queued.text
    for _ in range(50):
        if await run_once(db, kinds=['resume_intake_bulk_confirm','resume_intake_confirm']) is None:
            break
    assert await db.applications.count_documents({'jobId':'a'}) == 3
    assert await db.resume_intake_items.count_documents({'status':'review_required'}) == 5
    assert await db.outbox.count_documents({}) == 0
    # Replaying the same review does not create duplicate applications.
    assert (await client.post(path+'/confirm', json=body, headers=headers())).status_code == 202
    for _ in range(50):
        if await run_once(db, kinds=['resume_intake_bulk_confirm','resume_intake_confirm']) is None:break
    assert await db.applications.count_documents({'jobId':'a'}) == 3


async def test_job_review_permissions_concurrency_pending_and_bounds(client, db, scored):
    first, second = await make_two_batches(client, db)
    path = '/api/resume-intake/jobs/a/ats-review'
    assert (await client.get(path, headers=headers(role='viewer'))).status_code == 403
    assert (await client.get(path, headers=headers(org='other',uid='other'))).status_code in {403,404}
    await db.resume_intake_batches.update_one({'_id': second},{'$set':{'createdBy':'admin'}})
    overview = (await client.get(path, headers=headers())).json()
    assert overview['batches'] == 1
    body = {'minimum':60,'maximum':90,'expectedSnapshot':overview['snapshot']}
    assert (await client.put(path,json={**body,'minimum':95},headers=headers())).status_code == 422
    assert (await client.put(path,json=body,headers=headers())).status_code == 200
    pending = (await client.get(path,headers=headers())).json()
    assert (await client.post(path+'/confirm',json={**body,'expectedSnapshot':pending['snapshot'],'reviewed':True},headers=headers())).status_code == 409
    untouched = await db.resume_intake_batches.find_one({'_id':second})
    assert not untouched.get('atsRange')
    admin = (await client.get(path,headers=headers(role='admin'))).json()
    assert admin['batches'] == 2
    assert await db.applicants.count_documents({}) == 0
