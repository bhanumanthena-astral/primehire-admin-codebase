import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import ResumeIntakePage from '../ResumeIntakePage';
import {intakeGet,intakeMutate} from '../../lib/resumeIntakeApi';
vi.mock('../../lib/authContext',()=>({useAuth:()=>({user:{role:'super_admin',userId:'admin',orgId:'org'}})}));
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:vi.fn(),intakeMutate:vi.fn(),intakeDownload:vi.fn()}));
vi.mock('../JobResumeList',()=>({JobResumeList:({jobId,caps,onContinueToAts}:any)=><><p>All batches for {jobId}</p>{caps.canUpload&&onContinueToAts&&<button onClick={()=>onContinueToAts({itemId:'ready',batchId:'older-batch',status:'review_required'})}>Continue to ATS review</button>}</>}));
vi.mock('../JobResumeAtsReview',()=>({JobResumeAtsReview:()=> <p>Job-wide ATS review</p>}));
beforeEach(()=>vi.clearAllMocks());

it('resumes pending ATS across every batch from the job resume view',async()=>{
 vi.mocked(intakeGet).mockResolvedValue({items:[],hasMore:false} as any);
 vi.mocked(intakeMutate).mockResolvedValue({queued:210,alreadyScored:5,notReady:0});
 render(<ResumeIntakePage capabilities={{canUpload:true,canAdmin:true,limits:{}} as any} scopedJob={{jobId:'job-a'} as any} initialView="batches"/>);
 expect(intakeMutate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Resume ATS'}));
 expect(await screen.findByText(/Resuming ATS for 210 resumes. 5 current scores retained/)).toBeVisible();
 expect(intakeMutate).toHaveBeenCalledWith('/jobs/job-a/resume-ats',{});
});

it('resumes only the selected batch in Processing and review and hides the action for read-only users',async()=>{
 const batch={batchId:'batch-a',jobId:'job-a',jobTitle:'Engineer',jobKey:'JOB-A',mode:'files',createdAt:'2026-11-18',counts:{total:3},status:'review_required',importComplete:false};
 vi.mocked(intakeGet).mockImplementation(async path=>path.startsWith('/batches?')?{items:[batch],hasMore:false}:{batch,items:[],total:3} as any);
 vi.mocked(intakeMutate).mockResolvedValue({queued:3,alreadyScored:0,notReady:0});
 const view=render(<ResumeIntakePage capabilities={{canUpload:true,canAdmin:true,limits:{}} as any} scopedJob={{jobId:'job-a'} as any} initialView="batches"/>);
 fireEvent.click(screen.getByRole('button',{name:'Upload batches'}));
 await screen.findByText('Page 1 · 3 matching records');
 fireEvent.click(screen.getByRole('button',{name:'Resume ATS'}));
 await waitFor(()=>expect(intakeMutate).toHaveBeenCalledWith('/jobs/job-a/resume-ats',{batchId:'batch-a'}));
 view.unmount();
 render(<ResumeIntakePage capabilities={{canUpload:false,canAdmin:false,limits:{}} as any} scopedJob={{jobId:'job-a'} as any} initialView="batches"/>);
 expect(screen.queryByRole('button',{name:'Resume ATS'})).not.toBeInTheDocument();
});

it('defaults scoped review to all batches and preserves explicit single-batch review',async()=>{
  const batch={batchId:'last-batch',jobId:'job-a',jobTitle:'Engineer',jobKey:'JOB-A',mode:'files',createdAt:'2026-11-18',counts:{total:3},status:'review_required',importComplete:false};
  vi.mocked(intakeGet).mockImplementation(async path=>path.startsWith('/batches?')?{items:[batch],hasMore:false}:{batch,items:[],total:3} as any);
  render(<ResumeIntakePage capabilities={{canUpload:true,canAdmin:false,limits:{}} as any} scopedJob={{jobId:'job-a'} as any} initialView="batches"/>);
  expect(screen.getByText('All batches for job-a')).toBeVisible();
  await waitFor(()=>expect(intakeGet).toHaveBeenCalled());
  expect(vi.mocked(intakeGet).mock.calls.some(([path])=>path.startsWith('/batches/last-batch?'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Upload batches'}));
  await waitFor(()=>expect(vi.mocked(intakeGet).mock.calls.some(([path])=>path.startsWith('/batches/last-batch?'))).toBe(true));
  expect(await screen.findByText('Page 1 · 3 matching records')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'All job resumes'}));
  expect(screen.getByText('All batches for job-a')).toBeVisible();
});

it('continues an unreviewed resume to its own older upload batch and ATS controls',async()=>{
 const latest={batchId:'latest-batch',jobId:'job-a',jobTitle:'Recent upload',mode:'files',createdAt:'2026-11-19',counts:{total:1},status:'review_required',importComplete:true};
 const older={...latest,batchId:'older-batch',jobTitle:'Original upload',canSetAtsRange:true};
 let finishList!:(value:any)=>void;
 vi.mocked(intakeGet).mockImplementation(async path=>path.startsWith('/batches?')?new Promise(resolve=>{finishList=resolve}):{batch:older,items:[],total:1} as any);
 vi.mocked(intakeMutate).mockResolvedValue({});
 render(<ResumeIntakePage capabilities={{canUpload:true,canAdmin:false,limits:{}} as any} scopedJob={{jobId:'job-a'} as any} initialView="batches"/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue to ATS review'}));
 await screen.findByRole('region',{name:'ATS score range'});
 expect(screen.getByRole('button',{name:'Save range & score resumes'})).toBeEnabled();
 expect(intakeMutate).not.toHaveBeenCalled();
 finishList({items:[latest],hasMore:true});
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'Upload batch'})).toHaveTextContent('Original upload'));
 expect(vi.mocked(intakeGet).mock.calls.some(([path])=>path.startsWith('/batches/latest-batch?'))).toBe(false);
 fireEvent.change(screen.getByRole('spinbutton',{name:'Minimum ATS percentage'}),{target:{value:'45'}});
 fireEvent.click(screen.getByRole('button',{name:'Save range & score resumes'}));
 await waitFor(()=>expect(intakeMutate).toHaveBeenCalledWith('/batches/older-batch/ats-range',{minimum:45,maximum:100,expectedRevision:0},'PUT'));
});
