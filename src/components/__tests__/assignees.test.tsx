import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OwnersDirectory from '../OwnersDirectory';
import { AssignModal } from '../JobsPage';
import {
  nameForUserId,
  openCountsByAssignee,
  ownerDisplayName,
  resolveOwner,
} from '../assignees';
import { assignJob, fetchJobDetail, fetchJobActivity } from '../../lib/hiringApi';
import { useAuth } from '../../lib/authContext';
import JobDetailsPage from '../JobDetailsPage';

vi.mock('../../lib/hiringApi', () => ({
  archiveJob: vi.fn(),
  assignJob: vi.fn(),
  closeJob: vi.fn(),
  deleteJob: vi.fn(),
  fetchJobActivity: vi.fn(),
  fetchJobDetail: vi.fn(),
  fetchUserDirectory: vi.fn(),
  reopenJob: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock('../../lib/authContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../JobsPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../JobsPage')>();
  return { ...actual };
});

const ALICE = { userId: 'u-alice', name: 'Alice Rao', email: 'alice@acme.com', role: 'hr', isActive: true };
const BOB = { userId: 'u-bob', name: 'Bob Menon', email: 'bob@acme.com', role: 'hr', isActive: true };

function job(over: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1', orgId: 'default', jobKey: 'BE-1', title: 'Backend Engineer',
    jobRole: 'Backend Engineer', companyName: 'Acme', department: 'Engineering',
    minExperienceYears: 2, maxExperienceYears: 5, positionsTotal: 2, positionsFilled: 0,
    positionsRemaining: 2, keywords: [], workMode: null, location: null,
    openedAt: null, closesAt: '2028-01-01T00:00:00Z', assigneeUserId: 'u-alice',
    assigneeEmail: 'alice@acme.com', jdHtml: '<p>x</p>', jdText: 'x',
    lifecycleStatus: 'OPEN', closedAt: null, archivedAt: null, description: '',
    mustHaveSkills: [], niceToHaveSkills: [], matchThreshold: 60, status: 'open',
    assessmentJobId: null, assessmentRoundType: 'TECHNICAL', reuseAssessmentMonths: 6,
    createdBy: 'u', createdAt: '', updatedAt: '',
    ...over,
  } as never;
}

describe('assignee helpers', () => {
  it('resolves active owners and flags former owners', () => {
    expect(resolveOwner(job(), [ALICE, BOB]).active).toBe(true);
    expect(resolveOwner(job(), [ALICE, BOB]).name).toBe('Alice Rao');
    const gone = resolveOwner(job({ assigneeUserId: 'u-gone', assigneeEmail: 'gone@acme.com' }), [ALICE]);
    expect(gone.active).toBe(false);
    expect(ownerDisplayName(gone)).toBe('gone@acme.com');
  });

  it('names actors with former-user fallback', () => {
    expect(nameForUserId('u-alice', [ALICE])).toBe('Alice Rao');
    expect(nameForUserId('system:auto-close', [ALICE])).toBe('Automatic closure');
    expect(nameForUserId('u-unknown', [ALICE])).toMatch(/Former user/);
    expect(nameForUserId(null, [ALICE])).toBe('—');
  });

  it('counts only open jobs per assignee', () => {
    const counts = openCountsByAssignee([
      job({ jobId: 'a', assigneeUserId: 'u-alice', lifecycleStatus: 'OPEN' }),
      job({ jobId: 'b', assigneeUserId: 'u-alice', lifecycleStatus: 'DRAFT' }),
      job({ jobId: 'c', assigneeUserId: 'u-alice', lifecycleStatus: 'CLOSED' }),
      job({ jobId: 'd', assigneeUserId: 'u-bob', lifecycleStatus: 'ARCHIVED' }),
    ]);
    expect(counts).toEqual({ 'u-alice': 2 });
  });
});

describe('OwnersDirectory', () => {
  it('lists active owners with load and preserves inactive owners', () => {
    const jobs = [
      job({ jobId: 'a', assigneeUserId: 'u-alice' }),
      job({ jobId: 'b', assigneeUserId: 'u-gone', assigneeEmail: 'gone@acme.com' }),
    ];
    const onReassign = vi.fn();
    const onOpen = vi.fn();
    render(
      <OwnersDirectory directory={[ALICE, BOB]} jobs={jobs} counts={{ a: 1, b: 0 }}
        onReassign={onReassign} onOpen={onOpen} />
    );
    expect(screen.getByText('Alice Rao')).toBeInTheDocument();
    expect(screen.getByText('Inactive — preserved')).toBeInTheDocument();
    expect(screen.getByText('gone@acme.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    expect(onReassign).toHaveBeenCalled();
  });

  it('shows an empty state with no data', () => {
    render(<OwnersDirectory directory={[]} jobs={[]} counts={{}} onReassign={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('No owners or jobs to show yet.')).toBeInTheDocument();
  });
});

describe('AssignModal (Slice 8)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: { name: 'HR', role: 'hr' },
    } as unknown as ReturnType<typeof useAuth>);
  });

  function openModal(j = job(), dir = [ALICE, BOB], counts = { 'u-alice': 2 }) {
    const onSaved = vi.fn();
    render(
      <AssignModal job={j} directory={dir} openCounts={counts}
        onClose={() => {}} onSaved={onSaved} onError={() => {}} />
    );
    return { onSaved };
  }

  it('shows the current owner and active-only options with load', () => {
    openModal();
    expect(screen.getByText('Alice Rao')).toBeInTheDocument();
    const select = screen.getByLabelText('New assignee') as HTMLSelectElement;
    expect(select.options.length).toBe(3); // placeholder + 2 active users
    expect(select.textContent).toMatch(/2 open/);
  });

  it('warns on inactive current owners without erasing them', () => {
    openModal(job({ assigneeUserId: 'u-gone', assigneeEmail: 'gone@acme.com' }));
    expect(screen.getByText('Inactive — preserved')).toBeInTheDocument();
    expect(screen.getByText('gone@acme.com')).toBeInTheDocument();
  });

  it('reassigns, snapshots email and notifies (via endpoint)', async () => {
    vi.mocked(assignJob).mockResolvedValue(job({ assigneeUserId: 'u-bob', assigneeEmail: 'bob@acme.com' }));
    const { onSaved } = openModal();
    fireEvent.change(screen.getByLabelText('New assignee'), { target: { value: 'u-bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await waitFor(() => expect(vi.mocked(assignJob)).toHaveBeenCalledWith('job-1', 'bob@acme.com'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows API errors and preserves state', async () => {
    vi.mocked(assignJob).mockRejectedValue(new Error('FastAPI 422: bad assignee'));
    openModal();
    fireEvent.change(screen.getByLabelText('New assignee'), { target: { value: 'u-bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    expect(await screen.findByText(/bad assignee/)).toBeInTheDocument();
    // Selection preserved for correction.
    expect((screen.getByLabelText('New assignee') as HTMLSelectElement).value).toBe('u-bob');
  });

  it('resyncs from the server on stale failure', async () => {
    const fresh = job({ assigneeUserId: 'u-bob', assigneeEmail: 'bob@acme.com' });
    vi.mocked(assignJob).mockRejectedValue(new Error('FastAPI 409: conflict'));
    const onSaved = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(fresh);
    render(
      <AssignModal job={job()} directory={[ALICE, BOB]} openCounts={{}}
        onClose={() => {}} onSaved={onSaved} onError={() => {}} onRefresh={onRefresh} />
    );
    fireEvent.change(screen.getByLabelText('New assignee'), { target: { value: 'u-bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledWith('job-1'));
    expect(onSaved).toHaveBeenCalledWith(fresh);
  });

  it('prevents double submit while assigning', async () => {
    let release!: (v: never) => void;
    vi.mocked(assignJob).mockImplementation(() => new Promise<never>((res) => { release = res; }));
    openModal();
    fireEvent.change(screen.getByLabelText('New assignee'), { target: { value: 'u-bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assigning…' }));
    expect(vi.mocked(assignJob)).toHaveBeenCalledTimes(1);
    release(job() as never);
  });
});

describe('details inactive owner (Slice 8)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: { name: 'HR', role: 'hr' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(fetchJobDetail).mockResolvedValue({
      job: job({ assigneeUserId: 'u-gone', assigneeEmail: 'gone@acme.com' }),
      applications: [], counts: { total: 0, active: 0 },
    } as never);
    vi.mocked(fetchJobActivity).mockResolvedValue({ jobId: 'job-1', items: [], count: 0 });
  });

  it('flags the deactivated owner while preserving the snapshot', async () => {
    const { fetchUserDirectory } = await import('../../lib/hiringApi');
    vi.mocked(fetchUserDirectory).mockResolvedValue([ALICE]);
    const { default: Details } = await import('../JobDetailsPage');
    render(<Details jobId="job-1" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    await screen.findByRole('heading', { name: 'Backend Engineer' });
    expect(screen.getAllByText('Inactive — preserved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gone@acme.com').length).toBeGreaterThan(0);
  });
});
