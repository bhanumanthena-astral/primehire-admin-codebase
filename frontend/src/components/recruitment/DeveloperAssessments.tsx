import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Application, Job, Page, recruitmentRequest, stageLabel} from '../../lib/recruitmentApi';

export function DeveloperAssessments({job, canShortlist, readOnly, onChanged}: {job?:Job; canShortlist:boolean; readOnly:boolean; onChanged:()=>void}) {
  const navigate=useNavigate();
  const [page,setPage]=useState(0),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
  const [result,setResult]=useState<Page<Application>>({items:[],total:0}),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  useEffect(()=>setPage(0),[job?.jobId]);
  useEffect(()=>{
    setResult({items:[],total:0});setError('');
    if(!job)return;
    const controller=new AbortController();setLoading(true);
    void recruitmentRequest<Page<Application>>(`/applications?jobId=${encodeURIComponent(job.jobId)}&skip=${page*50}&limit=50`,undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted)setResult(value);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[job?.jobId,page,revision]);
  async function shortlist(application:Application){
    setBusy(true);setError('');
    try{await recruitmentRequest(`/applications/${encodeURIComponent(application.applicationId)}/shortlist`,{});setRevision(n=>n+1);onChanged();}
    catch(cause){setError(cause instanceof Error?cause.message:'Shortlisting failed');}
    finally{setBusy(false);}
  }
  if(!job)return <p className="rounded-xl border p-6">Choose an assigned job above to review its details and assessments. Ask an administrator to assign review jobs in Team access if none appear.</p>;
  return <section aria-label="Developer assessment review" className="space-y-5">
    <article className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-bold">{job.title}</h2>
      <p className="text-sm text-muted-foreground">{job.companyName || 'Company not specified'} · {job.lifecycleStatus || 'Status unavailable'} · {job.positionsFilled ?? 0} of {job.positionsTotal ?? '—'} positions filled</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">{[['Role',job.jobRole],['Department',job.department],['Location',job.location],['Work mode',job.workMode],['Experience',`${job.minExperienceYears??'—'}–${job.maxExperienceYears??'—'} years`],['Assessment',job.assessmentJobId],['Round',job.assessmentRoundType]].map(([label,value])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value||'Not specified'}</dd></div>)}</dl>
      <p>Skills: {job.keywords?.join(', ')||'Not specified'}</p><h3 className="font-semibold">Job description</h3><p className="whitespace-pre-wrap text-sm">{job.jdText||'No job description available.'}</p>
    </article>
    <header><h2 className="text-xl font-bold">Candidate assessments</h2><p className="text-sm text-muted-foreground">Review the report, then shortlist for an administrator to schedule your interview.</p></header>
    {error&&<p role="alert" className="text-destructive">{error}<Button variant="outline" onClick={()=>setRevision(n=>n+1)}>Retry</Button></p>}
    {loading?<p role="status">Loading assessments…</p>:result.items.map(application=><article key={application.applicationId} className="space-y-3 rounded-xl border bg-card p-5">
      <h3 className="font-semibold">{application.candidate.name}</h3><p className="text-sm">{stageLabel(application.currentStage)} · Assessment: {application.assessment?.status||'Not invited'} · Score: {application.assessment?.score??'Pending'}</p>
      {application.developerShortlist&&<p className="text-sm">Shortlisted for interview · Awaiting admin scheduling or interview progression</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!application.assessment} onClick={()=>navigate(`/reports/applications/${encodeURIComponent(application.applicationId)}`)}>View assessment reports</Button>
        {canShortlist&&application.currentStage==='ASSESSMENT_COMPLETED'&&<Button disabled={busy||readOnly||!application.assessment} onClick={()=>void shortlist(application)}>Shortlist for interview</Button>}</div>
    </article>)}
    {!loading&&!error&&!result.items.length&&<p>No candidates for this job yet.</p>}
    <footer className="flex items-center gap-3"><Button variant="outline" disabled={!page||loading} onClick={()=>setPage(n=>n-1)}>Previous assessments</Button><span>{result.total} candidates</span><Button variant="outline" disabled={(page+1)*50>=result.total||loading} onClick={()=>setPage(n=>n+1)}>Next assessments</Button></footer>
  </section>;
}
