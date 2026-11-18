import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ResumeIntakePage from '../ResumeIntakePage';
import {intakeGet} from '../../lib/resumeIntakeApi';
vi.mock('../../lib/authContext',()=>({useAuth:()=>({user:{role:'super_admin',userId:'admin',orgId:'org'}})}));
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:vi.fn(),intakeMutate:vi.fn(),intakeDownload:vi.fn()}));
vi.mock('../JobResumeList',()=>({JobResumeList:({jobId}:any)=><p>All batches for {jobId}</p>}));

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
