import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {InterviewDialog} from '../recruitment/InterviewDialog';
import {recruitmentRequest} from '../../lib/recruitmentApi';
import {chooseSelect} from '../../test-select';
vi.mock('../../lib/recruitmentApi',async original=>({...await original<any>(),recruitmentRequest:vi.fn()}));
vi.mock('../report/PreviousRoundReport',()=>({PreviousRoundReport:()=> <section aria-label="Previous round report snapshot">Preserved assessment report</section>}));
const initial:any={interviewId:'interview',applicationId:'application',interviewerId:'reviewer',round:'technical',
  status:'scheduled',revision:2,startsAt:'2026-11-03T06:30:00Z',endsAt:'2026-11-03T07:30:00Z',serverTime:'2026-11-03T08:00:00Z',
  candidate:{name:'Synthetic Candidate',skills:['Python']},application:{currentStage:'ROUND1_SCHEDULED',assessment:{score:84}},
  job:{jdText:'Build reliable services'},jobTitle:'Backend Engineer',canReview:true,canManage:false,emailStatus:[]};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(recruitmentRequest).mockResolvedValue(initial);});
afterEach(()=>vi.restoreAllMocks());
it.each(['technical','managerial','hr'])('opens a %s candidate as a page with accessible navigation and highlighted ratings',round=>{
  const close=vi.fn();render(<InterviewDialog initial={{...initial,round}} onClose={close} onChanged={vi.fn()} onReschedule={vi.fn()}/>);
  expect(screen.getByRole('region',{name:'Synthetic Candidate interview workspace'})).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Synthetic Candidate'})).toHaveFocus();
  fireEvent.click(screen.getByRole('tab',{name:'Reviews & decision'}));
  const ratings=screen.getByRole('group',{name:'Your ratings'});
  const criterion=round==='technical'?'Technical depth':round==='managerial'?'Leadership':'Culture fit';
  expect(within(ratings).getByRole('combobox',{name:`${criterion} rating`})).toBeVisible();
  expect(ratings.compareDocumentPosition(screen.getByLabelText('Candidate strengths'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Back to interviews'}));expect(close).toHaveBeenCalledOnce();
});
it('shows prior technical ratings before written feedback without inventing missing scores',()=>{
  const review={reviewId:'review',createdAt:'2026-11-03T08:00:00Z',round:'technical',decision:'advance',scorecard:{technicalDepth:5,problemSolving:4},strengths:'Detailed technical evidence',comments:'Ready for managerial interview'};
  render(<InterviewDialog initial={{...initial,round:'managerial',canReview:false,previousReviews:[review,{...review,reviewId:'missing',round:'managerial',scorecard:{}}]}} onClose={vi.fn()} onChanged={vi.fn()} onReschedule={vi.fn()}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Reviews & decision'}));
  const ratings=screen.getByRole('region',{name:'Technical review ratings'});
  expect(ratings).toHaveTextContent('Technical depth');expect(ratings).toHaveTextContent('5/ 5');
  expect(ratings.compareDocumentPosition(screen.getAllByText(/Detailed technical evidence/)[0])&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('No ratings recorded for this round.')).toBeVisible();
});
it('keeps score values in the existing review request and preserves the submitted lock',async()=>{
  const saved={...initial,status:'reviewed',canReview:false,review:{createdAt:'2026-11-03T08:00:00Z',round:'technical',decision:'advance',scorecard:{technicalDepth:5,problemSolving:3,communication:3},strengths:'Clear technical reasoning',comments:'Evidence supports the next round'}};
  vi.mocked(recruitmentRequest).mockResolvedValue(saved);
  const changed=vi.fn();render(<InterviewDialog initial={initial} onClose={vi.fn()} onChanged={changed} onReschedule={vi.fn()}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Reviews & decision'}));
  await chooseSelect(screen.getByRole('combobox',{name:'Technical depth rating'}),'5');
  fireEvent.change(screen.getByLabelText('Candidate strengths'),{target:{value:'Clear technical reasoning'}});
  fireEvent.change(screen.getByLabelText('Review reasons'),{target:{value:'Evidence supports the next round'}});
  fireEvent.submit(screen.getByRole('button',{name:'Submit review'}).closest('form')!);
  await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
  expect(recruitmentRequest).toHaveBeenCalledWith('/interviews/interview/review',expect.objectContaining({expectedRevision:2,scorecard:{technicalDepth:5,problemSolving:3,communication:3}}));
  expect(screen.queryByRole('button',{name:'Submit review'})).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Review submitted successfully'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'View submitted review'}));
  expect(screen.getByRole('region',{name:'Technical review ratings'})).toHaveTextContent('5/ 5');
});
it('protects unsaved feedback when returning to the interview list',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),close=vi.fn();
  render(<InterviewDialog initial={initial} onClose={close} onChanged={vi.fn()} onReschedule={vi.fn()}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Reviews & decision'}));
  fireEvent.change(screen.getByLabelText('Review reasons'),{target:{value:'Unsubmitted feedback'}});
  fireEvent.click(screen.getByRole('button',{name:'Back to interviews'}));
  expect(close).not.toHaveBeenCalled();expect(screen.getByLabelText('Review reasons')).toHaveValue('Unsubmitted feedback');
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Back to interviews'}));expect(close).toHaveBeenCalledOnce();
});
