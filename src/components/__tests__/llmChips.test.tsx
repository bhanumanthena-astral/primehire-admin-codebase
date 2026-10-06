import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResumeUploadPage from '../ResumeUploadPage';
import DiagnosticsPage from '../DiagnosticsPage';
import ApplicantProfilePage from '../ApplicantProfilePage';
import {
  fetchBatch,
  fetchBatches,
  fetchJobs,
  uploadResumes,
  fetchDiagnostics,
  retryFailedLlmJobs,
  retryJob,
  retryOutboxMessage,
  fetchApplicantProfile,
} from '../../lib/hiringApi';

vi.mock('../../lib/hiringApi', () => ({
  fetchJobs: vi.fn(),
  fetchBatches: vi.fn(),
  fetchBatch: vi.fn(),
  uploadResumes: vi.fn(),
  fetchDiagnostics: vi.fn(),
  retryFailedLlmJobs: vi.fn(),
  retryJob: vi.fn(),
  retryOutboxMessage: vi.fn(),
  fetchApplicantProfile: vi.fn(),
}));

const BATCH = {
  batchId: 'batch-1', orgId: 'default', jobKey: 'BE-1', fileIds: ['f1', 'f2'],
  status: 'processing', counts: { total: 2, parsed: 1, failed: 0, quarantined: 0, pendingAI: 1 },
  failures: [], consent: {},
};

function file(id: string, llmStatus?: string) {
  return {
    fileId: id, batchId: 'batch-1', fileName: `${id}.pdf`, mimeType: 'application/pdf',
    sizeBytes: 1024, contentHash: `h-${id}`, status: 'parsed', error: null,
    rawTextChars: 100, parsedJson: { name: 'N', email: `${id}@t.com` },
    createdAt: '', llmStatus,
  };
}

describe('L1 resilience chips', () => {
  beforeEach(() => {
    vi.mocked(fetchJobs).mockResolvedValue([]);
    vi.mocked(fetchBatches).mockResolvedValue([BATCH as never]);
    vi.mocked(fetchBatch).mockResolvedValue({
      batch: BATCH, files: [file('f1', 'pending'), file('f2', 'failed')],
    } as never);
  });

  it('shows pending and unavailable LLM chips in the batch table', async () => {
    render(<ResumeUploadPage />);
    fireEvent.click(await screen.findByText('batch-1'));
    expect(await screen.findByText('AI scoring pending')).toBeInTheDocument();
    expect(screen.getByText('AI unavailable — deterministic score used')).toBeInTheDocument();
  });

  it('shows no LLM chips when llmStatus is done or absent', async () => {
    vi.mocked(fetchBatch).mockResolvedValue({
      batch: BATCH, files: [file('f1', 'done'), file('f2')],
    } as never);
    render(<ResumeUploadPage />);
    fireEvent.click(await screen.findByText('batch-1'));
    await waitFor(() => expect(screen.getByText('f1.pdf')).toBeInTheDocument());
    expect(screen.queryByText('AI scoring pending')).not.toBeInTheDocument();
    expect(screen.queryByText('AI unavailable — deterministic score used')).not.toBeInTheDocument();
  });
});

describe('Diagnostics LLM health card', () => {
  beforeEach(() => {
    vi.mocked(fetchDiagnostics).mockResolvedValue({
      dryRun: true, allowlistConfigured: false, outbox: {}, failedOutbox: [], deadJobs: [],
      llm: {
        providerModel: 'openrouter:m', breaker: { state: 'open', failures: 5 },
        bucket: { tokens: 2, capacity: 5, rpm: 30 }, queuedJobs: 3,
        oldestWaitingSeconds: 95, rateLimitedLastHour: 7,
        lastError: { error: 'rate_limited', promptVersion: 'match-score-v1', model: 'm', latencyMs: 900, createdAt: null },
        fakeProvider: 'off',
      },
      deferredJobs: [],
    });
    vi.mocked(retryFailedLlmJobs).mockResolvedValue({ retried: 2, cap: 50 });
  });

  it('renders breaker, bucket, queue and last error plus retry action', async () => {
    render(<DiagnosticsPage />);
    expect(await screen.findByLabelText('LLM health card')).toBeInTheDocument();
    expect(screen.getByText(/breaker open/)).toBeInTheDocument();
    expect(screen.getByText(/queued 3/)).toBeInTheDocument();
    expect(screen.getByText(/429s last hour: 7/)).toBeInTheDocument();
    expect(screen.getByText(/last error: rate_limited/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed LLM jobs' }));
    await waitFor(() => expect(vi.mocked(retryFailedLlmJobs)).toHaveBeenCalledTimes(1));
  });
});

describe('Applicant profile pending chip', () => {
  it('shows AI scoring pending from the breakdown', async () => {
    vi.mocked(fetchApplicantProfile).mockResolvedValue({
      applicant: { applicantId: 'a1', name: 'N', email: 'n@t.com' },
      applications: [{
        applicationId: 'ap1', matchScore: 52, currentStage: 'PARSED', needsReview: true,
        reviewReasons: ['borderline'], scoreBreakdown: { keyword: 52, llmStatus: 'pending', final: 52 },
      }],
      timeline: [],
    } as never);
    render(<ApplicantProfilePage applicantId="a1" onBack={() => {}} />);
    expect(await screen.findByText('AI scoring pending')).toBeInTheDocument();
  });
});
