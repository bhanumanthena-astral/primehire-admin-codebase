import React from 'react';
import {beforeEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {UsersManagementPage} from './UsersManagementPage';
import {authFetch} from '../lib/authFetch';

const actor=vi.hoisted(()=>({userId:'admin-test',orgId:'default',role:'admin'}));
vi.mock('../lib/authContext',()=>({useAuth:()=>({user:actor,viewAs:vi.fn()})}));
vi.mock('../lib/authFetch',()=>({authFetch:vi.fn()}));
const pending={userId:'pending-test',email:'pending@example.test',name:'Pending Member',role:'hr',isActive:true,passwordSetupRequired:true};

it('restricts company settings controls to the super admin',async()=>{
  const regular=render(<UsersManagementPage/>);
  await screen.findByText('Pending Member');
  expect(screen.queryByRole('button',{name:'Company settings'})).not.toBeInTheDocument();
  regular.unmount();
  actor.role='super_admin';
  render(<UsersManagementPage/>);
  expect(await screen.findByRole('button',{name:'Company settings'})).toBeVisible();
});

beforeEach(()=>{
  actor.role='admin';
  vi.clearAllMocks();
  vi.mocked(authFetch).mockImplementation(async (_path,options)=>new Response(JSON.stringify(
    _path==='/api/companies' ? {companies:[{orgId:'default',name:'Nxtagent AI',members:[pending]}],catalog:[],granted:['users.manage'],pending:[]} :
    options?.method==='POST' ? {user:pending,inviteUrl:'/accept-invite#token=synthetic-invite-token'} : [pending]
  ),{status:options?.method==='POST'?201:200}));
});

it('creates a company by clicking the button, then invites a member into that company',async()=>{
  actor.role='super_admin';
  const user=userEvent.setup();
  const companies=[{orgId:'default',name:'Home',members:[] as typeof pending[]}];
  vi.mocked(authFetch).mockImplementation(async (path,options)=>{
    if (path==='/api/companies'&&options?.method==='POST') {
      companies.push({orgId:'new-company',name:'New Company',members:[]});
      return new Response(JSON.stringify({orgId:'new-company',name:'New Company'}),{status:201});
    }
    if (path==='/api/companies') return new Response(JSON.stringify({companies,catalog:[],granted:['users.manage'],pending:[]}));
    if (path==='/api/users'&&options?.method==='POST') return new Response(JSON.stringify({inviteUrl:'/accept-invite#token=new-company-invite'}),{status:201});
    return new Response('[]');
  });
  render(<UsersManagementPage/>);
  await user.type(await screen.findByRole('textbox',{name:'Company name'}),'New Company');
  await user.click(screen.getByRole('button',{name:'Create company'}));
  await waitFor(()=>expect(authFetch).toHaveBeenCalledWith('/api/companies',expect.objectContaining({method:'POST',body:JSON.stringify({name:'New Company'})})));
  const company=await screen.findByRole('region',{name:'New Company'});
  await user.click(within(company).getByRole('button',{name:'Add member'}));
  expect(screen.getByLabelText('Company',{exact:true})).toHaveValue('new-company');
  await user.type(screen.getByPlaceholderText('Jane Doe'),'New HR');
  await user.type(screen.getByPlaceholderText('jane@company.com'),'newhr@example.test');
  await user.click(screen.getByRole('button',{name:'Generate Invitation'}));
  await screen.findByDisplayValue('https://elitehr.vils.ai/accept-invite#token=new-company-invite');
  const request=vi.mocked(authFetch).mock.calls.find(([path,options])=>path==='/api/users'&&options?.method==='POST');
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({orgId:'new-company',role:'hr',email:'newhr@example.test'});
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

it('invites a leadership account with its dedicated read-only workspace',async()=>{
  const user=userEvent.setup();
  render(<UsersManagementPage/>);
  await screen.findByText('Pending Member');
  fireEvent.click(screen.getByRole('button',{name:'Invite Member'}));
  await user.click(screen.getByRole('combobox',{name:'Role'}));
  await user.click(screen.getByRole('option',{name:'Leadership (Hiring Intelligence)'}));
  expect(await screen.findByText(/Dedicated leadership dashboard with read-only hiring metrics/)).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Jane Doe'),{target:{value:'Leadership Member'}});
  fireEvent.change(screen.getByPlaceholderText('jane@company.com'),{target:{value:'leader@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:'Generate Invitation'}));
  await screen.findByDisplayValue('https://elitehr.vils.ai/accept-invite#token=synthetic-invite-token');
  const request=vi.mocked(authFetch).mock.calls.find(([path,options])=>path==='/api/users'&&options?.method==='POST');
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({role:'leadership',jobAccess:[]});
});

it('invites an administrator into the selected company with exactly the checked permissions',async()=>{
  actor.role='super_admin';
  const user=userEvent.setup();
  vi.mocked(authFetch).mockImplementation(async (path,options)=>new Response(JSON.stringify(
    path==='/api/companies' ? {companies:[{orgId:'default',name:'Home',members:[]},{orgId:'acme',name:'Acme',members:[]}],
      granted:['users.manage'],catalog:['jobs.view','whatsapp.campaign'],pending:[]} :
      options?.method==='POST' ? {inviteUrl:'/accept-invite#token=company-test'} : []
  )));
  render(<UsersManagementPage/>);
  await screen.findByText('Company hierarchy');
  await user.click(screen.getByRole('button',{name:'Invite Member'}));
  await user.type(screen.getByPlaceholderText('Jane Doe'),'Acme Admin');
  await user.type(screen.getByPlaceholderText('jane@company.com'),'admin@acme.test');
  await user.selectOptions(screen.getByLabelText('Company',{exact:true}),'acme');
  await user.click(screen.getByRole('combobox',{name:'Role'}));
  await user.click(screen.getByRole('option',{name:'Admin'}));
  await user.click(screen.getByRole('checkbox',{name:'jobs view'}));
  await user.click(screen.getByRole('button',{name:'Generate Invitation'}));
  const request=vi.mocked(authFetch).mock.calls.find(([path,options])=>path==='/api/users' && options?.method==='POST');
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({orgId:'acme',role:'admin',adminPermissions:['jobs.view']});
});
