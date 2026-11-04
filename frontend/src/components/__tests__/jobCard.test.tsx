import {chooseSelect} from '../../test-select';
import React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {JobCard} from '../JobCard';
import {JobAccessEditor} from '../JobAccessControls';
import {Job} from '../../lib/hiringApi';
import {User} from '../../lib/authTypes';

afterEach(cleanup);
const job={jobId:'one',jobKey:'JOB-ONE',title:'Platform Engineer',companyName:'Acme',jobRole:'Engineer',assigneeUserId:'owner',lifecycleStatus:'OPEN',closesAt:'2099-01-01T00:00:00Z',positionsTotal:3,positionsRemaining:2} as Job;
const user={userId:'owner',role:'recruiter',jobAccess:['view','upload']} as User;
function show(patch:Partial<Job>={},person:User=user,onStatus=vi.fn()) {
  render(<JobCard job={{...job,...patch}} user={person} count={7} busy={false} onView={vi.fn()} onUpload={vi.fn()} onEdit={vi.fn()} onAccess={vi.fn()} onStatus={onStatus}/>);
}
describe('permission-aware job cards',()=>{
  it('shows open assigned opportunities and upload, but no edit or status control',()=>{
    show();expect(screen.getByRole('button',{name:'Upload resumes'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Open workspace'})).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit Platform Engineer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Change status for Platform Engineer')).not.toBeInTheDocument();
  });
  it.each(['DRAFT','ON_HOLD','CLOSED','ARCHIVED'])('keeps %s assigned jobs read-only without view/upload actions',state=>{
    show({lifecycleStatus:state});
    expect(screen.queryByRole('button',{name:'Upload resumes'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Open workspace'})).not.toBeInTheDocument();
    expect(screen.getByText(/Resume uploads are unavailable/)).toBeInTheDocument();
  });
  it('honors per-job restrictions and expired closing dates',()=>{
    show({assigneeAccess:['view']});expect(screen.queryByRole('button',{name:'Upload resumes'})).not.toBeInTheDocument();
    cleanup();show({closesAt:'2000-01-01T00:00:00Z'});expect(screen.queryByRole('button',{name:'Upload resumes'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Open workspace'})).toBeInTheDocument();
    expect(screen.queryByText(/This job is archived/)).not.toBeInTheDocument();
    cleanup();show({positionsRemaining:0});
    expect(screen.queryByRole('button',{name:'Upload resumes'})).not.toBeInTheDocument();
    expect(screen.getByText(/All positions are filled/)).toBeInTheDocument();
  });
  it('requires confirmation before an administrator changes status',async ()=>{
    const change=vi.fn();show({}, {...user,role:'super_admin'},change);
    await chooseSelect(screen.getByLabelText('Change status for Platform Engineer'), 'ON_HOLD');
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Confirm status change'}));
    expect(change).toHaveBeenCalledWith('ON_HOLD');
  });
  it('clears dependent permissions when view is revoked',()=>{
    const change=vi.fn();render(<JobAccessEditor value={['view','edit','upload']} onChange={change}/>);
    fireEvent.click(screen.getByRole('checkbox',{name:/View assigned jobs/}));expect(change).toHaveBeenCalledWith([]);
  });
});
