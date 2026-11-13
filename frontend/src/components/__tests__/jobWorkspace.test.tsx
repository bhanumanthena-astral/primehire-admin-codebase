import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {JobWorkspace} from '../JobWorkspace';
import {JobAssessmentCandidates} from '../JobAssessmentCandidates';
import {fetchJobDetail,sendAssessments} from '../../lib/hiringApi';
import {recruitmentRequest} from '../../lib/recruitmentApi';
vi.mock('../JobDetailsPage',()=>({default:({onUpload,onShowApplications}:any)=><><button onClick={onUpload}>Upload within job</button><button onClick={onShowApplications}>Show applications</button></>}));
vi.mock('../JobApplicationsPage',()=>({JobApplicationsPage:({job,onBack}:any)=><section><p>Applications scope: {job.jobId}</p><button onClick={onBack}>Back to job</button></section>}));
vi.mock('../ResumeIntakePage',()=>({default:({scopedJob}:any)=><p>Resume scope: {scopedJob.jobId}</p>}));
vi.mock('../recruitment/RecruitmentWorkspace',()=>({RecruitmentWorkspace:({scopedJobId}:any)=><p>Schedule scope: {scopedJobId}</p>}));
vi.mock('../../lib/authContext',()=>({useAuth:()=>({user:{role:'admin'}})}));
vi.mock('../../lib/hiringApi',()=>({fetchJobDetail:vi.fn(),sendAssessments:vi.fn(),transitionApplication:vi.fn(),syncJobAssessmentResults:vi.fn(),fetchEmailMode:()=>Promise.resolve({dryRun:true})}));
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:()=>Promise.resolve({enabled:true})}));
vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn()}));
const job:any={jobId:'job-a',jobKey:'A',title:'Engineer',status:'open',assessmentJobId:'assessment-a'};
it('searches names and emails across pages, resets selections and retains the filter on refresh',async()=>{
 const rows=[{applicationId:'app-a',candidate:{name:'Zoe'},currentStage:'SHORTLISTED',atsScore:85}];
 vi.mocked(recruitmentRequest).mockImplementation(async path=>({items:path.includes('&search=')?[]:rows,total:path.includes('&search=')?0:51}) as any);
 render(<JobAssessmentCandidates job={job} onChooseAssessment={vi.fn()}/>);
 await screen.findByText('Zoe');fireEvent.click(screen.getByRole('button',{name:'Next page'}));
 await waitFor(()=>expect(recruitmentRequest).toHaveBeenCalledWith('/applications?jobId=job-a&skip=50&limit=50',undefined,'GET',expect.any(AbortSignal)));
 await screen.findByText('Zoe');fireEvent.click(screen.getByRole('checkbox',{name:'Select Zoe'}));
 expect(screen.getByRole('button',{name:'Confirm / shortlist selected (1)'})).toBeEnabled();
 fireEvent.change(screen.getByRole('searchbox',{name:'Search candidates by name or email'}),{target:{value:' alex+test@example.test '}});
 expect(screen.getByRole('button',{name:'Confirm / shortlist selected (0)'})).toBeDisabled();
 const filtered='/applications?jobId=job-a&skip=0&limit=50&search=alex%2Btest%40example.test';
 await waitFor(()=>expect(recruitmentRequest).toHaveBeenCalledWith(filtered,undefined,'GET',expect.any(AbortSignal)));
 expect(await screen.findByText('No candidates match this name or email.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Refresh results'}));
 await waitFor(()=>expect(vi.mocked(recruitmentRequest).mock.calls.filter(([path])=>path===filtered).length).toBeGreaterThan(1));
 fireEvent.click(screen.getByRole('button',{name:'Clear search'}));
 expect(await screen.findByText('Zoe')).toBeVisible();
 expect(screen.getByRole('searchbox')).toHaveValue('');
});
beforeEach(()=>{vi.clearAllMocks();vi.mocked(fetchJobDetail).mockResolvedValue({job} as any);vi.mocked(recruitmentRequest).mockResolvedValue({items:[{applicationId:'app-a',candidate:{name:'Zoe'},currentStage:'SHORTLISTED',atsScore:85,assessment:{score:75,status:'completed'}},{applicationId:'app-b',candidate:{name:'Amy'},currentStage:'PARSED',atsScore:65}],total:2});});
it('keeps resume and scheduling stages under the job and supports exit',async()=>{
 const exit=vi.fn();render(<JobWorkspace jobId="job-a" onBack={exit} onChanged={()=>{}} onDeleted={()=>{}} renderAssessments={j=><p>Assessment scope: {j.jobId}</p>}/>);
 await screen.findByRole('heading',{name:'Engineer'});fireEvent.click(screen.getByText('Upload within job'));expect(await screen.findByText('Resume scope: job-a')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'3. Assessments'}));expect(await screen.findByText('Assessment scope: job-a')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'5. Interview scheduling'}));expect(await screen.findByText('Schedule scope: job-a')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Exit to jobs'}));expect(exit).toHaveBeenCalledOnce();
});
it('shows scores, selects explicit candidates and queues invitations after confirmation',async()=>{
 vi.mocked(sendAssessments).mockResolvedValue({accepted:1,total:1,items:[{applicationId:'app-a',result:'accepted'}]} as any);
 render(<JobWorkspace jobId="job-a" onBack={()=>{}} onChanged={()=>{}} onDeleted={()=>{}} renderAssessments={(_,open)=><button onClick={()=>open?.({id:"assessment-a",jobTitle:"Engineer"} as any)}>View table</button>}/>);await screen.findByRole('heading',{name:'Engineer'});
 fireEvent.click(screen.getByRole('button',{name:'3. Assessments'}));fireEvent.click(await screen.findByRole('button',{name:'View table'}));await screen.findByText('Zoe');expect(screen.getByText('85')).toBeInTheDocument();expect(screen.getByText('75')).toBeInTheDocument();
 expect(vi.mocked(recruitmentRequest).mock.calls[0][0]).toContain('jobId=job-a');
 fireEvent.click(screen.getByRole('checkbox',{name:'Select Zoe'}));fireEvent.click(screen.getByRole('button',{name:'Send email invitations'}));expect(sendAssessments).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Confirm action'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Invitation template'),{target:{value:'tpl-invite'}});
 fireEvent.click(screen.getByRole('button',{name:'Confirm action'}));await waitFor(()=>expect(sendAssessments).toHaveBeenCalledWith(['app-a'],false,expect.objectContaining({id:'tpl-invite'})));
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp · paid add-on'}));expect(await screen.findByText('WhatsApp invitations cost extra')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Manager enablement unavailable until pricing is configured'})).toBeDisabled();
});

it('opens the complete applications directory inside the job and returns to details',async()=>{
 render(<JobWorkspace jobId="job-a" onBack={()=>{}} onChanged={()=>{}} onDeleted={()=>{}} renderAssessments={(_,open)=><button onClick={()=>open?.({id:"assessment-a",jobTitle:"Engineer"} as any)}>View table</button>}/>);
 await screen.findByRole('heading',{name:'Engineer'});fireEvent.click(screen.getByRole('button',{name:'Show applications'}));
 expect(await screen.findByText('Applications scope: job-a')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Back to job'}));
 expect(await screen.findByRole('button',{name:'Show applications'})).toBeVisible();
});

it('generates links separately without requesting email delivery',async()=>{
 vi.mocked(sendAssessments).mockResolvedValue({accepted:1,total:1,items:[{applicationId:'app-a',result:'accepted'}]} as any);
 render(<JobWorkspace jobId="job-a" onBack={()=>{}} onChanged={()=>{}} onDeleted={()=>{}} renderAssessments={(_,open)=><button onClick={()=>open?.({id:"assessment-a",jobTitle:"Engineer"} as any)}>View table</button>}/>);
 await screen.findByRole('heading',{name:'Engineer'});
 fireEvent.click(screen.getByRole('button',{name:'3. Assessments'}));fireEvent.click(await screen.findByRole('button',{name:'View table'}));await screen.findByText('Zoe');
 fireEvent.click(screen.getByRole('checkbox',{name:'Select Zoe'}));fireEvent.click(screen.getByRole('button',{name:'Generate links'}));
 expect(await screen.findByText('Generate assessment links without sending?')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Confirm action'}));await waitFor(()=>expect(sendAssessments).toHaveBeenCalledWith(['app-a'],true));
});

it('routes an unlinked job to assessment selection',async()=>{
 vi.mocked(fetchJobDetail).mockResolvedValue({job:{...job,assessmentJobId:null}} as any);
 render(<JobWorkspace jobId="job-a" onBack={()=>{}} onChanged={()=>{}} onDeleted={()=>{}} renderAssessments={(_,open)=><><p>Assessment selector stage</p><button onClick={()=>open?.({id:"assessment-a",jobTitle:"Engineer"} as any)}>View table</button></>}/>);
 await screen.findByRole('heading',{name:'Engineer'});fireEvent.click(screen.getByRole('button',{name:'3. Assessments'}));fireEvent.click(await screen.findByRole('button',{name:'View table'}));
 await screen.findByText('Zoe');expect(screen.getByRole('button',{name:'Generate links'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Choose assessment'}));expect(await screen.findByText('Assessment selector stage')).toBeVisible();
});

it('shows shortened link and password and copies their full values',async()=>{
 const link='https://assessment.example.test/opaque-candidate-token';const password='PrivateCode123';
 const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 vi.mocked(recruitmentRequest).mockResolvedValue({items:[{applicationId:'app-a',candidate:{name:'Zoe'},currentStage:'SHORTLISTED',assessment:{status:'link_created',link,password}}],total:1});
 render(<JobWorkspace jobId="job-a" onBack={()=>{}} onChanged={()=>{}} onDeleted={()=>{}} renderAssessments={(_,open)=><button onClick={()=>open?.({id:"assessment-a",jobTitle:"Engineer"} as any)}>View table</button>}/>);
 await screen.findByRole('heading',{name:'Engineer'});fireEvent.click(screen.getByRole('button',{name:'3. Assessments'}));fireEvent.click(await screen.findByRole('button',{name:'View table'}));await screen.findByText('Zoe');
 expect(screen.getByText(`Link: ${link.slice(0,Math.ceil(link.length/2))}…`)).toBeVisible();
 expect(screen.getByText(`Password: ${password.slice(0,Math.ceil(password.length/2))}••••`)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Copy password'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith(password));
 fireEvent.click(screen.getByRole('button',{name:'Copy link'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith(link));
});
