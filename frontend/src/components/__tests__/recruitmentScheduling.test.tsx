import React from 'react';
import {beforeEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {RecruitmentWorkspace} from '../recruitment/RecruitmentWorkspace';
import {recruitmentRequest} from '../../lib/recruitmentApi';
import {useAuth} from '../../lib/authContext';
import {chooseSelect} from '../../test-select';
vi.mock('../../lib/recruitmentApi', async original => ({...await original<any>(), recruitmentRequest:vi.fn()}));
vi.mock('../../lib/authContext', () => ({useAuth:vi.fn()}));
const candidate={applicationId:'app',applicantId:'person',jobId:'job',currentStage:'HR_ROUND',
  candidate:{name:'Handoff Candidate',email:'h***@example.test',phone:'******3210'},
  latestInterview:{interviewId:'manager-review',round:'managerial',status:'reviewed'},activeInterview:null};
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({user:{role:'admin'},logout:vi.fn()} as any);
  vi.mocked(recruitmentRequest).mockImplementation(async path=>{
    if(path==='/capabilities')return {canManage:true,canAdmin:true,workerReady:true,emailDryRun:true} as any;
    if(path.startsWith('/tracker'))return {stages:{HR_ROUND:1},milestones:{},total:1,
      schedulingPending:{hr:1,technical:0,managerial:0},positions:{total:1,filled:0},interviews:[],timeline:[]} as any;
    if(path.startsWith('/applications?'))return {items:[candidate],total:1} as any;
    return {items:[],total:0,unread:0} as any;
  });
});

it('finds an unscheduled HR candidate from the interview filter and defaults scheduling to HR',async()=>{
  render(<RecruitmentWorkspace/>);
  fireEvent.click(await screen.findByRole('button',{name:'Interviews'}));
  await chooseSelect(screen.getByRole('combobox',{name:'Interview view filter'}),'hr_scheduling_pending');
  await waitFor(()=>expect(recruitmentRequest).toHaveBeenCalledWith(
    '/applications?jobId=&stage=&schedulingRound=hr&search=&skip=0',undefined,'GET',expect.any(AbortSignal)));
  expect(await screen.findByRole('heading',{name:'Handoff Candidate'})).toBeVisible();
  expect(screen.getByRole('button',{name:'View candidate & reviews'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Schedule HR interview'}));
  const dialog=await screen.findByRole('dialog');
  expect(within(dialog).getByRole('combobox',{name:'Interview round'})).toHaveTextContent('HR');
  expect(screen.queryByLabelText('Manual exception reason')).not.toBeInTheDocument();
  expect(vi.mocked(recruitmentRequest).mock.calls.some(([path,body])=>path==='/interviews'&&!!body)).toBe(false);
});

it('uses the same pending queue for tracker counts and bulk selection',async()=>{
  render(<RecruitmentWorkspace/>);
  const counts=await screen.findByRole('region',{name:'Pending interview scheduling'});
  fireEvent.click(within(counts).getByRole('button',{name:'1 HR interview scheduling pending'}));
  await screen.findByRole('heading',{name:'HR interview scheduling pending'});
  fireEvent.click(screen.getByRole('button',{name:'Select all eligible candidates'}));
  await waitFor(()=>expect(recruitmentRequest).toHaveBeenCalledWith(
    '/applications?jobId=&stage=&schedulingRound=hr&search=&skip=0&limit=100'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Schedule selected (1)'})).toBeEnabled());
});

it('keeps unassigned scheduling queues out of interviewer controls',async()=>{
  vi.mocked(useAuth).mockReturnValue({user:{role:'hr'},logout:vi.fn()} as any);
  const previous=vi.mocked(recruitmentRequest).getMockImplementation()!;
  vi.mocked(recruitmentRequest).mockImplementation(async (...args)=>args[0]==='/capabilities'
    ? {canManage:false,canReview:true,workerReady:true} as any : previous(...args));
  render(<RecruitmentWorkspace/>);
  fireEvent.click(await screen.findByRole('button',{name:'My interviews'}));
  fireEvent.click(screen.getByRole('combobox',{name:'Interview view filter'}));
  expect(screen.queryByRole('option',{name:'HR interview scheduling pending'})).not.toBeInTheDocument();
});

it('connects the global search to all candidate stages and finds profiles beyond the first page',async()=>{
  const previous=vi.mocked(recruitmentRequest).getMockImplementation()!;
  vi.mocked(recruitmentRequest).mockImplementation(async (...args)=>{
    const path=args[0];
    if(path.startsWith('/applications?'))return path.includes('search=Ankit')
      ? {items:[candidate],total:1} as any : {items:[],total:32} as any;
    return previous(...args);
  });
  const page=render(<RecruitmentWorkspace externalSearch=""/>);
  fireEvent.click(await screen.findByRole('button',{name:'Interviews'}));
  await chooseSelect(screen.getByRole('combobox',{name:'Interview view filter'}),'completed');
  page.rerender(<RecruitmentWorkspace externalSearch="Ankit"/>);
  expect(await screen.findByRole('heading',{name:'Handoff Candidate'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Candidates'})).toHaveAttribute('aria-current','page');
  expect(recruitmentRequest).toHaveBeenCalledWith('/applications?jobId=&stage=&search=Ankit&skip=0',undefined,'GET',expect.any(AbortSignal));
  expect(screen.getByRole('button',{name:'Schedule HR interview'})).toBeEnabled();
});

it('keeps candidate lookup usable without loading unrelated interviews',async()=>{
  const previous=vi.mocked(recruitmentRequest).getMockImplementation()!;
  vi.mocked(recruitmentRequest).mockImplementation(async (...args)=>{
    if(args[0].startsWith('/interviews?'))throw new Error('Unrelated interview list unavailable');
    return previous(...args);
  });
  render(<RecruitmentWorkspace externalSearch="Ankit"/>);
  expect(await screen.findByRole('heading',{name:'Handoff Candidate'})).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(vi.mocked(recruitmentRequest).mock.calls.some(([path])=>path.startsWith('/interviews?'))).toBe(false);
});

it('preserves the explicit job scope when searching inside a job workspace',async()=>{
  render(<RecruitmentWorkspace scopedJobId="job" externalSearch="Ankit"/>);
  expect(await screen.findByRole('heading',{name:'Handoff Candidate'})).toBeVisible();
  expect(recruitmentRequest).toHaveBeenCalledWith('/applications?jobId=job&stage=&search=Ankit&skip=0',undefined,'GET',expect.any(AbortSignal));
});
