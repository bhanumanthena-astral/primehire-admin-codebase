import {fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import McqAnswerReview from '../report/McqAnswerReview';
import {normalizeMcq} from '../../utils/mcqReport';
import {QuestionVideo,ReportVideoProvider} from '../report/StoredReportEvidence';
import {reportingResponse} from '../../lib/reportingApi';
vi.mock('../../lib/reportingApi',()=>({reportingResponse:vi.fn()}));
beforeEach(()=>{
 vi.mocked(reportingResponse).mockReset();
 URL.createObjectURL=vi.fn(()=> 'blob:authorized-video');URL.revokeObjectURL=vi.fn();
});
it('shows all options and explicit labels for incorrect answers',()=>{
 render(<McqAnswerReview result={normalizeMcq({options:['Google','OpenAI'],option_id:'A',correct_option_id:'B',is_result_generated:true})}/>);
 const options=within(screen.getByRole('list',{name:'Answer options'})).getAllByRole('listitem');
 expect(options).toHaveLength(2);
 expect(options[0]).toHaveClass('bg-rose-50');expect(options[1]).toHaveClass('bg-emerald-50');
 expect(screen.getByText('Candidate’s selection')).toBeVisible();expect(screen.getByText('Correct answer')).toBeVisible();
});
it('keeps pending results neutral even when a correct ID is present',()=>{
 render(<McqAnswerReview result={normalizeMcq({options:['One','Two'],optionId:'A',correctOptionId:'A'})}/>);
 expect(screen.getByText('Awaiting evaluation')).toBeVisible();
 expect(screen.queryByText('Selected · Correct answer')).not.toBeInTheDocument();
 expect(screen.getByText('This answer has not been evaluated yet.')).toBeVisible();
});
it('preloads videos through the version-scoped endpoint without autoplay',async()=>{
 URL.createObjectURL=vi.fn(()=> 'blob:authorized-video');URL.revokeObjectURL=vi.fn();
 vi.mocked(reportingResponse).mockImplementation(async()=>new Response(new Blob(['video'],{type:'video/mp4'})));
 render(<QuestionVideo reportId="report" version={3} reference="q1"/>);
 expect(await screen.findByLabelText('Authorized question video')).not.toHaveAttribute('autoplay');
 expect(reportingResponse).toHaveBeenCalledWith('/reports/report/media/q1?version=3',undefined,expect.any(AbortSignal));
});

it('retries an interrupted video download, including a failed response body',async()=>{
 vi.mocked(reportingResponse)
  .mockRejectedValueOnce(new TypeError('Failed to fetch'))
  .mockResolvedValueOnce({blob:()=>Promise.reject(new TypeError('Failed to fetch'))} as Response)
  .mockResolvedValueOnce(new Response(new Blob(['video'],{type:'video/webm'})));
 render(<QuestionVideo reportId="report" version={3} reference="q1"/>);
 expect(await screen.findByLabelText('Authorized question video',{}, {timeout:3000})).toHaveAttribute('src','blob:authorized-video');
 expect(reportingResponse).toHaveBeenCalledTimes(3);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('limits automatic retries and allows the user to retry a recovered connection',async()=>{
 vi.mocked(reportingResponse).mockRejectedValue(new TypeError('Failed to fetch'));
 render(<QuestionVideo reportId="report" version={3} reference="q1"/>);
 expect(await screen.findByRole('alert',{}, {timeout:3000})).toHaveTextContent('video download was interrupted');
 expect(reportingResponse).toHaveBeenCalledTimes(3);
 vi.mocked(reportingResponse).mockResolvedValue(new Response(new Blob(['video'])));
 fireEvent.click(screen.getByRole('button',{name:'Retry video'}));
 expect(await screen.findByLabelText('Authorized question video')).toBeVisible();
 expect(reportingResponse).toHaveBeenCalledTimes(4);
});

it('does not retry permission failures or requests cancelled when leaving the report',async()=>{
 vi.mocked(reportingResponse).mockRejectedValue(new Error('Forbidden'));
 const first=render(<QuestionVideo reportId="report" version={3} reference="q1"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
 expect(reportingResponse).toHaveBeenCalledTimes(1);
 first.unmount();
 vi.mocked(reportingResponse).mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
 const second=render(<QuestionVideo reportId="report" version={3} reference="q1"/>);
 await waitFor(()=>expect(reportingResponse).toHaveBeenCalledTimes(1));
 second.unmount();
 await new Promise(resolve=>setTimeout(resolve,400));
 expect(reportingResponse).toHaveBeenCalledTimes(1);
});

it('clears the previous recording when the report version changes',async()=>{
 vi.mocked(reportingResponse).mockImplementation(async()=>new Response(new Blob(['video'],{type:'video/mp4'})));
 const view=render(<QuestionVideo reportId="report" version={1} reference="q1"/>);
 await screen.findByLabelText('Authorized question video');
 view.rerender(<QuestionVideo reportId="report" version={2} reference="q1"/>);
 expect(screen.queryByLabelText('Authorized question video')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Loading video'})).toBeVisible();
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authorized-video');
 expect(reportingResponse).toHaveBeenCalledTimes(2);
 await screen.findByLabelText('Authorized question video');
});

it('reuses report preloads when a question review mounts and cancels on close',async()=>{
 vi.mocked(reportingResponse).mockImplementation(async()=>new Response(new Blob(['video'])));
 const view=render(<ReportVideoProvider><QuestionVideo reportId="report" version={1} reference="q1"/></ReportVideoProvider>);
 await screen.findByLabelText('Authorized question video');
 view.rerender(<ReportVideoProvider><QuestionVideo reportId="report" version={1} reference="q1"/><QuestionVideo reportId="report" version={1} reference="q1"/></ReportVideoProvider>);
 await waitFor(()=>expect(screen.getAllByLabelText('Authorized question video')).toHaveLength(2));
 expect(reportingResponse).toHaveBeenCalledTimes(1);
 const signal=vi.mocked(reportingResponse).mock.calls[0][2];
 view.unmount();
 expect(signal?.aborted).toBe(true);
 expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('does not request media for questions without a recording',()=>{
 render(<QuestionVideo reportId="report" version={1} reference={null}/>);
 expect(reportingResponse).not.toHaveBeenCalled();
});
