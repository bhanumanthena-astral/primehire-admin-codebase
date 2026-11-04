import React, { useEffect, useRef, useState } from 'react';
import { Plus, Upload, RefreshCw, Search, ArrowLeft, Eye, Pencil, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AppSelect } from '../ui/AppSelect';
import { Modal } from '../ui/Modal';
import { assessmentRequest, assessmentTime, AssessmentCapabilities, ManagedAssessment, configFromForm } from '../../lib/assessmentManagementApi';
import { AssessmentPreview } from './AssessmentPreview';
import { AssessmentCsvDialog } from './AssessmentCsvDialog';
import {AssessmentAssignmentStatuses} from '../candidates/AssessmentAssignmentStatuses';

export function AssessmentLibrary({canManage,onNew,onEdit,onAssignments,onPublished,scopedAssessmentId,onViewTable}:{onViewTable?:(row:ManagedAssessment)=>void;scopedAssessmentId?:string;canManage:boolean;onNew:()=>void;onEdit:(row:ManagedAssessment)=>void;onAssignments:(row:ManagedAssessment)=>void;onPublished:(row:ManagedAssessment)=>void}) {
  const [items,setItems]=useState<ManagedAssessment[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[revision,setRevision]=useState(0);
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[language,setLanguage]=useState(''),[round,setRound]=useState(''),[status,setStatus]=useState('');
  const [dates,setDates]=useState({startsFrom:'',startsTo:'',endsFrom:'',endsTo:''});
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[csv,setCsv]=useState(false);
  const [opened,setOpened]=useState<ManagedAssessment|null>(null),[detailBusy,setDetailBusy]=useState(false),[detailError,setDetailError]=useState('');
  const [publish,setPublish]=useState(false),[busy,setBusy]=useState(false);
  const detailController=useRef<AbortController|null>(null);
  const [detailKey,setDetailKey]=useState('');
  useEffect(()=>()=>detailController.current?.abort(),[]);
  const refresh=()=>setRevision(value=>value+1);
  useEffect(()=>{if(search===query)return;const timer=setTimeout(()=>{setQuery(search);setPage(0);},250);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{setPage(0);},[language,round,status,dates]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const params=new URLSearchParams({search:query,skip:String(page*20),limit:'20'});
    if(scopedAssessmentId)params.set('assessmentId',scopedAssessmentId);
    if(language)params.set('language',language);if(round)params.set('roundType',round);if(status)params.set('status',status);
    Object.entries(dates).forEach(([key,value])=>{if(value){const date=new Date(`${value}T00:00:00+05:30`);if(key.endsWith('To'))date.setTime(date.getTime()+86400000);params.set(key,date.toISOString());}});
    void assessmentRequest<{items:ManagedAssessment[];total:number}>(`?${params}`,undefined,'GET',controller.signal)
      .then(result=>{if(!controller.signal.aborted){setItems(result.items);setTotal(result.total);}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[query,language,round,status,dates,page,revision,scopedAssessmentId]);
  async function open(key:string){
    detailController.current?.abort();const controller=new AbortController();detailController.current=controller;
    setDetailKey(key);setOpened(null);setDetailBusy(true);setDetailError('');setPublish(false);setNotice('');
    try{const row=await assessmentRequest<ManagedAssessment>('/'+encodeURIComponent(key),undefined,'GET',controller.signal);if(!controller.signal.aborted)setOpened(row);}
    catch(cause:any){if(!controller.signal.aborted)setDetailError(cause.message);}finally{if(!controller.signal.aborted)setDetailBusy(false);}
  }
  async function confirmPublish(){
    if(!opened||busy)return;setBusy(true);setDetailError('');
    try{const row=await assessmentRequest<ManagedAssessment>(`/${encodeURIComponent(opened.id)}/publish`,{expectedRevision:opened.revision,confirmed:true});setOpened(row);setPublish(false);setNotice('Assessment published successfully.');onPublished(row);refresh();}
    catch(cause:any){setDetailError(cause.message);try{setOpened(await assessmentRequest<ManagedAssessment>('/'+encodeURIComponent(opened.id)));}catch{/* Preserve the last visible configuration and error. */}}
    finally{setBusy(false);}
  }
  if(opened||detailBusy||detailError)return <section className="space-y-5">
    <Button variant="outline" disabled={busy} onClick={()=>{detailController.current?.abort();setOpened(null);setDetailKey('');setDetailBusy(false);setDetailError('');setNotice('');}}><ArrowLeft className="mr-2 h-4 w-4"/>Back to assessments</Button>
    {notice&&<p role="status" className="rounded-xl border border-border bg-primary/10 p-4 text-sm">{notice}</p>}
    {detailError&&<div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{detailError}{detailKey&&<Button className="ml-3" variant="outline" onClick={()=>void open(detailKey)}>Reload saved details</Button>}</div>}
    {opened?.publishError&&!detailError&&<p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{opened.publishError}</p>}
    {detailBusy?<Skeleton className="h-64"/>:opened&&<><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assessment details</p><h2 className="mt-2 text-xl font-bold">{opened.jobTitle}</h2></div><div className="flex flex-wrap gap-2">{opened.canEdit&&<Button variant="outline" onClick={()=>onEdit(opened)}><Pencil className="mr-2 h-4 w-4"/>Edit draft</Button>}{opened.canPublish&&<Button onClick={()=>setPublish(true)}><Send className="mr-2 h-4 w-4"/>Preview publication</Button>}{opened.publicationState==='published'&&canManage&&<Button variant="outline" onClick={()=>onAssignments(opened)}>Candidate assignments</Button>}</div></div>
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6"><dl className="mb-5 grid gap-3 border-b border-border pb-5 text-sm sm:grid-cols-3">{[
        ['Status',opened.status],['Created by',opened.createdByName||opened.createdBy||'Not available'],['Created at',assessmentTime(opened.createdAt)],['Updated by',opened.updatedByName||opened.updatedBy||'Not available'],['Updated at',assessmentTime(opened.updatedAt)],['Revision',String(opened.revision)],
      ].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
      {opened.publicationState!=='draft'&&<p className="mb-5 rounded-xl bg-muted/40 p-3 text-sm">{opened.publicationState==='published'?'Published questions are locked to protect candidate attempts. Create a new draft for a different configuration.':'Publication is running or needs provider reconciliation. Do not resubmit this assessment.'}</p>}
      <AssessmentPreview config={configFromForm(opened)}/>{!opened.questions?.length&&<p className="mt-3 text-sm text-muted-foreground">No questions are available for this assessment.</p>}{opened.publicationState==='published'&&<AssessmentAssignmentStatuses assessmentId={opened.id}/>}</div>
      {publish&&<Modal label="Confirm assessment publication" onClose={()=>setPublish(false)} dismissible={!busy} className="max-w-3xl p-5 sm:p-6"><h2 className="mb-4 text-xl font-bold">Review and confirm publication</h2><AssessmentPreview config={configFromForm(opened)}/><p className="mt-5 rounded-xl border border-border p-4 text-sm">Publishing creates this assessment in PrimeHire. Its questions will be locked. Candidate invitations are a separate action.</p>{detailError&&<p role="alert" className="mt-3 text-sm text-destructive">{detailError}</p>}<div className="mt-5 flex flex-wrap gap-2"><Button disabled={busy||!opened.canPublish} onClick={()=>void confirmPublish()}>{busy?'Publishing…':'Confirm and publish'}</Button><Button variant="outline" disabled={busy} onClick={()=>setPublish(false)}>Back to details</Button></div></Modal>}
    </>}
  </section>;
  return <section className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assessment management</p><h2 className="mt-2 text-2xl font-bold">All assessments</h2><p className="mt-2 text-sm text-muted-foreground">Create a draft, review its questions and publish when you’re ready.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4"/>Refresh assessments</Button>{canManage&&<><Button variant="outline" onClick={()=>setCsv(true)}><Upload className="mr-2 h-4 w-4"/>Import assessment CSV</Button><Button onClick={onNew}><Plus className="mr-2 h-4 w-4"/>New assessment</Button></>}</div></header>
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-medium sm:col-span-2">Search assessment ID or job description<Input className="mt-1" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search assessments"/></label><label className="text-xs font-medium">Language<AppSelect aria-label="Assessment language filter" value={language} onValueChange={setLanguage}><option value="">All languages</option><option value="ENGLISH">English</option><option value="DUTCH">Dutch</option></AppSelect></label><label className="text-xs font-medium">Round<AppSelect aria-label="Assessment round filter" value={round} onValueChange={setRound}><option value="">All rounds</option>{['BASIC','TECHNICAL','HR'].map(value=><option key={value}>{value}</option>)}</AppSelect></label><label className="text-xs font-medium">Status<AppSelect aria-label="Assessment status filter" value={status} onValueChange={setStatus}><option value="">All statuses</option>{['Draft','Scheduled','Active','Completed','Inactive'].map(value=><option key={value}>{value}</option>)}</AppSelect></label>{Object.entries(dates).map(([key,value])=><label key={key} className="text-xs font-medium">{{startsFrom:'Starts from',startsTo:'Starts through',endsFrom:'Ends from',endsTo:'Ends through'}[key]}<Input className="mt-1" type="date" value={value} onChange={event=>setDates(previous=>({...previous,[key]:event.target.value}))}/></label>)}<Button variant="ghost" onClick={()=>{setSearch('');setQuery('');setLanguage('');setRound('');setStatus('');setDates({startsFrom:'',startsTo:'',endsFrom:'',endsTo:''});setPage(0);}}>Clear filters</Button></div>
    {error&&<div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{error}<Button className="ml-3" variant="outline" onClick={refresh}>Retry assessment list</Button></div>}
    {loading?<Skeleton aria-label="Loading assessments" className="h-64"/>:<div className="overflow-x-auto rounded-2xl border border-border bg-card"><table className="w-full min-w-[1000px] text-left text-sm"><caption className="sr-only">Authorized assessment records</caption><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{['Assessment ID / title','Job description','Language','Round','Start date','End date','Status','Created by / at','Actions'].map(value=><th key={value} className="p-4 font-medium">{value}</th>)}</tr></thead><tbody>{items.map(row=><tr key={row.id} className="border-t border-border"><td className="max-w-56 p-4"><span className="block font-semibold">{row.jobTitle}</span><span className="mt-1 block break-all text-xs text-muted-foreground">{row.id}</span></td><td className="max-w-64 p-4"><p className="line-clamp-3">{row.jobDescription}</p></td><td className="p-4">{row.language}</td><td className="p-4">{row.roundType}</td><td className="p-4 text-xs">{assessmentTime(row.startDate)}</td><td className="p-4 text-xs">{assessmentTime(row.endDate)}</td><td className="p-4"><span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs">{row.status}</span></td><td className="p-4 text-xs">{row.createdByName||row.createdBy||'Not available'}<span className="mt-1 block text-muted-foreground">{assessmentTime(row.createdAt)}</span></td><td className="p-4"><div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>void open(row.id)}><Eye className="mr-1 h-3.5 w-3.5"/>View</Button>{row.publicationState==='published'&&<Button variant="outline" size="sm" onClick={()=>(onViewTable||onAssignments)(row)}>View table</Button>}{row.canEdit&&<Button variant="outline" size="sm" onClick={()=>void assessmentRequest<ManagedAssessment>('/'+encodeURIComponent(row.id)).then(onEdit).catch(cause=>setError(cause.message))}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</div></td></tr>)}{!items.length&&<tr><td colSpan={9} className="p-12 text-center text-muted-foreground">{query||language||round||status||Object.values(dates).some(Boolean)?'No assessments match these filters.':'No assessments are available in your access scope.'}</td></tr>}</tbody></table></div>}
    <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>{total} assessments · Page {page+1} of {Math.max(1,Math.ceil(total/20))}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!page||loading} onClick={()=>setPage(value=>value-1)}>Previous assessments</Button><Button variant="outline" size="sm" disabled={(page+1)*20>=total||loading} onClick={()=>setPage(value=>value+1)}>Next assessments</Button></div></footer>
    {csv&&<AssessmentCsvDialog onClose={()=>setCsv(false)} onImported={refresh}/>}
  </section>;
}
