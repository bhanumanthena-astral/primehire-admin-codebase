import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import McqAnswerReview from '../report/McqAnswerReview';
import {normalizeMcq} from '../../utils/mcqReport';
import {QuestionVideo} from '../report/StoredReportEvidence';
import {reportingResponse} from '../../lib/reportingApi';
vi.mock('../../lib/reportingApi',()=>({reportingResponse:vi.fn()}));
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
it('loads videos only on request through the version-scoped endpoint',async()=>{
 URL.createObjectURL=vi.fn(()=> 'blob:authorized-video');URL.revokeObjectURL=vi.fn();
 vi.mocked(reportingResponse).mockResolvedValue(new Response(new Blob(['video'],{type:'video/mp4'})));
 render(<QuestionVideo reportId="report" version={3} reference="q1"/>);
 expect(reportingResponse).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Load authorized video'}));
 expect(await screen.findByLabelText('Authorized question video')).toHaveAttribute('controls');
 expect(reportingResponse).toHaveBeenCalledWith('/reports/report/media/q1?version=3',undefined,expect.any(AbortSignal));
});
