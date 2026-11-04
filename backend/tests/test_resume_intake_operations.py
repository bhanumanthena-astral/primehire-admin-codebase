"""Recovery, permissions and post-confirmation behavior under realistic failures."""
from datetime import timedelta
import pytest
from tests.test_resume_intake_v2 import client, headers, upload, drain, first, reveal, confirm_http, workbook, word, select_range
from app.models.resume_intake import now
from app.services import resume_intake_review as review_service
from app.services.resume_intake_jobs import reconcile
from app.services.resume_intake_retention import sweep
from app.services.storage import resolve_storage_key


async def ready(client, db):
    response = await upload(client)
    await drain(db)
    return await reveal(client, await first(client, response.json()['batchId']))


async def completed(client, db):
    item = await ready(client, db)
    await confirm_http(client, item)
    await drain(db)
    return await reveal(client, await first(client, item['batchId']))


async def test_review_revision_conflicts_edits_and_stale_ats(client, db):
    item = await ready(client, db)
    profile = {**item['profile'], 'name': 'Corrected Candidate'}
    path = f"/api/resume-intake/items/{item['itemId']}"
    saved = await client.put(path+'/review',json={'expectedRevision':item['revision'],'profile':profile},headers=headers())
    assert saved.status_code == 200
    stale = await client.put(path+'/review',json={'expectedRevision':item['revision'],'profile':profile},headers=headers())
    assert stale.status_code == 409
    await confirm_http(client, saved.json()); await drain(db)
    item = await reveal(client, await first(client,item['batchId']))
    edit = await client.put(path+'/profile',json={'expectedRevision':item['revision'],'profile':{**profile,'skills':['Chemistry']}},headers=headers())
    assert edit.status_code == 200
    detail = (await client.get(path,headers=headers())).json()
    assert detail['atsStale']
    result = await client.post(path+'/recalculate',json={'expectedRevision':edit.json()['revision']},headers=headers())
    assert result.status_code == 200 and not result.json()['atsStale']
    assert result.json()['ats']['breakdown']['skills'] == 0
    assert (await db['applications'].find_one({}))['currentStage'] == 'PARSED'


async def test_persistence_failure_preserves_application_and_retries_after_job_closes(client, db, monkeypatch):
    item = await ready(client, db)
    from app.models.resume_intake import IntakeRepository
    original = IntakeRepository.patch_item
    async def fail(self, item_id, org, changes, revision=None):
        if changes.get('status') == 'completed':
            raise OSError('Synthetic ledger persistence failure')
        return await original(self,item_id,org,changes,revision)
    monkeypatch.setattr(IntakeRepository,'patch_item',fail)
    await confirm_http(client,item); await drain(db)
    paused = await first(client,item['batchId'])
    assert paused['status'] == 'confirmation_paused'
    assert await db['applicants'].count_documents({}) == 1
    assert await db['applications'].count_documents({}) == 1
    await db['jobs'].update_one({'jobId':'a'},{'$set':{'lifecycleStatus':'CLOSED'}})
    monkeypatch.setattr(IntakeRepository,'patch_item',original)
    retried = await client.post(f"/api/resume-intake/items/{item['itemId']}/retry",json={'expectedRevision':paused['revision']},headers=headers())
    assert retried.status_code == 200
    await drain(db)
    assert (await first(client,item['batchId']))['status'] == 'completed'
    assert await db['applications'].count_documents({}) == 1
    assert await db['stage_history'].count_documents({}) == 1
    assert await db['audit_log'].count_documents({'action':'resume_intake.confirm'}) == 1


async def test_confirmation_enqueue_crash_window_is_repaired(client, db, monkeypatch):
    item = await ready(client,db)
    from app.models.jobs import BackgroundJobRepository
    original = BackgroundJobRepository.enqueue
    async def broken(self,**kwargs):
        if kwargs['kind'] == 'resume_intake_confirm':
            raise OSError('Synthetic queue failure')
        return await original(self,**kwargs)
    monkeypatch.setattr(BackgroundJobRepository,'enqueue',broken)
    with pytest.raises(OSError):
        await confirm_http(client,item)
    assert (await first(client,item['batchId']))['status'] == 'confirming'
    monkeypatch.setattr(BackgroundJobRepository,'enqueue',original)
    assert await reconcile(db) >= 1
    await drain(db)
    assert (await first(client,item['batchId']))['status'] == 'completed'


async def test_association_notes_versions_assignment_and_admin_delete(client, db):
    item = await completed(client,db)
    path = f"/api/resume-intake/items/{item['itemId']}"
    note = await client.post(path+'/notes',json={'text':'Reviewer checked extracted skills.'},headers=headers())
    assert note.status_code == 201
    reviewer = await client.post(path+'/assign',json={'userId':'technical_interviewer','expectedRevision':item['revision']},headers=headers('admin'))
    assert reviewer.status_code == 200
    assert (await db['applications'].find_one({}))['assignedReviewers'] == ['technical_interviewer']
    clone = await client.post(path+'/associate',json={'jobId':'b'},headers=headers())
    assert clone.status_code == 202
    assert await db['applications'].count_documents({}) == 1
    await confirm_http(client,await reveal(client,clone.json()))
    await drain(db)
    assert await db['applicants'].count_documents({}) == 1
    assert await db['applications'].count_documents({}) == 2
    versions = (await client.get(path+'/versions',headers=headers())).json()['items']
    assert len(versions) == 2
    assert all('storageKey' not in version for version in versions)
    revision = (await client.get(path,headers=headers())).json()['revision']
    denied = await client.request('DELETE',path,json={'expectedRevision':revision,'reason':'Privacy request'},headers=headers())
    assert denied.status_code == 403
    deleted = await client.request('DELETE',path,json={'expectedRevision':revision,'reason':'Privacy request'},headers=headers('super_admin'))
    assert deleted.status_code == 200
    assert (await client.get(path+'/download',headers=headers())).status_code == 409
    assert await db['applications'].count_documents({}) == 2


async def test_resume_versions_filter_permissions_before_pagination(client, db):
    item = await completed(client, db)
    base = await db['resume_intake_items'].find_one({'_id':item['itemId']})
    for index in range(24):
        clone = {**base, '_id':f'version-{index:02}', 'rowNumber':index+2, 'jobId':'a' if index % 2 else 'recruiter-job'}
        await db['resume_intake_items'].insert_one(clone)
    path = f"/api/resume-intake/items/{item['itemId']}/versions"
    first_page = (await client.get(path+'?limit=5', headers=headers())).json()
    assert len(first_page['items']) == 5 and first_page['hasMore']
    second = (await client.get(path+'?limit=5&skip=5', headers=headers())).json()
    assert len(second['items']) == 5 and second['hasMore']
    last = (await client.get(path+'?limit=5&skip=10', headers=headers())).json()
    assert len(last['items']) == 3 and not last['hasMore']
    assert len({r['itemId'] for r in first_page['items']+second['items']+last['items']}) == 13
    assert all('storageKey' not in row for row in first_page['items'])
    assert (await client.get(path, headers=headers('technical_interviewer'))).status_code == 403


async def test_settings_revision_viewer_download_policy_and_active_actor(client, db):
    response = await upload(client,job='viewer-job',role='super_admin')
    await drain(db)
    item = (await client.get(f"/api/resume-intake/batches/{response.json()['batchId']}",headers=headers('super_admin'))).json()['items'][0]
    path = f"/api/resume-intake/items/{item['itemId']}/download"
    assert (await client.get(path,headers=headers('viewer'))).status_code == 403
    caps = (await client.get('/api/resume-intake/capabilities',headers=headers('admin'))).json()
    body = {'expectedRevision':0,'settings':{**caps['limits'],'viewerDownloads':True}}
    assert (await client.put('/api/resume-intake/settings',json=body,headers=headers())).status_code == 403
    assert (await client.put('/api/resume-intake/settings',json=body,headers=headers('admin'))).status_code == 200
    assert (await client.put('/api/resume-intake/settings',json=body,headers=headers('admin'))).status_code == 409
    assert (await client.get(path,headers=headers('viewer'))).status_code == 200
    await db['users'].update_one({'userId':'viewer'},{'$set':{'isActive':False}})
    assert (await client.get(path,headers=headers('viewer'))).status_code == 401


async def test_retention_only_removes_referenced_v2_originals_and_private_drafts(client, db, tmp_path):
    item = await ready(client,db)
    stored = await db['resume_intake_items'].find_one({'_id':item['itemId']})
    original = resolve_storage_key(stored['storageKey'])
    sentinel = original.parent/'unrelated-v1-sentinel.txt'
    sentinel.write_text('Unreferenced file must survive')
    await db['resume_intake_items'].update_one({'_id':item['itemId']},{'$set':{'retentionUntil':now()-timedelta(days=1)}})
    assert await sweep(db) == 1
    assert sentinel.is_file() and not original.exists()
    fresh = await db['resume_intake_items'].find_one({'_id':item['itemId']})
    assert fresh['profile'] == {} and fresh['rawText'] == '' and fresh['status'] == 'deleted'
    assert (await client.get(f"/api/resume-intake/items/{item['itemId']}",headers=headers())).status_code == 410


async def test_bulk_approval_processes_valid_rows_only(client, db):
    data = workbook([['Bulk Candidate','bulk@example.com','','','Python'],['Invalid Candidate','invalid','','','SQL']])
    response = await upload(client,data,mode='excel',name='bulk.xlsx',mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    await drain(db)
    batch_id = response.json()['batchId']
    await select_range(client,batch_id)
    approval = await client.post(f'/api/resume-intake/batches/{batch_id}/confirm',json={'reviewed':True},headers=headers())
    assert approval.status_code == 202
    from app.services.worker import run_once
    for _ in range(10):
        if not await run_once(db,kinds=['resume_intake_bulk_confirm','resume_intake_confirm']):
            break
    assert await db['applications'].count_documents({}) == 1
    assert (await db['resume_intake_batches'].find_one({'_id':batch_id}))['bulkApprovalResult'] == {'queued':1,'skipped':0}
