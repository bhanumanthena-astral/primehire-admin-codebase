"""Booked candidate cards and shared rescheduling state stay scoped and current."""
from datetime import timedelta
from app.models.recruitment import now
from tests.test_recruitment import client,headers,create,schedule,review


async def cards(client,role='super_admin'):
    response=await client.get('/api/recruitment/applications',headers=headers(role))
    assert response.status_code==200,response.text
    return {row['applicationId']:row for row in response.json()['items']}


async def test_admin_card_has_active_booking_independent_of_upcoming_filter(client,db):
    booked=await create(client)
    card=(await cards(client))['app0']
    assert card['activeInterview']['interviewId']==booked['interviewId']
    assert card['activeInterview']['interviewerName']=='Test technical_interviewer'
    assert card['activeInterview']['startsAt']==booked['startsAt']
    assert card['activeInterview']['round']=='technical'
    # An interview awaiting its review must stay visible on the admin candidate
    # card even after it falls out of the Upcoming interview list.
    await db['recruit_interviews'].update_one({'interviewId':booked['interviewId']},
        {'$set':{'startsAt':now()-timedelta(hours=2),'endsAt':now()-timedelta(hours=1)}})
    assert (await cards(client))['app0']['activeInterview']
    assert (await client.get('/api/recruitment/interviews?bucket=upcoming',headers=headers())).json()['total']==0
    assert (await cards(client,'recruiter'))['app0']['activeInterview']


async def test_reschedule_reason_and_times_are_shared_by_admin_and_reviewer(client,db):
    booked=await create(client)
    key=booked['interviewId']
    payload=schedule()
    start=now()+timedelta(days=3)
    payload.update(startsAt=start.isoformat(),endsAt=(start+timedelta(hours=1)).isoformat(),
        expectedRevision=booked['revision'],reason='Candidate requested a later slot')
    changed=await client.put('/api/recruitment/interviews/'+key,json=payload,headers=headers())
    assert changed.status_code==200,changed.text
    detail=changed.json()
    event=detail['scheduleChanges'][0]
    assert event['reason']==payload['reason']
    assert event['before']['startsAt']==booked['startsAt']
    assert event['after']['startsAt']==detail['startsAt']
    for role in ['super_admin','recruiter','technical_interviewer']:
        card=(await cards(client,role))['app0']
        assert card['activeInterview']['startsAt']==detail['startsAt']
        assert card['activeInterview']['rescheduleReason']==payload['reason']
        scoped=await client.get('/api/recruitment/interviews/'+key,headers=headers(role))
        assert scoped.json()['scheduleChanges'][0]['reason']==payload['reason']
    assert (await client.get('/api/recruitment/interviews/'+key,headers=headers('managerial_interviewer'))).status_code==404
    assert (await client.get('/api/recruitment/interviews/'+key,headers=headers(org='other'))).status_code==404


async def test_cancelled_and_reviewed_bookings_leave_no_active_card(client,db):
    booked=await create(client)
    response=await client.post(f"/api/recruitment/interviews/{booked['interviewId']}/cancel",
        json={'expectedRevision':booked['revision'],'reason':'Candidate requested cancellation'},headers=headers())
    assert response.status_code==200
    assert (await cards(client))['app0']['activeInterview'] is None
    second=await create(client)
    response=await review(client,db,second)
    assert response.status_code==200,response.text
    assert (await cards(client))['app0']['activeInterview'] is None


async def test_reviewer_interview_list_excludes_other_rounds_for_same_application(client,db):
    technical=await create(client)
    assert (await review(client,db,technical)).status_code==200
    managerial=await create(client,round='managerial')
    response=await client.get('/api/recruitment/interviews?bucket=all',headers=headers('technical_interviewer'))
    assert response.status_code==200,response.text
    assert [row['interviewId'] for row in response.json()['items']]==[technical['interviewId']]
    assert (await cards(client,'technical_interviewer'))['app0']['activeInterview'] is None
    assert (await cards(client,'managerial_interviewer'))['app0']['activeInterview']['interviewId']==managerial['interviewId']
