import React, {useEffect, useState} from 'react';
import {CalendarDays, FileText, RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Table, TableHead, TableHeader, TableBody, TableRow, TableCell} from '@/components/ui/table';
import type {Job} from '../lib/hiringApi';
import {Application, Page, recruitmentRequest, stageLabel} from '../lib/recruitmentApi';
import {useAuth} from '../lib/authContext';
import {JobCandidateReportDialog} from './JobCandidateReportDialog';

export function JobCandidateReports({job,onSchedule}:{job:Job;onSchedule:(application:Application)=>void}) {
  const {user,impersonatingUser}=useAuth();
  const role=impersonatingUser?.role||user?.role;
  const canManage=!impersonatingUser&&['super_admin','admin','recruiter'].includes(role||'');
  const canViewReports=['super_admin','admin','recruiter','hr'].includes(role||'');
  const [page,setPage]=useState(0),[revision,setRevision]=useState(0);
  const [items,setItems]=useState<Application[]>([]),[total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const [report,setReport]=useState<Application|null>(null);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setItems([]);setError('');
    void recruitmentRequest<Page<Application>>(`/applications?jobId=${encodeURIComponent(job.jobId)}&skip=${page*50}&limit=50`,undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted){setItems(value.items);setTotal(value.total);}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[job.jobId,page,revision]);
  return <section aria-label="Candidate reports" className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-bold">Candidate reports</h2><p className="mt-1 text-sm text-muted-foreground">Review candidate scores and move directly to interview scheduling.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>window.location.assign(`/reports?jobId=${encodeURIComponent(job.jobId)}`)}>Open Reports workspace</Button><Button variant="outline" disabled={loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw className="mr-2 h-4 w-4"/>Refresh reports</Button></div>
    </header>
    {error?<div role="alert" className="rounded-xl border p-4 text-sm text-destructive">{error}<Button variant="outline" className="ml-3" onClick={()=>setRevision(value=>value+1)}>Retry candidate reports</Button></div>:loading?<p role="status">Loading candidate reports…</p>:<div className="rounded-2xl border bg-card p-1">
      <Table><caption className="sr-only">Candidate reports for {job.title}</caption>
        <TableHeader><TableRow>{['Candidate name','ATS score','Pipeline stage','Assessment score','Actions'].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{items.map(row=>{
          const hasReport=row.assessment?.reportAvailable??(row.assessment?.score!=null);
          const terminal=['HIRED','REJECTED','WITHDRAWN'].includes(row.currentStage);
          const canSchedule=canManage&&!terminal;
          const pending=/pending|submitted/i.test(row.assessment?.status||'');
          return <TableRow key={row.applicationId}>
            <TableCell className="font-semibold">{row.candidate.name}</TableCell>
            <TableCell className="tabular-nums">{row.atsScore??'Pending'}</TableCell>
            <TableCell><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{stageLabel(row.currentStage)}</span></TableCell>
            <TableCell className="tabular-nums">{row.assessment?.score??(pending?'Report pending':'Not attempted')}</TableCell>
            <TableCell><div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!canViewReports||!hasReport} title={!hasReport?'The assessment report is not ready yet':undefined} onClick={()=>setReport(row)}><FileText className="mr-1.5 h-3.5 w-3.5"/>View report</Button>
              <Button variant="outline" size="sm" disabled={!canSchedule} title={terminal?'This application is no longer active':!canManage?'Interview scheduling permission is required':undefined} onClick={()=>onSchedule(row)}><CalendarDays className="mr-1.5 h-3.5 w-3.5"/>{row.activeInterview?'Reschedule interview':'Schedule interview'}</Button>
            </div></TableCell>
          </TableRow>;
        })}{!items.length&&<TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No candidates for this job yet.</TableCell></TableRow>}</TableBody>
      </Table>
    </div>}
    {!error&&!loading&&<footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span>{total} candidates · Page {page+1} of {Math.max(1,Math.ceil(total/50))}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!page} onClick={()=>setPage(value=>value-1)}>Previous reports</Button><Button variant="outline" size="sm" disabled={(page+1)*50>=total} onClick={()=>setPage(value=>value+1)}>Next reports</Button></div></footer>}
    {report&&<JobCandidateReportDialog key={report.applicationId} job={job} application={report} onClose={()=>setReport(null)}/>}
  </section>;
}
