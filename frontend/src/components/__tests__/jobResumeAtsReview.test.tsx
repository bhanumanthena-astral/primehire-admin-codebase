import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {JobResumeAtsReview} from '../JobResumeAtsReview';
import {intakeGet,intakeMutate} from '../../lib/resumeIntakeApi';
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:vi.fn(),intakeMutate:vi.fn()}));
it('applies a range across batches and requires explicit approval before creating profiles',async()=>{
 const data={snapshot:'a'.repeat(64),batches:63,range:{minimum:60,maximum:100},counts:{total:375,within:120},running:false,importing:false};
 vi.mocked(intakeGet).mockResolvedValue(data);vi.mocked(intakeMutate).mockResolvedValue(data);
 render(<JobResumeAtsReview jobId="backend" reload={0} onChanged={vi.fn()}/>);
 await screen.findByText(/375 resumes · 63 batches/);
 const create=screen.getByRole('button',{name:'Create profiles across all batches'});
 expect(create).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Apply ATS range to all batches'}));
 await waitFor(()=>expect(intakeMutate).toHaveBeenCalledWith('/jobs/backend/ats-review',{minimum:60,maximum:100,expectedSnapshot:data.snapshot,reviewed:false},'PUT'));
 await screen.findByText(/ATS range saved across 63/);
 fireEvent.click(screen.getByRole('checkbox'));
 expect(create).toBeEnabled();fireEvent.click(create);
 await waitFor(()=>expect(intakeMutate).toHaveBeenCalledWith('/jobs/backend/ats-review/confirm',{minimum:60,maximum:100,expectedSnapshot:data.snapshot,reviewed:true}));
});
