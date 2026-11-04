import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import ResumeUploadPage from '../ResumeUploadPage';
import AssessmentsAndAssignments from '../AssessmentsAndAssignments';
import {intakeGet} from '../../lib/resumeIntakeApi';
import {assessmentRequest,AssessmentError} from '../../lib/assessmentManagementApi';
vi.mock('../../lib/resumeIntakeApi',async original=>({...await original<any>(),intakeGet:vi.fn()}));
vi.mock('../../lib/assessmentManagementApi',async original=>({...await original<any>(),assessmentRequest:vi.fn()}));
afterEach(()=>vi.unstubAllEnvs());

describe('Production frontend requires the current V2 backend',()=>{
  it('shows retry instead of opening legacy resume flows when V2 is unreachable',async()=>{
    vi.stubEnv('DEV',false);vi.stubEnv('PROD',true);
    vi.mocked(intakeGet).mockRejectedValue(new Error('Unavailable'));
    render(<ResumeUploadPage/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Resume workspace is temporarily unavailable.');
    fireEvent.click(screen.getByRole('button',{name:'Retry resume workspace'}));
    await waitFor(()=>expect(intakeGet).toHaveBeenCalledTimes(2));
  });
  it('does not enter legacy provider assessment creation on a partial production backend',async()=>{
    vi.stubEnv('DEV',false);vi.stubEnv('PROD',true);
    vi.mocked(assessmentRequest).mockRejectedValue(new AssessmentError('Assessment workspace unavailable',[],404));
    render(<AssessmentsAndAssignments assessments={[]} candidates={[]} templates={[]} onSetAssessments={vi.fn()} onSetCandidates={vi.fn()} onOpenReport={vi.fn()}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Assessment workspace unavailable');
    expect(screen.queryByRole('button',{name:'Create assessment'})).not.toBeInTheDocument();
  });
});
