import {Button} from '@/components/ui/button';
import {useEffect, useState} from 'react';
import type {Job} from '../lib/hiringApi';
import {Capabilities, intakeGet} from '../lib/resumeIntakeApi';
import {Application, Interview, recruitmentRequest} from '../lib/recruitmentApi';
import {JobPipelineDetails} from './JobPipelineDetails';
import type {HiringStage} from './JobHiringProgress';
import ResumeIntakePage from './ResumeIntakePage';
import {JobAssessmentCandidates} from './JobAssessmentCandidates';
import {JobAssessmentAssignment} from './JobAssessmentAssignment';
import {JobCandidateReports} from './JobCandidateReports';
import {RecruitmentWorkspace} from './recruitment/RecruitmentWorkspace';
import {ScheduleDialog} from './recruitment/ScheduleDialog';

export function HiringStageWorkspace({job,stage,onChanged,onJobChanged}:{
  job:Job; stage:HiringStage; onChanged:()=>void; onJobChanged?:(job:Job)=>void;
}) {
  const intake = stage==='resumesUploaded'||stage==='atsTotal';
  const [caps,setCaps]=useState<Capabilities|null>(null);
  const [error,setError]=useState('');
  const [choose,setChoose]=useState(false);
  const [queue,setQueue]=useState<Application[]>([]);
  const [existing,setExisting]=useState<Interview>();
  const [revision,setRevision]=useState(0);
  const [saved,setSaved]=useState<string[]>([]);
  const target=queue[0];
  useEffect(()=>{
    if(!intake)return;
    let active=true;
    intakeGet<Capabilities>('/capabilities').then(value=>{if(active)setCaps(value)}).catch(e=>{if(active)setError(e.message)});
    return ()=>{active=false};
  },[intake]);
  useEffect(()=>{
    setExisting(undefined);
    if(!target?.activeInterview)return;
    const controller=new AbortController();
    recruitmentRequest<Interview>('/interviews/'+encodeURIComponent(target.activeInterview.interviewId),undefined,'GET',controller.signal)
      .then(row=>{if(!controller.signal.aborted)setExisting(row)})
      .catch(e=>{if(!controller.signal.aborted){setError(e.message);setQueue([])}});
    return ()=>controller.abort();
  },[target]);
  return <div className="space-y-4 p-3 sm:p-4">
    <details><summary className="cursor-pointer text-sm font-semibold">Records counted in this stage</summary>
      <JobPipelineDetails jobId={job.jobId} stage={stage}/></details>
    {error&&<p role="alert">{error}</p>}
    {intake&&(caps?.enabled?<ResumeIntakePage onChanged={onChanged} scopedJob={job} capabilities={caps} initialJobKey={job.jobKey} initialView={stage==='atsTotal'?'batches':'upload'}/>:<p role="status">{caps?'Resume intake is disabled.':'Loading resume intake…'}</p>)}
    {(intake||stage==='linksSent')&&<>
      {job.assessmentJobId&&<Button variant="outline" onClick={()=>setChoose(!choose)}>{choose?"Close assessment selection":"View linked assessment"}</Button>}
      {(!job.assessmentJobId||choose)&&<JobAssessmentAssignment job={job} onLinked={(id,round)=>{onJobChanged?.({...job,assessmentJobId:id,assessmentRoundType:round});setChoose(false);onChanged()}}/>}
      <JobAssessmentCandidates job={job} pipelineStage={stage==='linksSent'?'linksSent':undefined} onChooseAssessment={()=>setChoose(true)} onChanged={onChanged} embedded/>
    </>}
    {stage==='assessmentsCompleted'&&<JobCandidateReports key={revision} job={job} completedOnly onSchedule={row=>setQueue([row])} onScheduleSelected={setQueue}/>}
    {saved.length>0&&<p role="status">Schedule saved for {saved.join(', ')}.</p>}
    {target&&(!target.activeInterview||existing?.interviewId===target.activeInterview.interviewId)&&<ScheduleDialog deferInvitation key={target.applicationId} application={target} existing={target.activeInterview?existing:undefined}
      onClose={()=>setQueue([])} onSaved={()=>{setSaved(names=>[...names,target.candidate.name]);setQueue(rows=>rows.slice(1));setRevision(n=>n+1);onChanged()}}/>}
    {(stage==='technical'||stage==='managerial'||stage==='hr')&&<RecruitmentWorkspace scopedJobId={job.jobId} initialRound={stage}/>}
  </div>;
}
