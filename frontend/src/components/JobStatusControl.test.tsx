import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {JobStatusControl} from './JobStatusControl';
import type {Job} from '../lib/hiringApi';
import {chooseSelect} from '../test-select';
const archived={jobId:'test-job',title:'Backend Developer',lifecycleStatus:'ARCHIVED'} as Job;

it('shows every lifecycle status for an archived job and explains unavailable transitions',async()=>{
 render(<JobStatusControl job={archived} busy={false} canRestoreArchived onChange={vi.fn()}/>);
 fireEvent.click(screen.getByRole('combobox',{name:'Change status for Backend Developer'}));
 expect(await screen.findAllByRole('option')).toHaveLength(5);
 for(const name of ['Draft','On hold','Closed'])expect(screen.getByRole('option',{name})).toHaveAttribute('aria-disabled','true');
 expect(screen.getByRole('option',{name:'Open · accepting resumes'})).not.toHaveAttribute('aria-disabled','true');
 expect(screen.getByText(/Reopen this archived job/)).toBeVisible();
});
it('still requires confirmation before restoring and does not mutate status on selection',async()=>{
 const change=vi.fn();render(<JobStatusControl job={archived} busy={false} canRestoreArchived onChange={change}/>);
 await chooseSelect(screen.getByRole('combobox'),'OPEN');
 expect(await screen.findByRole('heading',{name:'Restore archived job?'})).toBeVisible();expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm status change'}));expect(change).toHaveBeenCalledWith('OPEN');
});
it('does not grant archived restoration to a regular administrator',()=>{
 render(<JobStatusControl job={archived} busy={false} onChange={vi.fn()}/>);
 expect(screen.getByRole('combobox')).toBeDisabled();expect(screen.getByText(/Ask a Super Admin/)).toBeVisible();
});
