"""Synthetic acceptance coverage; never sends provider mail."""
from datetime import timedelta
import pytest
from tests.test_recruitment import client, headers
from app.models.recruitment import now

PATH = '/api/recruitment/applications?jobId=invite-job&invitationCandidates=true'

async def seed(db, start, end):
    for i in range(start, end):
        await db.applicants.insert_one({'orgId':'default','applicantId':f'invite-person{i}','name':f'Candidate {i:03}','email':f'invite{i}@example.test'})
        await db.applications.insert_one({'orgId':'default','applicationId':f'invite-app{i}','applicantId':f'invite-person{i}','jobId':'invite-job','currentStage':'SHORTLISTED','matchScore':i,'createdAt':now(),'assessment':{}})

async def setup(db, count=10):
    await db.jobs.insert_one({'orgId':'default','jobId':'invite-job','assigneeUserId':'recruiter','assessmentJobId':'assessment-A'})
    await seed(db, 0, count)

async def invite(db, i, state='email_sent', delivery='sent', assessment='assessment-A', via='zepto'):
    await db.applications.update_one({'applicationId':f'invite-app{i}'},{'$set':{'assessment':{'assessmentId':assessment,'state':state,'messageId':f'message-{i}','updatedAt':now()}}})
    await db.email_outbox.insert_one({'orgId':'default','messageId':f'message-{i}','kind':'assessment_invite','entityType':'application','entityKey':f'invite-app{i}','assessmentId':assessment,'status':delivery,'sentVia':via,'sentAt':now() if delivery=='sent' else None})

async def rows(client, suffix=''):
    response=await client.get(PATH+suffix,headers=headers('admin'))
    assert response.status_code==200,response.text
    return response.json()

async def test_ten_five_three_acceptance_preserves_history(client, db):
    await setup(db)
    for i in range(5): await invite(db,i)
    assert (await rows(client))['total']==5
    await seed(db,10,13)
    result=await rows(client)
    assert result['total']==8 and result['eligibleTotal']==8
    assert {row['applicationId'] for row in result['items']}=={f'invite-app{i}' for i in range(5,13)}
    shown=await rows(client,'&includeInvitedCandidates=true')
    assert shown['total']==13 and shown['eligibleTotal']==8
    assert sum(row['invitation']['status']=='invited' for row in shown['items'])==5
    assert all(not row['invitation']['canInvite'] for row in shown['items'] if row['invitation']['status']=='invited')
    assert (await rows(client))['total']==8
    assert await db.applications.count_documents({'jobId':'invite-job'})==13
    assert await db.email_outbox.count_documents({'kind':'assessment_invite'})==5

async def test_filter_precedes_paging_search_and_sort_and_is_assessment_scoped(client, db):
    await setup(db,65)
    for i in range(5): await invite(db,i)
    first=await rows(client,'&sortBy=name&limit=10')
    second=await rows(client,'&sortBy=name&skip=10&limit=10')
    assert first['total']==second['total']==60
    assert first['items'][0]['candidate']['name']=='Candidate 005'
    assert second['items'][0]['candidate']['name']=='Candidate 015'
    assert (await rows(client,'&search=Candidate%20000'))['total']==0
    assert (await rows(client,'&includeInvitedCandidates=true&search=Candidate%20000'))['total']==1
    ranged=await rows(client,'&scoreField=ats&minimum=10&maximum=20&sortBy=ats&descending=true')
    assert ranged['total']==11 and ranged['items'][0]['atsScore']==20
    await db.jobs.update_one({'jobId':'invite-job'},{'$set':{'assessmentJobId':'assessment-B'}})
    switched=await rows(client)
    assert switched['total']==65 and switched['eligibleTotal']==65
    assert all(row['invitation']['status']=='not_invited' for row in switched['items'])
    assert all(row['invitationDelivery'] is None for row in switched['items'])
    assert (await client.get(PATH,headers=headers('technical_interviewer',uid='other-tech',org='other'))).status_code==404

async def test_pending_failed_dry_run_and_link_only_are_distinct(client, db):
    await setup(db)
    await invite(db,0,'email_queued','pending',via=None)
    await invite(db,1,'email_queued','failed',via=None)
    await invite(db,2,'email_queued','sent',via='dry_run')
    await db.applications.update_one({'applicationId':'invite-app3'},{'$set':{'assessment':{'assessmentId':'assessment-A','state':'link_created'}}})
    await db.applications.update_one({'applicationId':'invite-app4'},{'$set':{'assessment':{'assessmentId':'assessment-A','state':'failed'}}})
    visible=await rows(client)
    assert visible['total']==8 and visible['eligibleTotal']==7
    failed=next(row for row in visible['items'] if row['applicationId']=='invite-app1')
    assert failed['invitation']['status']=='failed' and not failed['invitation']['canInvite']
    assert failed['invitationDelivery']['retryId']=='message-1'
    all_rows=await rows(client,'&includeInvitedCandidates=true')
    indexed={row['applicationId']:row for row in all_rows['items']}
    assert indexed['invite-app0']['invitation']['status']=='pending'
    assert indexed['invite-app2']['invitation']['status']=='pending'
    assert indexed['invite-app3']['invitation']['status']=='not_invited'
    assert indexed['invite-app4']['invitation']['canInvite']
    assert (await rows(client,'&invitationStatus=failed'))['total']==2
