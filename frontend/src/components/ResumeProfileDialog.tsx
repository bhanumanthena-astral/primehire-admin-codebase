import {Textarea} from '@/components/ui/textarea';
import {Input} from '@/components/ui/input';
import {AppSelect} from '@/src/components/ui/AppSelect';
import {Button} from '@/components/ui/button';
import React, {useEffect, useState} from 'react';
import {FileText, Loader2, RefreshCw, Download, CheckCircle2} from 'lucide-react';
import {Modal} from './ui/Modal';
import {PAButton, Pill} from './ui/primitives';
import {Capabilities, IntakeItem, Profile, intakeGet, intakeMutate, intakeDownload, intakeBlob} from '../lib/resumeIntakeApi';
import {Job, fetchJobsPage} from '../lib/hiringApi';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';

export const readableStatus = (status: string) => status.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase());
export function IntakeStatus({status}: {status: string}) {
  const tone = ['completed', 'duplicate'].includes(status) ? 'success' : ['failed', 'rejected', 'virus_detected', 'unsupported_format', 'password_protected'].includes(status) ? 'danger' : ['review_required', 'duplicate_suspected', 'scan_required', 'ocr_required', 'confirmation_paused', 'conversion_required'].includes(status) ? 'warning' : 'info';
  return <Pill tone={tone}>{readableStatus(status)}</Pill>;
}

const OPTIONAL: {key: string; label: string; type?: string}[] = [
  {key:'currentLocation', label:'Current location'}, {key:'preferredLocations',label:'Preferred locations',type:'list'},
  {key:'currentCompany',label:'Current company'}, {key:'currentDesignation',label:'Current designation'},
  {key:'department',label:'Department'}, {key:'role',label:'Role'}, {key:'industry',label:'Industry'},
  {key:'headline',label:'Resume headline'}, {key:'summary',label:'Summary',type:'textarea'}, {key:'education',label:'Education',type:'list'},
  ...['ug','pg','doctorate'].flatMap(level => [
    {key:`${level}Degree`,label:`${level.toUpperCase()} degree`}, {key:`${level}Specialization`,label:`${level.toUpperCase()} specialization`},
    {key:`${level}University`,label:`${level.toUpperCase()} university`}, {key:`${level}GraduationYear`,label:`${level.toUpperCase()} graduation year`,type:'number'},
  ]),
  {key:'homeTown',label:'Home town'}, {key:'pinCode',label:'Postal code'}, {key:'dateOfBirth',label:'Date of birth',type:'date'},
];

export function ResumeProfileDialog({item: initial, caps, jobs, onClose, onChanged, onAssociated, embedded=false}: {
  embedded?: boolean; item: IntakeItem; caps: Capabilities; jobs: Job[]; onClose: () => void; onChanged: () => void; onAssociated?: (batchId: string) => void;
}) {
  const [item, setItem] = useState(initial);
  const [profile, setProfile] = useState<Profile>({name:'',email:'',phone:'',skills:[],experienceYears:null,...initial.profile} as Profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [note, setNote] = useState('');
  const [targetJob, setTargetJob] = useState('');
  const [associationJobs,setAssociationJobs]=useState(jobs);
  const [jobSearch,setJobSearch]=useState('');
  const [jobPage,setJobPage]=useState(0);
  const [moreJobs,setMoreJobs]=useState(false);
  const [assignee, setAssignee] = useState('');
  const [assignees, setAssignees] = useState<{userId:string;name:string;role:string}[]>([]);
  const [reviewerSearch,setReviewerSearch]=useState('');
  const [reviewerPage,setReviewerPage]=useState(0);
  const [moreReviewers,setMoreReviewers]=useState(false);
  const [versions, setVersions] = useState<IntakeItem[]>([]);
  const [versionsSkip, setVersionsSkip] = useState(0);
  const [moreVersions, setMoreVersions] = useState(false);
  const [preview, setPreview] = useState('');
  const waiting = ['queued','processing','confirming'].includes(item.status) || ['queued','scoring'].includes(item.atsState||'');
  const complete = ['completed','duplicate'].includes(item.status);
  const dirty = JSON.stringify(profile)!==JSON.stringify({name:'',email:'',phone:'',skills:[],experienceYears:null,...item.profile});
  const editable = caps.canUpload && ['review_required','duplicate_suspected','completed','duplicate'].includes(item.status);

  useEffect(()=>{if(embedded)setItem(initial);},[initial,embedded]);
  useEffect(()=>{
    if(!caps.canUpload||!complete)return;
    let cancelled=false;
    const timer=setTimeout(()=>{
      void fetchJobsPage({q:jobSearch,status:'OPEN',skip:jobPage*50,limit:50,sort:'createdAt',order:'desc'}).then(result=>{
        if(cancelled)return;
        setAssociationJobs(prev=>jobPage?[...prev,...result.items.filter(job=>!prev.some(old=>old.jobId===job.jobId))]:result.items);
        setMoreJobs((jobPage+1)*50<result.total);
      }).catch(e=>{if(!cancelled)setError(e.message);});
    },250);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[caps.canUpload,complete,jobSearch,jobPage]);

  useEffect(()=>{
    if(!caps.canAssign||!complete)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      void intakeGet<{items:typeof assignees;hasMore:boolean}>(`/assignees?skip=${reviewerPage*50}&limit=50&q=${encodeURIComponent(reviewerSearch)}`,controller.signal).then(result=>{
        if(controller.signal.aborted)return;
        setAssignees(prev=>reviewerPage?[...prev,...result.items.filter(actor=>!prev.some(old=>old.userId===actor.userId))]:result.items);
        setMoreReviewers(result.hasMore);
      }).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
    },250);
    return()=>{controller.abort();clearTimeout(timer);};
  },[caps.canAssign,complete,reviewerSearch,reviewerPage]);

  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController(); let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return; inFlight = true;
      try {
        let fresh = await intakeGet<IntakeItem>(`/items/${item.itemId}`, controller.signal);
        const finished = !['queued','processing','confirming'].includes(fresh.status) && !['queued','scoring'].includes(fresh.atsState||'');
        if (finished && !embedded && caps.canUpload && fresh.canEdit !== false) {
          const revealed = await intakeMutate<IntakeItem>(`/items/${item.itemId}/reveal`, {});
          fresh = {...fresh,...revealed};
        }
        if (!controller.signal.aborted) {
          setItem(prev => ({...prev,...fresh}));
          if (finished) {setProfile({name:'',email:'',phone:'',skills:[],experienceYears:null,...fresh.profile} as Profile);onChanged();}
        }
      } catch (e) {if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Refresh failed.');}
      finally {inFlight = false;}
    }, 2500);
    return () => {controller.abort(); clearInterval(timer);};
  }, [item.itemId, waiting]);
  useEffect(() => () => {if (preview) URL.revokeObjectURL(preview);}, [preview]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {await action(); setMessage(success); onChanged();}
    catch (e) {setError(e instanceof Error ? e.message : 'Action failed.');}
    finally {setBusy(false);}
  }
  async function update(path: string, body: unknown, method = 'POST') {
    const result = await intakeMutate<IntakeItem>(`/items/${item.itemId}/${path}`, body, method);
    setItem(prev => ({...prev,...result}));
    if(path==='review')setProfile({name:'',email:'',phone:'',skills:[],experienceYears:null,...result.profile} as Profile);
    return result;
  }
  async function loadVersions(skip = 0) {
    await act(async () => {
      const result = await intakeGet<{items:IntakeItem[];hasMore:boolean}>(`/items/${item.itemId}/versions?skip=${skip}&limit=20`);
      setVersions(prev => skip ? [...prev,...result.items] : result.items);
      setVersionsSkip(skip + result.items.length);
      setMoreVersions(result.hasMore);
    }, '');
  }
  function field(key: string, label: string, type = 'text') {
    const value = profile[key];
    const text = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value);
    const change = (value: string) => setProfile(prev => ({...prev, [key]: type === 'date' && !value ? null : type === 'number' ? value === '' ? null : Number(value) : type === 'list' ? value.split(',').map(v => v.trim()).filter(Boolean) : value}));
    const maximum=key==='email'?254:key==='phone'?25:key==='pinCode'?12:key==='headline'?250:key==='currentCompany'||key.endsWith('Specialization')?150:key.endsWith('University')?200:100;
    const needsReview=item.confidence?.[key]==='review';
    return <label key={key} className={`flex flex-col gap-1.5 text-xs font-semibold ${type === 'textarea' ? 'sm:col-span-2' : ''}`}>
      {label}{type === 'textarea' ? <Textarea value={text} onChange={e=>change(e.target.value)} disabled={!editable||busy||waiting} rows={4} maxLength={5000} className="ehr-input p-3 font-normal"/> :
        <Input aria-label={label} type={['number','date'].includes(type)?type:'text'} value={text} onChange={e=>change(e.target.value)} disabled={!editable||busy||waiting}
          step={key==='experienceYears'?'0.1':undefined} min={type==='number'?key.endsWith('GraduationYear')?1900:0:undefined}
          max={key==='experienceYears'?50:undefined} maxLength={type==='list'?30000:maximum}
          minLength={['name','currentLocation','currentCompany','currentDesignation','department','role','industry','homeTown'].includes(key)?2:undefined}
          className="ehr-input min-w-0 p-3 font-normal"/>}
      {needsReview&&!complete&&<span className="text-[0.6875rem] font-normal text-warning">Suggested value · verify against the original</span>}
    </label>;
  }
  const content=<>
    {!embedded&&<>
    <div className="mb-5 pr-8"><p className="eyebrow">Candidate profile</p><h2 className="mt-1 text-xl font-bold">{profile.name || 'Review extracted information'}</h2><p className="mt-1 break-words text-xs text-muted-foreground">{item.fileName}</p><div className="mt-3"><IntakeStatus status={item.status}/></div></div>
    {waiting && <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-xs"><Loader2 size={15} className="animate-spin"/>Processing continues on the server. This view updates automatically.</p>}
    {!!item.warnings?.length && <ul className="mb-4 space-y-1 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">{item.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>}
    {item.error && <p className="mb-4 rounded-xl bg-muted p-3 text-xs">{item.error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">{field('name','Candidate name')}{field('experienceYears','Experience (years)','number')}{field('email','Email')}{field('phone','Phone')}{field('skills','Key skills (comma separated)','list')}{field('currentDesignation','Current designation')}</div>
    <p className="mt-3 text-[0.6875rem] text-muted-foreground">Confirm the name and at least one valid contact. Blank information is kept unavailable. Suggested fields require your review.</p>
    <details className="mt-5 rounded-xl border border-border p-4"><summary className="cursor-pointer text-xs font-bold">Additional candidate information</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{OPTIONAL.filter(f=>f.key!=='currentDesignation').map(f=>field(f.key,f.label,f.type))}
      {['gender','maritalStatus'].map(key=><label key={key} className="flex flex-col gap-2 text-xs font-semibold">{key==='gender'?'Gender':'Marital status'}<AppSelect className="ehr-input p-3" value={String(profile[key]||'')} disabled={!editable||busy||waiting} onValueChange={e=>setProfile(prev=>({...prev,[key]:e}))}>
        <option value="">Not available</option>{(key==='gender'?['female','male','non_binary','prefer_not_to_say','other']:['single','married','divorced','widowed','prefer_not_to_say']).map(value=><option key={value} value={value}>{readableStatus(value)}</option>)}</AppSelect></label>)}
    </div></details>
    {editable && !complete && !!item.matches?.length && <label className="mt-5 flex flex-col gap-2 text-xs font-semibold">Duplicate candidate resolution<AppSelect aria-label="Duplicate candidate resolution" value={candidateId} onValueChange={e=>setCandidateId(e)} className="ehr-input p-3"><option value="">Use a clear match; conflicting identities require a choice</option>{item.matches.map(match=><option key={match.candidateId} value={match.candidateId}>{match.name} · {match.email} · {match.phone}</option>)}<option value="new">Confirm a different new person (email must be unique)</option></AppSelect></label>}
    <div className="mt-5 flex flex-wrap gap-2">
      {caps.canDownload && item.hasResume && <PAButton variant="secondary" type="button" disabled={busy} onClick={()=>void act(()=>intakeDownload(`/items/${item.itemId}/download`,item.fileName),'Original downloaded.')}><Download size={14}/>Download original</PAButton>}
      {caps.canDownload && item.hasResume && item.fileName.toLowerCase().endsWith('.pdf') && <PAButton variant="secondary" type="button" disabled={busy} onClick={()=>void act(async()=>{const blob=await intakeBlob(`/items/${item.itemId}/download`);setPreview(URL.createObjectURL(new Blob([blob],{type:'application/pdf'})));},'Original preview opened.')}><FileText size={14}/>View original PDF</PAButton>}
      {caps.canUpload && <PAButton variant="secondary" type="button" disabled={busy} onClick={()=>void act(()=>intakeDownload(`/items/${item.itemId}/profile.pdf`,'candidate-profile.pdf'),'Profile downloaded.')}><Download size={14}/>Download profile PDF</PAButton>}
      {!!item.rawText && <details className="w-full rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-bold">View extracted resume text</summary><pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[0.6875rem] leading-relaxed">{item.rawText}</pre></details>}
    </div>
    {preview && <div className="mt-4"><iframe title="Original resume PDF" sandbox="" src={preview} className="h-96 w-full rounded-xl border border-border"/><p className="mt-2 text-xs text-muted-foreground">If your browser blocks the preview, download the original to view it.</p></div>}
    {!complete && <section aria-label="Candidate ATS eligibility" className="mt-5 rounded-xl border border-border p-4 text-xs leading-relaxed">
      <p className="font-semibold">{item.atsSelection?.range ? `Saved ATS range: ${item.atsSelection.range.minimum}–${item.atsSelection.range.maximum}%` : 'Choose an ATS range in the upload batch before creating candidates.'}</p>
      <p className="mt-2 text-muted-foreground">{item.atsSelection?.eligible ? 'This resume is within the selected range. Review the profile before confirming.' : item.atsSelection?.state==='below'||item.atsSelection?.state==='above' ? 'This resume is outside the range and has been retained. Adjust the batch range to reconsider it.' : 'Save profile corrections and wait for a current ATS score before confirming.'}</p>
      {item.atsError&&<p role="alert" className="mt-2 text-destructive">{item.atsError}</p>}
      {caps.canUpload && ['review_required','duplicate_suspected','confirmation_paused'].includes(item.status) && item.atsSelection?.range && <PAButton type="button" variant="secondary" className="mt-3" disabled={busy||waiting||dirty} onClick={()=>void act(()=>update('score',{expectedRevision:item.revision}),'ATS scoring queued.')}><RefreshCw size={14}/>Recalculate ATS preview</PAButton>}
    </section>}
    </>}
    {embedded&&!item.ats&&<p className="p-4 text-sm text-muted-foreground">{item.atsError||"ATS evaluation is not available yet."}</p>}
    {embedded&&!complete&&caps.canUpload&&["review_required","duplicate_suspected","confirmation_paused"].includes(item.status)&&item.atsSelection?.range&&<PAButton variant="secondary" disabled={busy||waiting} onClick={()=>void act(()=>update("score",{expectedRevision:item.revision}),"ATS scoring queued.")}>Recalculate ATS preview</PAButton>}
    {item.ats && <section aria-label="Application ATS score" className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">{item.ats.llmStatus==='done'?'LLM evaluation':'Local evaluation · '+readableStatus(item.ats.llmStatus||'local_rules')}{item.ats.localOverall!=null?` · Local comparison: ${item.ats.localOverall}/100`:''}</p>
      {item.ats.needsReview&&<p className="mb-3 text-xs font-bold text-warning">Reviewer attention required. Check the evaluation notes before making a hiring decision.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold text-muted-foreground">ATS for this job</p><p className="mt-1 text-2xl font-bold">{item.ats.overall}<span className="text-sm text-muted-foreground"> / 100</span> <span className="text-sm">{item.ats.category}</span></p></div>{item.atsStale && <Pill tone="warning">Inputs changed · recalculate</Pill>}</div>
      <p className="mt-4 mb-2 text-xs font-semibold">Local scoring breakdown</p><Table aria-label="Local scoring breakdown"><TableHeader><TableRow>{Object.keys(item.ats.breakdown).map(key=><TableHead key={key} className="capitalize">{key}</TableHead>)}</TableRow></TableHeader><TableBody><TableRow>{Object.entries(item.ats.breakdown).map(([key,value])=><TableCell key={key} className="font-semibold tabular-nums">{value==null?'Not assessed':`${value}/100`}</TableCell>)}</TableRow></TableBody></Table>
      {!!item.ats.llmReasons?.length&&<ul className="mt-3 space-y-1 text-xs">{item.ats.llmReasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-bold">Matched skills</p><p className="mt-1 text-xs text-muted-foreground">{item.ats.matchedSkills.join(', ')||'None confirmed'}</p></div><div><p className="text-xs font-bold">Missing skills</p><p className="mt-1 text-xs text-muted-foreground">{item.ats.missingSkills.join(', ')||'No listed skill gaps'}</p></div></div>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{[...item.ats.strengths,...item.ats.gaps].map(text=><li key={text}>{text}</li>)}</ul><p className="mt-3 text-[0.6875rem] text-muted-foreground">{item.ats.note}</p>
      {caps.canUpload && complete && <PAButton variant="secondary" type="button" disabled={busy} className="mt-4" onClick={()=>void act(()=>update('recalculate',{expectedRevision:item.revision}),'ATS recalculated for this application.')}><RefreshCw size={14}/>Recalculate ATS</PAButton>}
    </section>}
    {complete && <details className="mt-5 rounded-xl border border-border p-4" onToggle={e=>{if(e.currentTarget.open)void loadVersions();}}><summary className="cursor-pointer text-xs font-bold">Resume versions you can access</summary><div className="mt-3"><Table aria-label="Accessible resume versions"><TableHeader><TableRow><TableHead>Resume file</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{versions.map(version=><TableRow key={version.itemId}><TableCell className="whitespace-normal break-words">{version.fileName}</TableCell><TableCell><IntakeStatus status={version.status}/></TableCell><TableCell className="text-right">{caps.canDownload&&version.status!=='deleted'&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void act(()=>intakeDownload(`/items/${version.itemId}/download`,version.fileName),'Version downloaded.')}>Download</Button>}</TableCell></TableRow>)}{!versions.length&&<TableRow><TableCell colSpan={3} className="text-muted-foreground">{busy?'Loading versions…':'No accessible versions found.'}</TableCell></TableRow>}</TableBody></Table></div>{moreVersions&&<PAButton variant="secondary" className="mt-3" disabled={busy} onClick={()=>void loadVersions(versionsSkip)}>Load more resume versions</PAButton>}</details>}
    {caps.canUpload && complete && <div className="mt-5 space-y-4 rounded-xl border border-border p-4">
      <Table aria-label="Job and reviewer assignment"><TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Selection</TableHead><TableHead>Apply</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell className="align-top font-semibold">Job association</TableCell><TableCell className="min-w-60 whitespace-normal"><label className="mb-3 flex flex-col gap-2 text-xs font-semibold">Find an open job<Input value={jobSearch} onChange={e=>{setJobSearch(e.target.value);setJobPage(0);setTargetJob('');}} placeholder="Search jobs by title"/></label><label className="flex flex-col gap-2 text-xs font-semibold">Associate with another open job<AppSelect value={targetJob} onValueChange={e=>setTargetJob(e)} className="ehr-input p-3"><option value="">Choose a job</option>{associationJobs.filter(j=>j.lifecycleStatus==='OPEN').map(job=><option key={job.jobId} value={job.jobId}>{job.title} · {job.jobKey}</option>)}</AppSelect></label>
      {moreJobs&&<PAButton variant="secondary" onClick={()=>setJobPage(n=>n+1)}>Load more jobs</PAButton>}</TableCell><TableCell className="align-top"><PAButton type="button" variant="secondary" disabled={busy||!targetJob} onClick={()=>void act(async()=>{const result=await intakeMutate<IntakeItem>(`/items/${item.itemId}/associate`,{jobId:targetJob});onAssociated?.(result.batchId);},'Job association ready for its own ATS range and review.')}>Associate candidate</PAButton></TableCell></TableRow>
      {caps.canAssign && <TableRow><TableCell className="align-top font-semibold">Reviewer assignment</TableCell><TableCell className="min-w-60 whitespace-normal space-y-3"><label className="flex flex-col gap-2 text-xs font-semibold">Find a reviewer<Input value={reviewerSearch} onChange={e=>{setReviewerSearch(e.target.value);setReviewerPage(0);setAssignee('');}} className="ehr-input p-3" placeholder="Search team members by name"/></label><label className="flex flex-col gap-2 text-xs font-semibold">Assign reviewer<AppSelect value={assignee} onValueChange={e=>setAssignee(e)} className="ehr-input p-3"><option value="">Choose an active reviewer</option>{assignees.map(actor=><option key={actor.userId} value={actor.userId}>{actor.name} · {readableStatus(actor.role)}</option>)}</AppSelect></label>{moreReviewers&&<PAButton variant="secondary" onClick={()=>setReviewerPage(n=>n+1)}>Load more reviewers</PAButton>}</TableCell><TableCell className="align-top"><PAButton type="button" variant="secondary" disabled={busy||!assignee} onClick={()=>void act(()=>update('assign',{userId:assignee,expectedRevision:item.revision}),'Reviewer assigned.')}>Assign reviewer</PAButton></TableCell></TableRow>}</TableBody></Table>
    </div>}
    {!embedded&&<>{caps.canUpload && <div className="mt-5"><label className="flex flex-col gap-2 text-xs font-semibold">Add a comment<Textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} rows={2} className="ehr-input p-3 font-normal"/></label><PAButton variant="secondary" type="button" disabled={busy||!note.trim()} className="mt-2" onClick={()=>void act(async()=>{await intakeMutate(`/items/${item.itemId}/notes`,{text:note});setNote('');const refreshed=await intakeGet<IntakeItem>(`/items/${item.itemId}`);setItem(prev=>({...prev,notes:refreshed.notes}));},'Comment added.')}>Add comment</PAButton></div>}
    {!!item.notes?.length&&<ul className="mt-3 space-y-2 text-xs text-muted-foreground">{item.notes.map((entry,index)=><li key={index} className="break-words rounded-lg bg-muted/50 p-3">{entry.text}</li>)}</ul>}
    </>}
    {error && <p role="alert" className="mt-4 break-words text-xs text-destructive">{error}</p>}{message && <p role="status" className="mt-4 text-xs text-success">{message}</p>}
    {!embedded&&<div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      <PAButton type="button" variant="secondary" onClick={onClose} disabled={busy}>Close</PAButton>
      {editable && <PAButton type="button" variant="secondary" disabled={busy||waiting} onClick={()=>void act(()=>update(complete?'profile':'review',{profile,expectedRevision:item.revision},'PUT'),'Reviewed profile saved.')}>Save corrections</PAButton>}
      {editable && !complete && <PAButton type="button" disabled={busy||waiting||!item.atsSelection?.eligible||dirty||profile.name.trim().length<2||(!profile.email.trim()&&!profile.phone.trim())} onClick={()=>void act(()=>update('confirm',{profile,expectedRevision:item.revision,candidateId:candidateId||null,atsRangeRevision:item.atsSelection?.rangeRevision}),'Eligible candidate creation queued.')}><CheckCircle2 size={15}/>Confirm candidate & application</PAButton>}
    </div>}
  </>;
  return embedded?<div className="whitespace-normal p-3 sm:p-5">{content}</div>:<Modal onClose={onClose} dismissible={!busy} label="Candidate resume review" className="max-w-4xl p-5 sm:p-6">{content}</Modal>;
}
