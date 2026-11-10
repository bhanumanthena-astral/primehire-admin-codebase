import {AppSelect} from '@/src/components/ui/AppSelect';
import React,{useState,useRef,useId} from 'react';
import {Job} from '../lib/hiringApi';
import {PAButton} from './ui/primitives';
import {Modal} from './ui/Modal';
import {LIFECYCLE_ORDER} from './JobLifecycle';
const LABELS: Record<string,string>={DRAFT:'Draft',OPEN:'Open · accepting resumes',ON_HOLD:'On hold',CLOSED:'Closed',ARCHIVED:'Archived'};
export function JobStatusControl({job,busy,onChange,compact=false,canRestoreArchived=false}:{job:Job,busy:boolean,onChange:(status:string)=>void,compact?:boolean,canRestoreArchived?:boolean}) {
  const [pending,setPending]=useState('');
  const triggerRef=useRef<HTMLButtonElement>(null);
  const hintId=useId();
  const current=job.lifecycleStatus || 'DRAFT';
  const choices:Record<string,string[]>={DRAFT:['DRAFT','OPEN','CLOSED','ARCHIVED'],OPEN:['OPEN','ON_HOLD','CLOSED','ARCHIVED'],ON_HOLD:['ON_HOLD','OPEN','CLOSED','ARCHIVED'],CLOSED:['CLOSED','OPEN','ARCHIVED'],ARCHIVED:canRestoreArchived?['ARCHIVED','OPEN']:['ARCHIVED']};
  return <><div><label className={`flex gap-2 text-[0.6875rem] font-semibold text-muted-foreground ${compact?'items-center':'flex-col'}`}><span className="shrink-0">Job status</span><AppSelect ref={triggerRef} aria-label={`Change status for ${job.title}`} aria-describedby={current==='ARCHIVED'?hintId:undefined} className={`ehr-input min-w-0 flex-1 px-2 text-[0.6875rem] font-medium normal-case tracking-normal ${compact?'min-h-8 py-1':'py-2'}`} value={current} disabled={busy||(current==='ARCHIVED'&&!canRestoreArchived)} onValueChange={e=>{if(e!==current&&(choices[current]||choices.DRAFT).includes(e))setPending(e);}}>{LIFECYCLE_ORDER.map(s=><option key={s} value={s} disabled={!(choices[current]||choices.DRAFT).includes(s)}>{LABELS[s]}</option>)}</AppSelect></label>
    {current==='ARCHIVED'&&<p id={hintId} className="mt-2 text-[0.6875rem] leading-relaxed text-muted-foreground">{canRestoreArchived?'Reopen this archived job to enable On hold or Closed. Draft is only available before a job is opened.':'This job is archived. Ask a Super Admin to reopen it.'}</p>}</div>
    {pending&&<Modal finalFocus={triggerRef} onClose={()=>setPending('')} labelledBy="status-confirm" className="max-w-md p-6"><h2 id="status-confirm" className="text-lg font-bold">{current==='ARCHIVED'?'Restore archived job?':'Change job status?'}</h2><p className="my-4 text-sm text-muted-foreground">{job.title} will change to {LABELS[pending]}. {current==='ARCHIVED'?'You will confirm a future closing date before this job is restored.':pending==='OPEN'?'Resume uploads will be available to authorized assignees.':'Resume uploads will be unavailable.'} {pending==='ARCHIVED'?'Archiving makes the job read-only.':''}</p><div className="flex flex-wrap justify-end gap-2"><PAButton variant="secondary" onClick={()=>setPending('')}>Cancel</PAButton><PAButton onClick={()=>{onChange(pending);setPending('');}}>Confirm status change</PAButton></div></Modal>}
  </>;
}

