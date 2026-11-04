import React,{useState} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,render,screen} from '@testing-library/react';
import {useAssessmentRefresh} from '../useAssessmentRefresh';
import {assessmentScoreLabel,assessmentStatusLabel} from '../../lib/assessmentProgress';
import {Application,recruitmentRequest} from '../../lib/recruitmentApi';
vi.mock('../../lib/recruitmentApi',()=>({recruitmentRequest:vi.fn()}));
const row=(status='link_created',score?:number):Application=>({applicationId:'one',applicantId:'person',jobId:'job',
  currentStage:'SHORTLISTED',createdAt:'',candidate:{applicantId:'person',name:'Synthetic',email:'',phone:''},assessment:{status,score}});
const errors=vi.fn();
function Probe({initial=[row()],paused=false}:{initial?:Application[];paused?:boolean}){
  const [items,setItems]=useState(initial);
  useAssessmentRefresh(items,'/applications?jobId=job',0,paused,value=>setItems([...value.items]),errors);
  return <p>{items.map(assessmentScoreLabel).join(',')}</p>;
}
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  vi.mocked(recruitmentRequest).mockImplementation(async()=>({items:[row()],total:1}) as any);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it('does not poll every 5/10 seconds and backs unchanged responses off to 60 then 120 seconds',async()=>{
  render(<Probe/>);
  await act(()=>vi.advanceTimersByTimeAsync(29_999));expect(recruitmentRequest).not.toHaveBeenCalled();
  await act(()=>vi.advanceTimersByTimeAsync(1));expect(recruitmentRequest).toHaveBeenCalledTimes(1);
  await act(()=>vi.advanceTimersByTimeAsync(59_999));expect(recruitmentRequest).toHaveBeenCalledTimes(1);
  await act(()=>vi.advanceTimersByTimeAsync(1));expect(recruitmentRequest).toHaveBeenCalledTimes(2);
  await act(()=>vi.advanceTimersByTimeAsync(119_999));expect(recruitmentRequest).toHaveBeenCalledTimes(2);
  await act(()=>vi.advanceTimersByTimeAsync(1));expect(recruitmentRequest).toHaveBeenCalledTimes(3);
});

it('pauses in a hidden tab and cancels an in-flight refresh when hidden',async()=>{
  const getter=vi.spyOn(document,'visibilityState','get');getter.mockReturnValue('hidden');
  render(<Probe/>);await act(()=>vi.advanceTimersByTimeAsync(120_000));expect(recruitmentRequest).not.toHaveBeenCalled();
  getter.mockReturnValue('visible');act(()=>document.dispatchEvent(new Event('visibilitychange')));
  vi.mocked(recruitmentRequest).mockReturnValue(new Promise(()=>{}));
  await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(recruitmentRequest).toHaveBeenCalledOnce();
  const signal=vi.mocked(recruitmentRequest).mock.calls[0][3];
  getter.mockReturnValue('hidden');act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(signal?.aborted).toBe(true);await act(()=>vi.advanceTimersByTimeAsync(120_000));expect(recruitmentRequest).toHaveBeenCalledOnce();
});

it('stops once results are complete and preserves a score of zero',async()=>{
  vi.mocked(recruitmentRequest).mockResolvedValue({items:[row('Completed',0)],total:1});
  render(<Probe/>);await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(screen.getByText('0')).toBeVisible();
  await act(()=>vi.advanceTimersByTimeAsync(240_000));expect(recruitmentRequest).toHaveBeenCalledOnce();
});

it('does not poll while a list load or candidate action is in progress',async()=>{
  render(<Probe paused/>);await act(()=>vi.advanceTimersByTimeAsync(300_000));expect(recruitmentRequest).not.toHaveBeenCalled();
});

it.each([['send_requested','Generating link','Generating link'],['link_created','Link ready','Not attempted'],
  ['In progress','In progress','In progress'],['Report pending','Report pending','Pending']])(
  'shows %s without claiming an invitation was sent or inventing a score',(status,label,score)=>{
    expect(assessmentStatusLabel(row(status))).toBe(label);expect(assessmentScoreLabel(row(status))).toBe(score);
  });
