import React from 'react';
import {beforeEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {UsersManagementPage} from './UsersManagementPage';
import {authFetch} from '../lib/authFetch';

vi.mock('../lib/authContext',()=>({useAuth:()=>({user:{userId:'admin-test',role:'admin'},viewAs:vi.fn()})}));
vi.mock('../lib/authFetch',()=>({authFetch:vi.fn()}));
const pending={userId:'pending-test',email:'pending@example.test',name:'Pending Member',role:'hr',isActive:true,passwordSetupRequired:true};

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(authFetch).mockImplementation(async (_path,options)=>new Response(JSON.stringify(
    options?.method==='POST' ? {user:pending,inviteUrl:'/accept-invite#token=synthetic-invite-token'} : [pending]
  ),{status:options?.method==='POST'?201:200}));
});

it('shows a public-domain invitation after inviting a member from the local admin UI',async()=>{
  render(<UsersManagementPage/>);
  await screen.findByText('Pending Member');
  fireEvent.click(screen.getByRole('button',{name:'Invite Member'}));
  fireEvent.change(screen.getByPlaceholderText('Jane Doe'),{target:{value:'New Member'}});
  fireEvent.change(screen.getByPlaceholderText('jane@company.com'),{target:{value:'new@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:'Generate Invitation'}));
  expect(await screen.findByDisplayValue('https://elitehr.vils.ai/accept-invite#token=synthetic-invite-token')).toBeVisible();
});

it('uses the same public domain when generating a replacement invitation',async()=>{
  render(<UsersManagementPage/>);
  fireEvent.click(await screen.findByRole('button',{name:'New invitation'}));
  expect(await screen.findByDisplayValue('https://elitehr.vils.ai/accept-invite#token=synthetic-invite-token')).toBeVisible();
  expect(authFetch).toHaveBeenCalledWith('/api/users/pending-test/invite',{method:'POST'});
});
