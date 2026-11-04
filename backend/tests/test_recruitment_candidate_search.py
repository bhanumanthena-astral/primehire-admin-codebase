"""Literal name/email filtering stays inside job, org and contact permissions."""
from tests.test_recruitment import client, headers, create


async def test_search_name_or_email_before_pagination(client, db):
    await db['applicants'].update_one({'applicantId':'person0'}, {'$set':{'email':'alex+test@example.test'}})
    for search in ['synthetic%20candidate%200', 'ALEX%2BTEST%40EXAMPLE.TEST', '%20alex%2Btest%20']:
        result=await client.get('/api/recruitment/applications?jobId=job&search='+search,headers=headers())
        assert result.status_code==200,result.text
        assert result.json()['total']==1
        assert result.json()['items'][0]['applicationId']=='app0'
    result=await client.get('/api/recruitment/applications?jobId=job&search=example.test&skip=1&limit=1',headers=headers())
    assert result.json()['total']==3 and len(result.json()['items'])==1
    result=await client.get('/api/recruitment/applications?jobId=other-job&search=example.test',headers=headers())
    assert result.json()['total']==0


async def test_search_regex_is_literal_and_foreign_candidate_rows_are_excluded(client, db):
    await db['applicants'].insert_one({'orgId':'other','applicantId':'person0','name':'Foreign Candidate','email':'private@elsewhere.test'})
    for search in ['.*','private%40elsewhere.test']:
        result=await client.get('/api/recruitment/applications?jobId=job&search='+search,headers=headers())
        assert result.json()['total']==0


async def test_email_search_requires_contact_access(client):
    await create(client)
    result=await client.get('/api/recruitment/applications?jobId=job&search=person0%40example.test',headers=headers('technical_interviewer'))
    assert result.status_code==200 and result.json()['total']==0
    result=await client.get('/api/recruitment/applications?jobId=job&search=Synthetic%20Candidate%200',headers=headers('technical_interviewer'))
    assert result.json()['total']==1
