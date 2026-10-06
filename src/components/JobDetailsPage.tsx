import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  archiveJob,
  closeJob,
  deleteJob,
  fetchJobActivity,
  fetchJobDetail,
  fetchJobNotifications,
  fetchUserDirectory,
  AuditEntry,
  DirectoryUser,
  Job,
  JobApplicationSummary,
  JobDetail,
  JobNotification,
} from '../lib/hiringApi';
import { useAuth } from '../lib/authContext';
import { EmptyNote, PAButton } from './ui/primitives';
import { LifecycleBadge, LifecycleStepper, jobActionsFor, visitedFromActivity } from './JobLifecycle';
import { AssignModal, ConfirmAction, EditJobModal, ReopenModal } from './JobsPage';
import { actorForUserId, ownerDisplayName, resolveOwner } from './assignees';

const MANAGING_ROLES = new Set(['super_admin', 'admin', 'hr']);

function fmtExp(job: Job): string {
  const { minExperienceYears: min, maxExperienceYears: max } = job;
  if (min == null && max == null) return '—';
  if (min != null && max != null) return min === max ? `${min} yrs` : `${min}–${max} yrs`;
  if (min != null) return `${min}+ yrs`;
  return `≤ ${max as number} yrs`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${months[d.getMonth()]}-${d.getFullYear()} ${String(hours).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function fmtValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return fmtDateTime(value);
    return value.length > 90 ? `${value.slice(0, 87)}…` : value;
  }
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'object') {
    const s = JSON.stringify(value);
    return s.length > 90 ? `${s.slice(0, 87)}…` : s;
  }
  return String(value);
}

function sanitizeJd(html: string): string {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'ul', 'ol', 'li', 'blockquote', 'a', 'b', 'i', 'strong', 'em', 'br'],
    ALLOWED_ATTR: ['href'],
  });
}

function ActivityItem({ entry, directory }: { entry: AuditEntry; directory: DirectoryUser[] }) {
  const details = (entry.details || {}) as Record<string, unknown>;
  const changes = (details.changes || {}) as Record<string, { from?: unknown; to?: unknown }>;
  return (
    <div className="relative">
      <span aria-hidden className="ehr-timeline-dot done" />
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {fmtDateTime(entry.createdAt)}
      </div>
      <ActivityTitle entry={entry} directory={directory} />
      <ActivityDetails entry={entry} changes={changes} details={details} directory={directory} />
    </div>
  );
}

function ActorName({ entry, directory }: { entry: AuditEntry; directory: DirectoryUser[] }) {
  const actor = actorForUserId(entry.actorUserId, directory);
  return (
    <span>
      {actor.name}
      {actor.email && actor.name !== actor.email && (
        <span className="font-medium text-muted-foreground"> · {actor.email}</span>
      )}
    </span>
  );
}

function ActivityTitle({ entry, directory }: { entry: AuditEntry; directory: DirectoryUser[] }) {
  const by = <ActorName entry={entry} directory={directory} />;
  switch (entry.action) {
    case 'job.create':
      return <div className="mt-0.5 text-[13px] font-bold">Job created by {by}</div>;
    case 'job.update': {
      const fields = Object.keys((entry.details as Record<string, unknown> || {}).changes || {});
      return (
        <div className="mt-0.5 text-[13px] font-bold">
          {fields.length > 0 ? `Updated ${fields.join(', ')}` : 'Job updated'} · by {by}
        </div>
      );
    }
    case 'job.assign':
      return <div className="mt-0.5 text-[13px] font-bold">Assignee changed · by {by}</div>;
    case 'job.close':
      return <div className="mt-0.5 text-[13px] font-bold">Job closed · by {by}</div>;
    case 'job.reopen':
      return <div className="mt-0.5 text-[13px] font-bold">Job reopened · by {by}</div>;
    case 'job.archive':
      return <div className="mt-0.5 text-[13px] font-bold">Job archived · by {by}</div>;
    case 'job.delete':
      return <div className="mt-0.5 text-[13px] font-bold">Job deleted · by {by}</div>;
    default:
      return <div className="mt-0.5 text-[13px] font-bold">{entry.action} · by {by}</div>;
  }
}

function ActivityDetails({
  entry, changes, details, directory,
}: {
  entry: AuditEntry;
  changes: Record<string, { from?: unknown; to?: unknown }>;
  details: Record<string, unknown>;
  directory: DirectoryUser[];
}) {
  const rows: { field: string; from: unknown; to: unknown }[] = [];
  for (const [field, pair] of Object.entries(changes)) {
    if (pair && typeof pair === 'object' && ('from' in pair || 'to' in pair)) {
      rows.push({ field, from: pair.from, to: pair.to });
    }
  }
  if (entry.action === 'job.assign' && rows.length === 0 && 'from' in details) {
    rows.push({ field: 'assigneeUserId', from: details.from, to: details.to });
  }
  if (rows.length === 0) {
    if (entry.action === 'job.close' && details.reason) {
      return <div className="text-xs text-muted-foreground">Reason: {fmtValue(details.reason)}</div>;
    }
    return null;
  }
  const idLike = (field: string) =>
    field === 'assigneeUserId' || field.toLowerCase().includes('actor');
  return (
    <ul className="mt-1 space-y-0.5">
      {rows.map((r) => (
        <li key={r.field} className="text-xs text-muted-foreground">
          <span className="font-bold text-foreground/80">{r.field}</span>{' '}
          {idLike(r.field) ? <UserRef userId={String(r.from ?? '')} directory={directory} /> : fmtValue(r.from)}{' '}
          <span aria-hidden>→</span>{' '}
          {idLike(r.field) ? <UserRef userId={String(r.to ?? '')} directory={directory} /> : fmtValue(r.to)}
        </li>
      ))}
    </ul>
  );
}

function UserRef({ userId, directory }: { userId: string; directory: DirectoryUser[] }) {
  const info = actorForUserId(userId || null, directory);
  return (
    <span>
      {info.name}
      {info.email && info.name !== info.email && (
        <span> · {info.email}</span>
      )}
    </span>
  );
}

function ApplicationRow({
  app, onOpen,
}: {
  app: JobApplicationSummary;
  onOpen: (applicantId: string) => void;
}) {
  const applicantId = String(app.applicantId || '');
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] font-bold" title={applicantId}>
          {applicantId ? `${applicantId.slice(0, 8)}…` : 'Unknown applicant'}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {String(app.currentStage || '').replace(/_/g, ' ') || 'No stage'} · {String(app.status || 'active')}
        </div>
      </div>
      {applicantId && (
        <button
          type="button"
          onClick={() => onOpen(applicantId)}
          className="shrink-0 cursor-pointer rounded-md border border-border px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
        >
          View candidate
        </button>
      )}
    </li>
  );
}

function NotificationRow({ item }: { item: JobNotification }) {
  const status = String(item.status || 'pending').toLowerCase();
  const label =
    status === 'sent' ? 'Sent' :
    status === 'failed' ? 'Failed' :
    status === 'sending' ? 'Sending' : 'Queued';
  const tone =
    status === 'sent'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'failed'
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-[var(--primary-soft)] text-foreground/80 border-border';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-bold" title={item.subject || ''}>
          {item.toName ? `To ${item.toName}` : 'Assignee notification'}
          {item.toMasked ? <span className="font-medium text-muted-foreground"> · {item.toMasked}</span> : null}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {item.sentVia === 'dry_run' ? 'Recorded (dry-run, not sent)' : label}
          {typeof item.attempts === 'number' && item.attempts > 0 ? ` · ${item.attempts} attempt${item.attempts === 1 ? '' : 's'}` : ''}
          {status === 'failed' && item.lastError ? ` · ${item.lastError}` : ''}
        </div>
      </div>
      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone}`}>
        {item.sentVia === 'dry_run' ? 'Dry-run' : label}
      </span>
    </li>
  );
}

export default function JobDetailsPage({
  jobId, onBack, onChanged, onDeleted,
}: {
  jobId: string;
  onBack: () => void;
  onChanged: (job: Job) => void;
  onDeleted: (jobId: string) => void;
}) {
  const { user } = useAuth();
  const canManage = new Set(['super_admin', 'admin', 'hr']).has(user?.role || '');

  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [notifications, setNotifications] = useState<JobNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchJobDetail(jobId));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load job.';
      setError(/404/.test(message) ? 'Job not found.' : message);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const res = await fetchJobActivity(jobId);
      setActivity(res.items);
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, [jobId]);

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    setNotifError(null);
    try {
      const res = await fetchJobNotifications(jobId);
      setNotifications(res.items);
    } catch (e) {
      setNotifications([]);
      setNotifError(e instanceof Error ? e.message : 'Failed to load notifications.');
    } finally {
      setNotifLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    void loadActivity();
    void loadNotifications();
  }, [load, loadActivity, loadNotifications]);

  // Directory for owner names + the assign modal (managers only).
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const users = await fetchUserDirectory();
        if (!cancelled) setDirectory(users);
      } catch {
        if (!cancelled) setDirectory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  async function refreshJob(): Promise<Job | null> {
    try {
      const fresh = await fetchJobDetail(jobId);
      setDetail(fresh);
      onChanged(fresh.job);
      return fresh.job;
    } catch {
      return null;
    }
  }

  async function runAction(fn: () => Promise<unknown>, opts?: { remove?: boolean; removeId?: string }) {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await fn();
      if (opts?.remove && opts.removeId) {
        onDeleted(opts.removeId);
        return;
      }
      const job = updated as Job;
      setDetail((d) => (d ? { ...d, job } : d));
      onChanged(job);
      void loadActivity();
      void loadNotifications();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  function openApplicant(applicantId: string) {
    window.dispatchEvent(new CustomEvent('elite:open-applicant', { detail: { applicantId } }));
  }

  const visited = useMemo(
    () => visitedFromActivity(activity, detail?.job.lifecycleStatus),
    [activity, detail]
  );

  if (loading) {
    return (
      <div className="space-y-4" aria-label="Loading job details">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-[1.25rem] bg-muted" />
        <div className="h-40 animate-pulse rounded-[1.25rem] bg-muted" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <PAButton variant="secondary" onClick={onBack}>← Back to Jobs</PAButton>
        <div role="alert" className="rounded-[1.25rem] border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
          <p className="text-[15px] font-bold">{error || 'Job not found.'}</p>
          <PAButton variant="secondary" className="mt-4" onClick={() => void load()}>Retry</PAButton>
        </div>
      </div>
    );
  }

  const { job, applications, counts } = detail;
  const lifecycle = (job.lifecycleStatus || 'DRAFT').toUpperCase();
  const actions = jobActionsFor(lifecycle, canManage, counts.total ?? 0);
  const owner = resolveOwner(job, directory);

  return (
    <div className="space-y-5" aria-label="Job details">
      <PAButton variant="secondary" onClick={onBack}>← Back to Jobs</PAButton>

      {/* ── Header ── */}
      <div className="ehr-rise rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Job details</div>
            <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">{job.title}</h1>
            <p className="mt-0.5 text-[13.5px] font-semibold text-muted-foreground">
              {job.jobRole || '—'} · {job.companyName || '—'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LifecycleBadge status={lifecycle} />
              <span className="font-mono text-[12px] text-muted-foreground" title={job.jobId}>
                Job ID: {job.jobKey}
              </span>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-1.5">
              {actions.canEdit && <EditButton onClick={() => setEditing(true)} />}
              {actions.canAssign && (
              <button type="button" onClick={() => setAssigning(true)}
                className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-bold transition-colors hover:border-[var(--ring)]">
                Assign
              </button>
              )}
              {actions.canClose && (
                <ConfirmAction label="Close" confirmLabel="Confirm close?"
                  title="Are you sure you want to close this job? New applications will no longer be accepted."
                  busy={busy} onConfirm={() => void runAction(() => closeJob(job.jobId))} />
              )}
              {actions.canReopen && (
                <button type="button" onClick={() => setReopening(true)}
                  className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-bold transition-colors hover:border-[var(--ring)]">
                  Reopen
                </button>
              )}
              {actions.canArchive && (
                <ConfirmAction label="Archive" confirmLabel="Confirm archive?" busy={busy}
                  onConfirm={() => void runAction(() => archiveJob(job.jobId))} />
              )}
              {actions.canDelete && (
                <ConfirmAction label="Delete" confirmLabel="Delete forever?" tone="danger" busy={busy}
                  onConfirm={() => void runAction(() => deleteJob(job.jobId), { remove: true, removeId: job.jobId })} />
              )}
            </div>
          )}
        </div>
        {actionError && (
          <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-[12.5px] font-medium text-red-700">
            {actionError}
          </div>
        )}
        <dl className="mt-4 grid gap-x-8 sm:grid-cols-3">
          <InfoRow label="Positions" value={`${job.positionsTotal ?? 1} total · ${job.positionsFilled ?? 0} filled · ${job.positionsRemaining ?? '?'} left`} />
          <InfoRow
            label="Assignee"
            value={(
              <span className="inline-flex items-center gap-1.5">
                {ownerDisplayName(owner)}
                {!owner.active && (owner.userId || owner.email) && (
                  <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                    Inactive — preserved
                  </span>
                )}
              </span>
            )}
          />
          <InfoRow label="Experience" value={fmtExp(job)} />
        </dl>
      </div>

      {/* ── Lifecycle progress (visual only; history lives in Activity) ── */}
      <section aria-label="Lifecycle progress" className="ehr-rise rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-[14px] font-extrabold tracking-tight">Lifecycle progress</h2>
        <div className="mt-3">
          <LifecycleStepper status={lifecycle} visited={visited} />
        </div>
        {lifecycle !== 'OPEN' && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {lifecycle === 'DRAFT' && 'Draft jobs do not accept applications and are not listed as active.'}
            {lifecycle === 'ON_HOLD' && 'This job is on hold and does not accept applications.'}
            {lifecycle === 'CLOSED' && 'This job should no longer accept applications.'}
            {lifecycle === 'ARCHIVED' && 'Archived jobs are read-only. Applications and history are preserved.'}
          </p>
        )}
      </section>

      {/* ── Overview ── */}
      <section aria-label="Job overview" className="ehr-rise ehr-rise-1 rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-[14px] font-extrabold tracking-tight">Job overview</h2>
        <dl className="mt-2 grid gap-x-10 md:grid-cols-2">
          <InfoRow label="Company Name" value={job.companyName || '—'} />
          <InfoRow label="Job ID" value={job.jobKey} mono />
          <InfoRow label="Job Role" value={job.jobRole || '—'} />
          <InfoRow label="Job Title" value={job.title} />
          <InfoRow label="Department" value={job.department || '—'} />
          <InfoRow label="Work Mode" value={job.workMode || '—'} />
          <InfoRow label="Location" value={job.location || '—'} />
          <InfoRow label="Opened At" value={fmtDate(job.openedAt)} />
          <InfoRow label="Closes At" value={fmtDate(job.closesAt)} />
          <InfoRow label="Assignee Email" value={job.assigneeEmail || '—'} />
        </dl>
        {(job.keywords?.length ?? 0) > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Keywords</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {job.keywords!.map((k) => (
                <span key={k} className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-[11.5px] font-bold">{k}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── JD ── */}
      <section aria-label="Job description" className="ehr-rise ehr-rise-2 rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-[14px] font-extrabold tracking-tight">Job Description</h2>
        {job.jdHtml ? (
          <div
            className="ehr-richtext !min-h-0 mt-2 !p-0"
            dangerouslySetInnerHTML={{ __html: sanitizeJd(job.jdHtml) }}
          />
        ) : (
          <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">
            {job.jdText || job.description || 'No description.'}
          </p>
        )}
      </section>

      {/* ── Applications ── */}
      <section aria-label="Applications" className="ehr-rise ehr-rise-3 rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-[14px] font-extrabold tracking-tight">
          Applications <span className="text-muted-foreground">({counts.total ?? applications.length})</span>
        </h2>
        {applications.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            No applications yet. {lifecycle === 'OPEN' ? 'This job is open and accepting applications.' : 'This job should no longer accept applications.'}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {applications.map((a) => (
              <ApplicationRow key={String(a.applicationId)} app={a} onOpen={openApplicant} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Activity ── */}
      <section aria-label="Activity" className="ehr-rise ehr-rise-4 rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-[14px] font-extrabold tracking-tight">Activity</h2>
        {activityLoading ? (
          <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" aria-label="Loading activity" />
        ) : activity.length === 0 ? (
          <EmptyNote>No activity recorded yet.</EmptyNote>
        ) : (
          <div className="ehr-timeline mt-4 space-y-5">
            {activity.map((entry) => (
              <ActivityItem key={entry.auditId} entry={entry} directory={directory} />
            ))}
          </div>
        )}
      </section>

      {/* ── Notifications (read-only visibility over the existing outbox) ── */}
      <section aria-label="Notifications" className="ehr-rise rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-[14px] font-extrabold tracking-tight">Notifications</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Assignment emails queued through the existing outbox. The Activity trail above remains authoritative for who changed the assignee and when.
        </p>
        {notifLoading ? (
          <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" aria-label="Loading notifications" />
        ) : notifError ? (
          <div role="alert" className="mt-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-[12.5px] text-muted-foreground">
            Could not load notification status.{' '}
            <button type="button" onClick={() => void loadNotifications()} className="font-bold underline underline-offset-2">Retry</button>
          </div>
        ) : notifications.length === 0 ? (
          <EmptyNote>No assignment notifications queued yet.</EmptyNote>
        ) : (
          <ul className="mt-3 space-y-2">
            {notifications.map((n) => (
              <NotificationRow key={n.messageId} item={n} />
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <EditJobModal
          job={job}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setDetail((d) => (d ? { ...d, job: updated } : d));
            onChanged(updated);
            setEditing(false);
          }}
          onError={setActionError}
        />
      )}
      {assigning && (
        <AssignModal
          job={job}
          directory={directory}
          openCounts={{}}
          onClose={() => setAssigning(false)}
          onSaved={(updated) => {
            setDetail((d) => (d ? { ...d, job: updated } : d));
            onChanged(updated);
            setAssigning(false);
            void loadActivity();
            void loadNotifications();
          }}
          onError={setActionError}
          onRefresh={refreshJob}
        />
      )}
      {reopening && (
        <ReopenModal
          job={job}
          onClose={() => setReopening(false)}
          onSaved={(updated) => {
            setDetail((d) => (d ? { ...d, job: updated } : d));
            onChanged(updated);
            setReopening(false);
          }}
          onError={setActionError}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="shrink-0 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-[13px] font-semibold ${mono ? 'font-mono text-[12px]' : ''}`} title={typeof value === 'string' ? value : undefined}>{value}</dd>
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-bold transition-colors hover:border-[var(--ring)]">
      Edit
    </button>
  );
}
