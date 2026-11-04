import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {CandidateProfileForm} from '../candidates/CandidateProfileForm';
import {CandidateDirectory} from '../candidates/CandidateDirectory';
import {candidateRequest,CandidateManagementError,isoIST,inputIST} from '../../lib/candidateManagementApi';
vi.mock('../../lib/candidateManagementApi',async original=>({...await original<any>(),candidateRequest:vi.fn()}));
beforeEach(()=>{vi.mocked(candidateRequest).mockReset();});

it('submits the edit form, preserves values on a revision conflict, and never sends the candidate ID as an editable field',async()=>{
  vi.mocked(candidateRequest).mockRejectedValue(new CandidateManagementError('Candidate changed; refresh before saving',409));
  const person:any={candidateId:'person-test',revision:3,profile:{name:'Test Candidate',email:'synthetic@example.test',phone:''}};
  const saved=vi.fn();render(<CandidateProfileForm person={person} initial={person.profile} onCancel={vi.fn()} onSaved={saved}/>);
  fireEvent.change(screen.getByLabelText('Current designation'),{target:{value:'Platform Engineer'}});
  fireEvent.click(screen.getByRole('button',{name:'Save candidate details'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Candidate changed');
  expect(screen.getByLabelText('Current designation')).toHaveValue('Platform Engineer');
  const body:any=vi.mocked(candidateRequest).mock.calls[0][1];expect(body.expectedRevision).toBe(3);expect(body.profile.candidateId).toBeUndefined();expect(saved).not.toHaveBeenCalled();
});

it('shows backend field-level errors while retaining the failed form',async()=>{
  vi.mocked(candidateRequest).mockRejectedValue(new CandidateManagementError('Phone must contain 7–15 digits',422,{phone:'Phone must contain 7–15 digits'}));
  const person:any={candidateId:'person-test',revision:1,profile:{name:'Test Candidate',email:'synthetic@example.test',phone:'123'}};
  render(<CandidateProfileForm person={person} initial={person.profile} onCancel={vi.fn()} onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Save candidate details'}));await screen.findByRole('alert');
  expect(screen.getByLabelText('Phone number')).toHaveAttribute('aria-invalid','true');expect(screen.getByLabelText('Phone number')).toHaveValue('123');
});

it('paginates without a mount-time search debounce resetting the page',async()=>{
  vi.mocked(candidateRequest).mockResolvedValue({items:[],total:23});render(<CandidateDirectory/>);
  await screen.findByText('No candidate profiles are available. Candidates appear here after an authorized creation or resume confirmation.');
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  await waitFor(()=>expect(vi.mocked(candidateRequest).mock.calls.some(([path])=>path?.includes('skip=20'))).toBe(true));
  await new Promise(resolve=>setTimeout(resolve,350));expect(screen.getByText('Page 2')).toBeVisible();
});

it('represents IST assignment input as an explicit UTC instant',()=>{
  expect(isoIST('2027-01-01T10:00')).toBe('2027-01-01T04:30:00.000Z');expect(inputIST('2027-01-01T04:30:00Z')).toBe('2027-01-01T10:00');
  expect(inputIST('2027-01-01T04:30:00')).toBe('2027-01-01T10:00');
});

it('preserves a comma inside one preferred location when editing another profile field',async()=>{
  vi.mocked(candidateRequest).mockResolvedValue({});
  const person:any={candidateId:'person-test',revision:0,profile:{name:'Test Candidate',email:'synthetic@example.test',phone:'',preferredLocations:['New York, NY','Hyderabad']}};
  render(<CandidateProfileForm person={person} initial={person.profile} onCancel={vi.fn()} onSaved={vi.fn()}/>);
  expect(screen.getByLabelText('Preferred locations (one per line)')).toHaveValue('New York, NY\nHyderabad');
  fireEvent.click(screen.getByRole('button',{name:'Save candidate details'}));
  await waitFor(()=>expect(candidateRequest).toHaveBeenCalled());
  expect((vi.mocked(candidateRequest).mock.calls[0][1] as any).profile.preferredLocations).toEqual(['New York, NY','Hyderabad']);
});
