import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ScheduleDialog} from '../recruitment/ScheduleDialog';
import {InterviewCalendarStatus} from '../recruitment/InterviewCalendarStatus';
import {recruitmentRequest} from '../../lib/recruitmentApi';
import {googleRequest} from '../../lib/googleApi';
import {chooseSelect} from '../../test-select';

vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn()}));
vi.mock('../../lib/googleApi',()=>({googleRequest:vi.fn()}));
const manual={userId:'manual',name:'Manual Interviewer',role:'technical_interviewer',googleCalendarConnected:false};
const connected={userId:'connected',name:'Connected Interviewer',role:'technical_interviewer',googleCalendarConnected:true};
const application={applicationId:'application',currentStage:'ASSESSMENT_COMPLETED',candidate:{name:'Synthetic Candidate'}} as any;
beforeEach(()=>{
  vi.resetAllMocks();
  vi.mocked(recruitmentRequest).mockImplementation(async(path,body)=>path.startsWith('/staff?')
    ?{items:[manual,connected],total:2,selected:path.includes('selectedUserId=connected')?connected:null} as any
    :{...body as object,googleCalendarStatus:'not_connected'} as any);
  vi.mocked(googleRequest).mockResolvedValue({status:'free',available:true,message:'No overlapping meetings.'});
});
function dates(){
  fireEvent.change(screen.getByLabelText('Interview starts'),{target:{value:'2026-12-01T10:00'}});
  fireEvent.change(screen.getByLabelText('Interview ends'),{target:{value:'2026-12-01T11:00'}});
  fireEvent.change(screen.getByLabelText('Scheduling reason'),{target:{value:'Recruiter approved this interview'}});
}
it('hides availability and saves manually without any Google request',async()=>{
  const saved=vi.fn();render(<ScheduleDialog application={application} onClose={vi.fn()} onSaved={saved}/>);
  expect(screen.queryByRole('button',{name:'Check availability'})).not.toBeInTheDocument();
  await chooseSelect(screen.getByLabelText('Assigned interviewer'),'manual');
  expect(await screen.findByText(/Manual Interviewer has not connected Google Calendar/)).toBeVisible();
  expect(screen.queryByRole('region',{name:'Google Calendar availability'})).not.toBeInTheDocument();
  dates();fireEvent.submit(screen.getByRole('button',{name:/^Schedule interview$/}).closest('form')!);
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(recruitmentRequest).toHaveBeenCalledWith('/interviews',expect.objectContaining({interviewerId:'manual'}),'POST');
  expect(googleRequest).not.toHaveBeenCalled();
});
it('names the connected account owner and discards checks when the interviewer changes',async()=>{
  render(<ScheduleDialog application={application} onClose={vi.fn()} onSaved={vi.fn()}/>);
  await chooseSelect(screen.getByLabelText('Assigned interviewer'),'connected');
  expect(await screen.findByText('Connected Interviewer has connected Google Calendar.')).toBeVisible();
  expect(screen.getByRole('heading',{name:'Connected Interviewer’s Google Calendar'})).toBeVisible();
  dates();
  let resolve!:(value:any)=>void;
  vi.mocked(googleRequest).mockImplementation(()=>new Promise(done=>{resolve=done;}));
  fireEvent.click(screen.getByRole('button',{name:'Check availability'}));
  await waitFor(()=>expect(googleRequest).toHaveBeenCalledOnce());
  const signal=vi.mocked(googleRequest).mock.calls[0][3]!;
  await chooseSelect(screen.getByLabelText('Assigned interviewer'),'manual');
  expect(signal.aborted).toBe(true);
  await act(async()=>resolve({status:'free',available:true,message:'Old interviewer is free.'}));
  expect(screen.queryByRole('button',{name:'Check availability'})).not.toBeInTheDocument();
  expect(screen.queryByText('Old interviewer is free.')).not.toBeInTheDocument();
});
it('retains the selected interviewer metadata when outside the current staff page',async()=>{
  vi.mocked(recruitmentRequest).mockResolvedValue({items:[manual],total:51,selected:connected} as any);
  render(<ScheduleDialog application={application} existing={{interviewId:'booking',interviewerId:'connected',round:'technical',startsAt:'2026-12-01T04:30:00Z',endsAt:'2026-12-01T05:30:00Z',revision:1} as any} onClose={vi.fn()} onSaved={vi.fn()}/>);
  expect(await screen.findByText('Connected Interviewer has connected Google Calendar.')).toBeVisible();
  expect(screen.getByRole('button',{name:'Check availability'})).toBeEnabled();
  expect(recruitmentRequest).toHaveBeenCalledWith(expect.stringContaining('selectedUserId=connected'),undefined,'GET',expect.any(AbortSignal));
});
it('labels a manual interview clearly without reporting a pending Google sync',()=>{
  render(<InterviewCalendarStatus interview={{googleCalendarStatus:'not_connected',canManage:true,status:'scheduled'} as any} onChanged={vi.fn()}/>);
  expect(screen.getByRole('status')).toHaveTextContent('Interview scheduled without Google Calendar');
  expect(screen.queryByRole('button',{name:'Retry calendar sync'})).not.toBeInTheDocument();
});
