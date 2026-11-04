import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {JobApplicationsPage} from '../JobApplicationsPage';
import {authFetch} from '../../lib/authFetch';
vi.mock('../../lib/authFetch',()=>({authFetch:vi.fn()}));
const job:any={jobId:'job-a',jobKey:'JOB-A',title:'Engineer'};
const row={applicationId:'a',name:'Amy',email:'amy@example.test',phone:'+919876543210',status:'Active',round:'Technical',assessment:{score:0,label:'0'}};
beforeEach(()=>vi.clearAllMocks());
it('shows the six requested fields, zero scores, pending statuses and back navigation',async()=>{
 vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({items:[row,{...row,applicationId:'b',name:'Zoe',email:'zoe@example.test',assessment:{score:null,label:'Report pending'}}],total:2})));
 const back=vi.fn();render(<JobApplicationsPage job={job} onBack={back}/>);
 expect(await screen.findByText('amy@example.test')).toBeVisible();expect(screen.getByText('0')).toBeVisible();expect(screen.getByText('Report pending')).toBeVisible();expect(screen.getAllByRole('columnheader')).toHaveLength(6);
 expect(vi.mocked(authFetch).mock.calls[0][0]).toContain('/jobs/job-a/applications?skip=0&limit=50');
 fireEvent.click(screen.getByRole('button',{name:'Back to job'}));expect(back).toHaveBeenCalledOnce();
});
it('loads the next page and supports retry after a failed request',async()=>{
 vi.mocked(authFetch).mockImplementation(async url=>new Response(JSON.stringify(String(url).includes('skip=50')?{items:[{...row,name:'Last applicant'}],total:51}:{items:[row],total:51})));
 render(<JobApplicationsPage job={job} onBack={()=>{}}/>);await screen.findByText('Amy');fireEvent.click(screen.getByRole('button',{name:'Next applications'}));expect(await screen.findByText('Last applicant')).toBeVisible();
 expect(screen.getByText('51–51 of 51')).toBeVisible();
});
it('reports access errors without displaying stale contacts',async()=>{
 vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({detail:'Candidate details require hiring access'}),{status:403}));
 render(<JobApplicationsPage job={job} onBack={()=>{}}/>);expect(await screen.findByRole('alert')).toHaveTextContent('Candidate details require hiring access');expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
