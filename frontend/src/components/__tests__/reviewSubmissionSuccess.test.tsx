import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ReviewSubmissionSuccess} from '../recruitment/ReviewSubmissionSuccess';
import {InterviewDialog} from '../recruitment/InterviewDialog';
import {recruitmentRequest} from '../../lib/recruitmentApi';
vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn()}));
vi.mock('../report/PreviousRoundReport',()=>({PreviousRoundReport:()=>null}));
const row:any={interviewId:'interview',applicationId:'application',interviewerId:'reviewer',round:'technical',
 status:'scheduled',revision:2,startsAt:'2026-11-03T06:30:00Z',endsAt:'2026-11-03T07:30:00Z',serverTime:'2026-11-03T08:00:00Z',
 candidate:{name:'Synthetic Candidate',skills:[]},application:{currentStage:'ROUND1_SCHEDULED'},
 job:{jdText:'Work with the team'},canReview:true,canManage:false,emailStatus:[]};
function saved(round='technical'){return {...row,round,status:'reviewed',canReview:false,review:{round,createdAt:'2026-11-03T08:00:00Z',strengths:'Evidence',scorecard:{communication:3}}};}
function fill(){fireEvent.change(screen.getByLabelText('Candidate strengths'),{target:{value:'Clear examples and thoughtful reasoning'}});fireEvent.change(screen.getByLabelText('Review reasons'),{target:{value:'Evidence supports my recommendation'}});}
beforeEach(()=>{vi.resetAllMocks();});
it.each(['technical','managerial','hr'])('confirms a saved %s review exactly once without depending on a follow-up GET',async round=>{
 const submitted=vi.fn(),changed=vi.fn();vi.mocked(recruitmentRequest).mockResolvedValue(saved(round));
 render(<InterviewDialog initial={{...row,round}} initialTab="reviews" onClose={vi.fn()} onChanged={changed} onReschedule={vi.fn()} onReviewSubmitted={submitted}/>);
 fill();fireEvent.submit(screen.getByRole('button',{name:'Submit review'}).closest('form')!);
 expect(await screen.findByRole('heading',{name:'Review submitted successfully'})).toBeVisible();
 expect(submitted).toHaveBeenCalledExactlyOnceWith(saved(round));expect(changed).toHaveBeenCalledOnce();
 expect(recruitmentRequest).toHaveBeenCalledTimes(1);
});
it('keeps failed review feedback intact and only shows success after a retry is saved',async()=>{
 const submitted=vi.fn();vi.mocked(recruitmentRequest).mockRejectedValueOnce(new Error('Connection interrupted. Please retry.')).mockResolvedValueOnce(saved());
 render(<InterviewDialog initial={row} initialTab="reviews" onClose={vi.fn()} onChanged={vi.fn()} onReschedule={vi.fn()} onReviewSubmitted={submitted}/>);
 fill();fireEvent.submit(screen.getByRole('button',{name:'Submit review'}).closest('form')!);
 expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
 expect(screen.getByLabelText('Review reasons')).toHaveValue('Evidence supports my recommendation');
 expect(submitted).not.toHaveBeenCalled();expect(screen.queryByRole('heading',{name:'Review submitted successfully'})).not.toBeInTheDocument();
 fireEvent.submit(screen.getByRole('button',{name:'Submit review'}).closest('form')!);
 await waitFor(()=>expect(submitted).toHaveBeenCalledOnce());
});
it('does not post the same review twice while the save is in flight',async()=>{
 let resolve!:(value:any)=>void;vi.mocked(recruitmentRequest).mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const submitted=vi.fn();render(<InterviewDialog initial={row} initialTab="reviews" onClose={vi.fn()} onChanged={vi.fn()} onReschedule={vi.fn()} onReviewSubmitted={submitted}/>);
 fill();const form=screen.getByRole('button',{name:'Submit review'}).closest('form')!;
 fireEvent.submit(form);fireEvent.submit(form);expect(recruitmentRequest).toHaveBeenCalledTimes(1);
 await act(async()=>resolve(saved()));expect(submitted).toHaveBeenCalledOnce();
});
it('thanks the interviewer by name, keeps the illustration local, and provides useful next actions',()=>{
 const next=vi.fn(),view=vi.fn();render(<ReviewSubmissionSuccess completion={{interviewId:'interview',candidateName:'Synthetic Candidate',round:'hr'}} interviewerName="Srinivas Manager" onContinue={next} onViewReview={view}/>);
 expect(screen.getByRole('heading',{name:'Review submitted successfully'})).toHaveFocus();
 expect(screen.getByText(/Congratulations, Srinivas/)).toHaveTextContent('HR interview feedback');
 expect(screen.getByRole('img',{name:'A friendly 3D colleague showing appreciation'})).toHaveAttribute('src','/images/interview-review-thank-you.png');
 expect(screen.getByText(/Thank you for the time, care and expertise/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'View submitted review'}));expect(view).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'Continue to interviews'}));expect(next).toHaveBeenCalledOnce();
});
it('retains the saved-review confirmation if the illustration cannot load',()=>{
 render(<ReviewSubmissionSuccess completion={{interviewId:'interview',candidateName:'Synthetic Candidate',round:'technical'}} onContinue={vi.fn()} onViewReview={vi.fn()}/>);
 fireEvent.error(screen.getByRole('img',{name:'A friendly 3D colleague showing appreciation'}));
 expect(screen.getByRole('heading',{name:'Review submitted successfully'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Continue to interviews'})).toBeEnabled();
});
