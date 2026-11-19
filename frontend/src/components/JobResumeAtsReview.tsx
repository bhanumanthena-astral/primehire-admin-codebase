import React, {useEffect, useState} from 'react';
import {intakeGet, intakeMutate} from '../lib/resumeIntakeApi';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {PAButton} from './ui/primitives';

type Overview = {snapshot:string;batches:number;range:{minimum:number;maximum:number}|null;counts:Record<string,number>;running:boolean;importing:boolean};

export function JobResumeAtsReview({jobId,reload,onChanged}:{jobId:string;reload:number;onChanged:()=>void}) {
  const [data,setData]=useState<Overview|null>(null);
  const [minimum,setMinimum]=useState('0');const [maximum,setMaximum]=useState('100');
  const [reviewed,setReviewed]=useState(false);const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    void intakeGet<Overview>(`/jobs/${jobId}/ats-review`,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      setData(result);setReviewed(false);
      if(result.range){setMinimum(String(result.range.minimum));setMaximum(String(result.range.maximum));}
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[jobId,reload,refresh]);
  useEffect(()=>{
    if(!data?.running&&!data?.counts.pending&&!data?.counts.creating&&!data?.importing)return;
    const timer=setInterval(()=>setRefresh(n=>n+1),5000);
    return()=>clearInterval(timer);
  },[data]);
  const valid=minimum!==''&&maximum!==''&&Number.isInteger(+minimum)&&Number.isInteger(+maximum)&&+minimum>=0&&+maximum<=100&&+minimum<=+maximum;
  const saved=!!data?.range&&+minimum===data.range.minimum&&+maximum===data.range.maximum;
  async function act(create:boolean){
    if(!data||!valid)return;
    setBusy(true);setError('');setMessage('');
    try{
      const body={minimum:+minimum,maximum:+maximum,expectedSnapshot:data.snapshot,reviewed:create&&reviewed};
      if(create){
        await intakeMutate(`/jobs/${jobId}/ats-review/confirm`,body);
        setMessage('Profile creation queued across all upload batches. Missing details and identity conflicts remain for review.');
      }else{
        const result=await intakeMutate<Overview>(`/jobs/${jobId}/ats-review`,body,'PUT');
        setData(result);setReviewed(false);
        setMessage(`ATS range saved across ${result.batches} upload batches. No profiles were created.`);
      }
      onChanged();setRefresh(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:'Could not update ATS review.');setRefresh(n=>n+1);}
    finally{setBusy(false);}
  }
  return <section aria-label="ATS review across all upload batches" className="space-y-4 rounded-2xl border border-border bg-card p-5">
    <div><h3 className="text-base font-bold">Review all job resumes</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Uploads may contain several small batches. Apply one ATS range to all your accessible batches for this job, then create eligible profiles across every page.</p></div>
    {data&&<p className="text-xs text-muted-foreground">{data.counts.total||0} resumes · {data.batches} batches · {data.counts.within||0} within saved range · {data.counts.range_required||0} awaiting a range · {data.counts.pending||0} awaiting scoring · {data.counts.created||0} profiles processed · {data.counts.needsCorrection||0} missing required details · {data.counts.needsAttention||0} file issues</p>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-2 text-xs font-semibold">Minimum ATS %<Input aria-label="Job minimum ATS score" type="number" min={0} max={100} value={minimum} disabled={busy} onChange={e=>{setMinimum(e.target.value);setReviewed(false);}} className="mt-2 w-28"/></label>
      <label className="space-y-2 text-xs font-semibold">Maximum ATS %<Input aria-label="Job maximum ATS score" type="number" min={0} max={100} value={maximum} disabled={busy} onChange={e=>{setMaximum(e.target.value);setReviewed(false);}} className="mt-2 w-28"/></label>
      <PAButton variant="secondary" disabled={busy||!data?.batches||!valid} onClick={()=>void act(false)}>Apply ATS range to all batches</PAButton>
      <PAButton variant="secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh ATS review</PAButton>
    </div>
    <label className="flex items-start gap-2 text-xs leading-relaxed"><Checkbox aria-label="Review all job resumes confirmed" checked={reviewed} disabled={busy||!saved} onCheckedChange={value=>setReviewed(!!value)}/><span>I reviewed the saved ATS range and approve creating eligible profiles across all these batches.</span></label>
    <PAButton disabled={busy||!saved||!reviewed||data?.running||data?.importing||!data?.counts.within||!!data?.counts.pending||!!data?.counts.score_failed} onClick={()=>void act(true)}>{data?.running?'Creating profiles…':'Create profiles across all batches'}</PAButton>
    {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
