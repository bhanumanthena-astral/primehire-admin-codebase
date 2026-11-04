import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {JobCandidateReports} from '../JobCandidateReports';
import {JobCandidateReportDialog} from '../JobCandidateReportDialog';
import {recruitmentRequest} from '../../lib/recruitmentApi';
import {authFetch} from '../../lib/authFetch';
import {useAuth} from '../../lib/authContext';
vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn()}));
vi.mock('../../lib/authFetch',()=>({authFetch:vi.fn()}));
vi.mock('../../lib/authContext',()=>({useAuth:vi.fn()}));
vi.mock('../report/ReportShell',()=>({default:({candidate,data}:any)=><p>Report for {candidate.name}: {data.overallScore}</p>}));
const job:any={jobId:'job-a',title:'Backend Engineer'};
const candidate:any={applicationId:'application-a',applicantId:'person-a',jobId:'job-a',candidate:{name:'Synthetic Candidate'},atsScore:0,currentStage:'ASSESSMENT_COMPLETED',assessment:{score:0,reportAvailable:true}};
beforeEach(()=>{
  vi.clearAllMocks();vi.mocked(useAuth).mockReturnValue({user:{role:'admin'}} as any);
  vi.mocked(recruitmentRequest).mockResolvedValue({items:[candidate],total:1});
  vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({applicationId:'application-a',report:{overallScore:0},candidate:{email:'masked@example.test'},assessment:{id:'assessment-a',roundType:'TECHNICAL'}})));
});
it('shows only report columns, preserves zero scores and opens the candidate-specific scheduler action',async()=>{
 const schedule=vi.fn();render(<JobCandidateReports job={job} onSchedule={schedule}/>);
 const row=(await screen.findByText('Synthetic Candidate')).closest('tr')!;
 expect(screen.getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['Candidate name','ATS score','Pipeline stage','Assessment score','Actions']);
 expect(within(row).getAllByText('0')).toHaveLength(2);
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Generate links'})).not.toBeInTheDocument();
 fireEvent.click(within(row).getByRole('button',{name:'Schedule interview'}));
 expect(schedule).toHaveBeenCalledWith(candidate);
 fireEvent.click(within(row).getByRole('button',{name:'View report'}));
 expect(await screen.findByText('Report for Synthetic Candidate: 0')).toBeVisible();
 expect(authFetch).toHaveBeenCalledWith('/api/job-assessments/job-a/applications/application-a/report',{signal:expect.any(AbortSignal)});
});
it('shows rescheduling for an existing booking and disables pending reports and terminal applications',async()=>{
 vi.mocked(recruitmentRequest).mockResolvedValue({items:[{...candidate,currentStage:'ROUND1_SCHEDULED',activeInterview:{interviewId:'booked'},assessment:{}},{...candidate,applicationId:'rejected',candidate:{name:'Rejected Candidate'},currentStage:'REJECTED'}],total:2});
 render(<JobCandidateReports job={job} onSchedule={vi.fn()}/>);
 const row=(await screen.findByText('Synthetic Candidate')).closest('tr')!;
 expect(within(row).getByRole('button',{name:'Reschedule interview'})).toBeEnabled();
 expect(within(row).getByRole('button',{name:'View report'})).toBeDisabled();
 expect(within(screen.getByText('Rejected Candidate').closest('tr')!).getByRole('button',{name:'Schedule interview'})).toBeDisabled();
});
it('hides actions from a reviewer role and keeps pagination scoped to the job',async()=>{
 vi.mocked(useAuth).mockReturnValue({user:{role:'technical_interviewer'}} as any);
 vi.mocked(recruitmentRequest).mockResolvedValue({items:[candidate],total:51});
 render(<JobCandidateReports job={job} onSchedule={vi.fn()}/>);
 expect(await screen.findByRole('button',{name:'Schedule interview'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'View report'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Next reports'}));
 await waitFor(()=>expect(recruitmentRequest).toHaveBeenCalledWith('/applications?jobId=job-a&skip=50&limit=50',undefined,'GET',expect.any(AbortSignal)));
});
it('shows a real provider-pending error and allows retry without a mock report',async()=>{
 vi.mocked(authFetch).mockResolvedValueOnce(new Response(JSON.stringify({detail:'The assessment report is still pending.'}),{status:409}));
 render(<JobCandidateReportDialog job={job} application={candidate} onClose={vi.fn()}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('still pending');
 expect(screen.queryByText(/Report for Synthetic/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry report'}));
 expect(await screen.findByText('Report for Synthetic Candidate: 0')).toBeVisible();
});
