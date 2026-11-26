import {expect,it,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {DeveloperAssessments} from '../recruitment/DeveloperAssessments';
import {recruitmentRequest} from '../../lib/recruitmentApi';
vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn()}));
const job={jobId:'job',title:'Backend Engineer',jdText:'Build Python services'};
const candidate={applicationId:'app',jobId:'job',candidate:{name:'Candidate'},currentStage:'ASSESSMENT_COMPLETED',assessment:{score:82,status:'completed'}};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(recruitmentRequest).mockResolvedValue({items:[candidate],total:1});});
it('shows job details and sends the developer shortlist decision',async()=>{
 const changed=vi.fn();render(<MemoryRouter><DeveloperAssessments job={job} canShortlist readOnly={false} onChanged={changed}/></MemoryRouter>);
 expect(screen.getByText('Build Python services')).toBeVisible();
 fireEvent.click(await screen.findByRole('button',{name:'Shortlist for interview'}));
 await waitFor(()=>expect(recruitmentRequest).toHaveBeenCalledWith('/applications/app/shortlist',{}));
 expect(changed).toHaveBeenCalled();
});
it('prevents changes in view-as mode and does not offer shortlisting for interview-only assignments',async()=>{
 const {rerender}=render(<MemoryRouter><DeveloperAssessments job={job} canShortlist readOnly onChanged={vi.fn()}/></MemoryRouter>);
 expect(await screen.findByRole('button',{name:'Shortlist for interview'})).toBeDisabled();
 rerender(<MemoryRouter><DeveloperAssessments job={job} canShortlist={false} readOnly={false} onChanged={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole('button',{name:'Shortlist for interview'})).not.toBeInTheDocument();
});
