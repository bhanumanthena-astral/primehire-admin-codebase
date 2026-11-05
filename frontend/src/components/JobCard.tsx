import {Button} from '@/components/ui/button';
import React from 'react';
import {ArrowUpRight, BriefcaseBusiness, MapPin, Users, CalendarDays, Upload, ShieldCheck, Pencil} from 'lucide-react';
import {Job} from '../lib/hiringApi';
import {User} from '../lib/authTypes';
import {acceptsResumes,hasJobAccess,isJobAdmin} from '../lib/jobAccess';
import {jobDate} from '../lib/jobTimezone';
import {LifecycleBadge} from './JobLifecycle';
import {JobStatusControl} from './JobStatusControl';

export function JobCard({job,user,count,busy,onView,onUpload,onEdit,onAssign,onAccess,onStatus}:{job:Job,user:User|null,count:number,busy:boolean,onView:()=>void,onUpload:()=>void,onEdit:()=>void,onAssign?:()=>void,onAccess:()=>void,onStatus:(status:string)=>void}) {
  const admin=isJobAdmin(user), active=acceptsResumes(job), open=job.lifecycleStatus==='OPEN';
  const total=job.positionsTotal??1,filled=job.positionsFilled??0,remaining=job.positionsRemaining??Math.max(0,total-filled);
  const initials=(job.companyName||'Job').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
  const experience=job.minExperienceYears!=null ? `${job.minExperienceYears}${job.maxExperienceYears!=null?`–${job.maxExperienceYears}`:'+'} years`:'Experience flexible';
  return <article aria-label={job.title} title={job.jobKey} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md">
    <div className={`h-1 w-full ${active?'bg-success':'bg-border'}`}/>
    <div className="flex-1 p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/15 text-xs font-bold text-foreground">{initials}</span><div className="min-w-0"><p className="truncate text-xs font-semibold" title={job.companyName}>{job.companyName||'Company'}</p><p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{job.department||'Hiring team'}</p></div></div><LifecycleBadge className="shrink-0" status={job.lifecycleStatus}/></div>
      <h2 className="line-clamp-2 break-words text-base font-bold leading-snug tracking-tight text-foreground" title={job.title}>{job.title}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground" title={job.jobRole}>{job.jobRole}</p>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin size={12}/>{job.location||'Location flexible'}{job.workMode?` · ${job.workMode.toLowerCase()}`:''}</span><span className="inline-flex items-center gap-1"><BriefcaseBusiness size={12}/>{experience}</span></div>
      <div className="my-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
        <div className="bg-muted/50 px-3 py-2.5"><p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">Open positions</p><p className="text-lg font-bold leading-6 tabular-nums">{remaining}<span className="ml-1 text-[0.6875rem] font-normal text-muted-foreground">of {total}</span></p></div>
        <div className="bg-muted/50 px-3 py-2.5"><p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">Resumes</p><p className="text-lg font-bold leading-6 tabular-nums">{job.pipeline?.resumesUploaded??count}</p></div>
        <div className="bg-card px-3 py-2.5"><p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">Assessment links sent</p><p className="text-lg font-bold leading-6 tabular-nums">{job.pipeline?.linksSent??'—'}</p></div>
        <div className="bg-card px-3 py-2.5"><p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">Assessments completed</p><p className="text-lg font-bold leading-6 tabular-nums">{job.pipeline?.assessmentsCompleted??'—'}</p></div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs"><span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"><Users size={14}/><span className="truncate" title={job.assigneeEmail||''}>{job.assigneeName||job.assigneeEmail||'Unassigned'}</span></span><span className="shrink-0 text-muted-foreground">{filled} filled</span></div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:`${Math.min(100,total?filled/total*100:0)}%`}}/></div>
      <p className="mt-2 flex items-center gap-1 text-[0.6875rem] text-muted-foreground"><CalendarDays size={12}/>Closes {jobDate(job.closesAt)}</p>
      {admin&&<div className="mt-3"><JobStatusControl compact job={job} busy={busy} canRestoreArchived={user?.role==='super_admin'} onChange={onStatus}/></div>}
    </div>
    <div className="border-t border-border bg-background/30 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {(admin||(open&&hasJobAccess(user,'view',job)))&&<Button variant="outline" size="sm" onClick={onView} className="rounded-lg px-2.5 text-[0.6875rem]">Open workspace<ArrowUpRight size={12}/></Button>}
        {active&&hasJobAccess(user,'upload',job)&&<Button size="sm" onClick={onUpload} aria-label="Upload resumes" title="Upload resumes" className="rounded-lg px-2.5 text-[0.6875rem]"><Upload size={12}/>Upload</Button>}
        <div className="ml-auto flex items-center gap-0.5">
        {hasJobAccess(user,'edit',job)&&job.lifecycleStatus!=='ARCHIVED'&&<Button variant="ghost" size="icon-xs" onClick={onEdit} title="Edit job" aria-label={`Edit ${job.title}`} className="rounded-lg text-muted-foreground"><Pencil size={14}/></Button>}
        {admin&&job.lifecycleStatus!=='ARCHIVED'&&<Button variant="ghost" size="icon-xs" onClick={onAssign} title="Assign job" aria-label={`Assign ${job.title}`} className="rounded-lg text-muted-foreground"><Users size={14}/></Button>}
        {admin&&job.lifecycleStatus!=='ARCHIVED'&&<Button variant="ghost" size="icon-xs" onClick={onAccess} title="Assignee access" aria-label={`Access for ${job.title}`} className="rounded-lg text-muted-foreground"><ShieldCheck size={14}/></Button>}
        </div>
      </div>
      {!active&&!admin&&<p className="text-xs text-muted-foreground">{open ? remaining===0?'All positions are filled':'Resume intake is unavailable' : (job.lifecycleStatus||'DRAFT')==='DRAFT'?'Awaiting publication':job.lifecycleStatus==='ON_HOLD'?'Hiring is paused':job.lifecycleStatus==='CLOSED'?'Hiring is complete':'This job is archived'} · Resume uploads are unavailable.</p>}
      <span className="sr-only">{job.jobKey}</span>
    </div>
  </article>;
}
