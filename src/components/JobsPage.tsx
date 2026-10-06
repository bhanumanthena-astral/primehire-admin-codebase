import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiveJob,
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
import OwnersDirectory from './OwnersDirectory';

const PAGE_SIZE = 20;
const MANAGING_ROLES = new Set(['super_admin', 'admin', 'hr']);

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Filters {
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
  q: '', status: '', company: '', department: '', assignee: '', experience: '',
  workMode: '', openedFrom: '', openedTo: '', closesFrom: '', closesTo: '',
};

function buildQuery(f: Filters, sort: string, order: 'asc' | 'desc', page: number): JobQuery {
  const exp = f.experience.trim() === '' ? undefined : Number(f.experience);
  return {
    q: f.q.trim() || undefined,
    status: f.status || undefined,
    company: f.company.trim() || undefined,
    department: f.department.trim() || undefined,
    assignee: f.assignee.trim() || undefined,
    experience: exp !== undefined && !Number.isNaN(exp) && exp >= 0 ? exp : undefined,
    workMode: f.workMode || undefined,
    openedFrom: f.openedFrom || undefined,
    openedTo: f.openedTo || undefined,
    closesFrom: f.closesFrom || undefined,
    closesTo: f.closesTo || undefined,
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
    <button
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
        'cursor-pointer rounded-md border px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        armed
          ? tone === 'danger'
            ? 'border-red-400 bg-red-50 text-red-700'
            : 'border-[var(--ring)] bg-[var(--primary-soft)] text-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-[var(--ring)]'
      )}
    >
      {armed ? confirmLabel : label}
    </button>
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
    <button
      type="button"
      onClick={() => onSort(field)}
      className="inline-flex cursor-pointer items-center gap-1 font-bold uppercase hover:text-foreground"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span aria-hidden className={active ? 'text-[var(--accent)]' : 'opacity-40'}>
        {active ? (order === 'asc' ? '▲' : '▼') : '△'}
      </span>
    </button>
  );
}

export default function JobsPage() {
  const { user } = useAuth();
  const canManage = MANAGING_ROLES.has(user?.role || '');
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
      const [pageData, appCounts] = await Promise.all([
        fetchJobsPage(query),
        fetchApplicationCounts().catch(() => ({} as Record<string, number>)),
      ]);
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
    () => Object.values(debounced).some((v: string) => v.trim() !== ''),
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
        setJobs((prev) => prev.map((j) => (j.jobId === job.jobId ? job : j)));
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
        onCreated={() => {
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
      <JobDetailsPage
        jobId={selectedJobId}
        onBack={() => {
          setMode('list');
          setSelectedJobId(null);
        }}
        onChanged={(updated) => {
          setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? updated : j)));
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
    <div className="space-y-5" aria-label="Jobs">
      <SectionHeader
        eyebrow="Hiring pipeline"
        title="Jobs"
        subtitle="Requisitions with lifecycle, assignees and applications. New jobs are created from the Create flow."
        action={canManage ? (
          <div className="flex gap-2">
            <PAButton variant="secondary" onClick={() => setMode(mode === 'owners' ? 'list' : 'owners')}>
              {mode === 'owners' ? 'Jobs list' : 'Owners'}
            </PAButton>
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
      <div className="rounded-[1.25rem] border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="grid gap-2.5 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:col-span-2">
            Search (ID, title, role, company, assignee)
            <input
              value={filters.q}
              onChange={(e) => setFilter({ q: e.target.value })}
              placeholder="e.g. backend, Acme, ELITE-…"
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Search jobs"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Status
            <select
              value={filters.status}
              onChange={(e) => setFilter({ status: e.target.value })}
              className="ehr-input cursor-pointer px-3 py-2 text-[13px] font-semibold normal-case tracking-normal"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Work mode
            <select
              value={filters.workMode}
              onChange={(e) => setFilter({ workMode: e.target.value })}
              className="ehr-input cursor-pointer px-3 py-2 text-[13px] font-semibold normal-case tracking-normal"
              aria-label="Filter by work mode"
            >
              <option value="">All modes</option>
              {WORK_MODE_OPTIONS.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Company
            <input
              value={filters.company}
              onChange={(e) => setFilter({ company: e.target.value })}
              placeholder="Acme"
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Filter by company"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Department
            <input
              value={filters.department}
              onChange={(e) => setFilter({ department: e.target.value })}
              placeholder="Engineering"
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Filter by department"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Assignee
            <input
              value={filters.assignee}
              onChange={(e) => setFilter({ assignee: e.target.value })}
              placeholder="email or user id"
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Filter by assignee"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Experience (yrs)
            <input
              value={filters.experience}
              onChange={(e) => setFilter({ experience: e.target.value })}
              placeholder="e.g. 3"
              inputMode="decimal"
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Filter by experience"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Opened from
            <input
              type="date"
              value={filters.openedFrom}
              onChange={(e) => setFilter({ openedFrom: e.target.value })}
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Opened from date"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Opened to
            <input
              type="date"
              value={filters.openedTo}
              onChange={(e) => setFilter({ openedTo: e.target.value })}
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Opened to date"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Closes from
            <input
              type="date"
              value={filters.closesFrom}
              onChange={(e) => setFilter({ closesFrom: e.target.value })}
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Closes from date"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Closes to
            <input
              type="date"
              value={filters.closesTo}
              onChange={(e) => setFilter({ closesTo: e.target.value })}
              className="ehr-input px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              aria-label="Closes to date"
            />
          </label>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="mt-3 cursor-pointer text-[12px] font-bold text-[var(--accent)] hover:underline"
          >
            Clear all filters
          </button>
        )}
      </div>

      {actionError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] font-medium text-red-700">
          {actionError}
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-[var(--shadow-card)]">
        {loading ? (
          <div className="space-y-2 p-4" aria-label="Loading jobs">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : error ? (
          <p role="alert" className="p-6 text-sm text-red-600">{error}</p>
        ) : jobs.length === 0 ? (
          <EmptyNote>
            {hasActiveFilters
              ? 'No jobs found.'
              : "You haven't created any jobs yet. Create your first job to start receiving applications."}
          </EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="ehr-table min-w-[1240px]">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th><SortHeader label="Job Title" field="title" sort={sort} order={order} onSort={onSort} /></th>
                  <th>Job Role</th>
                  <th><SortHeader label="Company" field="companyName" sort={sort} order={order} onSort={onSort} /></th>
                  <th>Department</th>
                  <th>Experience</th>
                  <th>Positions</th>
                  <th>Applications</th>
                  <th>Assignee</th>
                  <th><SortHeader label="Opened At" field="openedAt" sort={sort} order={order} onSort={onSort} /></th>
                  <th><SortHeader label="Closes At" field="closesAt" sort={sort} order={order} onSort={onSort} /></th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const lifecycle = (j.lifecycleStatus || 'DRAFT').toUpperCase();
                  const appCount = counts[j.jobId] ?? 0;
                  const actions = jobActionsFor(lifecycle, canManage, appCount);
                  return (
                    <React.Fragment key={j.jobId}>
                      <tr>
                        <td className="font-mono text-[12px] font-bold" title={j.jobId}>{j.jobKey}</td>
                        <td className="font-bold">{j.title}</td>
                        <td>{j.jobRole || '—'}</td>
                        <td>{j.companyName || '—'}</td>
                        <td>{j.department || '—'}</td>
                        <td className="tabular-nums">{fmtExp(j)}</td>
                        <td className="tabular-nums">
                          {j.positionsTotal ?? 1}
                          <span className="text-muted-foreground"> ({j.positionsRemaining ?? '?'} left)</span>
                        </td>
                        <td className="tabular-nums">{appCount}</td>
                        <td className="max-w-[180px]">
                          {(() => {
                            const owner = resolveOwner(j, directory);
                            const label = ownerDisplayName(owner);
                            return (
                              <span className="inline-flex max-w-full items-center gap-1.5">
                                <span className="truncate" title={label}>{label}</span>
                                {!owner.active && (owner.userId || owner.email) && (
                                  <span title="Deactivated — assignment preserved"
                                    className="h-2 w-2 shrink-0 rounded-full bg-[var(--warning)]" aria-label="Inactive assignee" />
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        <td>{fmtDate(j.openedAt)}</td>
                        <td>{fmtDate(j.closesAt)}</td>
                        <td><LifecycleBadge status={lifecycle} /></td>
                        <td>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedJobId(j.jobId);
                                setMode('details');
                              }}
                              className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground hover:border-[var(--ring)]"
                            >
                              View
                            </button>
                            {actions.canEdit && (
                              <button
                                type="button"
                                onClick={() => setEditing(j)}
                                className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground hover:border-[var(--ring)]"
                              >
                                Edit
                              </button>
                            )}
                            {actions.canClose && (
                              <ConfirmAction
                                label="Close"
                                confirmLabel="Confirm close?"
                                title="Are you sure you want to close this job? New applications will no longer be accepted."
                                busy={busyId === j.jobId}
                                onConfirm={() => void runAction(j.jobId, () => closeJob(j.jobId))}
                              />
                            )}
                            {actions.canReopen && (
                              <button
                                type="button"
                                onClick={() => setReopening(j)}
                                className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground hover:border-[var(--ring)]"
                              >
                                Reopen
                              </button>
                            )}
                            {actions.canArchive && (
                              <ConfirmAction
                                label="Archive"
                                confirmLabel="Confirm archive?"
                                busy={busyId === j.jobId}
                                onConfirm={() => void runAction(j.jobId, () => archiveJob(j.jobId))}
                              />
                            )}
                            {actions.canAssign && (
                              <button
                                type="button"
                                onClick={() => setAssigning(j)}
                                className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground hover:border-[var(--ring)]"
                              >
                                Assign
                              </button>
                            )}
                            {actions.canDelete && (
                              <ConfirmAction
                                label="Delete"
                                confirmLabel="Delete forever?"
                                tone="danger"
                                busy={busyId === j.jobId}
                                onConfirm={() => void runAction(j.jobId, () => deleteJob(j.jobId), { remove: true })}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && !error && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-[12px]">
            <span className="font-semibold text-muted-foreground tabular-nums">
              Page {page + 1} of {pageCount} · {total} job{total === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 font-bold transition-colors hover:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                type="button"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 font-bold transition-colors hover:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
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
            setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? updated : j)));
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
            setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? updated : j)));
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
            setJobs((prev) => prev.map((j) => (j.jobId === updated.jobId ? updated : j)));
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
  const [jd, setJd] = useState(job.jdText || job.description || '');
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
      if (email && email !== (job.assigneeEmail || '')) {
        // Reuse the assign endpoint so snapshot + notification stay identical.
        onSaved(await assignJob(job.jobId, email));
      }
      const rest: Record<string, unknown> = {
        keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
        jdHtml: jd,
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      };
      if (!closed) rest.positionsTotal = Number(positions);
      onSaved(await updateJob(job.jobId, rest));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Edit · ${job.jobKey}`} onClose={onClose}>
      <form onSubmit={onSave} className="space-y-3">
        {closed && (
          <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--warning)]">
            Closed jobs accept limited edits: closing date, assignee, keywords and description only.
          </p>
        )}
        <label className="flex flex-col gap-1 text-[12px] font-bold">
          Keywords (comma separated)
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-bold">
          Job description (plain text; rich formatting lands in the Create flow)
          <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={5} className="ehr-input px-3 py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-bold">
          Assignee email
          <input value={assigneeEmail} onChange={(e) => setAssigneeEmail(e.target.value)} placeholder="hr@company.com" className="ehr-input px-3 py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-bold">
          Closes at
          <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
        </label>
        {!closed && (
          <label className="flex flex-col gap-1 text-[12px] font-bold">
            Number of positions
            <input type="number" min={1} step={1} value={positions} onChange={(e) => setPositions(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
          </label>
        )}
        {error && <p role="alert" className="text-[12.5px] font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <PAButton variant="secondary" type="button" onClick={onClose}>Cancel</PAButton>
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
    <ModalShell title={`Assign · ${job.jobKey}`} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="rounded-xl border border-border bg-[var(--primary-soft)]/50 px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Assigned to
          </div>
          <div className="mt-0.5 text-[13.5px] font-bold">
            {owner.name || owner.email || 'Unassigned'}
            {!owner.active && (owner.userId || owner.email) && (
              <span className="ml-2 rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--warning)]">
                Inactive — preserved
              </span>
            )}
          </div>
          {owner.email && owner.name && (
            <div className="text-[12px] text-muted-foreground">{owner.email}</div>
          )}
          {!owner.active && (owner.userId || owner.email) && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              This owner is deactivated or deleted. Their history is preserved —
              pick an active user below to reassign.
            </p>
          )}
        </div>
        {useDirectory ? (
          <label className="flex flex-col gap-1 text-[12px] font-bold">
            New assignee (active users only)
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
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
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-[12px] font-bold">
            New assignee email
            <input
              value={emailFallback}
              onChange={(e) => setEmailFallback(e.target.value)}
              placeholder="hr@company.com"
              className="ehr-input px-3 py-2 font-normal"
              aria-label="New assignee email"
            />
          </label>
        )}
        {selected && (
          <p className="text-[12px] text-muted-foreground">
            Email snapshot: <strong className="text-foreground">{selected.email}</strong> ·
            they will be notified on save.
          </p>
        )}
        {error && <p role="alert" className="text-[12.5px] font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <PAButton variant="secondary" type="button" onClick={onClose}>Cancel</PAButton>
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
    <ModalShell title={`Reopen · ${job.jobKey}`} onClose={onClose}>
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
            onSaved(await reopenJob(job.jobId, new Date(closesAt).toISOString()));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Reopen failed.');
          } finally {
            setSaving(false);
          }
        }}
        className="space-y-3"
      >
        <p className="text-[12.5px] text-muted-foreground">
          Reopening requires a valid future closing date. The job returns to OPEN.
        </p>
        <label className="flex flex-col gap-1 text-[12px] font-bold">
          New closing date
          <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="ehr-input px-3 py-2 font-normal" />
        </label>
        {error && <p role="alert" className="text-[12.5px] font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <PAButton variant="secondary" type="button" onClick={onClose}>Cancel</PAButton>
          <PAButton type="submit" disabled={saving}>{saving ? 'Reopening…' : 'Reopen job'}</PAButton>
        </div>
      </form>
    </ModalShell>
  );
}

export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="ehr-rise relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.25rem] border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-extrabold tracking-tight">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="cursor-pointer rounded-lg px-2 py-1 text-lg leading-none text-muted-foreground hover:text-foreground">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
