import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {LoginPage} from './LoginPage';
import {useAuth} from '../lib/authContext';
import {recentSignInMethod} from '../lib/googleConnection';
vi.mock('../lib/authContext',()=>({useAuth:vi.fn()}));
vi.mock('../components/StaticTeamAvatar',()=>({StaticTeamAvatar:()=>null}));
const login=vi.fn(),verifyMfa=vi.fn();
function open(){render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<LoginPage/>}/><Route path="/" element={<h1>Workspace home</h1>}/></Routes></MemoryRouter>);}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(useAuth).mockReturnValue({login,verifyMfa} as any);login.mockResolvedValue({mfaRequired:false});verifyMfa.mockResolvedValue(undefined);});
it('preserves credential validation and explicit password visibility',async()=>{
  open();fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(screen.queryByRole('button',{name:/Sign in with Google/i})).not.toBeInTheDocument();
  expect(login).not.toHaveBeenCalled();
  expect(await screen.findByText('Please enter your email or phone number.')).toBeVisible();
  const password=screen.getByPlaceholderText('Passcode');
  expect(password).toHaveAttribute('type','password');
  fireEvent.click(screen.getByRole('button',{name:'Show passcode'}));
  expect(password).toHaveAttribute('type','text');
  fireEvent.click(screen.getByRole('button',{name:'Hide passcode'}));
  expect(password).toHaveAttribute('type','password');
});
it('signs in with the existing auth service and redirects to the workspace',async()=>{
  open();fireEvent.change(screen.getByPlaceholderText('Enter Email / Phone No'),{target:{value:' synthetic@example.test '}});
  fireEvent.change(screen.getByPlaceholderText('Passcode'),{target:{value:'Synthetic-passcode'}});
  fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(await screen.findByRole('heading',{name:'Workspace home'})).toBeVisible();
  expect(login).toHaveBeenCalledWith('synthetic@example.test','Synthetic-passcode');
});
it('retains MFA verification and displays server errors without losing the input',async()=>{
  login.mockResolvedValue({mfaRequired:true,mfaToken:'synthetic-token'});
  verifyMfa.mockRejectedValueOnce(new Error('Invalid verification code. Please try again.'));
  open();fireEvent.change(screen.getByPlaceholderText('Enter Email / Phone No'),{target:{value:'synthetic@example.test'}});
  fireEvent.change(screen.getByPlaceholderText('Passcode'),{target:{value:'Synthetic-passcode'}});
  fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(await screen.findByRole('heading',{name:'Two-Factor Authentication'})).toBeVisible();
  fireEvent.change(screen.getByLabelText('Verification code'),{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm & Sign In'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid verification code');
  expect(screen.getByLabelText('Verification code')).toHaveValue('123456');
  fireEvent.click(screen.getByRole('button',{name:'Confirm & Sign In'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Workspace home'})).toBeVisible());
  expect(verifyMfa).toHaveBeenCalledWith('synthetic-token','123456');
});

it('marks Google as recently used only after its MFA verification succeeds',async()=>{
  localStorage.clear();verifyMfa.mockRejectedValueOnce(new Error('Invalid verification code'));
  render(<MemoryRouter initialEntries={[{pathname:'/login',state:{googleMfaToken:'synthetic-google-mfa'}}]}><Routes>
    <Route path="/login" element={<LoginPage/>}/><Route path="/" element={<h1>Workspace home</h1>}/>
  </Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Verification code'),{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm & Sign In'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid verification code');
  expect(recentSignInMethod()).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Confirm & Sign In'}));
  await screen.findByRole('heading',{name:'Workspace home'});
  expect(recentSignInMethod()).toBe('google');localStorage.clear();
});
