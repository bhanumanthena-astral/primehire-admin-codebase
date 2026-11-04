import React, {useEffect, useState} from 'react';
import {ArrowLeft, ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import JobDetailsPage from './JobDetailsPage';
import {JobAssessmentAssignment} from './JobAssessmentAssignment';
import {JobApplicationsPage} from './JobApplicationsPage';
import ResumeIntakePage from './ResumeIntakePage';
import {RecruitmentWorkspace} from './recruitment/RecruitmentWorkspace';
import {Job, fetchJobDetail} from '../lib/hiringApi';
import {Capabilities, intakeGet} from '../lib/resumeIntakeApi';
import {Application} from '../lib/recruitmentApi';
import {JobAssessmentCandidates} from './JobAssessmentCandidates';
import {JobCandidateReports} from './JobCandidateReports';
import type {ManagedAssessment} from '../lib/assessmentManagementApi';

const steps = ['Job details', 'Resumes & ATS review', 'Assessments', 'Candidate reports', 'Interview scheduling'];
export function JobWorkspace({jobId,onBack,onChanged,onDeleted,renderAssessments}:{jobId:string;onBack:()=>void;onChanged:(job:Job)=>void;onDeleted:(id:string)=>void;renderAssessments?:(job:Job,onViewTable?:(assessment:ManagedAssessment)=>void)=>React.ReactNode}) {
  const [job,setJob]=useState<Job|null>(null),[step,setStep]=useState(0),[applicationsOpen,setApplicationsOpen]=useState(false),[error,setError]=useState('');
  const [candidateTable,setCandidateTable]=useState<ManagedAssessment|null>(null);
  const [scheduleTarget,setScheduleTarget]=useState<Application|null>(null);
  const [caps,setCaps]=useState<Capabilities|null>(null);
  useEffect(()=>{let active=true;void fetchJobDetail(jobId).then(value=>{if(active)setJob(value.job);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[jobId,step]);
  useEffect(()=>{if(step!==1)return;let active=true;void intakeGet<Capabilities>('/capabilities').then(value=>{if(active)setCaps(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[step]);
  if(applicationsOpen&&job)return <JobApplicationsPage job={job} onBack={()=>setApplicationsOpen(false)}/>;
  return <section className="space-y-5" aria-label="Job workspace">
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4"/>Exit to jobs</Button><nav aria-label="Job breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><button onClick={()=>setStep(0)}>{job?.title||'Job workspace'}</button><ChevronRight size={14}/><span className="font-semibold text-foreground">{steps[step]}</span></nav></div>
    <header className="rounded-2xl border bg-card p-5"><p className="text-xs text-muted-foreground">{job?.jobKey} · {job?.lifecycleStatus||job?.status}</p><h1 className="mt-1 text-2xl font-bold">{job?.title||'Loading job…'}</h1><p className="mt-2 text-sm text-muted-foreground">Manage this job from resume intake to the final interview, with every stage in one workspace.</p></header>
    <nav aria-label="Hiring stages" className="apple-hiring-stages flex flex-wrap">{steps.map((name,index)=><Button key={name} variant={step===index?'default':'outline'} aria-current={step===index?'step':undefined} onClick={()=>{setError('');setStep(index);}}>{index+1}. {name}</Button>)}</nav>
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {step===0&&<JobDetailsPage jobId={jobId} onBack={onBack} onChanged={value=>{setJob(value);onChanged(value);}} onDeleted={onDeleted} onUpload={()=>setStep(1)} onShowApplications={()=>setApplicationsOpen(true)}/>}
    {step===1&&job&&(caps?.enabled?<ResumeIntakePage key={jobId} capabilities={caps} scopedJob={job} initialJobKey={job.jobKey}/>:<p role="status">{caps?'Resume intake is not enabled on this server.':'Loading resume intake…'}</p>)}
    {step===2&&job&&<>{!candidateTable&&<JobAssessmentAssignment job={job} onLinked={(assessmentId,roundType)=>{const updated={...job,assessmentJobId:assessmentId,assessmentRoundType:roundType};setJob(updated);onChanged(updated);}}/>}{candidateTable?<><Button variant="outline" onClick={()=>setCandidateTable(null)}><ArrowLeft className="mr-2 h-4 w-4"/>Back to assessments</Button><h2 className="text-xl font-bold">{candidateTable.jobTitle} · Candidate invitations</h2><JobAssessmentCandidates key={`${job.jobId}:${candidateTable.id}`} job={job} onChooseAssessment={()=>setCandidateTable(null)}/></>:renderAssessments?.(job,setCandidateTable)||<p>Assessment management is unavailable.</p>}</>}
    {step===3&&job&&<JobCandidateReports job={job} onSchedule={application=>{setScheduleTarget(application);setStep(4);}}/>}
    {step===4&&<RecruitmentWorkspace key={jobId} scopedJobId={jobId} initialScheduleApplication={scheduleTarget||undefined} onInitialScheduleHandled={()=>setScheduleTarget(null)}/>}
    <div className="flex justify-between border-t pt-4"><Button variant="outline" disabled={step===0} onClick={()=>setStep(n=>n-1)}>Previous stage</Button><Button disabled={step===steps.length-1} onClick={()=>setStep(n=>n+1)}>Next stage<ChevronRight className="ml-2 h-4 w-4"/></Button></div>
  </section>;
}

