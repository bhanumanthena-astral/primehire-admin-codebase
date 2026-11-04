import { DirectoryUser, Job } from '../lib/hiringApi';

export interface OwnerInfo {
  userId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

/**
 * Resolve a job owner for display. Active directory users win; otherwise the
 * stored snapshot is preserved and flagged inactive/deleted (PRD §6 — history
 * is never erased, reassignment stays available).
 */
export function resolveOwner(job: Job, directory: DirectoryUser[]): OwnerInfo {
  const found = directory.find((u) => u.userId === job.assigneeUserId);
  if (found) {
    return {
      userId: found.userId,
      name: found.name,
      email: found.email,
      role: found.role,
      active: true,
    };
  }
  return {
    userId: job.assigneeUserId || '',
    name: '',
    email: job.assigneeEmail || '',
    role: '',
    active: false,
  };
}

export function ownerDisplayName(owner: OwnerInfo): string {
  if (owner.name) return owner.email ? `${owner.name} · ${owner.email}` : owner.name;
  return owner.email || 'Unassigned';
}

/** Display name for an actor/assignee id using the directory, else a short id. */
export function nameForUserId(
  userId: string | null | undefined,
  directory: DirectoryUser[]
): string {
  if (!userId) return '—';
  if (userId === 'system:auto-close') return 'Automatic closure';
  const found = directory.find((u) => u.userId === userId);
  if (found) return found.name || found.email;
  return `Former user ${userId.slice(0, 8)}`;
}

export interface ActorInfo {
  name: string;
  email: string;
  system: boolean;
}

/**
 * Slice 10: actor readability for the audit trail. Name + email where the
 * directory knows the user; the historical identifier is preserved (never
 * rewritten or fabricated) when the user is gone; system actions keep
 * their system representation (never attributed to a human).
 */
export function actorForUserId(
  userId: string | null | undefined,
  directory: DirectoryUser[]
): ActorInfo {
  if (!userId) return { name: '—', email: '', system: false };
  if (userId === 'system:auto-close') {
    return { name: 'Automatic closure', email: '', system: true };
  }
  const found = directory.find((u) => u.userId === userId);
  if (found) {
    return { name: found.name || found.email, email: found.email || '', system: false };
  }
  return { name: `Former user ${userId.slice(0, 8)}`, email: '', system: false };
}

/** Count open (non-closed, non-archived) jobs per assignee id. */
export function openCountsByAssignee(jobs: Job[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) {
    const lifecycle = (job.lifecycleStatus || 'DRAFT').toUpperCase();
    if (lifecycle === 'CLOSED' || lifecycle === 'ARCHIVED') continue;
    const key = job.assigneeUserId || '';
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
