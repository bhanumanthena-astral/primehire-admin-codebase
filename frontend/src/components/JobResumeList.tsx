import React, {useEffect, useState} from 'react';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {intakeGet, type IntakeItem} from '../lib/resumeIntakeApi';
import {ResumeReviewTable} from './ResumeReviewTable';
import {PAButton} from './ui/primitives';

type Props = Omit<React.ComponentProps<typeof ResumeReviewTable>, 'items' | 'selection'> & {jobId:string; reload:number};

export function JobResumeList({jobId,reload,...tableProps}:Props) {
  const [page,setPage]=useState(0);
  const [search,setSearch]=useState('');
  const [atsOnly,setAtsOnly]=useState(false);
  const [data,setData]=useState<{items:IntakeItem[];total:number}|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();let inFlight=false;
    setLoading(true);setError('');setData(null);
    async function refresh() {
      if(inFlight)return;inFlight=true;
      try {
        const query=new URLSearchParams({skip:String(page*25),limit:'25',q:search,atsOnly:String(atsOnly)});
        const result=await intakeGet<{items:IntakeItem[];total:number}>(`/jobs/${encodeURIComponent(jobId)}/items?${query}`,controller.signal);
        if(!controller.signal.aborted){setData(result);setError('');}
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load resumes.');}
      finally{inFlight=false;if(!controller.signal.aborted)setLoading(false);}
    }
    const delay=setTimeout(()=>void refresh(),200);
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);
    return()=>{controller.abort();clearTimeout(delay);clearInterval(timer);};
  },[jobId,page,search,atsOnly,reload]);
  const pending=(data?.items||[]).filter(item=>item.batchId&&item.canEdit!==false&&['review_required','duplicate_suspected','confirmation_paused'].includes(item.status));
  return <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
    <h3 className="text-base font-bold">All resumes for this job</h3>
    <p className="text-xs text-muted-foreground">Includes every upload batch. Open Upload batches to set ATS ranges and create profiles for a batch.</p>
    <label className="flex flex-col gap-2 text-xs font-bold">Find a resume across all batches<Input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>
    <label className="flex items-center gap-2 text-xs"><Checkbox checked={atsOnly} onCheckedChange={value=>{setAtsOnly(value===true);setPage(0);}}/>Resumes under ATS only (scored, queued or scoring)</label>
    {error&&<p role="alert">{error}</p>}
    {loading&&<p role="status">Loading resumes…</p>}
    {data&&<>
      {tableProps.caps.canUpload&&tableProps.onContinueToAts&&pending.length>0&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div><h4 className="text-sm font-semibold">Continue reviewing parsed resumes</h4><p className="mt-1 text-xs text-muted-foreground">{pending.length} resumes on this page need review. Open their upload batch to choose an ATS range, apply it and create eligible profiles.</p></div>
        <PAButton disabled={tableProps.busy} onClick={()=>tableProps.onContinueToAts?.(pending[0])}>Review next upload batch</PAButton>
      </div>}
      <ResumeReviewTable {...tableProps} items={data.items}/>
      {!data.items.length&&<p>No resumes match these filters.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><span>Page {page+1} · {data.total} matching records across all batches</span><div className="flex gap-2">
        <PAButton variant="secondary" disabled={!page||loading} onClick={()=>setPage(n=>n-1)}>Previous</PAButton>
        <PAButton variant="secondary" disabled={(page+1)*25>=data.total||loading} onClick={()=>setPage(n=>n+1)}>Next</PAButton>
      </div></div>
    </>}
  </section>;
}
