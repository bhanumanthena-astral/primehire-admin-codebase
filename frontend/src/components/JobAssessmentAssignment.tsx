import React, {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {AppSelect} from './ui/AppSelect';
import type {Job} from '../lib/hiringApi';
import {assessmentRequest, ManagedAssessment} from '../lib/assessmentManagementApi';
import {candidateRequest, AvailableAssessment, Page} from '../lib/candidateManagementApi';
import {authFetch} from '../lib/authFetch';
import {useAuth} from '../lib/authContext';

export function JobAssessmentAssignment({job,onLinked}:{job:Job;onLinked:(assessmentId:string,roundType:string)=>void}) {
  const {user,impersonatingUser}=useAuth();
  const canManage=!impersonatingUser&&['super_admin','admin','hr','recruiter'].includes(user?.role||'');
  const [choices,setChoices]=useState<AvailableAssessment[]>([]);
  const [linked,setLinked]=useState<ManagedAssessment|null>(null);
  const [selected,setSelected]=useState(job.assessmentJobId||'');
  const [total,setTotal]=useState(0),[loaded,setLoaded]=useState(50),[attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{setSelected(job.assessmentJobId||'');setLinked(null);if(!job.assessmentJobId)return;
    const controller=new AbortController();
    void assessmentRequest<ManagedAssessment>('/'+encodeURIComponent(job.assessmentJobId),undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted)setLinked(value);})
      .catch(()=>{/* The linked ID remains visible if details cannot be loaded. */});
    return()=>controller.abort();
  },[job.jobId,job.assessmentJobId]);
  useEffect(()=>{if(!canManage){setLoading(false);return;}const controller=new AbortController();setLoading(true);setError('');
    // Load in bounded pages; keep every fetched option available in the dropdown.
    const skip=Math.max(0,loaded-50);
    void candidateRequest<Page<AvailableAssessment>>(`/assessments?skip=${skip}&limit=50`,undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted){setChoices(previous=>skip?[...previous,...value.items.filter(row=>!previous.some(old=>old.assessmentId===row.assessmentId))]:value.items);setTotal(value.total);}})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[canManage,loaded,attempt]);
  async function link(){if(!selected||busy)return;setBusy(true);setError('');setNotice('');
    try{const base=((import.meta as any).env?.VITE_API_URL||'').replace(/\/$/,'');
      const response=await authFetch(`${base}/api/job-assessments/${encodeURIComponent(job.jobId)}/link`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assessmentId:selected,expectedAssessmentId:job.assessmentJobId||null})});
      const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'Could not link this assessment.');
      onLinked(result.assessmentId,result.roundType);setNotice('Assessment linked. Open View table in its Actions to manage candidate invitations.');
    }catch(e){setError(e instanceof Error?e.message:'Could not link this assessment.');}finally{setBusy(false);}}
  return <section aria-label="Job assessment assignment" className="space-y-3 rounded-2xl border bg-card p-5">
    <h2 className="text-xl font-bold">Use an existing assessment</h2>
    {canManage&&<div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 text-sm">Published assessment
        <AppSelect aria-label="Published assessment" value={selected} disabled={busy||loading} onValueChange={setSelected}>
          <option value="">Select a published assessment</option>
          {!!job.assessmentJobId&&!choices.some(row=>row.assessmentId===job.assessmentJobId)&&<option value={job.assessmentJobId}>{linked?.jobTitle||job.assessmentJobId} · linked</option>}
          {choices.map(row=><option key={row.assessmentId} value={row.assessmentId}>{row.title} · {row.roundType} · {row.assessmentId}</option>)}
        </AppSelect>
      </label>
      <Button disabled={busy||loading||!selected||selected===job.assessmentJobId||!choices.some(row=>row.assessmentId===selected)} onClick={()=>void link()}>{busy?'Linking…':'Link assessment'}</Button>
      {choices.length<total&&<Button variant="outline" disabled={busy||loading} onClick={()=>setLoaded(value=>value+50)}>Load more assessments</Button>}
    </div>}
    {loading&&<p role="status" className="text-sm text-muted-foreground">Loading published assessments…</p>}
    {error&&<div role="alert" className="text-sm text-destructive">{error}<Button variant="outline" className="ml-3" onClick={()=>setAttempt(value=>value+1)}>Retry assessments</Button></div>}
    {notice&&<p role="status" className="text-sm">{notice}</p>}
    <p className="text-sm text-muted-foreground">{job.assessmentJobId?<>Linked assessment: <strong>{linked?.jobTitle||job.assessmentJobId}</strong> · {linked?.roundType||job.assessmentRoundType}</>:'No assessment is linked to this job yet.'}</p>
  </section>;
}
