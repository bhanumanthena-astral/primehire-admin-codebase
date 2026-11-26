import {expect,it,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {DeveloperAssessments} from '../recruitment/DeveloperAssessments';
import {recruitmentRequest} from '../../lib/recruitmentApi';
vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn()}));
const job={jobId:'job',title:'Backend Engineer',jdText:'Build Python services'};
const candidate={applicationId:'app',jobId:'job',candidate:{name:'Candidate'},currentStage:'ASSESSMENT_COMPLETED',assessment:{score:82,status:'completed'},atsScore:75};
beforeEach(()=>{
 vi.clearAllMocks();
 vi.mocked(recruitmentRequest).mockImplementation(async(path,body)=>path==='/applications/shortlist-bulk'
  ? {shortlistedIds:(body as any).applicationIds,failed:[]} as any : {items:[candidate],total:1} as any);
});
const show=(changed=vi.fn())=>render(<MemoryRouter><DeveloperAssessments job={job} canShortlist readOnly={false} onChanged={changed}/></MemoryRouter>);
it('shows a sortable table and sends the developer shortlist decision',async()=>{
 const changed=vi.fn();show(changed);
 fireEvent.click(screen.getByText('Job description'));
 expect(screen.getByText('Build Python services')).toBeVisible();
 expect(await screen.findByRole('table',{name:'Candidate assessments'})).toBeVisible();
 fireEvent.click(await screen.findByRole('button',{name:'Shortlist for interview'}));
 await waitFor(()=>expect(recruitmentRequest).toHaveBeenCalledWith('/applications/shortlist-bulk',{applicationIds:['app']},'POST',expect.any(AbortSignal)));
 await waitFor(()=>expect(changed).toHaveBeenCalled());
 expect(screen.getByText(/1 candidates shortlisted/)).toBeVisible();
});
it('prevents changes in view-as mode and without review permission',async()=>{
 const {rerender}=render(<MemoryRouter><DeveloperAssessments job={job} canShortlist readOnly onChanged={vi.fn()}/></MemoryRouter>);
 expect(await screen.findByRole('button',{name:'Shortlist for interview'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Select all in range'})).toBeDisabled();
 expect(screen.getByRole('checkbox',{name:'Select Candidate'})).toBeDisabled();
 rerender(<MemoryRouter><DeveloperAssessments job={job} canShortlist={false} readOnly={false} onChanged={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole('button',{name:'Shortlist for interview'})).not.toBeInTheDocument();
});
it('sorts each data column on the server and reverses its direction',async()=>{
 show();await screen.findByRole('button',{name:'Shortlist for interview'});
 for(const [label,key] of [['ATS score','ats'],['Pipeline stage','stage'],['Assessment status','status'],['Assessment score','score'],['Candidate','name']]){
  await waitFor(()=>expect(screen.getByRole('button',{name:label})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:label}));
  await waitFor(()=>expect(recruitmentRequest).toHaveBeenLastCalledWith(expect.stringContaining(`sortBy=${key}&descending=false`),undefined,'GET',expect.any(AbortSignal)));
  await waitFor(()=>expect(screen.getByRole('button',{name:label})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:label}));
  await waitFor(()=>expect(recruitmentRequest).toHaveBeenLastCalledWith(expect.stringContaining(`sortBy=${key}&descending=true`),undefined,'GET',expect.any(AbortSignal)));
 }
});
it('uses two accessible range handles and selects matching candidates across all pages',async()=>{
 const matches=Array.from({length:101},(_,index)=>({...candidate,applicationId:`app${index}`,candidate:{name:`Candidate ${index}`}}));
 vi.mocked(recruitmentRequest).mockImplementation(async(path,body)=>{
  if(path==='/applications/shortlist-bulk')return {shortlistedIds:(body as any).applicationIds,failed:[]} as any;
  const query=new URLSearchParams(path.split('?')[1]);
  return {items:matches.slice(Number(query.get('skip')),Number(query.get('skip'))+Number(query.get('limit'))),total:101} as any;
 });
 show();await screen.findByRole('checkbox',{name:'Select Candidate 0'});
 expect(screen.getByRole('slider',{name:'Minimum assessment score'})).toBeVisible();
 expect(screen.getByRole('slider',{name:'Maximum assessment score'})).toBeVisible();
 fireEvent.change(screen.getByLabelText('Minimum score percentage'),{target:{value:'60'}});
 fireEvent.change(screen.getByLabelText('Maximum score percentage'),{target:{value:'90'}});
 fireEvent.click(screen.getByRole('button',{name:'Select all in range'}));
 const shortlist=await screen.findByRole('button',{name:'Shortlist selected (101)'});
 await waitFor(()=>expect(shortlist).toBeEnabled());
 expect(vi.mocked(recruitmentRequest).mock.calls.some(([path])=>path.includes('minimum=60&maximum=90&stage=ASSESSMENT_COMPLETED')&&path.includes('skip=100'))).toBe(true);
 fireEvent.click(shortlist);
 await screen.findByText(/101 candidates shortlisted/);
 expect(vi.mocked(recruitmentRequest).mock.calls.filter(([path])=>path==='/applications/shortlist-bulk').map(([,body])=>(body as any).applicationIds.length)).toEqual([100,1]);
});
it('keeps failed selections and reports partial success without hiding the error on refresh',async()=>{
 vi.mocked(recruitmentRequest).mockImplementation(async(path)=>path==='/applications/shortlist-bulk'
  ? {shortlistedIds:['app'],failed:[{applicationId:'changed',message:'Application changed; refresh first'}]} as any
  : {items:[candidate,{...candidate,applicationId:'changed',candidate:{name:'Changed Candidate'}}],total:2} as any);
 show();await screen.findByRole('checkbox',{name:'Select Candidate'});
 fireEvent.click(screen.getByRole('checkbox',{name:'Select eligible candidates on this page'}));
 fireEvent.click(screen.getByRole('button',{name:'Shortlist selected (2)'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Changed Candidate: Application changed');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Shortlist selected (1)'})).toBeEnabled());
 expect(screen.getByRole('alert')).toHaveTextContent('Application changed');
});
it('excludes incomplete assessments from page selection and resets selection on job change',async()=>{
 vi.mocked(recruitmentRequest).mockResolvedValue({items:[candidate,{...candidate,applicationId:'pending',candidate:{name:'Pending Candidate'},currentStage:'ASSESSMENT_PENDING',assessment:{}}],total:2} as any);
 const view=show();await screen.findByRole('checkbox',{name:'Select Candidate'});
 expect(screen.getByRole('checkbox',{name:'Select Pending Candidate'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:'Select eligible candidates on this page'}));
 expect(screen.getByRole('button',{name:'Shortlist selected (1)'})).toBeEnabled();
 view.rerender(<MemoryRouter><DeveloperAssessments job={{...job,jobId:'other'}} canShortlist readOnly={false} onChanged={vi.fn()}/></MemoryRouter>);
 expect(screen.getByText('0 selected across all pages')).toBeVisible();
});
