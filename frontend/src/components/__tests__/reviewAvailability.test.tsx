import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {InterviewDialog} from '../recruitment/InterviewDialog';
vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn(),recruitmentDownload:vi.fn()}));
afterEach(()=>vi.useRealTimers());

const interview={
  interviewId:'timed-interview',applicationId:'application',jobId:'job',interviewerId:'technical-reviewer',
  round:'technical',status:'scheduled',revision:1,reminderMinutes:15,
  startsAt:'2026-10-16T06:30:02Z',endsAt:'2026-10-16T07:30:02Z',serverTime:'2026-10-16T06:30:00Z',
  candidate:{name:'Synthetic Candidate',skills:['Python']},application:{currentStage:'ROUND1_SCHEDULED'},
  job:{jdText:'Build Python services'},jobTitle:'Backend Engineer',canReview:true,canManage:false,
  canReveal:false,canDownload:false,canCompensate:false,emailStatus:[],
} as any;

it('shows the opening time and enables review at the server-time boundary without losing feedback',()=>{
  vi.useFakeTimers();
  // Deliberately wrong device clock: server time still determines availability.
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  render(<InterviewDialog initial={interview} onClose={vi.fn()} onChanged={vi.fn()} onReschedule={vi.fn()}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Reviews & decision'}));
  expect(screen.getByRole('button',{name:'Submit review'})).toBeDisabled();
  expect(screen.getByText(/Review submission opens at/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Candidate strengths'),{target:{value:'Strong reasoning examples'}});
  act(()=>vi.advanceTimersByTime(3000));
  expect(screen.getByRole('button',{name:'Submit review'})).toBeEnabled();
  expect(screen.getByLabelText('Candidate strengths')).toHaveValue('Strong reasoning examples');
  expect(screen.queryByText(/Review submission opens at/)).not.toBeInTheDocument();
});

it('shows the previous and updated booking and the saved rescheduling reason',()=>{
  render(<InterviewDialog initial={{...interview,canManage:true,scheduleChanges:[{
    changedAt:'2026-10-16T05:00:00Z',reason:'Candidate requested a later slot',
    before:{startsAt:'2026-10-16T04:00:00Z',endsAt:'2026-10-16T05:00:00Z'},
    after:{startsAt:interview.startsAt,endsAt:interview.endsAt},
  }]}} onClose={vi.fn()} onChanged={vi.fn()} onReschedule={vi.fn()}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Schedule & delivery'}));
  expect(screen.getByRole('region',{name:'Rescheduling history'})).toHaveTextContent('Candidate requested a later slot');
  expect(screen.getByText(/Previous:/)).toBeVisible();
  expect(screen.getByText(/Updated:/)).toBeVisible();
});
