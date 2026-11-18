import React from 'react';
import {beforeEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {CompanySettingsDialog} from '../CompanySettingsDialog';
import {authFetch} from '../../lib/authFetch';

vi.mock('../../lib/authFetch',()=>({authFetch:vi.fn()}));
const saved={revision:3,enabledPermissions:['jobs.view','jobs.manage'],email:{mode:'custom',fromAddress:'hr@alpha.test',fromName:'Alpha',apiKeyConfigured:true}};
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(authFetch).mockImplementation(async (_path,options)=>new Response(JSON.stringify(
    options?.method==='PUT'?{...saved,revision:4}:saved
  )));
});
function open(){return render(<CompanySettingsDialog company={{orgId:'alpha',name:'Alpha'}} catalog={['jobs.view','jobs.manage']} onClose={vi.fn()}/>);}

it('retains a saved key without returning or resubmitting it, and saves company permissions',async()=>{
  open();
  const token=await screen.findByLabelText('ZeptoMail Send Mail token');
  expect(token).toHaveValue('');
  expect(token).toHaveAttribute('type','password');
  fireEvent.click(screen.getByRole('checkbox',{name:/jobs manage/i}));
  fireEvent.click(screen.getByRole('button',{name:'Save company settings'}));
  await screen.findByText(/Company settings saved/);
  const request=vi.mocked(authFetch).mock.calls.find(([,options])=>options?.method==='PUT');
  expect(request?.[0]).toBe('/api/companies/alpha/settings');
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({expectedRevision:3,enabledPermissions:['jobs.view'],email:{mode:'custom',fromAddress:'hr@alpha.test',fromName:'Alpha',clearApiKey:false}});
});

it('clears the token input after replacing credentials',async()=>{
  open();
  const token=await screen.findByLabelText('ZeptoMail Send Mail token');
  fireEvent.change(token,{target:{value:'synthetic-new-key'}});
  fireEvent.click(screen.getByRole('button',{name:'Save company settings'}));
  await screen.findByText(/Company settings saved/);
  expect(token).toHaveValue('');
  const request=vi.mocked(authFetch).mock.calls.find(([,options])=>options?.method==='PUT');
  expect(JSON.parse(String(request?.[1]?.body)).email.apiKey).toBe('synthetic-new-key');
});

it('allows removing a stored token only after disabling delivery',async()=>{
  const user=userEvent.setup(); open();
  await screen.findByLabelText('ZeptoMail Send Mail token');
  await user.click(screen.getByRole('combobox',{name:'Email delivery'}));
  await user.click(screen.getByRole('option',{name:/^Disabled$/}));
  await user.click(screen.getByRole('checkbox',{name:'Remove saved API key'}));
  await user.click(screen.getByRole('button',{name:'Save company settings'}));
  await screen.findByText(/Company settings saved/);
  const request=vi.mocked(authFetch).mock.calls.find(([,options])=>options?.method==='PUT');
  expect(JSON.parse(String(request?.[1]?.body)).email).toMatchObject({mode:'disabled',clearApiKey:true});
});

it('reports conflicts without claiming a save and aborts loading on unmount',async()=>{
  vi.mocked(authFetch).mockImplementation(async (_path,options)=>new Response(JSON.stringify(
    options?.method==='PUT'?{detail:'Company settings changed. Reopen settings and try again.'}:saved
  ),{status:options?.method==='PUT'?409:200}));
  const view=open();
  await screen.findByLabelText('ZeptoMail Send Mail token');
  fireEvent.click(screen.getByRole('button',{name:'Save company settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Company settings changed');
  expect(screen.queryByText(/Company settings saved/)).not.toBeInTheDocument();
  const signal=vi.mocked(authFetch).mock.calls[0][1]?.signal;
  view.unmount();
  await waitFor(()=>expect(signal?.aborted).toBe(true));
});
