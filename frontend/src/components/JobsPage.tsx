import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {AppSelect} from '@/src/components/ui/AppSelect';
import {RefreshCw} from 'lucide-react';
import {JobCard} from './JobCard';
import {JobAccessModal} from './JobAccessControls';
import {Modal} from './ui/Modal';
import {hasJobAccess,isJobAdmin} from '../lib/jobAccess';
import { jobLocalInput, jobUtcInput, jobDate, setJobTimezone, jobDateBoundary } from '../lib/jobTimezone';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiveJob,
  setJobLifecycle,
  assignJob,
  closeJob,
  deleteJob,
  fetchApplicationCounts,
  fetchJobsPage,
  fetchUserDirectory,
  reopenJob,
  updateJob,
  DirectoryUser,
  Job,
  JobQuery,
} from '../lib/hiringApi';
import { useAuth } from '../lib/authContext';
import { EmptyNote, SectionHeader, PAButton } from './ui/primitives';
import { LifecycleBadge, jobActionsFor } from './JobLifecycle';
import { openCountsByAssignee, ownerDisplayName, resolveOwner } from './assignees';
import { cn } from '@/lib/utils';
import CreateJobForm from './CreateJobForm';
import JobDetailsPage from './JobDetailsPage';
import {JobWorkspace} from './JobWorkspace';
import OwnersDirectory from './OwnersDirectory';
import { JdEditor } from './JdEditor';

const PAGE_SIZE = 20;
const MANAGING_ROLES = new Set(['super_admin', 'admin', 'hr', 'recruiter']);

const STATUS_OPTIONS = ['', 'DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED', 'ARCHIVED'];
const WORK_MODE_OPTIONS = ['', 'ONSITE', 'REMOTE', 'HYBRID'];

function fmtExp(job: Job): string {
  const { minExperienceYears: min, maxExperienceYears: max } = job;
  if (min == null && max == null) return '—';
  const f = (n: number) => Number.isInteger(n) ? String(n) : String(n);
  if (min != null && max != null) return min === max ? `${f(min)} yrs` : `${f(min)}–${f(max)} yrs`;
  if (min != null) return `${f(min)}+ yrs`;
  return `≤ ${f(max as number)} yrs`;
}

function fmtDate(iso: string | null | undefined): string { return jobDate(iso); }

function toLocalInput(iso: string | null | undefined): string { return jobLocalInput(iso); }

interface Filters {
  searchMode: 'contains' | 'exact' | 'starts_with';
  q: string;
  status: string;
  company: string;
  department: string;
  assignee: string;
  experience: string;
  workMode: string;
  openedFrom: string;
  openedTo: string;
  closesFrom: string;
  closesTo: string;
}

const EMPTY_FILTERS: Filters = {
  searchMode: 'contains',
  q: '', status: '', company: '', department: '', assignee: '', experience: '',
  workMode: '', openedFrom: '', openedTo: '', closesFrom: '', closesTo: '',
};

function buildQuery(f: Filters, sort: string, order: 'asc' | 'desc', page: number): JobQuery {
  const exp = f.experience.trim() === '' ? undefined : Number(f.experience);
  return {
    searchMode: f.searchMode,
    q: f.q.trim() || undefined,
    status: f.status || undefined,
    company: f.company.trim() || undefined,
    department: f.department.trim() || undefined,
    assignee: f.assignee.trim() || undefined,
    experience: exp !== undefined && !Number.isNaN(exp) && exp >= 0 ? exp : undefined,
    workMode: f.workMode || undefined,
    openedFrom: jobDateBoundary(f.openedFrom),
    openedTo: jobDateBoundary(f.openedTo, true),
    closesFrom: jobDateBoundary(f.closesFrom),
    closesTo: jobDateBoundary(f.closesTo, true),
    sort, order,
    skip: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
}

/* Two-step confirm button: first click arms, second confirms. */
export function ConfirmAction({
  label, confirmLabel, title, onConfirm, disabled, tone = 'default', busy,
}: {
  label: string;
  confirmLabel: string;
  title?: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  busy?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button variant="ghost"
      type="button"
      title={title}
      disabled={disabled || busy}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
      className={cn(
        'cursor-pointer rounded-md border px-2 py-1 text-[0.6875rem] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        armed
          ? tone === 'danger'
            ? 'border-destructive/30 bg-[var(--destructive-soft)] text-destructive'
            : 'border-[var(--ring)] bg-[var(--primary-soft)] text-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-[var(--ring)]'
      )}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

function SortHeader({
  label, field, sort, order, onSort,
}: {
  label: string;
  field: string;
  sort: string;
  order: 'asc' | 'desc';
  onSort: (field: string) => void;
}) {
  const active = sort === field;
  return (
    <Button variant="ghost"
      type="button"
      onClick={() => onSort(field)}
      className="inline-flex cursor-pointer items-center gap-1 font-bold uppercase hover:text-foreground"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span aria-hidden className={active ? 'text-[var(--accent)]' : 'opacity-40'}>
        {active ? (order === 'asc' ? '▲' : '▼') : '△'}
      </span>
    </Button>
  );
}

export default function JobsPage({onUpload,renderAssessments}: {onUpload?: (job:Job)=>void;renderAssessments?:(job:Job,onViewTable?:(assessment:import('../lib/assessmentManagementApi').ManagedAssessment)=>void)=>React.ReactNode}) {
  const { user,refreshUser } = useAuth();
  const canManage = isJobAdmin(user) || hasJobAccess(user,'edit') || hasJobAccess(user,'create');
  const [accessJob,setAccessJob] = useState<Job|null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'details' | 'owners'>('list');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debounced, setDebounced] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Assignee directory (managers only) + full job list for owner counts.
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]);

  const [editing, setEditing] = useState<Job | null>(null);
  const [assigning, setAssigning] = useState<Job | null>(null);
  const [reopening, setReopening] = useState<Job | null>(null);

  // Debounce the whole query so typing never fights select/date changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(filters);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [filters]);

  const query = useMemo(
    () => buildQuery(debounced, sort, order, page),
    [debounced, sort, order, page]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pageData = await fetchJobsPage(query);
      const appCounts = pageData.items.length ? await fetchApplicationCounts(pageData.items.map(j => j.jobId)) : {};
      setJobs(pageData.items);
      setTotal(pageData.total);
      setCounts(appCounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Directory + full list power the Owners view and owner resolution.
  // Best-effort: the list works without them (email snapshots remain).
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const [users, full] = await Promise.all([
          fetchUserDirectory(),
          fetchJobsPage({ limit: 100 }).then((p) => p.items).catch(() => [] as Job[]),
        ]);
        if (!cancelled) {
          setDirectory(users);
          setAllJobs(full);
        }
      } catch {
        if (!cancelled) {
          setDirectory([]);
          setAllJobs([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const openCounts = useMemo(() => openCountsByAssignee(allJobs), [allJobs]);

  /** Refetch one job from the server (stale/concurrency recovery). */
  const refreshJob = useCallback(
    async (jobId: string): Promise<Job | null> => {
      try {
        const page = await fetchJobsPage({ q: jobId, limit: 5 });
        const fresh = page.items.find((j) => j.jobId === jobId) ?? null;
        if (fresh) {
          setJobs((prev) => prev.map((j) => (j.jobId === jobId ? fresh : j)));
          setAllJobs((prev) => {
            const next = prev.map((j) => (j.jobId === jobId ? fresh : j));
            return prev.some((j) => j.jobId === jobId) ? next : [...prev, fresh];
          });
        }
        return fresh;
      } catch {
        return null;
      }
    },
    []
  );

  const onSort = (field: string) => {
    if (sort === field) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setOrder(field === 'title' || field === 'companyName' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const setFilter = (patch: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  const hasActiveFilters = useMemo(
    () => Object.entries(debounced).some(([key, value]) => key !== 'searchMode' && value.trim() !== ''),
    [debounced]
  );

  async function runAction(jobId: string, fn: () => Promise<Job | unknown>, opts?: { remove?: boolean }) {
    setBusyId(jobId);
    setActionError(null);
    try {
      const updated = await fn();
      if (opts?.remove) {
        setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
        setTotal((t) => Math.max(0, t - 1));
      } else if (updated && typeof updated === 'object' && 'jobId' in (updated as object)) {
        const job = updated as Job;
        setJobs((prev) => prev.map((j) => (j.jobId === job.jobId ? { ...job, pipeline: job.pipeline ?? j.pipeline } : j)));
      } else {
        await load();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (mode === 'create') {
    return (
      <CreateJobForm
        onCreated={(job) => {
          setSelectedJobId(job.jobId);setMode('details');
          void load();
        }}
        onExit={() => {
          setMode('list');
          void load();
        }}
      />
    );
  }

  if (mode === 'details' && selectedJobId) {
    return (
      <JobWorkspace
        jobId={selectedJobId}
        renderAssessments={renderAssessments}
        onBack={() => {
          setMode('list');
          setSelectedJobId(null);
          void load();
        }}
        onChanged={(updated) => {
          setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? { ...updated, pipeline: updated.pipeline ?? j.pipeline } : j)));
        }}
        onDeleted={(jobId) => {
          setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
          setTotal((t) => Math.max(0, t - 1));
          setMode('list');
          setSelectedJobId(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4" aria-label="Jobs">
      {accessJob&&<JobAccessModal job={accessJob} onClose={()=>setAccessJob(null)} onSaved={j=>setJobs(prev=>prev.map(old=>old.jobId===j.jobId?{...j,pipeline:j.pipeline??old.pipeline}:old))}/>}
      <SectionHeader
        eyebrow="Hiring pipeline"
        title="Jobs"
        subtitle={isJobAdmin(user) ? 'A clear view of every opportunity. Manage hiring status and keep your team moving.' : 'Your assigned opportunities. Everything you need to move the right candidates forward.'}
        action={hasJobAccess(user,'create') ? (
          <div className="flex gap-2">
            {isJobAdmin(user)&&<PAButton variant="secondary" onClick={() => setMode(mode === 'owners' ? 'list' : 'owners')}>
              {mode === 'owners' ? 'Jobs list' : 'Owners'}
            </PAButton>}
            <PAButton onClick={() => setMode('create')}>+ Create Job</PAButton>
          </div>
        ) : undefined}
      />

      {mode === 'owners' && canManage && (
        <OwnersDirectory
          directory={directory}
          jobs={allJobs.length > 0 ? allJobs : jobs}
          counts={counts}
          onReassign={(job) => setAssigning(job)}
          onOpen={(jobId) => {
            setSelectedJobId(jobId);
            setMode('details');
          }}
        />
      )}
      {mode !== 'owners' && (
      <>
      {/* ── Search + filters ── */}
      <div className="apple-job-filter-panel rounded-[1.25rem] border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="apple-job-filters">
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground apple-job-search-field">
            Search (ID, title, role, company, assignee)
            <div className="apple-job-search flex min-w-0 flex-wrap gap-2">
            <Input
              value={filters.q}
              onChange={(e) => setFilter({ q: e.target.value })}
              placeholder="e.g. backend, Acme, ELITE-…"
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Search jobs"
            />
            <AppSelect aria-label="Search matching" value={filters.searchMode} onValueChange={e => setFilter({searchMode: e as Filters['searchMode']})} className="ehr-input w-32 shrink-0 px-2 py-2 text-xs normal-case tracking-normal">
              <option value="contains">Contains</option><option value="starts_with">Starts with</option><option value="exact">Exact match</option>
            </AppSelect>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Status
            <AppSelect
              value={filters.status}
              onValueChange={(e) => setFilter({ status: e })}
              className="ehr-input cursor-pointer px-3 py-2 text-[0.8125rem] font-semibold normal-case tracking-normal"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </AppSelect>
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Work mode
            <AppSelect
              value={filters.workMode}
              onValueChange={(e) => setFilter({ workMode: e })}
              className="ehr-input cursor-pointer px-3 py-2 text-[0.8125rem] font-semibold normal-case tracking-normal"
              aria-label="Filter by work mode"
            >
              <option value="">All modes</option>
              {WORK_MODE_OPTIONS.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </AppSelect>
          </label>
          <details className="col-span-full"><summary className="cursor-pointer py-2 text-xs font-bold text-muted-foreground">More filters · company, experience & dates</summary><div className="apple-job-extra-filters mt-3 grid gap-3">          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Company
            <Input
              value={filters.company}
              onChange={(e) => setFilter({ company: e.target.value })}
              placeholder="Acme"
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Filter by company"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Department
            <Input
              value={filters.department}
              onChange={(e) => setFilter({ department: e.target.value })}
              placeholder="Engineering"
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Filter by department"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Assignee
            <Input
              value={filters.assignee}
              onChange={(e) => setFilter({ assignee: e.target.value })}
              placeholder="email or user id"
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Filter by assignee"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Experience (yrs)
            <Input
              value={filters.experience}
              onChange={(e) => setFilter({ experience: e.target.value })}
              placeholder="e.g. 3"
              inputMode="decimal"
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Filter by experience"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Opened from
            <Input
              type="date"
              value={filters.openedFrom}
              onChange={(e) => setFilter({ openedFrom: e.target.value })}
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Opened from date"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Opened to
            <Input
              type="date"
              value={filters.openedTo}
              onChange={(e) => setFilter({ openedTo: e.target.value })}
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Opened to date"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Closes from
            <Input
              type="date"
              value={filters.closesFrom}
              onChange={(e) => setFilter({ closesFrom: e.target.value })}
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Closes from date"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Closes to
            <Input
              type="date"
              value={filters.closesTo}
              onChange={(e) => setFilter({ closesTo: e.target.value })}
              className="ehr-input px-3 py-2 text-[0.8125rem] font-normal normal-case tracking-normal"
              aria-label="Closes to date"
            />
          </label>
</div></details>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost"
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="mt-3 cursor-pointer text-[0.75rem] font-bold text-[var(--accent)] hover:underline"
          >
            Clear all filters
          </Button>
        )}
      </div>

      {actionError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-[var(--destructive-soft)] px-4 py-2.5 text-[0.78125rem] font-medium text-destructive">
          {actionError}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold text-muted-foreground">{total} opportunit{total===1?'y':'ies'}</p><Button variant="ghost" className="ml-auto rounded-lg border border-border bg-card p-2 text-muted-foreground" aria-label="Refresh jobs" title="Refresh jobs and access" disabled={loading} onClick={()=>{void refreshUser?.();void load();}}><RefreshCw size={14}/></Button><label className="inline-flex items-center gap-2 text-xs text-muted-foreground">Sort by <AppSelect aria-label="Sort jobs" className="ehr-input w-auto min-w-28 px-2 py-1" value={sort} onValueChange={e=>{setSort(e);setPage(0);}}><option value="createdAt">Newest</option><option value="title">Job title</option><option value="companyName">Company</option><option value="closesAt">Closing date</option></AppSelect><Button variant="ghost" className="ml-2 rounded-lg border border-border p-2" aria-label="Reverse sort order" onClick={()=>setOrder(o=>o==='asc'?'desc':'asc')}>{order==='asc'?'↑':'↓'}</Button></label></div>
      {/* ── Job cards ── */}
      <div className="space-y-5">
        {loading ? (
          <div className="space-y-2 p-4" aria-label="Loading jobs">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : error ? (
          <p role="alert" className="p-6 text-sm text-destructive">{error}</p>
        ) : jobs.length === 0 ? (
          <EmptyNote>
            {hasActiveFilters
              ? 'No jobs found.'
              : hasJobAccess(user,'create') ? "You haven't created any jobs yet. Create your first job to start receiving applications." : 'No jobs are assigned to you yet. Your administrator will assign an opportunity when it is ready.'}
          </EmptyNote>
        ) : (
          <div className="apple-job-grid grid items-start gap-3">
            {jobs.map(j=><JobCard key={j.jobId} job={j} user={user} count={counts[j.jobId]??0} busy={busyId===j.jobId}
              onView={()=>{setSelectedJobId(j.jobId);setMode('details');}}
              onUpload={()=>{setSelectedJobId(j.jobId);setMode('details');}} onEdit={()=>setEditing(j)} onAssign={()=>setAssigning(j)} onAccess={()=>setAccessJob(j)}
              onStatus={status=>{
                if(status==='OPEN'&&j.lifecycleStatus==='CLOSED') {setReopening(j);return;}
                void runAction(j.jobId,()=>status==='CLOSED'?closeJob(j.jobId):status==='ARCHIVED'?archiveJob(j.jobId):setJobLifecycle(j.jobId,status as "OPEN"|"ON_HOLD"));
              }}/>) }
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && !error && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[0.75rem]">
            <span className="font-semibold text-muted-foreground tabular-nums">
              Page {page + 1} of {pageCount} · {total} job{total === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost"
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 font-bold transition-colors hover:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Prev
              </Button>
              <Button variant="ghost"
                type="button"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 font-bold transition-colors hover:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </Button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {editing && (
        <EditJobModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? { ...updated, pipeline: updated.pipeline ?? j.pipeline } : j)));
            setEditing(null);
          }}
          onError={setActionError}
        />
      )}
      {assigning && (
        <AssignModal
          job={assigning}
          directory={directory}
          openCounts={openCounts}
          onClose={() => setAssigning(null)}
          onSaved={(updated) => {
            setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? { ...updated, pipeline: updated.pipeline ?? j.pipeline } : j)));
            setAssigning(null);
          }}
          onError={setActionError}
          onRefresh={refreshJob}
        />
      )}
      {reopening && (
        <ReopenModal
          job={reopening}
          onClose={() => setReopening(null)}
          onSaved={(updated) => {
            setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? { ...updated, pipeline: updated.pipeline ?? j.pipeline } : j)));
            setReopening(null);
          }}
          onError={setActionError}
        />
      )}
    </div>
  );
}

/* ── Expanded detail (uses the Slice 2 detail endpoint) ── */
/* ── Edit modal: the 5 spec-editable fields, status-aware ── */
export function EditJobModal({
  job, onClose, onSaved, onError,
}: {
  job: Job;
  onClose: () => void;
  onSaved: (j: Job) => void;
  onError: (msg: string | null) => void;
}) {
  const lifecycle = (job.lifecycleStatus || 'DRAFT').toUpperCase();
  const closed = lifecycle === 'CLOSED';
  const [keywords, setKeywords] = useState((job.keywords || []).join(', '));
  const [jd, setJd] = useState(job.jdHtml || job.jdText || job.description || '');
  const [assigneeEmail, setAssigneeEmail] = useState(job.assigneeEmail || '');
  const [closesAt, setClosesAt] = useState(toLocalInput(job.closesAt));
  const [positions, setPositions] = useState(String(job.positionsTotal ?? 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    onError(null);
    setSaving(true);
    try {
      const email = assigneeEmail.trim();
      const rest: Record<string, unknown> = {
        expectedUpdatedAt: job.updatedAt,
        keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
        jdHtml: jd,
        closesAt: closesAt ? jobUtcInput(closesAt) : null,
      };
      if (email && email !== (job.assigneeEmail || '')) {
        const users = await fetchUserDirectory();
        const owner = users.find(u => u.isActive && u.email.toLowerCase() === email.toLowerCase());
        if (!owner) throw new Error('Choose an active assignee from this organization.');
        rest.assigneeUserId = owner.userId;
      }
      if (!closed) rest.positionsTotal = Number(positions);
      onSaved(await updateJob(job.jobId, rest));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Edit · ${job.jobKey}`} onClose={onClose} dismissible={!saving}>
      <form onSubmit={onSave} className="space-y-3">
        {closed && (
          <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[0.75rem] font-semibold text-[var(--warning)]">
            Closed jobs accept limited edits: closing date, assignee, keywords and description only.
          </p>
        )}
        <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
          Keywords (comma separated)
          <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
          Job description
          <JdEditor value={jd} onChange={setJd} />
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
          Assignee email
          <Input value={assigneeEmail} onChange={(e) => setAssigneeEmail(e.target.value)} placeholder="hr@company.com" className="ehr-input px-3 py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
          Closes at
          <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
        </label>
        {!closed && (
          <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
            Number of positions
            <Input type="number" min={1} step={1} value={positions} onChange={(e) => setPositions(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
          </label>
        )}
        {error && <p role="alert" className="text-[0.78125rem] font-medium text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <PAButton variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</PAButton>
          <PAButton type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</PAButton>
        </div>
      </form>
    </ModalShell>
  );
}

/* ── Assign modal: directory select, inactive-owner warning, stale refresh ── */
export function AssignModal({
  job, directory, openCounts, onClose, onSaved, onError, onRefresh,
}: {
  job: Job;
  directory: DirectoryUser[];
  openCounts: Record<string, number>;
  onClose: () => void;
  onSaved: (j: Job) => void;
  onError: (msg: string | null) => void;
  onRefresh?: (jobId: string) => Promise<Job | null>;
}) {
  const owner = resolveOwner(job, directory);
  const [selectedId, setSelectedId] = useState(job.assigneeUserId || '');
  const [emailFallback, setEmailFallback] = useState(job.assigneeEmail || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const useDirectory = directory.length > 0;
  const selected = directory.find((u) => u.userId === selectedId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = useDirectory
      ? selected?.email || ''
      : emailFallback.trim();
    if (!email) {
      setError(useDirectory ? 'Select an active user.' : 'Enter the new assignee email.');
      return;
    }
    setError(null);
    onError(null);
    setSaving(true);
    try {
      onSaved(await assignJob(job.jobId, email));
    } catch (err) {
      // Stale/concurrent change: resync from the server, keep our state.
      if (onRefresh) {
        try {
          const fresh = await onRefresh(job.jobId);
          if (fresh) onSaved(fresh);
        } catch {
          /* resync is best-effort; the error below is authoritative */
        }
      }
      setError(err instanceof Error ? err.message : 'Reassignment failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Assign · ${job.jobKey}`} onClose={onClose} dismissible={!saving}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="rounded-xl border border-border bg-[var(--primary-soft)]/50 px-3 py-2.5">
          <div className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Assigned to
          </div>
          <div className="mt-0.5 text-[0.84375rem] font-bold">
            {owner.name || owner.email || 'Unassigned'}
            {!owner.active && (owner.userId || owner.email) && (
              <span className="ml-2 rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[0.6875rem] font-bold text-[var(--warning)]">
                Inactive — preserved
              </span>
            )}
          </div>
          {owner.email && owner.name && (
            <div className="text-[0.75rem] text-muted-foreground">{owner.email}</div>
          )}
          {!owner.active && (owner.userId || owner.email) && (
            <p className="mt-1 text-[0.75rem] text-muted-foreground">
              This owner is deactivated or deleted. Their history is preserved —
              pick an active user below to reassign.
            </p>
          )}
        </div>
        {useDirectory ? (
          <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
            New assignee (active users only)
            <AppSelect
              value={selectedId}
              onValueChange={(e) => setSelectedId(e)}
              className="ehr-input cursor-pointer px-3 py-2 font-normal"
              aria-label="New assignee"
            >
              <option value="">Select an active user…</option>
              {directory.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name} · {u.email} · {u.role}
                  {openCounts[u.userId] ? ` · ${openCounts[u.userId]} open` : ''}
                </option>
              ))}
            </AppSelect>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
            New assignee email
            <Input
              value={emailFallback}
              onChange={(e) => setEmailFallback(e.target.value)}
              placeholder="hr@company.com"
              className="ehr-input px-3 py-2 font-normal"
              aria-label="New assignee email"
            />
          </label>
        )}
        {selected && (
          <p className="text-[0.75rem] text-muted-foreground">
            Email snapshot: <strong className="text-foreground">{selected.email}</strong> ·
            they will be notified on save.
          </p>
        )}
        {error && <p role="alert" className="text-[0.78125rem] font-medium text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <PAButton variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</PAButton>
          <PAButton type="submit" disabled={saving}>{saving ? 'Assigning…' : 'Reassign'}</PAButton>
        </div>
      </form>
    </ModalShell>
  );
}

export function ReopenModal({
  job, onClose, onSaved, onError,
}: {
  job: Job;
  onClose: () => void;
  onSaved: (j: Job) => void;
  onError: (msg: string | null) => void;
}) {
  const [closesAt, setClosesAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ModalShell title={`Reopen · ${job.jobKey}`} onClose={onClose} dismissible={!saving}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          onError(null);
          if (!closesAt) {
            setError('A valid future closing date is required to reopen.');
            return;
          }
          setSaving(true);
          try {
            onSaved(await reopenJob(job.jobId, jobUtcInput(closesAt)));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Reopen failed.');
          } finally {
            setSaving(false);
          }
        }}
        className="space-y-3"
      >
        <p className="text-[0.78125rem] text-muted-foreground">
          Reopening requires a valid future closing date. The job returns to OPEN.
        </p>
        <label className="flex flex-col gap-1 text-[0.75rem] font-bold">
          New closing date
          <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
        </label>
        {error && <p role="alert" className="text-[0.78125rem] font-medium text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <PAButton variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</PAButton>
          <PAButton type="submit" disabled={saving}>{saving ? 'Reopening…' : 'Reopen job'}</PAButton>
        </div>
      </form>
    </ModalShell>
  );
}

export function ModalShell({ title, onClose, children, dismissible = true }: { title: string; onClose: () => void; children: React.ReactNode; dismissible?: boolean }) {
  return <Modal onClose={onClose} label={title} dismissible={dismissible} className="max-w-lg p-5">
    <h3 className="mb-4 pr-6 text-[1rem] font-semibold tracking-tight">{title}</h3>
    {children}
  </Modal>;
}
