import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {AdminHiringProgress} from '../AdminHiringProgress';
vi.mock('../../lib/authContext',()=>({useAuth:()=>({user:{role:'admin',orgId:'org',userId:'admin-a'}})}));
vi.mock('../HiringStageWorkspace',()=>({HiringStageWorkspace:({stage}:any)=><p>Workspace {stage}</p>}));
it('opens five steps and restores the admin job preference',()=>{
 localStorage.clear();
 const props={job:{jobId:'job-a',title:'Engineer',pipeline:{atsScored:12,resumesUploaded:20,atsProcessing:8}} as any,onChanged:vi.fn(),onJobChanged:vi.fn()};
 const view=render(<AdminHiringProgress {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:/2ATS screening/}));
 expect(screen.getByText('12 of 20 resumes scored')).toBeVisible();
 expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','60');
 view.unmount();render(<AdminHiringProgress {...props}/>);
 expect(screen.getByText('Workspace atsTotal')).toBeVisible();
});
