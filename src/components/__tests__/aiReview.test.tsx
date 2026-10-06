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
    departments: ['Engineering', 'Product'],
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

const LONG_JD = '<p>' + 'Own the roadmap for SaaS and AI products. '.repeat(8) + '</p>';

const BASE_VALUES = {
  companyName: 'Elite HR Technologies',
  jobRole: 'Product Management',
  title: 'Product Manager - SaaS & AI Products',
  minExperienceYears: 3.0,
  maxExperienceYears: 6.0,
  positionsTotal: 2,
  keywords: ['SaaS', 'AI', 'Roadmap'],
  department: 'Product',
  closesAt: '2028-06-30T00:00:00Z',
  assigneeUserId: 'u-hr',
  workMode: 'HYBRID',
  location: 'Hyderabad',
  jdHtml: LONG_JD,
};

function docResult(reviewOverrides: Record<string, unknown> = {}, resultOverrides: Record<string, unknown> = {}) {
  return {
    filename: 'pm.pdf',
    kind: 'pdf',
    templateVersion: 'doc-v1',
    text: 'Product Manager JD text',
    mapped: {},
    warnings: [],
    aiExtract: { companyName: 'Elite HR Technologies', assigneeText: null },
    missingFields: [],
    evidence: {},
    review: {
      values: { ...BASE_VALUES },
      missingFields: [],
      needsReview: [],
      fieldErrors: [],
      warnings: [],
      resolvedAssignee: { userId: 'u-hr', email: 'anita@acme.com', name: 'Anita HR' },
      evidence: {},
      ...reviewOverrides,
    },
    ...resultOverrides,
  };
}

async function uploadDoc(result: unknown) {
  const file = new File(['dummy'], 'pm.pdf', { type: 'application/pdf' });
  vi.mocked(parseJd).mockResolvedValue(result as never);
  fireEvent.click(screen.getByRole('radio', { name: /JD Document/ }));
  fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/AI extraction complete/)).toBeInTheDocument());
  return file;
}

describe('AI JD Review UI (Phase 4)', () => {
  beforeEach(() => {
    vi.mocked(fetchUserDirectory).mockResolvedValue(DIRECTORY);
    vi.mocked(checkDuplicate).mockResolvedValue({ similarJobs: [], count: 0 });
    vi.mocked(createJob).mockResolvedValue({ jobId: 'j1', jobKey: 'PM-1' } as never);
    vi.mocked(downloadJdTemplate).mockResolvedValue(new Blob(['x']));
  });

  it('offers Template and JD Document paths with Template active by default', () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    expect(screen.getByRole('radio', { name: /JD Template/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /JD Document/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('sends mode=document for JD Document uploads and mode=template otherwise', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await uploadDoc(docResult());
    expect(vi.mocked(parseJd).mock.calls[0]?.[1]).toBe('document');

    vi.mocked(parseJd).mockClear();
    vi.mocked(parseJd).mockResolvedValue({
      filename: 'jd.docx', kind: 'docx', templateVersion: 'v1',
      text: 'Company Name: Acme', mapped: { companyName: 'Acme' }, warnings: [],
    } as never);
    const file = new File(['x'], 'jd.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    fireEvent.click(screen.getByRole('radio', { name: /JD Template/ }));
    fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Review them below before saving/)).toBeInTheDocument());
    expect(vi.mocked(parseJd).mock.calls[0]?.[1]).toBe('template');
  });

  it('prefills from review.values with AI badges and summary, saving nothing', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await uploadDoc(docResult());
    expect((screen.getByLabelText('Company Name', { exact: true }) as HTMLInputElement).value)
      .toBe('Elite HR Technologies');
    expect((screen.getByLabelText('Job Title', { exact: true }) as HTMLInputElement).value)
      .toBe('Product Manager - SaaS & AI Products');
    expect((screen.getByLabelText('Minimum Experience', { exact: true }) as HTMLInputElement).value)
      .toBe('3');
    expect((screen.getByLabelText('Assignee', { exact: true }) as HTMLSelectElement).value).toBe('u-hr');
    expect(screen.getByText('SaaS')).toBeInTheDocument();
    // AI badges on prefilled fields (company + title + …).
    expect(screen.getAllByText('AI extracted').length).toBeGreaterThan(2);
    // Summary counts from the actual payload.
    const summary = screen.getByLabelText('Extraction summary');
    expect(within(summary).getByText('Fields extracted')).toBeInTheDocument();
    expect(screen.getByText('AI extraction review')).toBeInTheDocument();
    expect(vi.mocked(createJob)).not.toHaveBeenCalled();
  });

  it('lists missing fields as needing input', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    const { missingFields, ...rest } = BASE_VALUES as Record<string, unknown>;
    void missingFields;
    const values = { ...rest };
    delete (values as Record<string, unknown>).closesAt;
    await uploadDoc(docResult({ values, missingFields: ['closesAt'] }));
    const panel = screen.getByRole('region', { name: 'AI review' });
    expect(within(panel).getByText('Needs input')).toBeInTheDocument();
    expect(within(panel).getByText('Closes At')).toBeInTheDocument();
    expect((screen.getByLabelText('Closes At', { exact: true }) as HTMLInputElement).value).toBe('');
  });

  it('shows needs-review with reason and raw assignee text', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    const values = { ...BASE_VALUES };
    delete (values as Record<string, unknown>).assigneeUserId;
    await uploadDoc(docResult({
      values,
      resolvedAssignee: null,
      needsReview: [{ field: 'assigneeUserId', reason: 'Assignee matches 2 users; HR must choose one.' }],
    }, { aiExtract: { assigneeText: 'Priya' } }));
    const panel = screen.getByRole('region', { name: 'AI review' });
    expect(within(panel).getByRole('heading', { name: 'Needs review' })).toBeInTheDocument();
    expect(within(panel).getByText(/matches 2 users/)).toBeInTheDocument();
    expect(within(panel).getByText(/Extracted text:/)).toBeInTheDocument();
    expect(within(panel).getByText(/“Priya”/)).toBeInTheDocument();
  });

  it('shows the resolved assignee identity', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await uploadDoc(docResult());
    const panel = screen.getByRole('region', { name: 'AI review' });
    expect(within(panel).getByText(/Assignee resolved:/)).toBeInTheDocument();
    expect(within(panel).getByText(/Anita HR · anita@acme.com/)).toBeInTheDocument();
  });

  it('exposes concise source evidence without raw model output', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await uploadDoc(docResult({ evidence: { jobTitle: 'We are looking for a Product Manager' } }));
    const panel = screen.getByRole('region', { name: 'AI review' });
    fireEvent.click(within(panel).getByText(/Source evidence/));
    expect(within(panel).getByText(/We are looking for a Product Manager/)).toBeInTheDocument();
    expect(screen.queryByText(/system prompt/i)).not.toBeInTheDocument();
  });

  it('renders AI field errors beside the relevant field', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await uploadDoc(docResult({
      fieldErrors: [{ field: 'closesAt', message: 'closesAt must be greater than openedAt' }],
    }));
    expect(screen.getByText(/closesAt must be greater than openedAt/)).toBeInTheDocument();
  });

  it('keeps template results free of AI review chrome', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    vi.mocked(parseJd).mockResolvedValue({
      filename: 'jd.docx', kind: 'docx', templateVersion: 'v1',
      text: 'Company Name: Acme', mapped: { companyName: 'Acme' }, warnings: [],
    } as never);
    const file = new File(['x'], 'jd.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Review them below before saving/)).toBeInTheDocument());
    expect(screen.queryByText('AI extraction review')).not.toBeInTheDocument();
    expect(screen.queryAllByText('AI extracted')).toHaveLength(0);
  });

  it('shows an honest failure and lets HR continue manually', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    vi.mocked(parseJd).mockRejectedValue(new JdParseError('Could not extract text from the uploaded file.'));
    const file = new File(['x'], 'pm.pdf', { type: 'application/pdf' });
    fireEvent.click(screen.getByRole('radio', { name: /JD Document/ }));
    fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file] } });
    expect(await screen.findByText(/Could not extract text/)).toBeInTheDocument();
    expect(screen.getByText(/continue filling the form manually/)).toBeInTheDocument();
    expect(screen.queryByText('AI extraction review')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI extraction successful/)).not.toBeInTheDocument();
    // Form remains fully usable.
    fireEvent.change(screen.getByLabelText('Job Title', { exact: true }), { target: { value: 'Manual Title' } });
    expect((screen.getByLabelText('Job Title', { exact: true }) as HTMLInputElement).value).toBe('Manual Title');
  });

  it('replacing the document replaces the review state', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await uploadDoc(docResult());
    expect((screen.getByLabelText('Company Name', { exact: true }) as HTMLInputElement).value)
      .toBe('Elite HR Technologies');
    const file2 = new File(['y'], 'pm2.pdf', { type: 'application/pdf' });
    vi.mocked(parseJd).mockResolvedValue(docResult({
      values: { companyName: 'Other Corp', title: 'Other Role' },
      missingFields: ['closesAt'],
    }) as never);
    fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file2] } });
    await waitFor(() => expect(
      (screen.getByLabelText('Company Name', { exact: true }) as HTMLInputElement).value,
    ).toBe('Other Corp'));
    expect(vi.mocked(createJob)).not.toHaveBeenCalled();
  });

  it('review → edit → duplicate advisory → save through the existing endpoint', async () => {
    vi.mocked(checkDuplicate).mockResolvedValue({
      similarJobs: [{ jobId: 'j-old', jobKey: 'OLD-1', title: 'Old PM', companyName: 'Elite HR Technologies', lifecycleStatus: 'OPEN' } as never],
      count: 1,
    });
    const onCreated = vi.fn();
    render(<CreateJobForm onCreated={onCreated} onExit={() => {}} />);
    await uploadDoc(docResult());
    // AI provides no jobKey: HR supplies identity, edits a value, saves.
    fireEvent.change(screen.getByLabelText('Job Key', { exact: true }), { target: { value: 'PM-1' } });
    fireEvent.change(screen.getByLabelText('Maximum Experience', { exact: true }), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create job' }));
    expect(await screen.findByText('A similar job already exists. Do you want to continue?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(vi.mocked(createJob)).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createJob).mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(payload.companyName).toBe('Elite HR Technologies');
    expect(payload.maxExperienceYears).toBe(7);
    expect(payload.assigneeUserId).toBe('u-hr');
    expect(onCreated).toHaveBeenCalled();
  });

  it('shows processing stages while the document is analyzed', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    let resolveParse!: (v: unknown) => void;
    vi.mocked(parseJd).mockImplementation(() => new Promise((res) => { resolveParse = res as never; }));
    const file = new File(['x'], 'pm.pdf', { type: 'application/pdf' });
    fireEvent.click(screen.getByRole('radio', { name: /JD Document/ }));
    fireEvent.change(screen.getByLabelText('Upload JD file'), { target: { files: [file] } });
    expect(await screen.findByLabelText('JD processing stages')).toBeInTheDocument();
    expect(screen.getByText('Validating document')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    resolveParse(docResult());
    await waitFor(() => expect(screen.getByText(/AI extraction complete/)).toBeInTheDocument());
  });

  it('AI prefill marks the form dirty for unsaved-change protection', async () => {
    const onExit = vi.fn();
    render(<CreateJobForm onCreated={() => {}} onExit={onExit} />);
    await uploadDoc(docResult());
    fireEvent.click(screen.getByRole('button', { name: /Back to Jobs/ }));
    expect(await screen.findByText('You have unsaved changes. Are you sure you want to leave?')).toBeInTheDocument();
  });

  it('double-submit protection holds after AI prefill', async () => {
    render(<CreateJobForm onCreated={() => {}} onExit={() => {}} />);
    await uploadDoc(docResult());
    fireEvent.change(screen.getByLabelText('Job Key', { exact: true }), { target: { value: 'PM-1' } });
    const btn = screen.getByRole('button', { name: 'Create job' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(vi.mocked(createJob)).toHaveBeenCalledTimes(1));
  });
});
