"""Repair may update suggestions, never human-reviewed or confirmed candidates."""
from datetime import timedelta
import pytest
from app.models.resume_intake import now
from app.services.resume_skill_repair import repair_job

async def seed(db):
    await db.jobs.insert_one({'orgId':'a','jobId':'target','jobKey':'REFERENCE','keywords':['Python']})
    for key,changes in [('ready',{}),('reviewed',{'reviewedBy':'human'}),('completed',{'status':'completed','applicationId':'app'}),('other-job',{'jobId':'other'}),('expired',{'retentionUntil':now()-timedelta(days=1)})]:
        await db.resume_intake_items.insert_one({'_id':key,'orgId':'a','jobId':'target','batchId':'batch','revision':1,'status':'review_required','profile':{'name':'Synthetic','email':'synthetic@example.test','skills':[]},'rawText':'Skills: Python, GitHub, JWT','retentionUntil':now()+timedelta(days=1),**changes})

async def test_repair_scopes_protects_edits_keeps_revisions_and_is_idempotent(db):
    await seed(db)
    assert (await repair_job(db,'REFERENCE'))['eligible']==1
    assert (await db.resume_intake_items.find_one({'_id':'ready'}))['revision']==1
    with pytest.raises(ValueError):await repair_job(db,'REFERENCE',apply=True,expected_count=2)
    result=await repair_job(db,'REFERENCE',apply=True,expected_count=1)
    assert result['updated']==1
    row=await db.resume_intake_items.find_one({'_id':'ready'})
    assert {'Python','GitHub','JWT'}<=set(row['profile']['skills'])
    assert row['revision']==2 and row['status']=='review_required'
    assert row['ats']['breakdown']['skills']==100 and row['ats']['llmStatus']=='not_requested'
    for key in ['reviewed','completed','other-job','expired']:
        assert (await db.resume_intake_items.find_one({'_id':key}))['revision']==1
    assert (await repair_job(db,'REFERENCE',apply=True,expected_count=0))['updated']==0
    assert await db.applications.count_documents({})==0
