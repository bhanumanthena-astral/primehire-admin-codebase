import React from 'react';
import {render, screen, fireEvent, waitFor, cleanup} from '@testing-library/react';
import {afterEach, beforeEach, describe, it, expect, vi} from 'vitest';
import {ResumeAtsRange} from '../ResumeAtsRange';
import {IntakeBatch, intakeMutate} from '../../lib/resumeIntakeApi';

vi.mock('../../lib/resumeIntakeApi',()=>({intakeMutate:vi.fn()}));
const batch: IntakeBatch = {batchId:'batch',jobId:'job',jobKey:'JOB',jobTitle:'Engineer',mode:'single',source:'local',status:'review_required',counts:{total:3},createdAt:'2026-10-22',importComplete:true,canSetAtsRange:true,atsRangeRevision:0};
afterEach(cleanup);
beforeEach(()=>{vi.mocked(intakeMutate).mockReset();});
describe('ATS range selection',()=>{
  it('requires an explicit save and supports lowering the minimum to 50 with two accessible thumbs',async()=>{
    vi.mocked(intakeMutate).mockResolvedValue({}); const saved=vi.fn();
    render(<ResumeAtsRange batch={batch} onSaved={saved}/>);
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getByRole('slider',{name:'Minimum ATS score'})).toHaveAttribute('aria-valuenow','60');
    expect(intakeMutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Minimum ATS percentage'),{target:{value:'50'}});
    fireEvent.click(screen.getByRole('button',{name:'Save range & score resumes'}));
    await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(intakeMutate).toHaveBeenCalledWith('/batches/batch/ats-range',{minimum:50,maximum:100,expectedRevision:0},'PUT');
  });
  it('keeps excluded counts visible and saves both endpoints using the current revision',async()=>{
    vi.mocked(intakeMutate).mockResolvedValue({});
    render(<ResumeAtsRange batch={{...batch,atsRange:{minimum:70,maximum:90},atsRangeRevision:4,atsStats:{within:1,below:1,above:1,pending:0}}} onSaved={()=>{}}/>);
    expect(screen.getByText(/Saved range:/)).toHaveTextContent('1 below · 1 above');
    expect(screen.getByText(/Resumes outside the range stay visible/)).toBeVisible();
    expect(screen.getByRole('button',{name:'Apply ATS range'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Minimum ATS percentage'),{target:{value:'50'}});
    fireEvent.change(screen.getByLabelText('Maximum ATS percentage'),{target:{value:'80'}});
    fireEvent.click(screen.getByRole('button',{name:'Apply ATS range'}));
    await waitFor(()=>expect(intakeMutate).toHaveBeenCalledWith('/batches/batch/ats-range',{minimum:50,maximum:80,expectedRevision:4},'PUT'));
  });
  it('shows stale-save errors and keeps the chosen range available for retry',async()=>{
    vi.mocked(intakeMutate).mockImplementation(async()=>{throw new Error('The ATS range changed. Refresh before saving.');});
    render(<ResumeAtsRange batch={batch} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Save range & score resumes'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before saving');
    expect(screen.getByRole('button',{name:'Save range & score resumes'})).toBeEnabled();
  });
  it('keeps range controls read-only for users who cannot change this upload',()=>{
    render(<ResumeAtsRange batch={{...batch,canSetAtsRange:false}} onSaved={()=>{}}/>);
    expect(screen.getByLabelText('Minimum ATS percentage')).toBeDisabled();
    expect(screen.queryByRole('button',{name:'Save range & score resumes'})).not.toBeInTheDocument();
  });
});
