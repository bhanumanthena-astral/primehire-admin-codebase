import {SOURCE_LABELS,sourceLabel} from '../lib/hiringWorkflow';
import {JobScoreFilter,matchingApplications} from './JobScoreFilter';
import { savedMailTemplates } from '../mockData';
import { AssessmentMailPicker } from './AssessmentMailPicker';
import React, {useEffect, useState} from 'react';
import {RefreshCw, MessageCircle, Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Switch} from '@/components/ui/switch';
import {Table, TableHeader, TableHead, TableBody, TableRow, TableCell} from '@/components/ui/table';
import {Modal} from './ui/Modal';
import {Job, retryOutboxMessage, sendAssessments, syncJobAssessmentResults, transitionApplication, fetchEmailMode} from '../lib/hiringApi';
import {Application, Page, recruitmentRequest} from '../lib/recruitmentApi';
import {useAuth} from '../lib/authContext';
import {authFetch} from '../lib/authFetch';
import {useAssessmentRefresh} from './useAssessmentRefresh';
import {assessmentScoreLabel,assessmentStatusLabel} from '../lib/assessmentProgress';
const base=((import.meta as any).env?.VITE_API_URL||'').replace(/\/$/,'');
async function whatsappRequest(jobId:string,body?:unknown,send=false){

 const response=await authFetch(`${base}/api/jobs/${encodeURIComponent(jobId)}/whatsapp${send?'/send':''}`,body===undefined?{}:{method:send?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'WhatsApp request failed');return result;
}

export function JobAssessmentCandidates({job,onChooseAssessment,pipelineStage,onChanged,embedded}:{job:Job;pipelineStage?:'linksSent';embedded?:boolean;onChanged?:()=>void;onChooseAssessment:()=>void}) {
  const {user,impersonatingUser}=useAuth();
  const canManage=!impersonatingUser&&['super_admin','admin','hr','recruiter'].includes(user?.role||'');
  const templates = savedMailTemplates();
  const [templateId, setTemplateId] = useState('');
  const template = templates.find(item => item.id === templateId);
  const [items,setItems]=useState<Application[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[revision,setRevision]=useState(0);
  const [search,setSearch]=useState(''),[query,setQuery]=useState('');
  const searching=search.trim()!==query;
  const [range,setRange]=useState<number[]|null>(null);
  const [previewRow,setPreviewRow]=useState<Application|null>(null);
  const invitationSelection=Boolean(pipelineStage)||!embedded;
  const [includeInvited,setIncludeInvited]=useState(false);
  const [eligibleTotal,setEligibleTotal]=useState(0);
  const [retry,setRetry]=useState<{id:string;name:string}[]>([]);
  const [source,setSource]=useState('');
  const [status,setStatus]=useState('');
  const filters=(source?'&applicationSource='+encodeURIComponent(source):'')+(range?'&scoreField=ats&minimum='+range[0]+'&maximum='+range[1]:'')+(status?'&invitationStatus='+status:'');
  const [within,setWithin]=useState<number|null>(null);
  useEffect(()=>{
    if(!embedded||pipelineStage)return;
    const controller=new AbortController();
    setWithin(null);
    const [minimum,maximum]=range??[0,100];
    authFetch(`${base}/api/jobs/${encodeURIComponent(job.jobId)}/ats-range-counts?minimum=${minimum}&maximum=${maximum}`,{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error('Could not load ATS range counts');return response.json()})
      .then(data=>{if(!controller.signal.aborted)setWithin(data.within)})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message)});
    return ()=>controller.abort();
  },[job.jobId,job.pipeline?.atsScored,range,embedded,pipelineStage]);
  const [selected,setSelected]=useState<string[]>([]),[sort,setSort]=useState('name'),[descending,setDescending]=useState(false);
  const listPath=`/applications?jobId=${encodeURIComponent(job.jobId)}&skip=${page*50}&limit=50${filters}${invitationSelection?`&invitationCandidates=true&includeInvitedCandidates=${includeInvited}`:""}&sortBy=${sort}&descending=${descending}${query?`&search=${encodeURIComponent(query)}`:''}`;
  useEffect(()=>{const value=search.trim();if(value===query)return;const timer=setTimeout(()=>{setQuery(value);setPage(0);setSelected([]);},300);return()=>clearTimeout(timer);},[search,query]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[confirm,setConfirm]=useState<'shortlist'|'generate'|'send'|null>(null),[whatsapp,setWhatsapp]=useState(false),[dryRun,setDryRun]=useState<boolean|null>(null);
  const [wa,setWa]=useState<{configured:boolean;enabled:boolean;price:number;currency:string;canApprove:boolean}|null>(null);
  const [optIn,setOptIn]=useState(false);
  useEffect(()=>{let active=true;void whatsappRequest(job.jobId).then(value=>{if(active)setWa(value);}).catch(()=>{});return()=>{active=false;};},[job.jobId,revision]);
  async function whatsappAction(enable:boolean){setBusy(true);setError('');try{if(enable){await whatsappRequest(job.jobId,{enabled:!wa?.enabled,expectedPrice:wa?.price,currency:wa?.currency});setNotice('WhatsApp approval updated.');}else{const result=await whatsappRequest(job.jobId,{applicationIds:selected,recipientConsentConfirmed:optIn},true);setNotice(`${result.items.filter((i:any)=>i.status==='queued').length} WhatsApp invitations queued. ${result.items.filter((i:any)=>i.status!=='queued').map((i:any)=>i.reason).join(' ')}`);}setWhatsapp(false);setRevision(n=>n+1);}catch(e){setError(e instanceof Error?e.message:'WhatsApp request failed');}finally{setBusy(false);}}
  useEffect(()=>{let active=true;void fetchEmailMode().then(value=>{if(active)setDryRun(value.dryRun);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setSelected([]);void recruitmentRequest<Page<Application>>(listPath,undefined,'GET',controller.signal).then(value=>{if(!controller.signal.aborted){setItems(value.items);setTotal(value.total);setEligibleTotal((value as any).eligibleTotal??value.total);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[listPath,revision]);
  useAssessmentRefresh(items,listPath,revision,busy||loading||searching,value=>{setItems(value.items);setTotal(value.total);setEligibleTotal((value as any).eligibleTotal??value.total);},setError);
  function toggleSort(key:string){setPage(0);setSelected([]);if(key===sort)setDescending(!descending);else{setSort(key);setDescending(false);}}
  const eligible=(row:Application)=>!invitationSelection|| (row.invitation?.canInvite ?? !['email_sent','email_queued','send_requested','upstream_pending','completed','in_progress','report_pending'].includes(row.assessment?.status||''));
  const selectable=items.filter(eligible);
  const invitationLabels:Record<string,string>={not_invited:'Not Invited',pending:'Invitation Pending',invited:'Invited',failed:'Invitation Failed'};
  const value=(row:Application,key:string):string|number=>key==='name'?row.candidate.name:key==='ats'?((row as Application&{atsScore?:number}).atsScore??-1):key==='score'?(row.assessment?.score??-1):key==='stage'?row.currentStage:row.assessment?.status||'Not invited';
  const sorted=[...items].sort((a,b)=>{const x=value(a,sort),y=value(b,sort);return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y)))*(descending?-1:1);});
  async function run(){if(!confirm||busy)return;setBusy(true);setError('');setNotice('');try{if(confirm==='send'||confirm==='generate'){const results:string[]=[];
      for(let offset=0;offset<selected.length;offset+=50){
        const ids=selected.slice(offset,offset+50);
        try {
          const result=confirm==='generate'?await sendAssessments(ids,true):await sendAssessments(ids,false,template);
          results.push(...result.items.map(item=>(items.find(row=>row.applicationId===item.applicationId)?.candidate.name||item.applicationId)+' · '+(item.reason||item.linkStatus||(item.result==='accepted'?'Queued for processing — email has not been sent yet':item.result))));
        } catch(e){results.push(...ids.map(id=>id+' · '+(e instanceof Error?e.message:'Request failed')));}
      }
      setNotice(results.join('\n'));}else{let success=0;const failures:string[]=[];for(const id of selected){try{await transitionApplication(id,'SHORTLISTED','Recruiter confirmed candidate after reviewing the job ATS score.');success++;}catch(e){failures.push(e instanceof Error?e.message:'Confirmation failed');}}setNotice(`${success} candidates shortlisted. ${failures.join(' ')}`);}setConfirm(null);setSelected([]);onChanged?.();setRevision(n=>n+1);}catch(e){setError(e instanceof Error?e.message:'Action failed');}finally{setBusy(false);}}
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Candidates, results & invitations</h2><p className="mt-1 text-sm text-muted-foreground">{embedded?'Select confirmed profiles for the next hiring step.':'Select eligible candidates, then generate links or send invitations.'}</p></div><div className="flex gap-2">{canManage&&<Button variant="outline" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const result=await syncJobAssessmentResults(job.jobId);setNotice(result.checked===undefined?`${result.queued} assessment result checks queued.`:`${result.checked} assessment results checked. ${result.failed||0} checks need retry. Submitted assessments show Pending until their reports are ready.`);setRevision(n=>n+1);}catch(e){setError(e instanceof Error?e.message:'Sync failed');}finally{setBusy(false);}}}>Sync results</Button>}<Button variant="outline" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={14} className="mr-2"/>Refresh results</Button></div></div>
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 sm:max-w-xl">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
        <Input type="search" aria-label="Search candidates by name or email" placeholder="Search by candidate name or email…" className="pl-10" maxLength={100} value={search} disabled={busy} onChange={event=>{setSearch(event.target.value);setSelected([]);}}/>
      </div>
      {search&&<Button variant="outline" disabled={busy} onClick={()=>{setSearch('');setQuery('');setPage(0);setSelected([]);}}>Clear search</Button>}
    </div>
    {embedded&&!pipelineStage&&job.pipeline&&<dl className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {Object.entries({'Uploaded':job.pipeline.resumesUploaded,'ATS scored':job.pipeline.atsScored,'In range':within,'Outside range':within===null?null:Math.max(0,job.pipeline.atsScored-within),'Awaiting score':Math.max(0,job.pipeline.resumesUploaded-job.pipeline.atsScored),'Selected profiles':selected.length}).map(([label,count])=><div key={label} className="rounded-lg border px-3 py-2"><dt className="text-xs">{label}</dt><dd className="font-semibold tabular-nums">{count??'—'}</dd></div>)}
    </dl>}
    <label className="block text-sm">Application source<select value={source} className="ml-2 rounded border bg-background p-2" onChange={e=>{setSource(e.target.value);setPage(0);setSelected([]);}}><option value="">All sources</option>{Object.entries(SOURCE_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    {embedded&&<JobScoreFilter label="ATS score range" range={range} count={invitationSelection?eligibleTotal:total} busy={busy||loading||searching} onChange={v=>{setRange(v);setPage(0);setSelected([])}} onClear={()=>setSelected([])}
      onSelect={canManage?async()=>{setBusy(true);try{const rows=await matchingApplications(range?listPath:listPath+'&scoreField=ats');const [minimum,maximum]=range??[0,100];
        setSelected(rows.filter(row=>typeof row.atsScore==='number' && row.atsScore>=minimum && row.atsScore<=maximum &&
          eligible(row)&&!['HIRED','REJECTED','WITHDRAWN'].includes(row.currentStage)).map(row=>row.applicationId));}catch(e){setError(e instanceof Error?e.message:'Selection failed')}finally{setBusy(false)}}:undefined}/>}
    {invitationSelection&&<div className="flex flex-wrap items-center gap-4 rounded-xl border p-3">
      <label className="flex items-center gap-3 text-sm font-medium"><Switch aria-label="Include Invited Candidates" checked={includeInvited} disabled={busy} onCheckedChange={checked=>{setIncludeInvited(checked);if(!checked&&['pending','invited'].includes(status))setStatus('');setPage(0);setSelected([]);}}/>Include Invited Candidates</label>
      <label className="text-sm">Invitation status <select aria-label="Invitation status" value={status} className="ml-2 rounded border bg-background p-2" disabled={busy} onChange={e=>{setStatus(e.target.value);setPage(0);setSelected([]);}}><option value="">All visible statuses</option>{Object.entries(invitationLabels).filter(([id])=>includeInvited||['not_invited','failed'].includes(id)).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">Invited and pending candidates are excluded from bulk invitations. Failed deliveries use an explicit retry.</p>
    </div>}
    {dryRun!==false&&<p className="rounded-xl border p-3 text-sm">{dryRun?'Email is in dry-run mode: invitation requests are recorded without delivery.':'Email delivery mode could not yet be verified.'}</p>}
    {!job.assessmentJobId&&<p className="rounded-xl border p-3 text-sm">Link a published assessment before generating candidate links. <Button variant="outline" className="ml-3" onClick={onChooseAssessment}>Choose assessment</Button></p>}
    {canManage&&<div className="flex flex-wrap gap-2"><Button disabled={busy||!selected.length} onClick={()=>setConfirm('shortlist')}>Confirm / shortlist selected ({selected.length})</Button><Button disabled={busy||!selected.length||!job.assessmentJobId} onClick={()=>setConfirm('generate')}>Generate links</Button><Button disabled={busy||!selected.length||!job.assessmentJobId||dryRun===null} onClick={()=>{setTemplateId('');setPreviewRow(items.find(r=>selected.includes(r.applicationId))??null);setConfirm('send')}}>Send email invitations</Button><Button variant="outline" className={wa?.enabled?"":"opacity-50"} onClick={()=>{setOptIn(false);setWhatsapp(true);}}><MessageCircle size={15} className="mr-2"/>WhatsApp · paid add-on</Button></div>}
    {!!retry.length&&<Modal label="Confirm invitation retry" dismissible={!busy} onClose={()=>setRetry([])}>
      <p>Retry {retry.length} failed invitations?</p>
      <Button disabled={busy} onClick={async()=>{setBusy(true);const results:string[]=[];
        for(const row of retry){try{await retryOutboxMessage(row.id);results.push(row.name+' · Retry queued')}catch(e){results.push(row.name+' · '+(e instanceof Error?e.message:'Retry failed'))}}
        setNotice(results.join('\n'));setRetry([]);setRevision(n=>n+1);setBusy(false);
      }}>Confirm retry</Button></Modal>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}{notice&&<p role="status" className="max-h-56 overflow-auto whitespace-pre-line rounded-xl border p-3 text-sm">{notice}</p>}
    {loading?<p role="status">Loading candidates…</p>:<div className="rounded-xl border"><Table><TableHeader><TableRow><TableHead><Checkbox aria-label="Select candidates on this page" checked={!!selectable.length&&selectable.every(r=>selected.includes(r.applicationId))} onCheckedChange={checked=>setSelected(ids=>checked?[...new Set([...ids,...selectable.map(r=>r.applicationId)])]:ids.filter(id=>!selectable.some(r=>r.applicationId===id)))} disabled={!canManage||busy||loading||searching||!selectable.length}/></TableHead>{[['name','Candidate'],['ats','ATS score'],['stage','Pipeline stage'],['status','Assessment status'],['score','Assessment score']].map(([key,label])=><TableHead key={key} aria-sort={sort===key?(descending?'descending':'ascending'):'none'}><Button variant="ghost" onClick={()=>toggleSort(key)}>{label} {sort===key?(descending?'↓':'↑'):'↕'}</Button></TableHead>)}</TableRow></TableHeader><TableBody>{sorted.map(row=><TableRow key={row.applicationId}><TableCell><Checkbox aria-label={`Select ${row.candidate.name}`} disabled={!canManage||busy||loading||searching||!eligible(row)} checked={selected.includes(row.applicationId)} onCheckedChange={checked=>setSelected(ids=>checked?[...ids,row.applicationId]:ids.filter(id=>id!==row.applicationId))}/></TableCell><TableCell>{row.candidate.name}<p className="text-xs text-muted-foreground">Source · {sourceLabel(row.applicationSource)}</p>{embedded&&<p className="text-xs">{row.candidate.email}</p>}</TableCell><TableCell>{value(row,'ats')===-1?'Pending':value(row,'ats')}</TableCell><TableCell>{row.currentStage.replaceAll('_',' ')}</TableCell><TableCell>{invitationSelection?invitationLabels[row.invitation?.status||'not_invited']:assessmentStatusLabel(row)}{invitationSelection&&<p className="text-xs">Assessment: {assessmentStatusLabel(row)}</p>}{invitationSelection&&row.invitation?.sentAt&&<p className="text-xs">Invited: {new Date(row.invitation.sentAt).toLocaleString()}</p>}{invitationSelection&&row.invitationDelivery&&<p>Email: {row.invitationDelivery.via==='dry_run'?'Dry run':row.invitationDelivery.status}</p>}{invitationSelection&&row.invitationDelivery?.retryId&&canManage&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>setRetry([{id:row.invitationDelivery!.retryId!,name:row.candidate.name}])}>Retry invitation email</Button>}{invitationSelection&&<details><summary>Assignment details</summary><p>Sent: {row.assessment?.sentAt||'Unavailable'}</p><p>Completed: {row.assessment?.completedAt||'Unavailable'}</p><p>Valid until: {row.assessment?.windowEnd||'Unavailable'}</p></details>}{row.assessment?.link&&<div className="mt-2 space-y-2 text-xs"><div className="flex items-center gap-2"><span className="max-w-56 truncate font-mono">Link: {row.assessment.link.slice(0,Math.ceil(row.assessment.link.length/2))}…</span><Button variant="outline" size="sm" onClick={()=>void navigator.clipboard.writeText(row.assessment!.link!).then(()=>setNotice(`Link copied for ${row.candidate.name}.`)).catch(()=>setError('Could not copy the link.'))}>Copy link</Button></div><div className="flex items-center gap-2"><span className="max-w-56 truncate font-mono">Password: {row.assessment.password?`${row.assessment.password.slice(0,Math.ceil(row.assessment.password.length/2))}••••`:'Not available'}</span>{row.assessment.password&&<Button variant="outline" size="sm" onClick={()=>void navigator.clipboard.writeText(row.assessment!.password!).then(()=>setNotice(`Password copied for ${row.candidate.name}.`)).catch(()=>setError('Could not copy the password.'))}>Copy password</Button>}</div></div>}{row.assessment?.error&&<p className="text-xs text-destructive">{row.assessment.error}</p>}</TableCell><TableCell>{assessmentScoreLabel(row)}</TableCell></TableRow>)}{!items.length&&<TableRow><TableCell colSpan={6} className="p-8 text-center">{query?'No candidates match this name or email.':invitationSelection?'No candidates need invitations in this view. Enable Include Invited Candidates to view invitation history.':'Confirm resume profiles in the Resumes & ATS review stage to populate this job.'}</TableCell></TableRow>}</TableBody></Table></div>}
    <div className="flex items-center justify-between"><Button variant="outline" disabled={!page||busy||loading||searching} onClick={()=>setPage(n=>n-1)}>Previous page</Button><span className="text-sm">{total} candidates{invitationSelection?` · ${eligibleTotal} eligible for invitations`:""} · Page {page+1}</span><Button variant="outline" disabled={(page+1)*50>=total||busy||loading||searching} onClick={()=>setPage(n=>n+1)}>Next page</Button></div>
    {confirm&&<Modal label="Confirm bulk candidate action" onClose={()=>setConfirm(null)} dismissible={!busy}><h3 className="text-lg font-bold">{confirm==='generate'?'Generate assessment links without sending?':confirm==='send'?'Send assessment invitations?':'Confirm selected candidates?'}</h3><p className="my-4 text-sm">{selected.length} selected candidates for {job.title}. {confirm==='generate'?'Links are generated for shortlisted candidates. No email or WhatsApp message will be sent.':confirm==='send'?'Only shortlisted candidates are eligible. Existing invitations are preserved; requests run in the background.':'Shortlisting is a human decision. Review the ATS scores and candidate profiles before continuing.'}</p>{confirm==='send'&&<AssessmentMailPicker fields={{candidate_name:previewRow?.candidate.name||'Selected candidate',job_title:job.title,company:job.companyName||'PrimeHire',round_type:job.assessmentRoundType||'Assessment',link:previewRow?.assessment?.link||'Individual assessment link',password:'••••••',start_time:'Assigned window start',end_time:previewRow?.assessment?.windowEnd||'Assigned window end'}} templates={templates} value={templateId} onChange={setTemplateId}/>}<Button disabled={busy||(confirm==='send'&&!template)} onClick={()=>void run()}>{busy?'Working…':'Confirm action'}</Button></Modal>}
    {whatsapp&&<Modal label="WhatsApp paid delivery" onClose={()=>setWhatsapp(false)}><h3 className="text-lg font-bold">WhatsApp invitations cost extra</h3><p className="my-4 text-sm">WhatsApp delivery is disabled by default. A manager must approve the configured message price before the job creator can send assessment links.</p><p className="my-3 text-sm">{wa?.configured?`Configured estimate: ${wa.currency} ${wa.price} per message. Estimated cost for ${selected.length} selected candidates: ${wa.currency} ${(wa.price*selected.length).toFixed(2)}. Actual Meta charges may vary.`:"Meta credentials, approved template and a message price must be configured on the server before enabling delivery."}</p>{wa?.canApprove&&<Button variant="outline" disabled={busy||!wa.configured} onClick={()=>void whatsappAction(true)}>{wa.enabled?"Disable WhatsApp for this job":"Manager: approve price and enable"}</Button>}{!wa?.configured&&<Button disabled>Manager enablement unavailable until pricing is configured</Button>}{wa?.enabled&&wa.configured&&<div className="mt-4 space-y-3"><label className="flex gap-2 text-sm"><Checkbox checked={optIn} onCheckedChange={value=>setOptIn(value===true)}/>I confirm the selected candidates opted in to WhatsApp invitations.</label><Button disabled={busy||!optIn||!selected.length} onClick={()=>void whatsappAction(false)}>Send selected assessment links on WhatsApp</Button></div>}</Modal>}
  </section>;
}
