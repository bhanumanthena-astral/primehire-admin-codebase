import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResumeUploadPage from '../ResumeUploadPage';
import { fetchBatches, fetchJobs } from '../../lib/hiringApi';

vi.mock('../../lib/authContext',()=>({useAuth:()=>({user:{role:'hr',jobAccess:['view','upload']}})}));
vi.mock('../../lib/hiringApi', () => ({
  fetchJobs: vi.fn(),
  fetchBatches: vi.fn(),
  fetchBatch: vi.fn(),
  uploadResumes: vi.fn(),
}));

describe('Resume upload consent gate', () => {
  beforeEach(() => {
    vi.mocked(fetchJobs).mockResolvedValue([
      { jobId: 'j1', jobKey: 'BE-1', title: 'Backend', mustHaveSkills: [],
        niceToHaveSkills: [], minExperienceYears: null, maxExperienceYears: null,
        matchThreshold: 60, lifecycleStatus:'OPEN', status: 'open', assessmentJobId: null,
        assessmentRoundType: 'TECHNICAL',
        reuseAssessmentMonths: 6, createdBy: 'u', createdAt: '', updatedAt: '',
        orgId: 'default', description: '' },
    ]);
    vi.mocked(fetchBatches).mockResolvedValue([]);
  });

  it('keeps upload disabled until consent is ticked', async () => {
    render(<ResumeUploadPage />);
    const button = await screen.findByRole('button', { name: 'Upload resumes' });
    expect(button).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText('Resume files')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Resume files'), {target: {files: [new File(['Resume'], 'candidate.pdf', {type: 'application/pdf'})]}});
    fireEvent.click(screen.getByLabelText(/Candidate consent confirmed/));
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(screen.getByLabelText(/Candidate consent confirmed/));
    await waitFor(() => expect(button).toBeDisabled());
  });

  it('shows the consent requirement text', async () => {
    render(<ResumeUploadPage />);
    await screen.findByRole('button', { name: 'Upload resumes' });
    expect(screen.getByText(/consented to processing/)).toBeInTheDocument();
  });
});
