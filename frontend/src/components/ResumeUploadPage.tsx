import {TableColumnSettings} from './TableColumnSettings';
import {useTableColumnSettings} from '../lib/useTableColumnSettings';
import {Progress} from '@/components/ui/progress';
import {AppSelect} from '@/src/components/ui/AppSelect';
import {Checkbox} from '@/components/ui/checkbox';
import {Button} from '@/components/ui/button';
import {Table, TableHeader, TableRow, TableHead, TableBody, TableCell} from '@/components/ui/table';
import {useAuth} from '../lib/authContext';
import {hasJobAccess,acceptsResumes} from '../lib/jobAccess';
import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchBatch,
  fetchBatches,
  fetchJobs,
  Job,
  ResumeBatch,
  ResumeFile,
  uploadResumes,
} from '../lib/hiringApi';
import { EmptyNote, Pill, SectionHeader, PAButton } from './ui/primitives';
import {ResumeFilePicker, fileSize} from './ResumeFilePicker';
import {BriefcaseBusiness, CheckCircle2, FileText, Loader2, ShieldCheck, Upload} from 'lucide-react';
import {Capabilities, intakeGet} from '../lib/resumeIntakeApi';
import {legacyScreensAllowed} from '../lib/deploymentMode';
const UPLOAD_COLUMNS=['File','Size','Status','Name','Email','Phone','Skills'].map(label=>({key:label.toLowerCase(),label,required:label==='File'}));
const IntakeWorkspace = React.lazy(()=>import('./ResumeIntakePage'));

function statusTone(s: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (s === 'parsed' || s === 'done') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'quarantined' || s === 'partial') return 'warning';
  return 'info';
}

/**
 * Resume Upload page (Slice A): pick a job, tick consent, upload single or
 * bulk resumes, watch the live batch table with per-file parse statuses.
 */
export function LegacyResumeUploadPage({initialJobKey=''}:{initialJobKey?:string}) {
  const {user}=useAuth();
  const columns=useTableColumnSettings(UPLOAD_COLUMNS,user?`elitehr:table-columns:resume-upload:${user.orgId}:${user.userId}`:undefined);
  function renderFileCell(f:ResumeFile,key:string){switch(key){
    case 'file':return <TableCell className="px-2 py-1 font-mono text-xs">{f.fileName}</TableCell>;
    case 'size':return <TableCell className="px-2 py-1">{(f.sizeBytes / 1024).toFixed(1)} KB</TableCell>;
    case 'status':return <TableCell className="px-2 py-1">
                      <Pill tone={statusTone(f.status)}>{f.status}</Pill>
                      {f.error && <span className="ml-1 text-xs opacity-70">{f.error}</span>}
                      {f.llmStatus === 'pending' && (
                        <span className="ml-1"><Pill tone="warning">AI scoring pending</Pill></span>
                      )}
                      {f.status === 'parsed' && !f.llmStatus && (
                        <span className="ml-1"><Pill tone="neutral">Saved for later matching</Pill></span>
                      )}
                      {(f.llmStatus === 'failed' || f.llmStatus === 'skipped') && f.status === 'parsed' && (
                        <span className="ml-1"><Pill tone="neutral">AI unavailable — deterministic score used</Pill></span>
                      )}
                    </TableCell>;
    case 'name':return <TableCell className="px-2 py-1">{f.parsedJson?.name || '—'}</TableCell>;
    case 'email':return <TableCell className="px-2 py-1">{f.parsedJson?.email || '—'}</TableCell>;
    case 'phone':return <TableCell className="px-2 py-1">{f.parsedJson?.phone || '—'}</TableCell>;
    case 'skills':return <TableCell className="px-2 py-1 text-xs">{(f.parsedJson?.skills || []).join(', ') || '—'}</TableCell>;
  }}
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobKey, setJobKey] = useState(initialJobKey);
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ResumeBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ batch: ResumeBatch; files: ResumeFile[] } | null>(null);
  const [polling, setPolling] = useState(false);

  // Live batch table: the worker extracts and stores details off-request, so poll
  // until every file reaches a terminal status.
  useEffect(() => {
    if (!selected || selected.batch.status !== 'processing') {
      setPolling(false);
      return;
    }
    setPolling(true);
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const fresh = await fetchBatch(selected.batch.batchId);
        setSelected(fresh);
        if (fresh.batch.status !== 'processing' || tries >= 60) {
          clearInterval(timer);
          setPolling(false);
          if (fresh.batch.status !== 'processing') {
            setBatches((prev) => [fresh.batch, ...prev.filter((b) => b.batchId !== fresh.batch.batchId)]);
          }
        }
      } catch {
        clearInterval(timer);
        setPolling(false);
      }
    }, 3000);
    return () => { clearInterval(timer); setPolling(false); };
  }, [selected?.batch.batchId, selected?.batch.status]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [j, b] = await Promise.all([fetchJobs(), fetchBatches()]);
      const eligible=j.filter(job=>acceptsResumes(job)&&hasJobAccess(user,'upload',job));
      setJobs(eligible);
      setBatches(b);
      setJobKey(prev=>eligible.some(job=>job.jobKey===prev)?prev:eligible[0]?.jobKey||'');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [user?.userId,user?.role,user?.jobAccess?.join(',')]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobKey || !jobs.some(job=>job.jobKey===jobKey&&acceptsResumes(job)&&hasJobAccess(user,'upload',job))) { setError('Select an open job with resume upload access.'); return; }
    if (!consent) { setError('Candidate consent is required to upload resumes.'); return; }
    if (files.length === 0) { setError('Choose at least one PDF, DOCX or DOC file.'); return; }
    setUploading(true);
    try {
      const result = await uploadResumes(jobKey, consent, files);
      setSelected(result);
      setBatches((prev) => [result.batch, ...prev.filter((b) => b.batchId !== result.batch.batchId)]);
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function openBatch(batchId: string) {
    try {
      setSelected(await fetchBatch(batchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batch.');
    }
  }

  const activeJob = jobs.find(job => job.jobKey === jobKey);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const processed = selected ? selected.batch.counts.parsed + selected.batch.counts.failed + selected.batch.counts.quarantined : 0;
  const batchTotal = selected?.batch.counts.total || 0;

  return (
    <div className="space-y-6" aria-label="Resume upload">
      <SectionHeader
        eyebrow="Hiring pipeline"
        title="Resume Upload"
        subtitle="Upload PDF or Word resumes to extract and save candidate details. Saved data can be used for JD matching later."
      />
      {!jobs.length&&!loading&&<p role="status" className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No assigned jobs are currently open for resume uploads. Ask your administrator to open a job or grant upload access.</p>}
      <form onSubmit={onUpload} className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]" aria-label="Upload resumes" aria-busy={uploading}>
        <div className="border-b border-border px-5 py-5 sm:px-6">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold"><BriefcaseBusiness size={16} className="text-primary"/> Choose a job</div>
          <label className="flex flex-col gap-2 text-xs font-semibold">
            Job profile
            <AppSelect value={jobKey} onValueChange={e => setJobKey(e)} disabled={uploading || loading || !jobs.length}
              className="ehr-input w-full min-w-0 px-3 py-3 text-sm font-medium" aria-label="Job profile">
              {!jobs.length && <option value="">{loading ? 'Loading available jobs…' : 'No open jobs with upload access'}</option>}
              {jobs.map(job => <option key={job.jobId} value={job.jobKey}>{job.title} — {job.jobKey}</option>)}
            </AppSelect>
          </label>
          {activeJob && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-success dark:text-success"><span className="h-1.5 w-1.5 rounded-full bg-success"/>Open for resumes</span>
            {activeJob.companyName && <span>{activeJob.companyName}</span>}
            {activeJob.location && <span>{activeJob.location}</span>}
          </div>}
        </div>
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <ResumeFilePicker files={files} onChange={setFiles} disabled={!jobKey || loading} uploading={uploading}/>
          </div>
          <aside className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/50 p-5" aria-label="Upload summary">
            <h3 className="flex items-center gap-2 text-sm font-bold"><FileText size={16} className="text-primary"/>Upload summary</h3>
            <dl className="mt-5 space-y-4 text-xs">
              <div><dt className="text-muted-foreground">Selected job</dt><dd className="mt-1 break-words font-semibold">{activeJob?.title || 'Choose a job above'}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Resumes</dt><dd className="font-bold tabular-nums">{files.length} / 10</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Total size</dt><dd className="font-bold tabular-nums">{totalBytes ? fileSize(totalBytes) : '—'}</dd></div>
            </dl>
            <div className="my-5 border-t border-border"/>
            <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed">
              <Checkbox  checked={consent} disabled={uploading} onCheckedChange={e => setConsent(e)}
                className="mt-1 h-4 w-4 shrink-0 accent-amber-600" aria-label="Candidate consent confirmed"/>
              <span>I confirm candidates consented to processing their resumes for this hiring workflow.</span>
            </label>
            {error && <p role="alert" className="mt-4 break-words text-xs text-destructive">{error}</p>}
            <PAButton type="submit" disabled={uploading || !consent || !jobKey || !files.length || loading}
              title={!files.length ? 'Add resumes to upload' : !consent ? 'Confirm candidate consent to upload' : undefined}
              className="mt-5 w-full py-3">
              {uploading ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none"/> : <Upload size={16}/>}
              {uploading ? 'Uploading…' : 'Upload resumes'}
            </PAButton>
            <p role="status" className="mt-3 text-center text-[0.6875rem] leading-relaxed text-muted-foreground">
              {uploading ? 'Keep this page open while your files upload.' : !files.length ? 'Add files to get started.' : !consent ? 'Confirm consent to start the upload.' : `${files.length} resume${files.length === 1 ? '' : 's'} ready to upload.`}
            </p>
            <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-[0.6875rem] leading-relaxed text-muted-foreground">
              <ShieldCheck size={15} className="mt-0.5 shrink-0"/><span>Resumes are linked to the selected job. Follow each file’s processing status below.</span>
            </div>
          </aside>
        </div>
      </form>

      {selected && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-[var(--shadow-card)] sm:p-6" aria-label="Batch detail">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CheckCircle2 size={17} className="text-primary"/><strong>Batch {selected.batch.batchId.slice(0, 8)}</strong>
            <Pill tone={statusTone(selected.batch.status)}>{selected.batch.status}</Pill>
            {polling && <span className="text-xs opacity-60">Worker running — refreshing…</span>}
            {!polling && selected.batch.status === 'processing' && (
              <Button variant="ghost" onClick={() => void openBatch(selected.batch.batchId)} className="text-xs text-warning hover:underline">
                Refresh
              </Button>
            )}
            <span className="opacity-70">
              {selected.batch.counts.parsed} parsed · {selected.batch.counts.failed} failed ·{' '}
              {selected.batch.counts.quarantined} quarantined
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Resume processing</span><span className="tabular-nums">{processed} / {batchTotal} complete</span></div>
            <Progress aria-label="Resume processing progress" value={Math.min(processed, batchTotal)} max={Math.max(batchTotal, 1)}
              className="w-full [&_[data-slot=progress-track]]:h-2"/>
          </div>
          <div className="flex justify-end"><TableColumnSettings settings={columns}/></div>
          <div className="overflow-x-auto">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="text-left opacity-70">
                  {columns.visible.map(column=><TableHead key={column.key} className="px-2 py-1">{column.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {selected.files.map((f) => (
                  <TableRow key={f.fileId} className="border-t">
                    {columns.visible.map(column=><React.Fragment key={column.key}>{renderFileCell(f,column.key)}</React.Fragment>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Upload batches</h3>
        {loading && <div className="h-12 animate-pulse rounded-xl border" aria-label="Loading batches" />}
        {!loading && batches.length === 0 && (
          <EmptyNote>No uploads yet — run the first batch above.</EmptyNote>
        )}
        {batches.map((b) => (
          <Button variant="ghost"
            key={b.batchId}
            onClick={() => void openBatch(b.batchId)}
            className="flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm hover:bg-card/5"
          >
            <span className="font-mono text-xs">{b.batchId.slice(0, 8)}</span>
            <span>{b.jobKey}</span>
            <Pill tone={statusTone(b.status)}>{b.status}</Pill>
            <span className="opacity-70">
              {b.counts.parsed}/{b.counts.total} parsed
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function ResumeUploadPage({initialJobKey=''}:{initialJobKey?:string}) {
  const [caps,setCaps]=useState<Capabilities|null>(null);
  const [checked,setChecked]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setChecked(false);setCaps(null);
    void intakeGet<Capabilities>('/capabilities',controller.signal).then(value=>{if(!controller.signal.aborted)setCaps(value);}).catch(()=>undefined).finally(()=>{if(!controller.signal.aborted)setChecked(true);});
    return()=>controller.abort();
  },[attempt]);
  if(!checked)return <div aria-label="Loading resume workspace" className="h-48 animate-pulse rounded-2xl border border-border bg-card"/>;
  if(caps?.enabled)return <React.Suspense fallback={<div role="status">Loading resume workspace…</div>}><IntakeWorkspace capabilities={caps} initialJobKey={initialJobKey}/></React.Suspense>;
  if(!legacyScreensAllowed())return <div role="alert" className="rounded-2xl border border-border bg-card p-6">Resume workspace is temporarily unavailable.<Button variant="outline" className="ml-3" onClick={()=>setAttempt(value=>value+1)}>Retry resume workspace</Button></div>;
  return <LegacyResumeUploadPage initialJobKey={initialJobKey}/>;
}
