import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import JobsPage from '../JobsPage';
import { fetchJobsPage, fetchApplicationCounts, fetchJobDetail, fetchJobActivity, closeJob } from '../../lib/hiringApi';
import { useAuth } from '../../lib/authContext';

vi.mock('../../lib/hiringApi', () => ({
  fetchJobsPage: vi.fn(),
  fetchApplicationCounts: vi.fn(),
  fetchJobDetail: vi.fn(),
  fetchJobActivity: vi.fn(),
  closeJob: vi.fn(),
  reopenJob: vi.fn(),
  archiveJob: vi.fn(),
  deleteJob: vi.fn(),
  assignJob: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock('../../lib/authContext', () => ({
  useAuth: vi.fn(),
}));

const JOB = {
  jobId: 'job-1', orgId: 'default', jobKey: 'BE-1', title: 'Backend Engineer',
  jobRole: 'Backend Engineer', companyName: 'Acme', department: 'Engineering',
  minExperienceYears: 2, maxExperienceYears: 5, positionsTotal: 3,
  positionsRemaining: 2, keywords: ['Python'], workMode: 'HYBRID', location: 'Hyd',
  openedAt: '2026-10-01T00:00:00Z', closesAt: '2026-12-31T00:00:00Z',
  assigneeUserId: 'u1', assigneeEmail: 'hr@acme.com', jdText: 'Build things.',
  jdHtml: '<p>Build things.</p>', lifecycleStatus: 'OPEN', closedAt: null,
  archivedAt: null, description: '', mustHaveSkills: [], niceToHaveSkills: [],
  matchThreshold: 60, status: 'open', assessmentJobId: null,
  assessmentRoundType: 'TECHNICAL', reuseAssessmentMonths: 6,
  createdBy: 'u', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

function mockHr() {
  vi.mocked(useAuth).mockReturnValue({
    user: { name: 'HR', role: 'hr' },
  } as unknown as ReturnType<typeof useAuth>);
}

describe('Jobs list (Slice 4)', () => {
  beforeEach(() => {
    mockHr();
    vi.mocked(fetchJobsPage).mockResolvedValue({ items: [JOB], total: 1 });
    vi.mocked(fetchApplicationCounts).mockResolvedValue({ 'job-1': 4 });
  });

  it('renders all 13 PRD columns', async () => {
    render(<JobsPage />);
    const table = await screen.findByRole('table');
    for (const col of ['Job ID', 'Job Title', 'Job Role', 'Company', 'Department',
      'Experience', 'Positions', 'Applications', 'Assignee', 'Opened At',
      'Closes At', 'Status', 'Actions']) {
      expect(within(table).getByText(col, { exact: false })).toBeInTheDocument();
    }
    expect(screen.getByText('BE-1')).toBeInTheDocument();
  });

  it('shows the exact no-jobs-created empty state', async () => {
    vi.mocked(fetchJobsPage).mockResolvedValue({ items: [], total: 0 });
    render(<JobsPage />);
    expect(await screen.findByText(
      "You haven't created any jobs yet. Create your first job to start receiving applications."
    )).toBeInTheDocument();
  });

  it('shows the exact no-results state when filters are active', async () => {
    vi.mocked(fetchJobsPage).mockResolvedValue({ items: [], total: 0 });
    render(<JobsPage />);
    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No jobs found.')).toBeInTheDocument();
  });

  it('sends search text to the query and paginates', async () => {
    vi.mocked(fetchJobsPage).mockResolvedValue({
      items: [JOB], total: 41,
    });
    render(<JobsPage />);
    await screen.findByText('BE-1');
    expect(screen.getByText(/Page 1 of 3 · 41 jobs/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: 'acme' } });
    await waitFor(() => {
      const calls = vi.mocked(fetchJobsPage).mock.calls;
      expect(calls.some(([q]) => (q as { q?: string }).q === 'acme')).toBe(true);
    });
  });

  it('hides manage actions for interviewer roles', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { name: 'Rahul', role: 'technical_interviewer' },
    } as unknown as ReturnType<typeof useAuth>);
    render(<JobsPage />);
    await screen.findByText('BE-1');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });
});

describe('Jobs lifecycle sync (Slice 7)', () => {
  beforeEach(() => {
    mockHr();
    vi.mocked(fetchJobsPage).mockResolvedValue({ items: [JOB], total: 1 });
    vi.mocked(fetchApplicationCounts).mockResolvedValue({ 'job-1': 0 });
    vi.mocked(fetchJobDetail).mockResolvedValue({
      job: JOB, applications: [], counts: { total: 0, active: 0 },
    } as never);
    vi.mocked(fetchJobActivity).mockResolvedValue({ jobId: 'job-1', items: [], count: 0 });
  });

  it('hides Delete when applications exist', async () => {
    vi.mocked(fetchApplicationCounts).mockResolvedValue({ 'job-1': 2 });
    render(<JobsPage />);
    await screen.findByText('BE-1');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('syncs list after a details close (details -> list)', async () => {
    const closed = { ...JOB, lifecycleStatus: 'CLOSED' };
    vi.mocked(closeJob).mockResolvedValue(closed as never);
    render(<JobsPage />);
    await screen.findByText('BE-1');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByRole('heading', { name: 'Backend Engineer' });
    // Two-step confirm, then the details header flips to CLOSED.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm close?' }));
    await waitFor(() => expect(vi.mocked(closeJob)).toHaveBeenCalledWith('job-1'));
    expect(screen.getAllByText('CLOSED').length).toBeGreaterThan(0);
    // Back to the list: the same row reflects CLOSED without a refetch.
    fireEvent.click(screen.getByRole('button', { name: /Back to Jobs/ }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('CLOSED')).toBeInTheDocument();
  });

  it('disables close while the request is in flight (double-submit)', async () => {
    let release!: (v: never) => void;
    vi.mocked(closeJob).mockImplementation(() => new Promise<never>((res) => { release = res; }));
    render(<JobsPage />);
    await screen.findByText('BE-1');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm close?' }));
    expect(vi.mocked(closeJob)).toHaveBeenCalledTimes(1);
    // While the request is in flight the action is disabled: no second call.
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
    release({ ...JOB, lifecycleStatus: 'CLOSED' } as never);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument());
  });
});
