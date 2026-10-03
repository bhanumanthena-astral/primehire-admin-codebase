import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApplicantsPage from '../ApplicantsPage';
import { fetchApplicants, fetchEmailMode, revealPii } from '../../lib/hiringApi';

vi.mock('../../lib/hiringApi', () => ({
  fetchApplicants: vi.fn(),
  fetchEmailMode: vi.fn(),
  revealPii: vi.fn(),
  sendAssessments: vi.fn(),
}));

const MASKED = {
  applicantId: 'a1',
  orgId: 'default',
  email: 'p***@example.com',
  name: 'Priya Strong',
  phone: 'XXXXXX1111',
  resume: { parsedJson: { skills: ['Python', 'SQL'] } },
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

describe('Applicants masking and reveal', () => {
  beforeEach(() => {
    vi.mocked(fetchApplicants).mockResolvedValue([MASKED]);
    vi.mocked(fetchEmailMode).mockResolvedValue({ dryRun: true });
    vi.mocked(revealPii).mockResolvedValue({ email: 'priya.strong@example.com', phone: '+919111111111' });
  });

  it('shows masked contact with a Reveal action, never the full value', async () => {
    render(<ApplicantsPage onOpen={() => {}} />);
    expect(await screen.findByText('p***@example.com')).toBeInTheDocument();
    expect(screen.queryByText('priya.strong@example.com')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reveal contact/ })).toBeInTheDocument();
  });

  it('reveals only after an explicit click', async () => {
    render(<ApplicantsPage onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Reveal contact/ }));
    await waitFor(() => expect(revealPii).toHaveBeenCalledWith('a1', ['email', 'phone']));
    expect(await screen.findByText('priya.strong@example.com')).toBeInTheDocument();
  });
});
