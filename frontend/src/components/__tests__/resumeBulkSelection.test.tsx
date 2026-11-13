import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ResumeBulkSelection} from '../ResumeBulkSelection';
import {intakeGet,intakeMutate} from '../../lib/resumeIntakeApi';
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:vi.fn(),intakeMutate:vi.fn()}));
const first:any={itemId:'i1',fileName:'unsupported.txt',revision:2,status:'unsupported_format',profile:{}};
const second:any={...first,itemId:'i2',fileName:'other.txt',revision:4};
const changed=vi.fn();
function show(enabled=true){return render(<ResumeBulkSelection batchId="batch-a" query="status=unsupported_format" items={[first]} total={2} enabled={enabled} onChanged={changed}>{selection=><>{selection&&<input type="checkbox" aria-label="Select page" checked={selection.ids.has('i1')} onChange={selection.togglePage}/>}</>}</ResumeBulkSelection>);}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(intakeGet).mockImplementation(async path=>({items:String(path).includes('skip=0')?[first]:[second],total:2} as any));vi.mocked(intakeMutate).mockResolvedValue({deleted:true});});
it('selects matching resumes across pages and deletes only after confirmation',async()=>{
 show();fireEvent.click(screen.getByRole('button',{name:'Select all matching resumes'}));
 expect(await screen.findByText('2 selected across all pages')).toBeVisible();
 expect(intakeGet).toHaveBeenCalledWith('/batches/batch-a?status=unsupported_format&skip=1&limit=100');
 fireEvent.click(screen.getByRole('button',{name:'Delete selected resumes'}));
 expect(intakeMutate).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Confirm deletion'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Bulk deletion reason'),{target:{value:'Remove unsupported uploads'}});
 fireEvent.click(screen.getByRole('button',{name:'Confirm deletion'}));
 expect(await screen.findByText('2 resumes deleted.')).toBeVisible();
 expect(intakeMutate).toHaveBeenCalledWith('/items/i1',{reason:'Remove unsupported uploads',expectedRevision:2},'DELETE');
 expect(intakeMutate).toHaveBeenCalledWith('/items/i2',{reason:'Remove unsupported uploads',expectedRevision:4},'DELETE');
 expect(changed).toHaveBeenCalledOnce();
});
it('allows page selection, cancel and clearing without deleting',()=>{
 show();fireEvent.click(screen.getByLabelText('Select page'));expect(screen.getByText('1 selected across all pages')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Delete selected resumes'}));fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 fireEvent.click(screen.getByRole('button',{name:'Clear selection'}));expect(screen.getByText('0 selected across all pages')).toBeVisible();expect(intakeMutate).not.toHaveBeenCalled();
});
it('reports partial failure and keeps failed selections',async()=>{
 vi.mocked(intakeMutate).mockRejectedValueOnce(new Error('Resume changed. Refresh before deleting.'));
 show();fireEvent.click(screen.getByRole('button',{name:'Select all matching resumes'}));await screen.findByText('2 selected across all pages');
 fireEvent.click(screen.getByRole('button',{name:'Delete selected resumes'}));fireEvent.change(screen.getByLabelText('Bulk deletion reason'),{target:{value:'Remove unsupported uploads'}});fireEvent.click(screen.getByRole('button',{name:'Confirm deletion'}));
 expect(await screen.findByText('1 resume deleted. 1 could not be deleted. Refresh before retrying.')).toBeVisible();
 expect(screen.getByRole('alert')).toHaveTextContent('unsupported.txt: Resume changed.');expect(screen.getByText('1 selected across all pages')).toBeVisible();
});
it('does not offer deletion to accounts without admin capabilities',()=>{show(false);expect(screen.queryByRole('button',{name:'Delete selected resumes'})).not.toBeInTheDocument();});
