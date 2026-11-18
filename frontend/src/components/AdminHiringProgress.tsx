import {useAuth} from '../lib/authContext';
import {useEffect,useRef,useState} from 'react';
import {Progress} from '@/components/ui/progress';
import {Button} from '@/components/ui/button';
import type {Job} from '../lib/hiringApi';
import {HiringStageWorkspace} from './HiringStageWorkspace';
import type {HiringStage} from './JobHiringProgress';

const stages=[
 {id:'resumesUploaded',label:'Upload resumes',action:'Add resumes for this job.'},
 {id:'atsTotal',label:'ATS screening',action:'Review scores and choose candidates for assessment.'},
 {id:'linksSent',label:'Assessments',action:'Assign an assessment, send invitations and review results.'},
 {id:'technical',label:'Interviews',action:'Schedule interviews and record feedback.'},
 {id:'hr',label:'Hiring decision',action:'Review final feedback and complete the hiring decision.'},
] as const;
export function AdminHiringProgress({job,onChanged,onJobChanged}:{job:Job;onChanged:()=>void;onJobChanged:(job:Job)=>void}){
 const {user}=useAuth();
 const preferenceKey='elitehr:hiring-step:'+user?.orgId+':'+user?.userId+':'+job.jobId;
 const [active,setActive]=useState(()=>{
  try {const saved=Number(localStorage.getItem(preferenceKey));return Number.isInteger(saved)&&saved>=0&&saved<5?saved:0}catch{return 0}
 });
 useEffect(()=>{try{localStorage.setItem(preferenceKey,String(active))}catch{}},[active,preferenceKey]);
 useEffect(()=>{
  const open=()=>setActive(0);
  window.addEventListener('admin-upload-resumes',open);
  return ()=>window.removeEventListener('admin-upload-resumes',open);
 },[]);
 const refresh=useRef(onChanged);refresh.current=onChanged;
 useEffect(()=>{
  const timer=setInterval(()=>{if(!document.hidden)refresh.current()},10000);
  return ()=>clearInterval(timer);
 },[job.jobId]);
 const [interviewRound,setInterviewRound]=useState<HiringStage>('technical');
 const [results,setResults]=useState(false);
 const current=stages[active];
 const stage=active===3?interviewRound:active===2&&results?'assessmentsCompleted':current.id;
 const counts=job.pipeline;
 return <section className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6" aria-label="Guided hiring workflow">
  <header className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">Hire for {job.title}</h2><p className="mt-1 text-sm text-muted-foreground">{current.action}</p></div><Button variant="outline" onClick={onChanged}>Refresh progress</Button></header>
  <nav aria-label="Hiring steps" className="grid gap-2 sm:grid-cols-5">{stages.map((item,index)=><button key={item.id} aria-current={active===index?'step':undefined} onClick={()=>setActive(index)} className={'rounded-xl border p-3 text-left text-sm '+(active===index?'border-primary bg-primary/10':'hover:bg-muted')}><span className="mr-2 text-muted-foreground">{index+1}</span>{item.label}</button>)}</nav>
  {active===1&&counts&&<section aria-label="Screening progress" className="rounded-xl border p-4">
   <p className="text-sm font-semibold">{counts.atsScored} of {counts.resumesUploaded} resumes scored</p>
   <Progress aria-label="Resumes scored" className="mt-3" value={Math.min(100,counts.atsScored/Math.max(1,counts.resumesUploaded)*100)}/>
   <p className="mt-2 text-xs text-muted-foreground">{counts.atsProcessing} queued or being scored. Progress updates automatically.</p>
  </section>}
  {active===2&&<div className="flex gap-2"><Button variant={!results?'default':'outline'} onClick={()=>setResults(false)}>Assignments & invitations</Button><Button variant={results?'default':'outline'} onClick={()=>setResults(true)}>Review results</Button></div>}
  {active===3&&<label className="block text-sm">Interview round<select className="ml-3 rounded border bg-background p-2" value={interviewRound} onChange={e=>setInterviewRound(e.target.value as HiringStage)}><option value="technical">Technical</option><option value="managerial">Managerial</option><option value="hr">HR</option></select></label>}
  <HiringStageWorkspace key={stage} job={job} stage={stage} onChanged={onChanged} onJobChanged={onJobChanged} guided/>
  <footer className="flex justify-between"><Button variant="outline" disabled={!active} onClick={()=>setActive(n=>n-1)}>Previous step</Button><Button disabled={active===4} onClick={()=>setActive(n=>n+1)}>Next step</Button></footer>
 </section>;
}
