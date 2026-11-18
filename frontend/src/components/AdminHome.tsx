import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {fetchJobsPage} from '../lib/hiringApi';
import {recruitmentRequest,Tracker} from '../lib/recruitmentApi';

export function AdminHome({onNavigate}:{onNavigate:(tab:string)=>void}){
 const [tracker,setTracker]=useState<Tracker|null>(null);
 const [activeJobs,setActiveJobs]=useState<number|null>(null);
 const [error,setError]=useState('');
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setError('');
  Promise.all([fetchJobsPage({status:'OPEN',limit:1}),recruitmentRequest<Tracker>('/tracker')])
   .then(([jobs,value])=>{if(active){setActiveJobs(jobs.total);setTracker(value)}})
   .catch(e=>{if(active)setError(e.message)});
  return ()=>{active=false};
 },[revision]);
 return <section className="space-y-6">
  <header><h1 className="text-2xl font-semibold">Your hiring workspace</h1><p className="mt-2 text-muted-foreground">Open a job to review resumes, invite candidates and plan interviews.</p><Button className="mt-4" onClick={()=>onNavigate('jobs')}>Manage jobs</Button></header>
  {error&&<p role="alert">{error} <Button variant="outline" onClick={()=>setRevision(n=>n+1)}>Retry</Button></p>}
  <div className="grid gap-4 sm:grid-cols-3">
   {[['Active jobs',activeJobs,'jobs'],['Candidates',tracker?.total,'recruitment'],['Interviews in overview',tracker?.interviews.length,'recruitment']].map(([label,count,target])=><button key={String(label)} className="rounded-2xl border bg-card p-5 text-left hover:border-primary" onClick={()=>onNavigate(String(target))}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-3 block text-3xl">{count??'—'}</strong></button>)}
  </div>
  <section className="space-y-3 rounded-2xl border bg-card p-5"><h2 className="font-semibold">Continue hiring</h2>
   {[['Review resumes','Open a job to upload resumes and review ATS scores.','jobs'],['Review assessment results','Read reports before deciding who to interview.','reports'],['Plan interviews','Schedule rounds and review interviewer feedback.','recruitment']].map(([title,note,target])=><button key={title} onClick={()=>onNavigate(target)} className="flex w-full items-center justify-between rounded-xl border p-4 text-left hover:bg-muted"><span><strong className="block text-sm">{title}</strong><span className="text-sm text-muted-foreground">{note}</span></span><span aria-hidden="true">→</span></button>)}
  </section>
 </section>;
}
