import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {JobResumeList} from '../JobResumeList';
import {intakeGet} from '../../lib/resumeIntakeApi';
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:vi.fn()}));
vi.mock('../ResumeReviewTable',()=>({ResumeReviewTable:({items}:any)=><div>{items.map((item:any)=><p key={item.itemId}>{item.fileName}</p>)}</div>}));

it('loads the whole job, paginates and resets pagination for ATS and search filters',async()=>{
  vi.mocked(intakeGet).mockImplementation(async path=>{
    const query=new URLSearchParams(path.split('?')[1]);
    return {items:[{itemId:'row',fileName:`Batch ${query.get('skip')}`}],total:query.get('atsOnly')==='true'?592:967} as any;
  });
  render(<JobResumeList jobId="job-a" reload={0} caps={{} as any} jobs={[]} busy={false} onOpen={vi.fn()} onRetry={vi.fn()} onDelete={vi.fn()} onChanged={vi.fn()} onAssociated={vi.fn()}/>);
  expect(await screen.findByText(/967 matching records across all batches/)).toBeVisible();
  expect(screen.getByRole('button',{name:'Next'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  expect(await screen.findByText('Batch 25')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(await screen.findByText(/Page 1 · 592 matching records/)).toBeVisible();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Candidate'}});
  await waitFor(()=>expect(intakeGet).toHaveBeenLastCalledWith('/jobs/job-a/items?skip=0&limit=25&q=Candidate&atsOnly=true',expect.any(AbortSignal)));
});
