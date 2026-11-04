import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApplicantsPage from '../ApplicantsPage';
import { fetchApplicants, fetchEmailMode, revealPii, sendAssessments } from '../../lib/hiringApi';

vi.mock('../../lib/hiringApi', () => ({
  fetchApplicants: vi.fn(),
  fetchEmailMode: vi.fn(),
  revealPii: vi.fn(),
  sendAssessments: vi.fn(),
}));

const ROW = {
  applicantId: 'a1',
  orgId: 'default',
  email: 'p***@example.com',
  name: 'Priya Strong',
  phone: 'XXXXXX1111',
  resume: { parsedJson: { skills: ['Python'] } },
  consent: {},
  retentionUntil: null,
  tags: [],
  possibleDuplicate: false,
  latestApplication: {
    applicationId: 'app1', jobId: 'j1', currentStage: 'SHORTLISTED',
    matchScore: 95, needsReview: false, threshold: 60, lowConfidence: false,
    assessment: { state: 'none', error: null },
  },
  createdAt: '', updatedAt: '',
};

describe('Bulk send assessments', () => {
  beforeEach(() => {
    vi.mocked(fetchApplicants).mockResolvedValue([ROW]);
    vi.mocked(fetchEmailMode).mockResolvedValue({ dryRun: true });
    vi.mocked(sendAssessments).mockResolvedValue({
      items: [{ applicationId: 'app1', result: 'accepted' }], accepted: 1, total: 1,
    });
  });

  it('selects shortlisted rows, confirms, and shows per-item results', async () => {
    render(<ApplicantsPage onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Select Priya Strong/ }));
    fireEvent.click(screen.getByRole('button', { name: /Send assessments/ }));
    expect(await screen.findByRole('dialog', { name: /Confirm bulk send/ })).toBeInTheDocument();
    expect(screen.getByText(/Dry-run is ON/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm send/ }));
    await waitFor(() => expect(sendAssessments).toHaveBeenCalledWith(['app1']));
    expect(await screen.findByText(/1\/1 queued/)).toBeInTheDocument();
  });
});
