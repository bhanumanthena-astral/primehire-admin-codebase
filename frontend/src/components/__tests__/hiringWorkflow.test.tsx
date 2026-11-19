import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {expect,it,vi,beforeEach} from 'vitest';
import userEvent from '@testing-library/user-event';
import {HiringTemplateSettings} from '../HiringTemplateSettings';
import {RejectionPreview} from '../RejectionPreview';
import {TraitManager} from '../TraitManager';
import {ShareReports} from '../ShareReports';
import {workflowRequest} from '../../lib/hiringWorkflow';
vi.mock('../../lib/authContext',()=>({useAuth:()=>({user:{role:'admin'}})}));
vi.mock('../../lib/hiringWorkflow',async original=>({...await original<any>(),workflowRequest:vi.fn()}));
beforeEach(()=>vi.resetAllMocks());
it('persists the selected default rejection template for the company',async()=>{
 const settings={revision:1,templates:[{id:'reject',name:'Approved response',category:'rejection',subject:'Application update',body:'Thank you {{candidate_name}}'}],defaultRejectionId:null};
 vi.mocked(workflowRequest).mockResolvedValue(settings);
 render(<HiringTemplateSettings/>);
 await screen.findByText(/Approved response/);
 await userEvent.click(screen.getByText(/Approved response/));
 fireEvent.click(screen.getByRole('button',{name:'Set as Default Rejection Email'}));
 await waitFor(()=>expect(workflowRequest).toHaveBeenCalledWith('/settings',{templates:settings.templates,defaultRejectionId:'reject',expectedRevision:1},'PUT'));
});
it('blocks rejection when the administrator has not selected a default',async()=>{
 vi.mocked(workflowRequest).mockRejectedValue(new Error('Select a default rejection template'));
 const ready=vi.fn();render(<RejectionPreview applicationId="app" onReady={ready}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Select a default rejection template');
 expect(ready).toHaveBeenCalledWith(false);expect(ready).not.toHaveBeenCalledWith(true);
});
it('prevents adding a seventh active trait and saves a new trait description',async()=>{
 const traits=Array.from({length:6},(_,index)=>({id:'trait'+index,name:'Trait '+index,description:'Original description',active:true}));
 vi.mocked(workflowRequest).mockResolvedValue({revision:2,traits});
 render(<TraitManager jobId="job" round="technical" configuration={{revision:1,traits}} onSaved={vi.fn()}/>);
 await userEvent.click(screen.getByText('Manage Traits'));
 expect(screen.getByRole('button',{name:'Add trait'})).toBeDisabled();
 fireEvent.change(screen.getAllByRole('textbox',{name:'Description'})[0],{target:{value:'Assess reasoning with evidence'}});
 fireEvent.click(screen.getByRole('button',{name:'Save traits'}));
 await waitFor(()=>expect(workflowRequest).toHaveBeenCalledWith('/jobs/job/traits/technical',expect.objectContaining({expectedRevision:1,traits:expect.arrayContaining([expect.objectContaining({description:'Assess reasoning with evidence'})])}),'PUT'));
});
it('previews selected finalized reports before queueing an HR email',async()=>{
 const request=vi.mocked(workflowRequest);
 request.mockImplementation(async(path,body)=>{
  if(path.endsWith('/shareable'))return {items:[{id:'technical',kind:'review',round:'technical',version:1,url:'/reports/applications/app',summary:'Technical evidence'},{id:'managerial',kind:'review',round:'managerial',version:1,url:'/reports/applications/app',summary:'Managerial evidence'}]} as any;
  if(path.startsWith('/hr-recipients'))return {items:[{userId:'hr',name:'HR Member',email:'hr@example.test'}]} as any;
  if(path==='/settings')return {templates:[{id:'share',name:'HR handoff',category:'report_share'}]} as any;
  if(path==='/integration-status')return {connected:false,gmailAuthorized:false} as any;
  if(path.endsWith('/messages'))return {items:[]} as any;
  if(path.endsWith('/share-preview'))return {to:'hr@example.test',subject:'Finalized reports',html:'<p>Technical and Managerial</p>'} as any;
  return {status:'pending'} as any;
 });
 render(<ShareReports applicationId="app"/>);
 await userEvent.click(screen.getByText('Share Reports with HR'));
 await screen.findByText(/technical ·/);
 fireEvent.change(screen.getByLabelText('Company-side report template'),{target:{value:'share'}});
 fireEvent.click(screen.getByRole('button',{name:'Email Reports'}));
 expect(await screen.findByText('Confirm report email')).toBeVisible();
 expect(request.mock.calls.some(([path])=>path.endsWith('/share'))).toBe(false);
 expect(screen.getByRole('button',{name:'Send via Gmail'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm email'}));
 await waitFor(()=>expect(request).toHaveBeenCalledWith('/applications/app/share',expect.objectContaining({reportIds:['technical','managerial'],recipientUserId:'hr',templateId:'share'})));
});

it('lets an assigned portal reviewer save traits on the interview route',async()=>{
 const traits=[{id:'reasoning',name:'Reasoning',description:'Explain decisions',active:true}];
 vi.mocked(workflowRequest).mockResolvedValue({revision:1,traits});
 render(<TraitManager jobId="job" round="technical" interviewId="interview" configuration={{revision:0,traits}} onSaved={vi.fn()}/>);
 await userEvent.click(screen.getByText('Manage Traits'));
 fireEvent.click(screen.getByRole('button',{name:'Save traits'}));
 await waitFor(()=>expect(workflowRequest).toHaveBeenCalledWith('/interviews/interview/traits',{expectedRevision:0,traits},'PUT'));
});
it('shows shared round traits without edit controls to read-only viewers',async()=>{
 render(<TraitManager jobId="job" round="technical" interviewId="interview" readOnly configuration={{revision:1,traits:[{id:'reasoning',name:'Reasoning',description:'Explain decisions',active:true}]}} onSaved={vi.fn()}/>);
 await userEvent.click(screen.getByText('Round Traits'));
 expect(screen.getByText('Reasoning')).toBeVisible();
 expect(screen.getByText('Explain decisions')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Save traits'})).not.toBeInTheDocument();
});

it('confirms hiring template save only after the backend succeeds and clears stale confirmation on edits',async()=>{
 const settings={revision:1,templates:[{id:'reject',name:'Approved response',category:'rejection',subject:'Application update',body:'Thank you'}],defaultRejectionId:'reject'};
 let finish!:(value:any)=>void;
 vi.mocked(workflowRequest).mockImplementation(async(path,body)=>body?new Promise(resolve=>{finish=resolve}):settings);
 render(<HiringTemplateSettings/>);
 await screen.findByText(/Approved response/);
 fireEvent.click(screen.getByRole('button',{name:'Save hiring templates'}));
 expect(screen.getByRole('button',{name:'Saving…'})).toBeDisabled();
 expect(screen.queryByText('Hiring email templates saved successfully.')).not.toBeInTheDocument();
 finish({...settings,revision:2});
 expect(await screen.findByRole('status')).toHaveTextContent('Hiring email templates saved successfully.');
 await userEvent.click(screen.getByText(/Approved response/));
 fireEvent.change(screen.getByRole('textbox',{name:'Subject'}),{target:{value:'Changed subject'}});
 expect(screen.queryByText('Hiring email templates saved successfully.')).not.toBeInTheDocument();
});
it('shows a failed hiring-template save without claiming success',async()=>{
 vi.mocked(workflowRequest).mockImplementation(async(path,body)=>{if(body)throw new Error('Backend unavailable');return {revision:1,templates:[],defaultRejectionId:null}});
 render(<HiringTemplateSettings/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save hiring templates'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Save hiring templates'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Backend unavailable');
 expect(screen.queryByText('Hiring email templates saved successfully.')).not.toBeInTheDocument();
});
