import {Progress} from '@/components/ui/progress';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {AppSelect} from '@/src/components/ui/AppSelect';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import React, {useEffect, useRef, useState} from 'react';
import {Archive, FileSpreadsheet, FileText, Upload, Loader2, Settings2, Download, RefreshCw, Users, ShieldCheck} from 'lucide-react';
import {useAuth} from '../lib/authContext';
import {Job, fetchJobsPage} from '../lib/hiringApi';
import {acceptsResumes, hasJobAccess} from '../lib/jobAccess';
import {Capabilities, IntakeItem, IntakeBatch, BatchPage, CandidateRow, Limits, intakeGet, intakeMutate, intakeUpload, intakeDownload} from '../lib/resumeIntakeApi';
import {ResumeBulkSelection} from './ResumeBulkSelection';
import {ResumeReviewTable} from './ResumeReviewTable';
import {ResumeAtsRange} from './ResumeAtsRange';
import {uploadResumeSelection} from '../lib/resumeBulkUpload';
import {ResumeFilePicker} from './ResumeFilePicker';
import {ResumeProfileDialog, IntakeStatus} from './ResumeProfileDialog';
import {EmptyNote, PAButton, SectionHeader} from './ui/primitives';
import {Modal} from './ui/Modal';

const MODES = [{key:'single',label:'Single resume',icon:FileText},{key:'files',label:'Multiple resumes',icon:Upload},{key:'zip',label:'ZIP archive',icon:Archive},{key:'excel',label:'Excel import',icon:FileSpreadsheet}];
const SOURCE = ['local','linkedin','naukri','referral','email','other'];
const STATUS = ['uploaded','queued','processing','review_required','duplicate_suspected','confirming','completed','duplicate','failed','rejected','unsupported_format','scan_required','virus_detected','password_protected','ocr_required','conversion_required','confirmation_paused','deleted'];
const label = (value:string) => value.replaceAll('_',' ').replace(/^./, s=>s.toUpperCase());

export default function ResumeIntakePage({capabilities, initialJobKey='', scopedJob}:{capabilities:Capabilities;initialJobKey?:string;scopedJob?:Job}) {
  const {user} = useAuth();
  const [caps,setCaps] = useState(capabilities);
  const [view,setView] = useState<'upload'|'batches'|'candidates'>(caps.canUpload?'upload':'batches');
  const [mode,setMode] = useState('single'); const [source,setSource] = useState('local');
  const [jobs,setJobs] = useState<Job[]>(scopedJob?[scopedJob]:[]); const [jobId,setJobId] = useState(scopedJob?.jobId||''); const [jobSearch,setJobSearch] = useState(''); const [jobPage,setJobPage] = useState(0); const [moreJobs,setMoreJobs] = useState(false);
  const [files,setFiles] = useState<File[]>([]); const [archive,setArchive] = useState<File[]>([]); const [consent,setConsent] = useState(false);
  const [uploading,setUploading] = useState(false); const [uploadProgress,setUploadProgress] = useState(0); const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [message,setMessage] = useState('');
  const [batches,setBatches] = useState<IntakeBatch[]>([]); const [batchPage,setBatchPage] = useState(0); const [moreBatches,setMoreBatches] = useState(false); const [batchId,setBatchId] = useState('');
  const [data,setData] = useState<BatchPage|null>(null); const [page,setPage] = useState(0); const [status,setStatus] = useState(''); const [search,setSearch] = useState(''); const [loading,setLoading] = useState(false); const [reload,setReload] = useState(0);
  const [scoreBand,setScoreBand] = useState(''); const [creationOpen,setCreationOpen] = useState(false);
  const [review,setReview] = useState<IntakeItem|null>(null); const [deleteItem,setDeleteItem] = useState<IntakeItem|null>(null); const [reason,setReason] = useState(''); const [settingsOpen,setSettingsOpen] = useState(false);
  const [candidates,setCandidates] = useState<CandidateRow[]>([]); const [candidatePage,setCandidatePage] = useState(0); const [moreCandidates,setMoreCandidates] = useState(false);
  const key = useRef(''); const uploadAbort = useRef<AbortController|null>(null); const latestStatus = useRef('');
  const selectedJob = jobs.find(job=>job.jobId===jobId);
  const eligible = !!selectedJob && acceptsResumes(selectedJob) && hasJobAccess(user,'upload',selectedJob);
  const changed = () => setReload(n=>n+1);
  const resetUpload = () => {key.current='';setConsent(false);};
  useEffect(()=>()=>uploadAbort.current?.abort(),[]);
  useEffect(()=>{
    const controller=new AbortController();let inFlight=false;
    const timer=setInterval(async()=>{
      if(document.hidden||inFlight)return;inFlight=true;
      try{const fresh=await intakeGet<Capabilities>('/capabilities',controller.signal);if(!controller.signal.aborted)setCaps(fresh);}
      catch{/* Existing upload files and results remain usable during a temporary outage. */}
      finally{inFlight=false;}
    },30000);
    return()=>{controller.abort();clearInterval(timer);};
  },[]);

  useEffect(()=>{
    if(scopedJob)return;
    let cancelled=false;
    const timer=setTimeout(()=>{
      void fetchJobsPage({q:jobSearch,status:view==='upload'?'OPEN':undefined,skip:jobPage*50,limit:50,sort:'createdAt',order:'desc'}).then(result=>{
        if(cancelled)return;
        const incoming=view==='upload'?result.items.filter(job=>acceptsResumes(job)&&hasJobAccess(user,'upload',job)):result.items;
        setJobs(prev=>jobPage?[...prev,...incoming.filter(job=>!prev.some(p=>p.jobId===job.jobId))]:incoming);
        setMoreJobs((jobPage+1)*50<result.total);
        if(!jobId||!jobSearch&&jobPage===0&&!incoming.some(job=>job.jobId===jobId))setJobId(incoming.find(job=>job.jobKey===initialJobKey)?.jobId||incoming[0]?.jobId||'');
      }).catch(e=>{if(!cancelled)setError(e.message);});
    },250);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[jobSearch,jobPage,view,user?.userId]);
  useEffect(()=>{
    const controller=new AbortController();
    void intakeGet<{items:IntakeBatch[];hasMore:boolean}>(`/batches?skip=${batchPage*10}&limit=10${scopedJob?`&jobId=${encodeURIComponent(scopedJob.jobId)}`:""}`,controller.signal).then(result=>{
      setBatches(result.items);setMoreBatches(result.hasMore);if(!batchId&&result.items.length)setBatchId(result.items[0].batchId);
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[batchPage,reload]);
  useEffect(()=>{
    if(!batchId)return;
    const controller=new AbortController();let inFlight=false;
    setLoading(true);
    async function refresh() {
      if(inFlight)return;inFlight=true;
      try {
        const query=new URLSearchParams({skip:String(page*25),limit:'25',q:search});if(status)query.set('status',status);if(scoreBand)query.set('scoreBand',scoreBand);
        const result=await intakeGet<BatchPage>(`/batches/${batchId}?${query}`,controller.signal);
        if(!controller.signal.aborted){setData(result);latestStatus.current=result.batch.status;setBatches(prev=>prev.map(b=>b.batchId===batchId?result.batch:b));}
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not refresh results.');}
      finally{inFlight=false;if(!controller.signal.aborted)setLoading(false);}
    }
    const delay=setTimeout(()=>void refresh(),200);
    const timer=setInterval(()=>{if((latestStatus.current==='processing'||creationOpen)&&document.visibilityState==='visible')void refresh();},3000+Math.random()*500);
    return()=>{controller.abort();clearTimeout(delay);clearInterval(timer);};
  },[batchId,page,status,scoreBand,search,reload,creationOpen]);
  useEffect(()=>{
    if(view!=='candidates'||!jobId)return;
    const controller=new AbortController();setLoading(true);
    void intakeGet<{items:CandidateRow[];hasMore:boolean}>(`/candidates?jobId=${encodeURIComponent(jobId)}&skip=${candidatePage*25}&limit=25`,controller.signal).then(result=>{setCandidates(result.items);setMoreCandidates(result.hasMore);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[view,jobId,candidatePage,reload]);

  async function action(work:()=>Promise<unknown>,success='') {
    setBusy(true);setError('');setMessage('');
    try{await work();setMessage(success);changed();}catch(e){setError(e instanceof Error?e.message:'Action failed.');}finally{setBusy(false);}
  }
  async function open(itemId:string) {
    await action(async()=>{
      const detail=await intakeGet<IntakeItem>(`/items/${itemId}`);
      const revealed=caps.canUpload&&detail.canEdit!==false?await intakeMutate<IntakeItem>(`/items/${itemId}/reveal`,{}):detail;
      setReview({...detail,...revealed,ats:detail.ats,atsStale:detail.atsStale,matches:detail.matches,notes:detail.notes});
    });
  }
  async function submit(e:React.FormEvent) {
    e.preventDefault();if(!eligible||!consent||!files.length)return;
    setError('');setUploading(true);setUploadProgress(0);key.current ||= crypto.randomUUID();
    const controller=new AbortController();uploadAbort.current=controller;
    try {
      const batch=await uploadResumeSelection({jobId,mode,source,files,companion:archive[0]||null,key:key.current,signal:controller.signal,
        chunkSize:Math.min(10,Math.floor(64/caps.limits.resumeMaxMb)),
        onAccepted:(received,count)=>{setUploadProgress(count);setBatches(prev=>[received,...prev.filter(p=>p.batchId!==received.batchId)]);setMessage(`${count} of ${files.length} files received. Accepted files remain queued if the upload is interrupted.`);}});
      setFiles([]);setArchive([]);resetUpload();setBatchPage(0);setBatches(prev=>[batch,...prev.filter(p=>p.batchId!==batch.batchId)]);setBatchId(batch.batchId);setPage(0);setStatus('');setScoreBand('');setSearch('');setView('batches');latestStatus.current='processing';
      setMessage(`${files.length} file${files.length===1?'':'s'} received. Parsing continues on the server. Each small upload appears as a batch in Processing & review.`);changed();
    } catch(e) {if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Upload failed. Your files remain selected for retry.');}
    finally{setUploading(false);}
  }
  const completed = data ? data.batch.counts.total - (data.batch.counts.queued||0) - (data.batch.counts.processing||0) - (data.batch.counts.uploaded||0) : 0;

  return <div className="space-y-6" aria-label="Resume intake workspace">
    <SectionHeader eyebrow="Hiring pipeline · Module 2" title="Resume Upload" subtitle="Import resumes, review candidate information and evaluate each job application."
      action={caps.canAdmin?<PAButton variant="secondary" type="button" onClick={()=>setSettingsOpen(true)}><Settings2 size={15}/>Settings</PAButton>:undefined}/>
    <div role="tablist" aria-label="Resume workspace" className="flex flex-wrap gap-2">
      {(caps.canUpload?[['upload','Upload resumes'],['batches','Processing & review'],['candidates','Candidate database']]:[['batches','Processing results'],['candidates','Candidate database']]).map(([id,title])=><Button variant="ghost" key={id} role="tab" aria-selected={view===id} onClick={()=>{setView(id as typeof view);setJobSearch('');setJobPage(0);}}
        className={`rounded-xl border px-4 py-3 text-xs font-bold ${view===id?'border-primary/40 bg-primary/15 text-foreground':'border-border bg-card text-muted-foreground'}`}>{title}</Button>)}
    </div>
    {error&&<p role="alert" className="break-words rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">{error}</p>}
    {message&&<p role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs">{message}</p>}
    {caps.canAdmin&&caps.workerReady===false&&<p role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs">Processing is waiting for a resume worker. Uploads remain safely queued until a worker connects.</p>}
    {caps.canAdmin&&caps.workerReady&&caps.scannerReady===false&&<p role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs">The malware scanner is unavailable. Files remain blocked until scanning succeeds; retry them after the scanner reconnects.</p>}
    {(view==='upload'||view==='candidates')&&<section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-2 text-xs font-bold">Find a job<Input aria-label="Find a job" value={jobSearch} disabled={uploading||!!scopedJob} onChange={e=>{setJobSearch(e.target.value);setJobPage(0);}} className="ehr-input p-3 font-normal" placeholder="Search by title, role or company"/></label>
      <label className="flex flex-col gap-2 text-xs font-bold">Job profile<AppSelect aria-label="Job profile" value={jobId} disabled={uploading||!!scopedJob} onValueChange={e=>{setJobId(e);setCandidatePage(0);resetUpload();}} className="ehr-input min-w-0 p-3 font-normal"><option value="">{jobs.length?'Choose a job':'No eligible jobs available'}</option>{jobs.map(job=><option key={job.jobId} value={job.jobId}>{job.title} · {job.jobKey}</option>)}</AppSelect></label></div>
      {moreJobs&&<Button variant="ghost" className="mt-3 text-xs font-bold text-primary" type="button" onClick={()=>setJobPage(n=>n+1)}>Load more jobs</Button>}
    </section>}
    {view==='upload'&&caps.canUpload&&<form onSubmit={submit} aria-label="Module 2 upload" aria-busy={uploading} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
      <fieldset disabled={uploading}><legend className="mb-3 text-xs font-bold">Upload mode</legend><RadioGroup name="uploadMode" value={mode} disabled={uploading} onValueChange={value=>{setMode(value as typeof mode);setFiles([]);setArchive([]);resetUpload();}} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{MODES.map(choice=><label key={choice.key} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-xs font-bold ${mode===choice.key?'border-primary/50 bg-primary/10':'border-border'}`}><RadioGroupItem value={choice.key}/><choice.icon size={16}/>{choice.label}</label>)}</RadioGroup></fieldset>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]"><div className="min-w-0 space-y-5">
        <ResumeFilePicker files={files} onChange={next=>{setFiles(next);resetUpload();}} uploading={uploading} disabled={!eligible} maxFiles={mode==='files'?1000:1}
          accept={mode==='zip'?'.zip':mode==='excel'?'.xlsx':'.pdf,.docx,.doc'} maxMb={mode==='zip'?caps.limits.zipMaxMb:mode==='excel'?caps.limits.excelMaxMb:caps.limits.resumeMaxMb}
          formatLabel={mode==='zip'?'ZIP':mode==='excel'?'XLSX':'PDF, DOCX or DOC'} noun={mode==='zip'?'resume ZIP':mode==='excel'?'candidate Excel sheet':'resumes'}/>
        {mode==='files'&&<p className="text-xs leading-relaxed text-muted-foreground">Select up to 1,000 resumes. Files upload in small batches so you can retry interruptions without duplicating accepted files. Parsing continues one at a time on the free deployment.</p>}
        {mode==='zip'&&<p className="text-xs leading-relaxed text-muted-foreground">Up to {caps.limits.zipMaxFiles} resumes. Unsafe paths, nested archives and unsupported entries are rejected individually. Valid resumes are kept.</p>}
        {mode==='excel'&&<div className="space-y-4 rounded-xl border border-border p-4"><p className="text-xs leading-relaxed text-muted-foreground">Use the prescribed template, up to {caps.limits.excelMaxRows.toLocaleString()} rows. Candidate name and email or phone are required. Optionally link resumes by file name from a ZIP.</p><PAButton type="button" variant="secondary" onClick={()=>void action(()=>intakeDownload('/template','primehire-candidate-template.xlsx'))}><Download size={14}/>Download Excel template</PAButton><details><summary className="cursor-pointer text-xs font-bold">Attach a resume ZIP (optional)</summary><div className="mt-3"><ResumeFilePicker files={archive} onChange={next=>{setArchive(next);resetUpload();}} maxFiles={1} maxMb={caps.limits.zipMaxMb} accept=".zip" formatLabel="ZIP" noun="resume ZIP" inputLabel="Resume archive files" uploading={uploading} disabled={!eligible}/></div></details></div>}
      </div><aside className="rounded-2xl border border-border bg-background/50 p-5"><h3 className="text-sm font-bold">Upload summary</h3><p className="mt-4 text-xs font-semibold">{selectedJob?.title||'Choose an open job'}</p><p className="mt-2 text-xs text-muted-foreground">{files.length} selected · {label(mode)} · {label(source)}</p>
        <label className="mt-5 flex flex-col gap-2 text-xs font-semibold">Upload source<AppSelect value={source} disabled={uploading} onValueChange={e=>{setSource(e);resetUpload();}} className="ehr-input p-3">{SOURCE.map(value=><option key={value} value={value}>{value==='linkedin'?'LinkedIn':value==='naukri'?'Naukri':label(value)}</option>)}</AppSelect></label>
        <label className="mt-5 flex items-start gap-3 text-xs leading-relaxed"><Checkbox  checked={consent} disabled={uploading} onCheckedChange={e=>setConsent(e)} aria-label="Candidate consent confirmed" className="mt-1 shrink-0 accent-amber-600"/><span>I confirm candidates consented to processing their information for this hiring workflow.</span></label>
        <PAButton type="submit" disabled={uploading||!eligible||!consent||!files.length} className="mt-5 w-full py-3">{uploading?<Loader2 className="animate-spin" size={16}/>:<Upload size={16}/>} {uploading?`Uploading ${uploadProgress} / ${files.length}…`:'Upload resumes'}</PAButton>
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted-foreground">{uploading?'Keep this page open until the upload is received.':!eligible?'Only open jobs with upload access accept new resumes.':'Files are securely queued, then reviewed before creating candidate applications.'}</p>
        <div className="mt-5 flex gap-2 border-t border-border pt-4 text-[0.6875rem] leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="shrink-0"/><span>Security scanning is required. Scanned resumes that need OCR or conversion remain clearly identifiable for retry.</span></div>
      </aside></div>
    </form>}
    {view==='batches'&&<div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5"><div className="flex flex-wrap items-end gap-3"><label className="flex min-w-0 flex-1 flex-col gap-2 text-xs font-bold">Upload batch<AppSelect value={batchId} onValueChange={e=>{setBatchId(e);setData(null);setPage(0);setStatus('');setScoreBand('');}} aria-label="Upload batch" className="ehr-input min-w-0 p-3 font-normal"><option value="">Choose a batch</option>{batches.map(batch=><option key={batch.batchId} value={batch.batchId}>{batch.jobTitle} · {label(batch.mode)} · {new Date(batch.createdAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</option>)}</AppSelect></label><PAButton type="button" variant="secondary" onClick={changed}><RefreshCw size={15}/>Refresh</PAButton></div>
      <div className="mt-3 flex justify-end gap-2"><PAButton variant="secondary" disabled={!batchPage} onClick={()=>setBatchPage(n=>n-1)}>Previous batches</PAButton><PAButton variant="secondary" disabled={!moreBatches} onClick={()=>setBatchPage(n=>n+1)}>More batches</PAButton></div></section>
      {!batchId&&<EmptyNote>No uploads yet. Start with a resume, ZIP or Excel import.</EmptyNote>}
      {data&&data.batch.batchId===batchId&&<section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="border-b border-border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold">{data.batch.jobTitle}</h3><p className="mt-1 text-xs text-muted-foreground">{data.batch.jobKey} · {data.batch.counts.total} records · {label(data.batch.mode)}</p></div><IntakeStatus status={data.batch.status}/></div>
        {data.batch.importComplete?<><div className="mt-4 flex justify-between text-xs text-muted-foreground"><span>Validation & parsing</span><span>{completed} / {data.batch.counts.total}</span></div><Progress aria-label="Import processing progress" value={Math.max(0,completed)} max={Math.max(1,data.batch.counts.total)} className="mt-2 w-full [&_[data-slot=progress-track]]:h-2"/></>:<p role="status" className="mt-4 flex gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin"/>Inspecting and importing files… Processing continues even if you leave this page.</p>}
        {data.batch.bulkApprovalResult&&<p className="mt-3 text-xs text-muted-foreground">Profile creation: {data.batch.bulkApprovalResult.queued} queued · {data.batch.bulkApprovalResult.skipped} skipped or require individual review.</p>}
        {data.batch.error&&<p className="mt-3 text-xs text-destructive">{data.batch.error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">{caps.canUpload&&<><PAButton variant="secondary" onClick={()=>void action(()=>intakeDownload(`/batches/${batchId}/report`,'resume-processing-report.csv'))}>Processing report</PAButton><PAButton variant="secondary" onClick={()=>void action(()=>intakeDownload(`/batches/${batchId}/report?errorsOnly=true`,'resume-errors.csv'))}>Error report</PAButton><PAButton variant="secondary" onClick={()=>void action(()=>intakeDownload(`/batches/${batchId}/export?format=xlsx`,'candidate-export.xlsx'))}>Export Excel</PAButton><PAButton variant="secondary" onClick={()=>void action(()=>intakeDownload(`/batches/${batchId}/export?format=csv`,'candidate-export.csv'))}>Export CSV</PAButton><PAButton disabled={busy||!data.batch.importComplete||data.batch.bulkApprovalRunning||!data.batch.atsRange||!(data.batch.atsStats?.within)||!!data.batch.atsPending} onClick={()=>{setCreationOpen(true);void action(async()=>{await intakeMutate(`/batches/${batchId}/confirm`,{reviewed:true,atsRangeRevision:data.batch.atsRangeRevision??0});latestStatus.current='processing';},'Profile creation queued for the saved ATS range. Valid profiles will be created automatically; records needing corrections remain available for review.');}}>{data.batch.bulkApprovalRunning?'Creating profiles…':'Create profiles in ATS range'}</PAButton></>}</div></div>
        {data.batch.importComplete && completed > 0 && <ResumeAtsRange batch={{...data.batch,canSetAtsRange:!!data.batch.canSetAtsRange&&caps.canUpload}} onSaved={()=>{latestStatus.current='processing';changed();}}/>}
        <div className="px-5 pt-2"><label className="flex flex-col gap-2 text-xs font-bold">ATS eligibility<AppSelect aria-label="ATS eligibility" value={scoreBand} disabled={!data.batch.atsRange} onValueChange={value=>{setScoreBand(value);setPage(0);}} className="ehr-input p-3 font-normal"><option value="">All resumes, including outside the range</option><option value="within">Within selected range</option><option value="below">Below selected minimum</option><option value="above">Above selected maximum</option><option value="pending">Awaiting a current score</option></AppSelect></label></div>
        {caps.canUpload&&<p className="px-5 pb-2 text-xs leading-relaxed text-muted-foreground">Create profiles in ATS range processes this entire upload across all pages, using the saved range. No individual confirmation is needed for valid profiles. Extracted names are accepted without individual review. Missing contacts and identity conflicts remain for review.</p>}
        <div className="grid gap-3 p-5 sm:grid-cols-2"><label className="flex flex-col gap-2 text-xs font-bold">Find a resume or candidate<Input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} className="ehr-input p-3 font-normal"/></label><label className="flex flex-col gap-2 text-xs font-bold">Processing status<AppSelect value={status} onValueChange={e=>{setStatus(e);setPage(0);}} aria-label="Processing status" className="ehr-input p-3 font-normal"><option value="">All statuses</option>{STATUS.map(value=><option key={value} value={value}>{label(value)}</option>)}</AppSelect></label></div>
        {loading&&<p role="status" className="px-5 pb-3 text-xs text-muted-foreground">Refreshing results…</p>}
        <ResumeBulkSelection key={`${batchId}:${status}:${scoreBand}:${search}`} batchId={batchId} query={new URLSearchParams({...status?{status}:{},...scoreBand?{scoreBand}:{},q:search}).toString()} items={data.items} total={data.total} enabled={caps.canAdmin&&!busy} onChanged={changed}>{selection=><ResumeReviewTable selection={selection} items={data.items} caps={caps} jobs={jobs} busy={busy} onOpen={id=>void open(id)} onRetry={item=>void action(()=>intakeMutate(`/items/${item.itemId}/retry`,{expectedRevision:item.revision}),'Retry queued.')} onDelete={item=>{setError('');setDeleteItem(item);setReason('');}} onChanged={changed} onAssociated={id=>{setBatchId(id);setPage(0);setStatus('');setScoreBand('');changed();}}/>}</ResumeBulkSelection>

        {!data.items.length&&!loading&&<div className="p-5"><EmptyNote>No records match these filters.</EmptyNote></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5 text-xs text-muted-foreground"><span>Page {page+1} · {data.total} matching records</span><div className="flex gap-2"><PAButton variant="secondary" disabled={!page} onClick={()=>setPage(n=>n-1)}>Previous</PAButton><PAButton variant="secondary" disabled={(page+1)*25>=data.total} onClick={()=>setPage(n=>n+1)}>Next</PAButton></div></div>
      </section>}
    </div>}
    {view==='candidates'&&<section className="space-y-4 rounded-2xl border border-border bg-card p-5"><h3 className="flex items-center gap-2 text-base font-bold"><Users size={18} className="text-primary"/>Candidates for the selected job</h3><p className="text-xs text-muted-foreground">One person can have several job applications. The score shown here belongs to this job.</p>{loading&&<p role="status" className="text-xs">Loading candidates…</p>}{!candidates.length&&!loading&&<EmptyNote>No confirmed candidates for this job.</EmptyNote>}
      <div className="grid gap-3 sm:grid-cols-2">{candidates.map(candidate=><article key={candidate.applicationId} className="min-w-0 rounded-xl border border-border p-4"><p className="text-sm font-bold">{candidate.name}</p><p className="mt-2 break-words text-xs text-muted-foreground">{candidate.email||'Email not available'} · {candidate.phone||'Phone not available'}</p><p className="mt-3 text-xs font-semibold">ATS {candidate.score==null?'not available':`${candidate.score}/100`} · {candidate.ats?.category||label(candidate.stage)}</p>{candidate.itemId&&<PAButton className="mt-3" variant="secondary" onClick={()=>void open(candidate.itemId)}>View candidate profile</PAButton>}</article>)}</div>
      <div className="flex justify-end gap-2"><PAButton variant="secondary" disabled={!candidatePage} onClick={()=>setCandidatePage(n=>n-1)}>Previous</PAButton><PAButton variant="secondary" disabled={!moreCandidates} onClick={()=>setCandidatePage(n=>n+1)}>Next</PAButton></div>
    </section>}
    {review&&<ResumeProfileDialog item={review} caps={{...caps,canUpload:caps.canUpload&&review.canEdit!==false,canAssign:caps.canAssign&&review.canEdit!==false}} jobs={jobs} onClose={()=>setReview(null)} onChanged={changed} onAssociated={id=>{setReview(null);setBatchId(id);setPage(0);setStatus('');setScoreBand('');setView('batches');changed();}}/>}
    {deleteItem&&<Modal label="Delete original resume" onClose={()=>setDeleteItem(null)} dismissible={!busy} className="max-w-md p-6"><h2 className="text-lg font-bold">Delete this resume version?</h2>{error&&<p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}<p className="my-4 text-xs text-muted-foreground">The original document becomes unavailable across its associations. Candidate and application records remain.</p><label className="flex flex-col gap-2 text-xs font-bold">Reason<Textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} className="ehr-input p-3"/></label><div className="mt-5 flex justify-end gap-2"><PAButton variant="secondary" disabled={busy} onClick={()=>setDeleteItem(null)}>Cancel</PAButton><PAButton disabled={busy||reason.trim().length<3} onClick={()=>void action(async()=>{await intakeMutate(`/items/${deleteItem.itemId}`,{reason,expectedRevision:deleteItem.revision},'DELETE');setDeleteItem(null);},'Resume version deleted.')}>Delete resume</PAButton></div></Modal>}

    {creationOpen&&data&&<Modal label="Candidate creation progress" onClose={()=>setCreationOpen(false)} className="max-w-md p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold">{(busy||data.batch.bulkApprovalRunning||!!data.batch.counts.confirming)&&<Loader2 size={18} className="animate-spin"/>}Candidate profile creation</h2>
      <p role="status" aria-live="polite" className="mt-4 text-sm">{busy?'Submitting your request…':data.batch.bulkApprovalRunning?'Preparing profiles in your saved ATS range…':data.batch.counts.confirming?'Creating profiles in the background…':error?'The request could not finish. See the error below.':'Processing finished. Profiles that need attention remain available for review.'}</p>
      <div className="my-4 space-y-2 text-sm tabular-nums"><p>Created in this upload: <strong>{data.batch.counts.completed||0}</strong></p><p>Already existing: <strong>{data.batch.counts.duplicate||0}</strong></p><p>Waiting to finish creation: <strong>{data.batch.counts.confirming||0}</strong></p><p>Still in the ATS range: <strong>{data.batch.atsStats?.within||0}</strong></p></div>
      {data.batch.bulkApprovalResult&&<p className="text-xs text-muted-foreground">Last batch request: {data.batch.bulkApprovalResult.queued} queued · {data.batch.bulkApprovalResult.skipped} skipped (including outside the range or requiring corrections).</p>}
      {error&&<p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {data.batch.error&&<p role="alert" className="mt-3 text-xs text-destructive">{data.batch.error}</p>}
      <p className="mt-4 text-xs text-muted-foreground">Counts refresh automatically and include this entire upload. You can close this window; processing continues in the background.</p>
      <PAButton className="mt-5" variant="secondary" onClick={()=>setCreationOpen(false)}>Close</PAButton>
    </Modal>}
    {settingsOpen&&<IntakeSettingsDialog caps={caps} onClose={()=>setSettingsOpen(false)} onSaved={limits=>{setCaps(prev=>({...prev,limits,settingsRevision:prev.settingsRevision+1}));setSettingsOpen(false);}}/>}
  </div>;
}

function IntakeSettingsDialog({caps,onClose,onSaved}:{caps:Capabilities;onClose:()=>void;onSaved:(limits:Limits)=>void}) {
  const [limits,setLimits]=useState(caps.limits);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const names:Record<string,string>={resumeMaxMb:'Resume size (MB)',zipMaxMb:'ZIP size (MB)',zipMaxFiles:'Resumes per ZIP',expandedMaxMb:'ZIP expanded size (MB)',excelMaxMb:'Excel size (MB)',excelMaxRows:'Excel rows',excellentAt:'Excellent score starts at',goodAt:'Good score starts at',moderateAt:'Moderate score starts at'};
  return <Modal label="Resume module settings" onClose={onClose} dismissible={!busy}><h2 className="text-lg font-bold">Resume module settings</h2><p className="my-3 text-xs text-muted-foreground">Safe upper bounds remain enforced. Changes apply to new uploads; accepted batches retain their intake limits.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await intakeMutate('/settings',{settings:limits,expectedRevision:caps.settingsRevision},'PUT');onSaved(limits);}catch(e){setError(e instanceof Error?e.message:'Settings failed.');}finally{setBusy(false);}}}>
    <div className="grid gap-3 sm:grid-cols-2">{Object.entries(names).map(([key,name])=><label key={key} className="flex flex-col gap-2 text-xs font-semibold">{name}<Input type="number" value={Number(limits[key as keyof Limits])} onChange={e=>setLimits(prev=>({...prev,[key]:Number(e.target.value)}))} className="ehr-input p-3" min={1} required/></label>)}</div><label className="mt-4 flex items-start gap-2 text-xs"><Checkbox  checked={limits.viewerDownloads} onCheckedChange={e=>setLimits(prev=>({...prev,viewerDownloads:e}))} className="accent-amber-600"/>Allow viewers to download originals for their assigned jobs.</label>{error&&<p role="alert" className="mt-4 text-xs text-destructive">{error}</p>}<div className="mt-5 flex justify-end gap-2"><PAButton variant="secondary" type="button" disabled={busy} onClick={onClose}>Cancel</PAButton><PAButton type="submit" disabled={busy}>Save settings</PAButton></div></form></Modal>;
}

