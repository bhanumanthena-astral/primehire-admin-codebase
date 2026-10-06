import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JobDetailsPage from '../JobDetailsPage';
import {
  archiveJob,
  closeJob,
  deleteJob,
  fetchJobActivity,
  fetchJobDetail,
  fetchJobNotifications,
  fetchUserDirectory,
} from '../../lib/hiringApi';
import { useAuth } from '../../lib/authContext';

vi.mock('../../lib/hiringApi', () => ({
  archiveJob: vi.fn(),
  assignJob: vi.fn(),
  closeJob: vi.fn(),
  deleteJob: vi.fn(),
  fetchJobActivity: vi.fn(),
  fetchJobDetail: vi.fn(),
  fetchJobNotifications: vi.fn(),
  fetchUserDirectory: vi.fn(),
  reopenJob: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock('../../lib/authContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../JobsPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../JobsPage')>();
  return {
    ...actual,
    EditJobModal: () => null,
    AssignModal: () => null,
  };
});

const JOB = {
  jobId: 'job-9', orgId: 'default', jobKey: 'BE-9', title: 'Senior Java Developer',
  jobRole: 'Java Backend Engineering', companyName: 'Elite HR', department: 'Engineering',
  minExperienceYears: 5.2, maxExperienceYears: 8, positionsTotal: 4, positionsFilled: 1,
  positionsRemaining: 3, keywords: ['Java', 'Spring Boot'], workMode: 'HYBRID',
  location: 'Hyderabad', openedAt: '2026-10-01T00:00:00Z', closesAt: '2026-12-31T00:00:00Z',
  assigneeUserId: 'u-hr', assigneeEmail: 'hr@elitehr.com',
  jdHtml: '<h1>Role</h1><p>Build <strong>things</strong>.</p><script>alert(1)</script>',
  jdText: 'Role Build things.', lifecycleStatus: 'OPEN', closedAt: null, archivedAt: null,
  description: '', mustHaveSkills: [], niceToHaveSkills: [], matchThreshold: 60,
  status: 'open', assessmentJobId: null, assessmentRoundType: 'TECHNICAL',
  reuseAssessmentMonths: 6, createdBy: 'u', createdAt: '', updatedAt: '',
};

const APPS = [
  { applicationId: 'app-1', jobId: 'job-9', applicantId: 'cand-111', currentStage: 'SHORTLISTED', status: 'active' },
  { applicationId: 'app-2', jobId: 'job-9', applicantId: 'cand-222', currentStage: 'REJECTED', status: 'rejected' },
];

const ACTIVITY = [
  {
    auditId: 'a1', orgId: 'default', actorUserId: 'user-srivani', action: 'job.create',
    resourceType: 'job', resourceId: 'job-9', details: { jobKey: 'BE-9' },
    ipAddress: '', createdAt: '2026-10-03T14:30:00Z',
  },
  {
    auditId: 'a2', orgId: 'default', actorUserId: 'user-admin', action: 'job.assign',
    resourceType: 'job', resourceId: 'job-9',
    details: { from: 'user-rahul', to: 'user-priya' },
    ipAddress: '', createdAt: '2026-10-03T15:10:00Z',
  },
  {
    auditId: 'a3', orgId: 'default', actorUserId: 'user-admin', action: 'job.update',
    resourceType: 'job', resourceId: 'job-9',
    details: { changes: { title: { from: 'Java Developer', to: 'Senior Java Developer' } } },
    ipAddress: '', createdAt: '2026-10-05T16:15:00Z',
  },
];

function mockHr() {
  vi.mocked(useAuth).mockReturnValue({
    user: { name: 'Srivani', role: 'hr' },
  } as unknown as ReturnType<typeof useAuth>);
}

function mockLoaded() {
  vi.mocked(fetchJobDetail).mockResolvedValue({
    job: JOB,
    applications: APPS,
    counts: { total: 2, active: 1 },
  } as never);
  vi.mocked(fetchJobActivity).mockResolvedValue({ jobId: 'job-9', items: ACTIVITY, count: 3 } as never);
  vi.mocked(fetchJobNotifications).mockResolvedValue({ jobId: 'job-9', items: [], count: 0 } as never);
  vi.mocked(fetchUserDirectory).mockResolvedValue([]);
}

describe('Job Details (Slice 6)', () => {
  beforeEach(() => {
    mockHr();
    mockLoaded();
  });

  it('loads and renders all required fields plus status', async () => {
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Senior Java Developer' })).toBeInTheDocument();
    expect(screen.getAllByText(/Java Backend Engineering/).length).toBeGreaterThan(0);
    expect(screen.getByText('BE-9')).toBeInTheDocument();
    expect(screen.getAllByText('OPEN').length).toBeGreaterThan(0);
    expect(screen.getByText(/4 total/)).toBeInTheDocument();
    expect(screen.getAllByText('hr@elitehr.com').length).toBeGreaterThan(0);
    expect(screen.getByText('Hyderabad')).toBeInTheDocument();
    expect(screen.getByText('Java')).toBeInTheDocument();
  });

  it('renders applications with matching count', async () => {
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    await screen.findByRole('heading', { name: 'Senior Java Developer' });
    expect(screen.getByText((_, el) => el?.textContent === 'Applications (2)')).toBeInTheDocument();
    expect(screen.getByText(/SHORTLISTED/)).toBeInTheDocument();
  });

  it('renders rich-text JD safely (scripts stripped)', async () => {
    const { container } = render(
      <JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />
    );
    await screen.findByRole('heading', { name: 'Senior Java Developer' });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('h1')).not.toBeNull();
    expect(screen.getByText('things', { exact: false })).toBeInTheDocument();
  });

  it('shows Job not found on 404 and supports retry', async () => {
    vi.mocked(fetchJobDetail).mockRejectedValue(new Error('FastAPI 404 on GET'));
    const { rerender } = render(
      <JobDetailsPage jobId="nope" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />
    );
    expect(await screen.findByText('Job not found.')).toBeInTheDocument();
    vi.mocked(fetchJobDetail).mockResolvedValue({
      job: JOB, applications: [], counts: { total: 0, active: 0 },
    } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Senior Java Developer' })).toBeInTheDocument();
    rerender(<JobDetailsPage jobId="nope" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
  });

  it('shows empty applications and empty activity states', async () => {
    vi.mocked(fetchJobDetail).mockResolvedValue({
      job: JOB, applications: [], counts: { total: 0, active: 0 },
    } as never);
    vi.mocked(fetchJobActivity).mockResolvedValue({ jobId: 'job-9', items: [], count: 0 });
    vi.mocked(fetchJobNotifications).mockResolvedValue({ jobId: 'job-9', items: [], count: 0 });
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
    expect(screen.getByText('No activity recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('No assignment notifications queued yet.')).toBeInTheDocument();
  });

  it('renders the audit trail with who, what, old and new', async () => {
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    expect(await screen.findByText(/Job created by/)).toBeInTheDocument();
    expect(screen.getByText(/Assignee changed/)).toBeInTheDocument();
    // old → new values visible in the timeline (scoped to the timeline section)
    const timeline = document.querySelector('section[aria-label="Activity"]');
    expect(timeline?.textContent).toMatch(/Java Developer/);
    expect(timeline?.textContent).toMatch(/Senior Java Developer/);
    expect(timeline?.textContent).toMatch(/→/);
  });

  it('dispatches applicant navigation on View candidate', async () => {
    const seen: string[] = [];
    const handler = (e: Event) => {
      seen.push((e as CustomEvent).detail.applicantId);
    };
    window.addEventListener('elite:open-applicant', handler);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    const buttons = await screen.findAllByRole('button', { name: 'View candidate' });
    fireEvent.click(buttons[0]);
    expect(seen).toEqual(['cand-111']);
    window.removeEventListener('elite:open-applicant', handler);
  });

  it('runs close with the PRD confirmation', async () => {
    vi.mocked(closeJob).mockResolvedValue({ ...JOB, lifecycleStatus: 'CLOSED' } as never);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    await screen.findByRole('heading', { name: 'Senior Java Developer' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm close?' }));
    await waitFor(() => expect(vi.mocked(closeJob)).toHaveBeenCalledWith('job-9'));
    expect(screen.getAllByText('CLOSED').length).toBeGreaterThan(0);
  });

  it('hides manage actions for read-only roles', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { name: 'Rahul', role: 'technical_interviewer' },
    } as unknown as ReturnType<typeof useAuth>);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    await screen.findByRole('heading', { name: 'Senior Java Developer' });
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
  });
});


describe('Job Details lifecycle extras (Slice 7)', () => {
  beforeEach(() => {
    mockHr();
    mockLoaded();
  });

  it('attributes automatic closure to the system, not a human', async () => {
    vi.mocked(fetchJobActivity).mockResolvedValue({
      jobId: 'job-9',
      items: [{
        auditId: 'a-sys', orgId: 'default', actorUserId: 'system:auto-close',
        action: 'job.close', resourceType: 'job', resourceId: 'job-9',
        details: { from: 'OPEN', to: 'CLOSED', reason: 'closing date reached' },
        ipAddress: '', createdAt: '2026-12-31T23:59:00Z',
      }],
      count: 1,
    } as never);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    expect(await screen.findByText(/Automatic closure/)).toBeInTheDocument();
  });

  it('surfaces backend reopen validation errors', async () => {
    const { reopenJob } = await import('../../lib/hiringApi');
    vi.mocked(reopenJob).mockRejectedValue(
      new Error('FastAPI 422: Reopening requires a valid future closing date')
    );
    const closedJob = { ...JOB, lifecycleStatus: 'CLOSED' };
    vi.mocked(fetchJobDetail).mockResolvedValue({
      job: closedJob, applications: [], counts: { total: 0, active: 0 },
    } as never);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    await screen.findByRole('heading', { name: 'Senior Java Developer' });
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    fireEvent.change(screen.getByLabelText('New closing date'), {
      target: { value: '2030-01-01T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reopen job' }));
    expect(await screen.findByText(/valid future closing date/)).toBeInTheDocument();
  });
});

describe('Job Details notifications (Slice 9)', () => {
  beforeEach(() => {
    mockHr();
    mockLoaded();
  });

  it('shows queued/sent states from the existing outbox only', async () => {
    vi.mocked(fetchJobNotifications).mockResolvedValue({
      jobId: 'job-9',
      items: [
        { messageId: 'm1', kind: 'job_assigned', status: 'sent', toMasked: 'p***@x.com', toName: 'Priya', subject: 'assigned', attempts: 1, sentVia: 'zepto' },
        { messageId: 'm2', kind: 'job_assigned', status: 'pending', toMasked: 'r***@x.com', toName: 'Rahul', subject: 'assigned', attempts: 0 },
      ],
      count: 2,
    } as never);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    const section = await screen.findByLabelText('Notifications');
    expect(section.textContent).toMatch(/Sent/);
    expect(section.textContent).toMatch(/Queued/);
  });

  it('surfaces failed notifications without claiming delivery', async () => {
    vi.mocked(fetchJobNotifications).mockResolvedValue({
      jobId: 'job-9',
      items: [
        { messageId: 'm9', kind: 'job_assigned', status: 'failed', toMasked: 'p***@x.com', toName: 'Priya', lastError: 'Email provider unavailable', attempts: 5 },
      ],
      count: 1,
    } as never);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    const section = await screen.findByLabelText('Notifications');
    expect(section.textContent).toMatch(/Failed/);
    expect(section.textContent).toMatch(/Email provider unavailable/);
  });

  it('shows an error state with retry when the status fetch fails', async () => {
    vi.mocked(fetchJobNotifications).mockRejectedValue(new Error('boom'));
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    expect(await screen.findByText(/Could not load notification status/)).toBeInTheDocument();
  });
});

describe('Job Details audit refinement (Slice 10)', () => {
  beforeEach(() => {
    mockHr();
    mockLoaded();
  });

  it('shows actor name plus email when the directory knows the user', async () => {
    vi.mocked(fetchUserDirectory).mockResolvedValue([
      { userId: 'user-admin', name: 'Asha Admin', email: 'asha@elitehr.com', role: 'admin', isActive: true },
    ]);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    const timeline = await screen.findByLabelText('Activity');
    expect(timeline.textContent).toMatch(/Asha Admin/);
    expect(timeline.textContent).toMatch(/asha@elitehr\.com/);
  });

  it('preserves the historical identifier when the user is gone', async () => {
    vi.mocked(fetchUserDirectory).mockResolvedValue([]);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    const timeline = await screen.findByLabelText('Activity');
    // user-srivani is not in the directory: snapshot id preserved, never fabricated.
    expect(timeline.textContent).toMatch(/Former user/);
  });

  it('keeps automatic closure attributed to the system, not a human', async () => {
    vi.mocked(fetchJobActivity).mockResolvedValue({
      jobId: 'job-9',
      items: [{
        auditId: 'a-sys', orgId: 'default', actorUserId: 'system:auto-close',
        action: 'job.close', resourceType: 'job', resourceId: 'job-9',
        details: { from: 'OPEN', to: 'CLOSED', reason: 'closing date reached' },
        ipAddress: '', createdAt: '2026-12-31T23:59:00Z',
      }],
      count: 1,
    } as never);
    render(<JobDetailsPage jobId="job-9" onBack={() => {}} onChanged={() => {}} onDeleted={() => {}} />);
    const timeline = await screen.findByLabelText('Activity');
    expect(timeline.textContent).toMatch(/Automatic closure/);
  });
});
