"""Human score bands, retained exclusions, stale approvals and isolated scoring."""
import pytest
from pydantic import ValidationError
from app.schemas.resume_intake import AtsRangeRequest
from app.services import resume_intake_llm as ats
from app.services.resume_intake_ats import score
from tests.test_resume_intake_v2 import client, headers, upload, drain, reveal, select_range, workbook


@pytest.fixture
def scored(monkeypatch):
    calls = []
    async def evaluate(db, org, profile, text, job, limits, reference, **kwargs):
        calls.append(reference)
        result = score(profile, text, job, limits)
        result.update(overall=int(profile['name'].split()[-1]), llmStatus='not_configured')
        return result
    monkeypatch.setattr(ats, 'evaluate', evaluate)
    return calls


async def batch_rows(client, db):
    rows = [[f'Candidate {value}', f'person{value}@example.com', '', '', 'Python'] for value in [45, 50, 70, 90, 95]]
    received = await upload(client, workbook(rows), mode='excel', name='scores.xlsx', mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert received.status_code == 202
    await drain(db)
    batch_id = received.json()['batchId']
    return batch_id, f'/api/resume-intake/batches/{batch_id}'


async def confirm_row(client, row, revision):
    full = await reveal(client, row)
    return await client.post(f'/api/resume-intake/items/{row["itemId"]}/confirm', headers=headers(), json={
        'profile':full['profile'], 'expectedRevision':full['revision'], 'atsRangeRevision':revision})


async def test_two_ended_range_retains_all_resumes_and_lowering_to_50_reuses_scores(client, db, scored):
    batch_id, path = await batch_rows(client, db)
    before = (await client.get(path, headers=headers())).json()
    assert all(row['atsSelection']['state'] == 'range_required' for row in before['items'])
    assert scored == []
    assert (await confirm_row(client, before['items'][0], 0)).status_code == 409
    await select_range(client, batch_id, 70, 90)
    result = (await client.get(path, headers=headers())).json()
    assert result['batch']['atsStats'] == {'within':2,'below':2,'above':1,'pending':0}
    assert result['total'] == 5
    assert len(scored) == 5
    assert await db['applicants'].count_documents({}) == 0
    assert await db['applications'].count_documents({}) == 0
    below = (await client.get(path+'?scoreBand=below', headers=headers())).json()
    assert below['total'] == 2
    assert all(row['atsSelection']['state'] == 'below' for row in below['items'])
    assert (await confirm_row(client, below['items'][1], 1)).status_code == 422
    await select_range(client, batch_id, 50, 90)
    result = (await client.get(path, headers=headers())).json()
    assert result['batch']['atsStats'] == {'within':3,'below':1,'above':1,'pending':0}
    assert len(scored) == 5  # Slider changes do not reparse or spend ATS provider quota.
    assert (await confirm_row(client, result['items'][1], 1)).status_code == 409
    assert (await confirm_row(client, result['items'][1], 2)).status_code == 202
    await drain(db)
    assert await db['applicants'].count_documents({}) == 1
    assert await db['resume_intake_items'].count_documents({}) == 5
    assert await db['email_outbox'].count_documents({}) == 0
    assert (await client.get(path+'?scoreBand=above', headers=headers())).json()['total'] == 1


async def test_bulk_creates_only_inclusive_band_and_stale_approval_is_blocked(client, db, scored):
    batch_id, path = await batch_rows(client, db)
    await select_range(client, batch_id, 50, 90)
    # Batch approval accepts extracted profiles without individual review.
    await db['resume_intake_items'].update_many({'batchId':batch_id}, {'$set':{'confidence.name':'review'}, '$unset':{'reviewedBy':''}})
    response = await client.post(path+'/confirm', json={'reviewed':True,'atsRangeRevision':1}, headers=headers())
    assert response.status_code == 202
    from app.services.worker import run_once
    for _ in range(15):
        if not await run_once(db, kinds=['resume_intake_bulk_confirm','resume_intake_confirm']):break
    assert await db['applications'].count_documents({}) == 3
    assert await db['resume_intake_items'].count_documents({'status':'review_required'}) == 2
    assert {row['matchScore'] async for row in db['applications'].find({})} == {50,70,90}
    await select_range(client, batch_id, 0, 100)
    assert (await client.post(path+'/confirm', json={'reviewed':True,'atsRangeRevision':1}, headers=headers())).status_code == 409


async def test_changed_range_pauses_queued_creation_until_explicit_retry(client, db, scored):
    batch_id, path = await batch_rows(client, db)
    await select_range(client, batch_id, 0, 100)
    rows = (await client.get(path, headers=headers())).json()['items']
    assert (await confirm_row(client, rows[1], 1)).status_code == 202
    response = await client.put(path+'/ats-range', json={'minimum':60,'maximum':100,'expectedRevision':1}, headers=headers())
    assert response.status_code == 200
    await drain(db)
    item = await db['resume_intake_items'].find_one({'_id':rows[1]['itemId']})
    assert item['status'] == 'confirmation_paused'
    assert await db['applicants'].count_documents({}) == 0
    retry_path = f'/api/resume-intake/items/{item["_id"]}/retry'
    assert (await client.post(retry_path, json={'expectedRevision':item['revision']}, headers=headers())).status_code == 422
    await select_range(client, batch_id, 50, 100)
    assert (await client.post(retry_path, json={'expectedRevision':item['revision']}, headers=headers())).status_code == 200
    await drain(db)
    assert await db['applications'].count_documents({}) == 1


async def test_job_and_profile_changes_require_current_scores(client, db, scored):
    batch_id, path = await batch_rows(client, db)
    await select_range(client, batch_id, 0, 100)
    row = (await client.get(path, headers=headers())).json()['items'][1]
    await db['jobs'].update_one({'jobId':'a'}, {'$set':{'keywords':['Java']}})
    assert (await confirm_row(client, row, 1)).status_code == 409
    assert (await client.get(path+'?scoreBand=pending', headers=headers())).json()['total'] == 5
    await select_range(client, batch_id, 0, 100)
    full = await reveal(client, row)
    changed = {**full['profile'], 'skills':['Java']}
    assert (await client.post(f'/api/resume-intake/items/{row["itemId"]}/confirm', headers=headers(), json={
        'expectedRevision':full['revision'],'profile':changed,'atsRangeRevision':2})).status_code == 409
    saved = await client.put(f'/api/resume-intake/items/{row["itemId"]}/review', headers=headers(), json={
        'expectedRevision':full['revision'],'profile':changed})
    assert saved.status_code == 200 and not saved.json()['atsSelection']['eligible']
    await drain(db)
    assert (await client.get(f'/api/resume-intake/items/{row["itemId"]}',headers=headers())).json()['atsSelection']['eligible']


async def test_only_uploader_or_admin_can_set_range_with_scope_and_revision_checks(client, db):
    batch_id, path = await batch_rows(client, db)
    body = {'minimum':50,'maximum':100,'expectedRevision':0}
    await db['resume_intake_batches'].update_one({'_id':batch_id}, {'$set':{'createdBy':'someone-else'}})
    assert (await client.put(path+'/ats-range',json=body,headers=headers())).status_code == 403
    assert (await client.put(path+'/ats-range',json=body,headers=headers('viewer'))).status_code == 403
    assert (await client.put(path+'/ats-range',json=body,headers=headers(org='other',uid='other'))).status_code == 404
    assert (await client.put(path+'/ats-range',json=body,headers=headers('admin'))).status_code == 200
    assert (await client.put(path+'/ats-range',json=body,headers=headers('admin'))).status_code == 409


async def test_failed_scoring_never_creates_profiles_and_can_be_retried(client, db, monkeypatch, scored):
    batch_id, path = await batch_rows(client, db)
    original = ats.evaluate
    async def broken(*args, **kwargs):raise OSError('Synthetic provider/scoring failure')
    monkeypatch.setattr(ats, 'evaluate', broken)
    await select_range(client, batch_id)
    result = (await client.get(path,headers=headers())).json()
    assert all(row['atsSelection']['state']=='score_failed' for row in result['items'])
    assert await db['applicants'].count_documents({}) == 0
    row = result['items'][0]
    assert (await confirm_row(client,row,1)).status_code == 409
    monkeypatch.setattr(ats, 'evaluate', original)
    assert (await client.post(f'/api/resume-intake/items/{row["itemId"]}/score',headers=headers(),json={'expectedRevision':row['revision']})).status_code == 200
    await drain(db)
    assert (await client.get(f'/api/resume-intake/items/{row["itemId"]}',headers=headers())).json()['atsSelection']['eligible']


async def test_name_correction_reuses_score_and_reverting_technical_edits_cannot_stick_in_queue(client, db, scored):
    batch_id, path = await batch_rows(client, db)
    await select_range(client, batch_id)
    row = (await client.get(path, headers=headers())).json()['items'][1]
    full = await reveal(client, row)
    review_path = f'/api/resume-intake/items/{row["itemId"]}/review'
    corrected = {**full['profile'], 'name':'Corrected Candidate 50'}
    saved = await client.put(review_path, headers=headers(), json={'expectedRevision':full['revision'],'profile':corrected})
    assert saved.status_code == 200
    assert saved.json()['atsState'] == 'done' and saved.json()['atsSelection']['eligible']
    assert len(scored) == 5
    changed = await client.put(review_path, headers=headers(), json={
        'expectedRevision':saved.json()['revision'],'profile':{**corrected,'skills':['Java']}})
    assert changed.json()['atsState'] == 'queued'
    await drain(db)
    reverted = await client.put(review_path, headers=headers(), json={
        'expectedRevision':changed.json()['revision'],'profile':corrected})
    assert reverted.json()['atsState'] == 'queued'
    await drain(db)
    current = (await client.get(f'/api/resume-intake/items/{row["itemId"]}', headers=headers())).json()
    assert current['atsState'] == 'done' and current['atsSelection']['eligible']
    assert len(scored) == 7
    assert await db['applicants'].count_documents({}) == 0


async def test_range_queue_crash_window_is_reconciled_without_candidate_creation(client, db, scored, monkeypatch):
    from app.models.jobs import BackgroundJobRepository
    from app.services.resume_intake_jobs import reconcile
    batch_id, path = await batch_rows(client, db)
    original = BackgroundJobRepository.enqueue
    async def broken(self, **kwargs):
        if kwargs['kind'] == 'resume_intake_score_batch':raise OSError('Synthetic queue outage')
        return await original(self, **kwargs)
    monkeypatch.setattr(BackgroundJobRepository, 'enqueue', broken)
    with pytest.raises(OSError):
        await client.put(path+'/ats-range', headers=headers(), json={'minimum':50,'maximum':100,'expectedRevision':0})
    assert (await db['resume_intake_batches'].find_one({'_id':batch_id}))['atsScoringRequested']
    monkeypatch.setattr(BackgroundJobRepository, 'enqueue', original)
    assert await reconcile(db) >= 1
    await drain(db)
    current = (await client.get(path, headers=headers())).json()
    assert current['batch']['atsStats']['within'] == 4
    assert await db['applicants'].count_documents({}) == 0


@pytest.mark.parametrize('minimum,maximum', [(-1,100),(0,101),(70,50),(True,100),(50.5,100)])
def test_range_rejects_invalid_or_coerced_endpoints(minimum, maximum):
    with pytest.raises(ValidationError):AtsRangeRequest(minimum=minimum,maximum=maximum,expectedRevision=0)


@pytest.mark.parametrize('minimum,maximum', [(0,0),(0,100),(50,50),(100,100)])
def test_range_accepts_zero_full_and_equal_endpoints(minimum, maximum):
    assert AtsRangeRequest(minimum=minimum,maximum=maximum,expectedRevision=0).minimum == minimum


async def test_additive_migration_refuses_v1_and_is_idempotent():
    from mongomock_motor import AsyncMongoMockClient
    from migrations.resume_ats_range_v2 import upgrade
    db = AsyncMongoMockClient()
    with pytest.raises(RuntimeError):await upgrade(db['primehire_admin'])
    target = db['primehire_admin_v2']
    assert (await upgrade(target,dry_run=True))['backfill'] is False
    await upgrade(target); await upgrade(target)
    assert await target['migrations'].count_documents({}) == 1


async def test_reconciliation_with_an_old_queued_snapshot_cannot_reopen_a_completed_score(client, db, scored):
    from app.services.resume_intake_selection import enqueue_score
    batch_id, path = await batch_rows(client, db)
    await select_range(client, batch_id)
    stored = await db['resume_intake_items'].find_one({'batchId':batch_id})
    job = await db['jobs'].find_one({'jobId':'a'})
    await enqueue_score(db,{**stored,'atsState':'queued'},job)
    current = await db['resume_intake_items'].find_one({'_id':stored['_id']})
    assert current['atsState'] == 'done' and current['atsStale'] is False
    await drain(db)
    assert len(scored) == 5
