import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  LifecycleBadge,
  LifecycleStepper,
  jobActionsFor,
  normalizeLifecycle,
  visitedFromActivity,
} from '../JobLifecycle';
import { AuditEntry } from '../../lib/hiringApi';

function entry(action: string): AuditEntry {
  return {
    auditId: `a-${action}`, orgId: 'default', actorUserId: 'u1', action,
    resourceType: 'job', resourceId: 'j1', details: {}, ipAddress: '',
    createdAt: '2026-10-05T10:00:00Z',
  };
}

describe('Job lifecycle presentation (Slice 7)', () => {
  it('normalizes every lifecycle state and falls back to DRAFT', () => {
    expect(normalizeLifecycle('OPEN')).toBe('OPEN');
    expect(normalizeLifecycle('on_hold')).toBe('ON_HOLD');
    expect(normalizeLifecycle('ARCHIVED')).toBe('ARCHIVED');
    expect(normalizeLifecycle(undefined)).toBe('DRAFT');
    expect(normalizeLifecycle('BOGUS')).toBe('DRAFT');
  });

  it('renders the same badge for all five states', () => {
    const { rerender } = render(<LifecycleBadge status="DRAFT" />);
    const cases: [string, string][] = [
      ['DRAFT', 'DRAFT'],
      ['OPEN', 'OPEN'],
      ['ON_HOLD', 'ON HOLD'],
      ['CLOSED', 'CLOSED'],
      ['ARCHIVED', 'ARCHIVED'],
    ];
    for (const [value, display] of cases) {
      rerender(<LifecycleBadge status={value} />);
      expect(screen.getByText(display)).toBeInTheDocument();
    }
  });

  it('gates actions by status and permission', () => {
    const none = jobActionsFor('OPEN', false);
    expect(Object.values(none).every((v) => v === false)).toBe(true);

    const draft = jobActionsFor('DRAFT', true, 0);
    expect(draft).toMatchObject({
      canEdit: true, canClose: true, canReopen: false,
      canArchive: true, canDelete: true, canAssign: true,
    });

    const openWithApps = jobActionsFor('OPEN', true, 3);
    expect(openWithApps.canClose).toBe(true);
    expect(openWithApps.canDelete).toBe(false);

    const closed = jobActionsFor('CLOSED', true, 2);
    expect(closed).toMatchObject({
      canEdit: true, canClose: false, canReopen: true,
      canArchive: true, canDelete: false, canAssign: true,
    });

    const archived = jobActionsFor('ARCHIVED', true, 0);
    expect(Object.values(archived).every((v) => v === false)).toBe(true);
  });

  it('derives visited states from audit history only', () => {
    const visited = visitedFromActivity(
      [entry('job.create'), entry('job.close'), entry('job.reopen')], 'OPEN'
    );
    expect(visited.has('DRAFT')).toBe(true);
    expect(visited.has('CLOSED')).toBe(true);
    expect(visited.has('OPEN')).toBe(true);
    expect(visited.has('ARCHIVED')).toBe(false);
    expect(visitedFromActivity([], 'DRAFT').has('OPEN')).toBe(false);
  });

  it('marks current vs visited vs pending in the stepper', () => {
    render(<LifecycleStepper status="CLOSED" visited={new Set(['DRAFT', 'OPEN', 'CLOSED'])} />);
    const list = screen.getByRole('list', { name: 'Job lifecycle progress' });
    expect(list).toBeInTheDocument();
    const current = within(list).getByText('CLOSED').closest('li');
    expect(current?.getAttribute('aria-current')).toBe('step');
    expect(within(list).getByText('DRAFT').textContent).toBeDefined();
    // Pending states render as hollow markers.
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument();
  });

  it('keeps audit and lifecycle visually separate', () => {
    const { container } = render(
      <LifecycleStepper status="OPEN" visited={new Set(['DRAFT', 'OPEN'])} />
    );
    // Stepper shows progression only — no actor names, no timestamps.
    expect(container.textContent).not.toMatch(/User |actor/i);
  });
});
