import {Table, TableHeader, TableRow, TableHead, TableBody, TableCell} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import React from 'react';
import { DirectoryUser, Job } from '../lib/hiringApi';
import { EmptyNote, Pill } from './ui/primitives';
import { openCountsByAssignee, ownerDisplayName, resolveOwner } from './assignees';

/**
 * Owners directory (PRD §21 assignee model): active owners with their load,
 * plus preserved inactive owners whose history survives deactivation (§6).
 * Read-only over existing endpoints — no user-management duplication.
 */
export default function OwnersDirectory({
  directory,
  jobs,
  counts,
  onReassign,
  onOpen,
}: {
  directory: DirectoryUser[];
  jobs: Job[];
  counts: Record<string, number>;
  onReassign: (job: Job) => void;
  onOpen: (jobId: string) => void;
}) {
  const openCounts = openCountsByAssignee(jobs);
  const activeIds = new Set(directory.map((u) => u.userId));

  const byOwner = new Map<string, Job[]>();
  for (const job of jobs) {
    const key = job.assigneeUserId || '';
    if (!key) continue;
    const list = byOwner.get(key) || [];
    list.push(job);
    byOwner.set(key, list);
  }

  const inactiveOwners = [...byOwner.entries()].filter(([id]) => id && !activeIds.has(id));

  if (directory.length === 0 && jobs.length === 0) {
    return (
      <div className="rounded-[1.25rem] border border-border bg-card shadow-[var(--shadow-card)]">
        <EmptyNote>No owners or jobs to show yet.</EmptyNote>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[0.875rem] font-semibold tracking-tight">Active owners</h2>
          <p className="text-[0.75rem] text-muted-foreground">Only active users can receive new assignments.</p>
        </div>
        {directory.length === 0 ? (
          <EmptyNote>Directory unavailable.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <Table className="ehr-table min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Open jobs</TableHead>
                  <TableHead>Total assigned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {directory.map((u) => {
                  const owned = byOwner.get(u.userId) || [];
                  return (
                    <TableRow key={u.userId}>
                      <TableCell className="font-bold">{u.name}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell><Pill tone="neutral">{u.role.replace('_', ' ')}</Pill></TableCell>
                      <TableCell className="tabular-nums">{openCounts[u.userId] ?? 0}</TableCell>
                      <TableCell className="tabular-nums">{owned.length}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {inactiveOwners.length > 0 && (
        <div className="overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[0.875rem] font-semibold tracking-tight">Preserved inactive owners</h2>
            <p className="text-[0.75rem] text-muted-foreground">
              Deactivated or deleted owners. Assignments and history are preserved — reassign from here.
            </p>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {inactiveOwners.map(([id, owned]) => {
              const snapshot = owned.find((j) => j.assigneeEmail)?.assigneeEmail || '';
              return (
                <li key={id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.75rem] font-bold" title={id}>
                      {snapshot || `Former user ${id.slice(0, 8)}`}
                    </span>
                    <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[0.6875rem] font-bold text-[var(--warning)]">
                      Inactive — preserved
                    </span>
                    <span className="ml-auto text-[0.71875rem] text-muted-foreground tabular-nums">
                      {owned.length} job{owned.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {owned.map((j) => (
                      <li key={j.jobId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[0.75rem]">
                        <Button variant="ghost"
                          type="button"
                          onClick={() => onOpen(j.jobId)}
                          className="cursor-pointer font-bold hover:underline"
                          title={j.jobId}
                        >
                          {j.jobKey} · {j.title}
                        </Button>
                        <span className="text-muted-foreground">{(j.lifecycleStatus || '').replace('_', ' ')}</span>
                        <span className="ml-auto flex gap-1.5">
                          <span className="text-muted-foreground tabular-nums">
                            {counts[j.jobId] ?? 0} applications
                          </span>
                          <Button variant="ghost"
                            type="button"
                            onClick={() => onReassign(j)}
                            className="cursor-pointer rounded-md border border-border px-2 py-0.5 text-[0.6875rem] font-bold transition-colors hover:border-[var(--ring)]"
                          >
                            Reassign
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ownerLabelFor(job: Job, directory: DirectoryUser[]): string {
  return ownerDisplayName(resolveOwner(job, directory));
}
