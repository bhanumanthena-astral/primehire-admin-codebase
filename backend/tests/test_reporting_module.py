"""Reports PRD acceptance: scope, independent statuses, immutable evidence and lineage."""
from copy import deepcopy
from datetime import timedelta
from unittest.mock import AsyncMock
import pytest
from app.models.recruitment import now
from app.services import reporting as service
from app.services.report_content import presentation,generation_status
from tests.test_recruitment import client,headers

BASE='/api/reporting'


def source(**changes):
    value={'interview_details':{'interview_id':'attempt0','candidate_id':'provider0','job_id':'ASSESSMENT','round_type':'TECHNICAL','submitted_at':now().isoformat()},
        'report':{'overall_score':0,'overall_grade':'Stored grade','max_score':20,
            'overall_result':{'technical_analysis':{'overall_score':0,'grade':'T','max_score':20},
                'communication_analysis':{'overall_score':5,'fluency':0,'grammar':10,'max_score':20}},
            'question_wise_result':[{'id':'question1','question':'Explain the source code.','is_result_generated':True,
                'obtained_score':0,'max_score':20,'weightage':0,'video_url':'https://media.example.test/answer.webm',
                'result':{'transcript':'A supplied answer.','relevancy':0,'feedback':'Source feedback.',
                    'strengths':['Question strength'],'recommendations':['Question recommendation']}}],
            'ai_summary':{'strengths':['Source strength'],'areas_for_improvement':['Source improvement'],'recommendations':['Source recommendation']}},
        'faceapi_violations':{'tab_switching':0}}
    value.update(changes)
    return value


async def capture(db,payload=None,**kwargs):
    app=await db.applications.find_one({'orgId':'default','applicationId':'app0'})
    app['assessment']={'interviewId':'attempt0','providerCandidateId':'provider0','submittedAt':now().isoformat()}
    await db.applications.update_one({'orgId':'default','applicationId':'app0'},{'$set':{'assessment':app['assessment']}})
    job=await db.jobs.find_one({'orgId':'default','jobId':'job'})
    await db.jobs.update_one({'orgId':'default','jobId':'job'},{'$set':{'assessmentJobId':'ASSESSMENT','assessmentRoundType':'TECHNICAL'}})
    job.update(assessmentJobId='ASSESSMENT',assessmentRoundType='TECHNICAL')
    return await service.capture(db,app,job,payload,**kwargs)


def test_only_source_values_and_scales_are_present_and_question_analysis_is_unique():
    content=presentation(source(),'TECHNICAL')
    assert content['overview']['value']==0 and content['overview']['maximum']==20
    assert content['overview']['grade']=='Stored grade'
    assert content['questions'][0]['score']==0 and content['questions'][0]['weightage']==0
    assert content['questions'][0]['relevancy']==0 and content['questions'][0]['transcript']=='A supplied answer.'
    assert len(content['questions'])==1
    assert content['feedback'][2]['value'] is None
    assert content['proctoring']['tabSwitching']==0 and content['proctoring']['facesDetected'] is None
    assert content['aiSummary']['strengths']==['Source strength']
    assert all(metric['value'] is None for metric in content['distribution'])


@pytest.mark.parametrize('round_type',['HR','MIXED','UNKNOWN'])
def test_unsupported_schemas_do_not_borrow_technical_metrics(round_type):
    content=presentation(source(),round_type)
    assert not content['schemaSupported']
    assert content['feedback']==content['questions']==content['skillProfile']==[]
    assert content['aiSummary'] is None and content['proctoring'] is None


def test_score_alone_cannot_mark_report_complete_and_optional_missing_metrics_do_not_make_partial():
    content=presentation({'report':{'overall_score':0}},'BASIC')
    assert generation_status({'report':{'overall_score':0}},content,submitted=True)=='Processing'
    assert generation_status({'report':{'overall_score':0}},content,report_available=True)=='Partial'
    content=presentation(source(),'TECHNICAL')
    assert generation_status(source(),content,report_available=True)=='Completed'
    assert generation_status(None,content,submitted=True)=='Processing'
    assert generation_status(None,content)=='Not Started'


async def test_list_detail_filters_context_zero_scores_and_no_raw_video_urls(client,db):
    row=await capture(db,source(),report_available=True,submitted=True)
    response=await client.get(BASE+'/reports',headers=headers(),params={'q':'Synthetic Candidate 0','roundType':'TECHNICAL','status':'Completed','jobId':'job'})
    assert response.status_code==200,response.text
    assert response.json()['total']==1
    metadata=response.json()['items'][0]
    assert metadata['candidateId']=='person0' and metadata['applicationId']=='app0' and metadata['isOfficialAttempt']
    response=await client.get(BASE+'/reports/'+row['reportId'],headers=headers())
    assert response.status_code==200,response.text
    assert response.json()['content']['overview']['value']==0
    assert 'media.example.test' not in response.text and 'source' not in response.json()
    assert (await client.get(BASE+'/reports',headers=headers(),params={'status':'Processing'})).json()['total']==0
    assert (await client.get(BASE+'/reports',headers=headers(),params={'q':'wrong candidate'})).json()['total']==0
    assert (await client.get(BASE+'/reports',headers=headers(),params={'sort':'unsupported'})).status_code==422
    assert (await client.get(BASE+'/reports',headers=headers(),params={'generatedFrom':'2026-01-01T00:00:00'})).status_code==422


async def test_versions_are_idempotent_and_summary_sources_are_immutable(client,db):
    payload=source()
    first=await capture(db,payload,report_available=True,submitted=True)
    again=await capture(db,deepcopy(payload),report_available=True,submitted=True)
    assert again['version']==first['version']==1
    summary=await db.report_summaries.find_one({'sourceReportId':first['reportId']})
    changed=deepcopy(payload);changed['report']['overall_score']=14
    second=await capture(db,changed,report_available=True,submitted=True)
    assert second['version']==2
    assert (await db.report_summaries.find_one({'summaryId':summary['summaryId']}))==summary
    response=await client.get(BASE+'/reports/'+first['reportId'],headers=headers(),params={'version':1})
    assert response.json()['content']['overview']['value']==0
    assert not response.json()['metadata']['isCurrent']
    response=await client.get(BASE+'/summaries/'+summary['summaryId'],headers=headers())
    assert response.json()['sourceReportVersion']==1 and response.json()['snapshot']['overview']['value']==0
    page=await client.get(BASE+'/reports/'+first['reportId']+'/versions',headers=headers(),params={'skip':1,'limit':1})
    assert page.json()['total']==2 and page.json()['items'][0]['version']==1


async def test_viewer_cross_tenant_and_same_candidate_different_application_are_denied(client,db):
    row=await capture(db,source(),report_available=True,submitted=True);url=BASE+'/reports/'+row['reportId']
    assert (await client.get(url,headers=headers('viewer'))).status_code==403
    assert (await client.get(url,headers=headers(org='other'))).status_code==404
    assert (await client.get(url,headers=headers('technical_interviewer'))).status_code==404
    assert (await client.get(url,headers=headers('recruiter'))).status_code==200
    # An interview assignment for another application never grants this report.
    await db.recruit_interviews.insert_one({'orgId':'default','applicationId':'app1','interviewId':'assigned-other','interviewerId':'managerial_interviewer','status':'scheduled','createdAt':now(),'startsAt':now()+timedelta(days=1)})
    assert (await client.get(url,headers=headers('managerial_interviewer'))).status_code==404
    await db.recruit_interviews.insert_one({'orgId':'default','applicationId':'app0','interviewId':'assigned','interviewerId':'managerial_interviewer','status':'scheduled','createdAt':now(),'startsAt':now()+timedelta(days=1)})
    assert (await client.get(url,headers=headers('managerial_interviewer'))).status_code==200
    await db.recruit_interviews.update_one({'interviewId':'assigned'},{'$set':{'status':'cancelled'}})
    assert (await client.get(url,headers=headers('managerial_interviewer'))).status_code==404
    assert (await client.get(BASE+'/reports',headers=headers('managerial_interviewer'))).json()['total']==0


async def test_revoked_job_and_evidence_access_are_enforced_on_detail_summary_media(client,db):
    row=await capture(db,source(),report_available=True,submitted=True)
    await db.users.update_one({'userId':'recruiter'},{'$set':{'jobAccess':[]}})
    assert (await client.get(BASE+'/reports/'+row['reportId'],headers=headers('recruiter'))).status_code==404
    await db.recruit_interviews.insert_one({'orgId':'default','applicationId':'app0','interviewId':'assigned','interviewerId':'technical_interviewer','status':'scheduled','createdAt':now(),'startsAt':now()+timedelta(days=1)})
    await db.recruit_profiles.insert_one({'orgId':'default','userId':'technical_interviewer','visibleFields':['skills']})
    assert (await client.get(BASE+'/reports/'+row['reportId'],headers=headers('technical_interviewer'))).status_code==403
    assert (await client.get(BASE+'/reports/'+row['reportId']+'/media/q1?version=1',headers=headers('technical_interviewer'))).status_code==403


async def test_mismatched_catalog_or_provider_context_is_rejected(client,db):
    payload=source();payload['interview_details']['candidate_id']='other-provider'
    with pytest.raises(ValueError):await capture(db,payload,report_available=True)
    row=await capture(db,source(),report_available=True)
    await db.report_catalog.update_one({'reportId':row['reportId']},{'$set':{'candidateId':'other-person'}})
    assert (await client.get(BASE+'/reports',headers=headers())).json()['total']==0
    assert (await client.get(BASE+'/reports/'+row['reportId'],headers=headers())).status_code==404


async def test_archival_invalidation_and_exports_require_admin_permissions_and_audit(client,db):
    row=await capture(db,source(),report_available=True);url=BASE+'/reports/'+row['reportId']
    request={'version':1,'action':'invalidate','reason':'Provider evidence was invalidated after review.'}
    assert (await client.post(url+'/version-action',headers=headers('recruiter'),json=request)).status_code==403
    assert (await client.get(url+'/export',headers=headers('recruiter'))).status_code==403
    assert (await client.post(url+'/version-action',headers=headers(),json=request)).status_code==200
    result=(await client.get(url,headers=headers())).json()
    assert result['metadata']['status']=='Invalidated' and not result['metadata']['isCurrent']
    assert (await client.get(BASE+'/reports',headers=headers(),params={'status':'Completed'})).json()['total']==0
    summary=await db.report_summaries.find_one({'sourceReportId':row['reportId']})
    summary_response=await client.get(BASE+'/summaries/'+summary['summaryId'],headers=headers())
    assert summary_response.json()['sourceValidity']=='Invalidated'
    request['action']='restore'
    assert (await client.post(url+'/version-action',headers=headers(),json=request)).status_code==200
    assert (await client.get(url+'/export',headers=headers())).status_code==200
    assert await db.audit_log.count_documents({'action':'reports.exported'})==1


async def test_report_sync_jobs_are_deduplicated_and_never_create_new_attempts(client,db,monkeypatch):
    await capture(db)
    for _ in range(2):
        result=await client.post(BASE+'/sync',headers=headers('recruiter'),json={'applicationId':'app0'})
        assert result.status_code==202,result.text
    assert await db.background_jobs.count_documents({'kind':'report_sync'})==1
    from app.services import primehire_api
    monkeypatch.setattr(primehire_api,'get_interview_status',AsyncMock(return_value={'submitted':True,'reportAvailable':True}))
    monkeypatch.setattr(primehire_api,'get_report_envelope',AsyncMock(return_value=source()))
    task=await db.background_jobs.find_one({'kind':'report_sync'})
    outcome=await service.sync_report(db,task)
    assert outcome['status']=='Completed'
    assert (await db.applications.find_one({'applicationId':'app0'}))['assessment']['interviewId']=='attempt0'


async def test_pending_and_failed_statuses_are_separate_from_round_completion(client,db):
    row=await capture(db,None,submitted=True)
    response=(await client.get(BASE+'/reports/'+row['reportId'],headers=headers())).json()
    assert response['metadata']['status']=='Processing' and response['content'] is None
    failed=source();failed['report']['status']='FAILED'
    row=await capture(db,failed,submitted=True)
    response=(await client.get(BASE+'/reports/'+row['reportId'],headers=headers())).json()
    assert response['metadata']['status']=='Failed' and response['content'] is None


async def test_interview_snapshot_stays_pinned_and_submitted_history_cannot_be_refreshed(client,db):
    original=source();row=await capture(db,original,report_available=True)
    app=await db.applications.find_one({'applicationId':'app0'})
    pin=await service.pin_snapshot(db,app)
    await db.recruit_interviews.insert_one({'orgId':'default','applicationId':'app0','interviewId':'assigned','interviewerId':'managerial_interviewer','status':'scheduled','reportSummarySnapshot':pin})
    changed=deepcopy(original);changed['report']['overall_score']=13
    await capture(db,changed,report_available=True)
    url=BASE+'/interviews/assigned/summary'
    result=(await client.get(url,headers=headers('managerial_interviewer'))).json()
    assert result['summary']['sourceReportVersion']==1
    assert result['summary']['snapshot']['overview']['value']==0
    assert (await client.post(url+'-refresh',headers=headers('managerial_interviewer'),json={})).status_code==200
    assert (await client.get(url,headers=headers('managerial_interviewer'))).json()['summary']['sourceReportVersion']==2
    await db.recruit_interviews.update_one({'interviewId':'assigned'},{'$set':{'status':'reviewed'}})
    assert (await client.post(url+'-refresh',headers=headers('managerial_interviewer'),json={})).status_code==409


async def test_unknown_or_unconfigured_media_is_rejected_without_network_access(client,db):
    row=await capture(db,source(),report_available=True)
    assert (await client.get(BASE+'/reports/'+row['reportId']+'/media/q2?version=1',headers=headers())).status_code==404
    assert (await client.get(BASE+'/reports/'+row['reportId']+'/media/q1?version=1',headers=headers())).status_code==409
