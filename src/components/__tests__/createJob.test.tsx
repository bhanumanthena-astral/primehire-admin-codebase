import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CreateJobForm from '../CreateJobForm';
import {
  checkDuplicate,
  createJob,
  downloadJdTemplate,
  fetchUserDirectory,
  parseJd,
  JdParseError,
} from '../../lib/hiringApi';

vi.mock('../../lib/hiringApi', () => ({
  checkDuplicate: vi.fn(),
  createJob: vi.fn(),
  downloadJdTemplate: vi.fn(),
  fetchUserDirectory: vi.fn(),
  parseJd: vi.fn(),
  fetchRules: vi.fn().mockResolvedValue({
    jdMinChars: 50, jdMaxChars: 10000, maxKeywords: 20,
    keywordMinChars: 1, keywordMaxChars: 50,
    minExperienceYears: 0, maxExperienceYears: 50,
    positionsMin: 1, positionsMax: 1000,
    companyNameMin: 2, companyNameMax: 150,
    jobRoleMin: 2, jobRoleMax: 100,
    jobTitleMin: 2, jobTitleMax: 150,
    departments: ['Engineering', 'Product', 'Design', 'Data & Analytics', 'Quality Assurance', 'DevOps', 'Human Resources', 'Sales', 'Marketing', 'Finance', 'Customer Support', 'Operations'],
  }),
  JdParseError: class JdParseError extends Error {
    fieldErrors: { field: string; message: string }[];
    constructor(message: string, fieldErrors: { field: string; message: string }[] = []) {
      super(message);
      this.name = 'JdParseError';
      this.fieldErrors = fieldErrors;
    }
  },
}));

const DIRECTORY = [
  { userId: 'u-hr', name: 'Anita HR', email: 'anita@acme.com', role: 'hr', isActive: true },
  { userId: 'u-hr2', name: 'Dev HR', email: 'dev@acme.com', role: 'hr', isActive: true },
];

const LONG_JD = '<p>' + 'Backend work with Python and SQL. '.repeat(8) + '</p>';

function fillValid(except: Record<string, string> = {}) {
  const v: Record<string, string> = {
    'Job Key': 'ACME-BE-1',
    'Company Name': 'Acme',
    'Job Role': 'Backend Engineer',
    'Job Title': 'Senior Backend Engineer',
    'Minimum Experience': '2.5',
    'Maximum Experience': '5',
    'Number of Positions': '3',
    'Department': 'Engineering',
    'Closes At': '2028-12-31T10:00',
    ...except,
  };
  for (const [label, value] of Object.entries(v)) {
    fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText('Assignee', { exact: true }), {
    target: { value: 'u-hr' },
  });
}

async function fillJdViaUpload(mapped: Record<string, unknown> = {}) {
  const file = new File(['dummy'], 'jd.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  vi.mocked(parseJd).mockResolvedValue({
    filename: 'jd.docx',
    kind: 'docx',
    templateVersion: 'v1',
    text: 'Company Name: Acme',
    mapped: {
      companyName: 'Acme',
      jobRole: 'Backend Engineer',
      title: 'Senior Backend Engineer',
      minExperienceYears: 2.5,
      maxExperienceYears: 5,
      positionsTotal: 3,
      keywords: ['Python'],
      department: 'Engineering',
      closesAt: '2028-12-31T00:00:00Z',
      assigneeUserId: 'u-hr',
      jdHtml: LONG_JD,
      ...mapped,
    },
    warnings: [],
  });
  fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/Review them below before saving/)).toBeInTheDocument());
}

describe('Create Job UI (Slice 5)', () => {
  beforeEach(() => {
    vi.mocked(fetchUserDirectory).mockResolvedValue(DIRECTORY);
    vi.mocked(checkDuplicate).mockResolvedValue({ similarJobs: [], count: 0 });
    vi.mocked(createJob).mockResolvedValue({ jobId: 'j1', jobKey: 'ACME-BE-1' } as never);
    vi.mocked(downloadJdTemplate).mockResolvedValue(new Blob(['x']));
  });

  it('renders all 14 PRD fields with Job ID read-only', async () => {
    const { container } = render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    expect(await screen.findByText(/Auto-generated on save/)).toBeInTheDocument();
    for (const label of ['Job Key', 'Company Name', 'Job Role', 'Job Title',
      'Minimum Experience', 'Maximum Experience', 'Number of Positions',
      'Department', 'Opened At', 'Closes At', 'Assignee', 'Assignee Email']) {
      expect(screen.getByLabelText(label, { exact: true })).toBeInTheDocument();
    }
    // Rich-text JD editor (ProseMirror) — the section shares the accessible
    // name, so assert the editor node directly.
    expect(container.querySelector('.ProseMirror')).not.toBeNull();
  });

  it('requires mandatory fields', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create job' }));
    expect(await screen.findByText('Company Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Job Title is required.')).toBeInTheDocument();
    expect(screen.queryByText('Job created successfully.')).not.toBeInTheDocument();
    expect(vi.mocked(createJob)).not.toHaveBeenCalled();
  });

  it('validates experience ranges and positions', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    fillValid({ 'Minimum Experience': '6', 'Maximum Experience': '2', 'Number of Positions': '0' });
    fireEvent.click(screen.getByRole('button', { name: 'Create job' }));
    expect(await screen.findByText(/must be greater than or equal to Minimum/)).toBeInTheDocument();
    expect(screen.getByText(/must be an integer between 1 and 1000/)).toBeInTheDocument();
    expect(vi.mocked(createJob)).not.toHaveBeenCalled();
  });

  it('prevents duplicate keywords live', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    const input = screen.getByLabelText('Add keyword');
    fireEvent.change(input, { target: { value: 'Python' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: ' python ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText(/duplicates are not allowed/)).toBeInTheDocument();
  });

  it('auto-fills assignee email on selection', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Assignee', { exact: true })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Assignee', { exact: true }), { target: { value: 'u-hr' } });
    expect((screen.getByLabelText('Assignee Email') as HTMLInputElement).value).toBe('anita@acme.com');
  });

  it('JD upload maps values for review without persisting', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await fillJdViaUpload();
    expect((screen.getByLabelText('Company Name', { exact: true }) as HTMLInputElement).value).toBe('Acme');
    expect(vi.mocked(createJob)).not.toHaveBeenCalled();
  });

  it('shows the exact invalid-template message', async () => {
    vi.mocked(parseJd).mockRejectedValue(new JdParseError(
      'Invalid JD template. Please download the latest template and upload the completed template.'
    ));
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    const file = new File(['x'], 'jd.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file] } });
    expect(await screen.findByText(
      'Invalid JD template. Please download the latest template and upload the completed template.'
    )).toBeInTheDocument();
  });

  it('shows duplicate warning and continues only on confirm', async () => {
    vi.mocked(checkDuplicate).mockResolvedValue({
      similarJobs: [{ jobId: 'j-old', jobKey: 'OLD-1', title: 'Old Role', companyName: 'Acme', lifecycleStatus: 'OPEN' } as never],
      count: 1,
    });
    const onCreated = vi.fn();
    render(<CreateJobForm onCreated={onCreated} onExit={() => {}} />);
    fillValid();
    await fillJdViaUpload();
    fireEvent.click(screen.getByRole('button', { name: 'Create job' }));
    expect(await screen.findByText('A similar job already exists. Do you want to continue?')).toBeInTheDocument();
    expect(vi.mocked(createJob)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(vi.mocked(createJob)).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Job created successfully.')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
  });

  it('prevents double submission', async () => {
    const onCreated = vi.fn();
    render(<CreateJobForm onCreated={onCreated} onExit={() => {}} />);
    fillValid();
    await fillJdViaUpload();
    const btn = screen.getByRole('button', { name: 'Create job' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(vi.mocked(createJob)).toHaveBeenCalledTimes(1));
  });

  it('keeps entered data when the API fails', async () => {
    vi.mocked(createJob).mockRejectedValue(new Error('FastAPI 409 on POST /api/jobs'));
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    fillValid();
    await fillJdViaUpload();
    fireEvent.click(screen.getByRole('button', { name: 'Create job' }));
    expect(await screen.findByText(/FastAPI 409/)).toBeInTheDocument();
    expect((screen.getByLabelText('Job Title', { exact: true }) as HTMLInputElement).value)
      .toBe('Senior Backend Engineer');
    expect(vi.mocked(createJob)).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding unsaved changes', async () => {
    const onExit = vi.fn();
    render(<CreateJobForm onCreated={() => {}} onExit={onExit} />);
    fireEvent.change(screen.getByLabelText('Job Title', { exact: true }), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /Back to Jobs/ }));
    expect(await screen.findByText('You have unsaved changes. Are you sure you want to leave?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back to Jobs/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Changes' }));
    expect(onExit).toHaveBeenCalled();
  });
});
