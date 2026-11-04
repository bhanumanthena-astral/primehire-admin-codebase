import {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {authFetch} from '../lib/authFetch';
import type {HiringStage} from './JobHiringProgress';

type PipelineRow = {id:string; name:string; source:string; status:string; atsState?:string|null; atsScore:number|null; assessment:{score:number|null;label:string}|null};
type PipelinePage = {items:PipelineRow[];total:number};
const pageSize=25;
function displayStatus(value:string) {
  return value.replace(/^ROUND1_/, 'Technical · ').replace(/^ROUND2_/, 'Managerial · ')
    .replace(/_/g,' ').toLowerCase().replace(/^./,letter=>letter.toUpperCase());
}

export function JobPipelineDetails({jobId,stage}:{jobId:string;stage:HiringStage}) {
  const [page,setPage]=useState(0),[revision,setRevision]=useState(0);
  const [data,setData]=useState<PipelinePage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setData(null);
    const base=((import.meta as any).env?.VITE_API_URL||'').replace(/\/$/,'');
    void authFetch(`${base}/api/jobs/${encodeURIComponent(jobId)}/pipeline-details?stage=${stage}&skip=${page*pageSize}&limit=${pageSize}`,{signal:controller.signal})
      .then(async response=>{
        const result=await response.json();
        if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'Could not load stage details.');
        if(!controller.signal.aborted)setData(result);
      }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load stage details.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[jobId,stage,page,revision]);
  const isResume=stage==='resumesUploaded'||stage==='atsTotal';
  if(loading)return <p role="status" className="p-6 text-sm text-muted-foreground">Loading records for this stage…</p>;
  if(error)return <div role="alert" className="space-y-3 p-5"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={()=>setRevision(value=>value+1)}>Retry stage details</Button></div>;
  return <div className="p-4 sm:p-5">
    <Table aria-label="Records in selected hiring stage"><TableHeader><TableRow>
      <TableHead>{isResume?'Resume / candidate':'Candidate'}</TableHead>
      <TableHead>Current status</TableHead><TableHead className="text-right">ATS score</TableHead>
      <TableHead className="text-right">{isResume?'ATS status':'Assessment score / status'}</TableHead>
    </TableRow></TableHeader><TableBody>
      {data?.items.map(row=><TableRow key={row.id}>
        <TableCell className="min-w-48"><p className="font-medium">{row.name}</p>{isResume&&<p className="mt-1 max-w-72 truncate text-xs text-muted-foreground" title={row.source}>{row.source}</p>}</TableCell>
        <TableCell>{displayStatus(row.status)}</TableCell><TableCell className="text-right tabular-nums">{row.atsScore??'—'}</TableCell>
        <TableCell className="text-right tabular-nums">{isResume?(row.atsState==='done'?'Scored':displayStatus(row.atsState||'Not scored')):(row.assessment?.score??row.assessment?.label??'Not attempted')}</TableCell>
      </TableRow>)}
      {!data?.items.length&&<TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No records in this stage yet.</TableCell></TableRow>}
    </TableBody></Table>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span aria-live="polite">{data?.total?`${page*pageSize+1}–${Math.min((page+1)*pageSize,data.total)} of ${data.total} records`:'0 records'}</span>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(value=>value-1)}>Previous records</Button><Button variant="outline" size="sm" disabled={(page+1)*pageSize>=(data?.total??0)} onClick={()=>setPage(value=>value+1)}>Next records</Button></div>
    </div>
  </div>;
}
