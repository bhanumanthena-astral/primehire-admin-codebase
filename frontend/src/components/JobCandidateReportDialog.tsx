import React, {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Modal} from './ui/Modal';
import ReportShell from './report/ReportShell';
import {StoredReportEvidence} from './report/StoredReportEvidence';
import type {Application} from '../lib/recruitmentApi';
import type {Job} from '../lib/hiringApi';
import type {AssessmentProfile, Candidate} from '../types';
import {asLocalCandidateId} from '../lib/primehireIds';
import {authFetch} from '../lib/authFetch';

export function JobCandidateReportDialog({job,application,onClose}:{job:Job;application:Application;onClose:()=>void}) {
  const [result,setResult]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setResult(null);setError('');
    const base=((import.meta as any).env?.VITE_API_URL||'').replace(/\/$/,'');
    void authFetch(`${base}/api/job-assessments/${encodeURIComponent(job.jobId)}/applications/${encodeURIComponent(application.applicationId)}/report`,{signal:controller.signal})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(typeof body.detail==='string'?body.detail:'Could not load this assessment report.');if(!controller.signal.aborted)setResult(body);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[job.jobId,application.applicationId,attempt]);
  const candidate:Candidate={id:asLocalCandidateId(application.applicantId),assessmentId:result?.assessment?.id,name:application.candidate.name,email:result?.candidate?.email||'',phone:result?.candidate?.phone||'',startTime:'',endTime:'',link:null,password:null,assignedDate:null,submittedDate:application.assessment?.completedAt||null,status:'ACTIVE',reportStatus:'GENERATED'};
  const assessment={...result?.assessment,questions:[]} as AssessmentProfile;
  return <Modal label={`Assessment report for ${application.candidate.name}`} onClose={onClose} className="max-w-7xl p-5 sm:p-6">
    {loading?<p role="status" className="p-8 text-center">Loading assessment report…</p>:error?<section role="alert" className="space-y-4 p-4"><h2 className="text-lg font-bold">Assessment report</h2><p>{error}</p><Button variant="outline" onClick={()=>setAttempt(value=>value+1)}>Retry report</Button></section>:result?.reportContract?<section className="space-y-4"><h2 className="text-xl font-bold">{application.candidate.name} · {result.reportContract.metadata.roundType} report</h2><p className="text-xs text-muted-foreground">{result.reportContract.metadata.status} · Version {result.reportContract.metadata.version} · Application {result.reportContract.metadata.applicationId}</p><Button variant="outline" onClick={()=>window.location.assign(`/reports/${encodeURIComponent(result.reportContract.metadata.reportId)}?version=${result.reportContract.metadata.version}`)}>Open preserved report & version history</Button>{result.reportContract.content?<StoredReportEvidence content={result.reportContract.content} reportId={result.reportContract.metadata.reportId} version={result.reportContract.metadata.version}/>:<p role="status">{result.reportContract.metadata.status}: report content is not available yet.</p>}</section>:result&&<ReportShell candidate={candidate} assessment={assessment} data={result.report} onClose={onClose}/>}
  </Modal>;
}
