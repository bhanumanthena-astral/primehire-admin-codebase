import React from 'react';
import { Pill } from './ui/primitives';
import { cn } from '@/lib/utils';
import { AuditEntry } from '../lib/hiringApi';

/** Canonical lifecycle order (PRD §7). No other states exist. */
export const LIFECYCLE_ORDER = ['DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as const;

export type LifecycleStatus = (typeof LIFECYCLE_ORDER)[number];

export function normalizeLifecycle(status: string | undefined | null): LifecycleStatus {
  const upper = (status || 'DRAFT').toUpperCase();
  return (LIFECYCLE_ORDER as readonly string[]).includes(upper)
    ? (upper as LifecycleStatus)
    : 'DRAFT';
}

function toneFor(status: LifecycleStatus): 'neutral' | 'success' | 'warning' | 'accent' {
  switch (status) {
    case 'OPEN': return 'accent';
    case 'ON_HOLD': return 'warning';
    default: return 'neutral';
  }
}

/** Single status presentation used by List, Details and modals (§11). */
export function LifecycleBadge({ status, className }: { status: string | undefined | null; className?: string }) {
  const normalized = normalizeLifecycle(status);
  return (
    <Pill tone={toneFor(normalized)} className={className}>
      {normalized.replace('_', ' ')}
    </Pill>
  );
}

export interface ActionFlags {
  canEdit: boolean;
  canClose: boolean;
  canReopen: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canAssign: boolean;
}

/**
 * Single source for status × permission action availability (§1, §12).
 * Backend authorization stays authoritative; this only decides visibility.
 * Delete additionally requires zero applications (checked by the caller).
 */
export function jobActionsFor(
  lifecycle: string | undefined | null,
  canManage: boolean,
  applicationCount: number = 0
): ActionFlags {
  const status = normalizeLifecycle(lifecycle);
  const none = { canEdit: false, canClose: false, canReopen: false, canArchive: false, canDelete: false, canAssign: false };
  if (!canManage) return none;
  switch (status) {
    case 'ARCHIVED':
      // Archived jobs accept no normal editing — not even reassignment.
      return none;
    case 'CLOSED':
      return { ...none, canEdit: true, canReopen: true, canArchive: true, canAssign: true };
    case 'DRAFT':
    case 'OPEN':
    case 'ON_HOLD':
      return {
        ...none,
        canEdit: true,
        canClose: true,
        canArchive: true,
        canAssign: true,
        canDelete: applicationCount === 0,
      };
    default:
      return none;
  }
}

/**
 * Derive visited lifecycle states from the audit trail (never invented).
 * job.create implies the creation state; close/reopen/archive record from/to.
 */
export function visitedFromActivity(
  entries: AuditEntry[],
  current: string | undefined | null
): Set<LifecycleStatus> {
  const visited = new Set<LifecycleStatus>([normalizeLifecycle(current)]);
  for (const entry of entries) {
    if (entry.action === 'job.create') {
      visited.add('DRAFT');
    } else if (entry.action === 'job.close') {
      visited.add('CLOSED');
    } else if (entry.action === 'job.reopen') {
      visited.add('OPEN');
      visited.add('CLOSED');
    } else if (entry.action === 'job.archive') {
      visited.add('ARCHIVED');
    }
  }
  return visited;
}

/**
 * Lifecycle stepper: current state prominent, visited states marked from
 * real history, the rest pending. NEVER a substitute for the audit trail —
 * it shows progression, not who did what (§3).
 */
export function LifecycleStepper({
  status,
  visited,
  compact,
}: {
  status: string | undefined | null;
  visited?: Set<LifecycleStatus>;
  compact?: boolean;
}) {
  const current = normalizeLifecycle(status);
  const done = visited ?? new Set<LifecycleStatus>();
  return (
    <ol
      aria-label="Job lifecycle progress"
      className={cn(
        'flex items-start',
        compact ? 'flex-col gap-1.5' : 'flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-0'
      )}
    >
      {LIFECYCLE_ORDER.map((state, i) => {
        const isCurrent = state === current;
        const isDone = done.has(state) && !isCurrent;
        return (
          <li
            key={state}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn('flex items-center gap-2', !compact && 'sm:flex-1 sm:last:flex-none')}
          >
            <span
              aria-hidden
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-black transition-colors',
                isCurrent
                  ? 'border-[var(--ring)] bg-primary text-primary-foreground shadow-[var(--shadow-card)]'
                  : isDone
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-border bg-card text-muted-foreground'
              )}
            >
              {isDone ? '✓' : isCurrent ? '●' : '○'}
            </span>
            <span
              className={cn(
                'text-[11px] font-bold uppercase tracking-[0.08em]',
                isCurrent ? 'text-foreground' : isDone ? 'text-[var(--accent)]' : 'text-muted-foreground'
              )}
            >
              {state.replace('_', ' ')}
            </span>
            {i < LIFECYCLE_ORDER.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'mx-1 hidden h-px flex-1 bg-border sm:block',
                  compact && 'hidden'
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
