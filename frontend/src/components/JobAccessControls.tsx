import {Checkbox} from '@/components/ui/checkbox';
import React, {useState} from 'react';
import {ShieldCheck, Eye, Pencil, Upload, Plus} from 'lucide-react';
import {Job, updateJob} from '../lib/hiringApi';
import {JobAccess} from '../lib/jobAccess';
import {PAButton} from './ui/primitives';
import {Modal} from './ui/Modal';

const OPTIONS = [
  {key:'view' as const,label:'View assigned jobs',description:'Read the job brief and its applications.',icon:Eye},
  {key:'upload' as const,label:'Upload resumes',description:'Upload candidate resumes while the job is open.',icon:Upload},
  {key:'edit' as const,label:'Edit job details',description:'Update permitted details while the job is open.',icon:Pencil},
  {key:'create' as const,label:'Create jobs',description:'Create new requisitions assigned to this user.',icon:Plus},
];
export function JobAccessEditor({value,onChange,includeCreate=true,disabled=false,allowed}: {value:JobAccess[],onChange:(value:JobAccess[])=>void,includeCreate?:boolean,disabled?:boolean,allowed?:JobAccess[]}) {
  return <fieldset className="space-y-3" disabled={disabled}><legend className="mb-3 text-sm font-bold flex items-center gap-2"><ShieldCheck size={17}/>Job access</legend>
    <div className="grid gap-2 sm:grid-cols-2">{OPTIONS.filter(o=>(includeCreate || o.key !== 'create')&&(!allowed||allowed.includes(o.key))).map(o=><label key={o.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${value.includes(o.key)?'border-primary/50 bg-primary/10':'border-border bg-background/40'}`}>
      <Checkbox  className="mt-1 accent-amber-600" checked={value.includes(o.key)} onCheckedChange={e=>onChange(e ? [...new Set([...value,'view' as const,o.key])] : o.key==='view' ? [] : value.filter(v=>v!==o.key))}/>
      <span><span className="block text-xs font-bold">{o.label}</span><span className="mt-1 block text-[0.6875rem] leading-relaxed text-muted-foreground">{o.description}</span></span></label>)}</div>
    <p className="text-xs text-muted-foreground">Job status, assignment and deletion remain administrator controls.</p>
  </fieldset>;
}
export function JobAccessModal({job,onClose,onSaved}:{job:Job,onClose:()=>void,onSaved:(job:Job)=>void}) {
  const [value,setValue]=useState<JobAccess[]>(job.assigneeAccess ?? ['view','edit','upload']);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function save() {setBusy(true);setError('');try {const result=await updateJob(job.jobId,{assigneeAccess:value,expectedUpdatedAt:job.updatedAt});onSaved(result);onClose();}catch(e){setError(e instanceof Error?e.message:'Could not save access');}finally{setBusy(false);}}
  return <Modal onClose={onClose} dismissible={!busy} labelledBy="job-access-title">
    <h2 id="job-access-title" className="text-xl font-bold">Access for this job</h2><p className="mt-2 mb-5 text-sm text-muted-foreground">{job.title} · These options work within the assignee’s team permissions.</p>
    <JobAccessEditor value={value} onChange={setValue} includeCreate={false}/>{error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><PAButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</PAButton><PAButton onClick={()=>void save()} disabled={busy}>{busy?'Saving…':'Save access'}</PAButton></div>
  </Modal>;
}
