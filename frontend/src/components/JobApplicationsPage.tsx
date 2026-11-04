import React, {useEffect, useState} from 'react';
import {ArrowLeft, RefreshCw, ArrowUpDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {authFetch} from '../lib/authFetch';
import type {Job} from '../lib/hiringApi';

type ApplicantRow = {applicationId:string;name:string;email:string;phone:string;status:string;round:string;assessment:{score:number|null;label:string}};
const columns = [['name','Applicant name'],['email','Email ID'],['phone','Phone'],['status','Current status'],['round','Round'],['assessment','Assessment score / status']] as const;
export function JobApplicationsPage({job,onBack}:{job:Job;onBack:()=>void}) {
  const [items,setItems]=useState<ApplicantRow[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [sort,setSort]=useState<string>(''),[descending,setDescending]=useState(false);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    const base=((import.meta as any).env?.VITE_API_URL||'').replace(/\/$/,'');
    void authFetch(`${base}/api/jobs/${encodeURIComponent(job.jobId)}/applications?skip=${page*50}&limit=50`,{signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'Could not load applications.');
      if(!controller.signal.aborted){setItems(result.items);setTotal(result.total);}
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[job.jobId,page,revision]);
  const sorted=[...items].sort((a,b)=>{if(!sort)return 0;const x=sort==='assessment'?(a.assessment.score??a.assessment.label):a[sort as keyof Omit<ApplicantRow,'assessment'>];const y=sort==='assessment'?(b.assessment.score??b.assessment.label):b[sort as keyof Omit<ApplicantRow,'assessment'>];return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true}))*(descending?-1:1);});
  return <section aria-label="Job applications" className="space-y-5">
    <Button variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4"/>Back to job</Button>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{job.jobKey} · {job.title}</p><h1 className="mt-2 text-2xl font-bold">Applications{!loading&&!error&&` (${total})`}</h1><p className="mt-2 text-sm text-muted-foreground">All applicants for this job. Select a column heading to sort this page.</p></div><Button variant="outline" disabled={loading} onClick={()=>setRevision(n=>n+1)}><RefreshCw className="mr-2 h-4 w-4"/>Refresh applications</Button></header>
    {error?<div role="alert" className="rounded-xl border border-destructive/30 p-5"><p>{error}</p><Button variant="outline" className="mt-3" onClick={()=>setRevision(n=>n+1)}>Retry applications</Button></div>:loading?<p role="status" className="rounded-xl border p-8">Loading applications…</p>:<div className="rounded-2xl border border-border bg-card p-4 sm:p-6"><Table><TableCaption>A list of applicants for {job.title}.</TableCaption><TableHeader><TableRow>{columns.map(([key,label])=><TableHead key={key} aria-sort={sort===key?(descending?'descending':'ascending'):'none'} className={key==='assessment'?'text-right':''}><Button variant="ghost" className="px-0" onClick={()=>{if(sort===key)setDescending(value=>!value);else{setSort(key);setDescending(false);}}}>{label}<ArrowUpDown className="ml-2 h-3 w-3"/></Button></TableHead>)}</TableRow></TableHeader><TableBody>{sorted.map(row=><TableRow key={row.applicationId}><TableCell className="font-medium">{row.name}</TableCell><TableCell>{row.email||'Not available'}</TableCell><TableCell className="whitespace-nowrap">{row.phone||'Not available'}</TableCell><TableCell>{row.status}</TableCell><TableCell>{row.round}</TableCell><TableCell className="text-right tabular-nums">{row.assessment.score??row.assessment.label}</TableCell></TableRow>)}{!items.length&&<TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No applications for this job yet.</TableCell></TableRow>}</TableBody></Table></div>}
    {!loading&&!error&&<div className="flex flex-wrap items-center justify-between gap-3 text-sm"><Button variant="outline" disabled={page===0} onClick={()=>setPage(value=>value-1)}>Previous applications</Button><span>{total?`${page*50+1}–${Math.min((page+1)*50,total)} of ${total}`:'0 applicants'}</span><Button variant="outline" disabled={(page+1)*50>=total} onClick={()=>setPage(value=>value+1)}>Next applications</Button></div>}
  </section>;
}
