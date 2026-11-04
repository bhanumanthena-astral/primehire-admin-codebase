import React,{useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Assignment,Page,candidateRequest,candidateTime} from '../../lib/candidateManagementApi';

export function AssessmentAssignmentStatuses({assessmentId}:{assessmentId:string}){
  const [open,setOpen]=useState(false),[page,setPage]=useState(0),[items,setItems]=useState<Assignment[]>([]),[total,setTotal]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);setError('');
    void candidateRequest<Page<Assignment>>(`/assessment-assignments/${encodeURIComponent(assessmentId)}?skip=${page*20}`,undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted){setItems(value.items);setTotal(value.total);}}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[open,page,assessmentId,retry]);
  return <section className="mt-6 border-t border-border pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Candidate assignment statuses</h3><Button variant="outline" onClick={()=>setOpen(v=>!v)}>{open?'Hide assignment statuses':'View assignment statuses'}</Button></div>{open&&<div className="mt-4 space-y-3">{loading?<p role="status" className="text-sm">Loading assignments…</p>:error?<p role="alert" className="text-sm">{error}<Button variant="outline" size="sm" className="ml-2" onClick={()=>setRetry(v=>v+1)}>Retry assignments</Button></p>:<>{items.map(item=><article key={item.assignmentId} className="rounded-xl border border-border p-3 text-sm"><p className="font-medium">Candidate ID: {item.candidateId}</p><p className="mt-1">{item.status} · {candidateTime(item.startDate)} – {candidateTime(item.endDate)}</p></article>)}{!items.length&&<p className="text-sm text-muted-foreground">No candidate assignments in your access scope.</p>}<div className="flex items-center gap-3 text-xs"><Button variant="outline" size="sm" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous assignments</Button><span>{total} assignments · page {page+1}</span><Button variant="outline" size="sm" disabled={(page+1)*20>=total} onClick={()=>setPage(p=>p+1)}>Next assignments</Button></div></>}</div>}</section>;
}
