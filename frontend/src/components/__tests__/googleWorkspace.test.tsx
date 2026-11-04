import React,{StrictMode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {GoogleSignInButton} from '../auth/GoogleSignInButton';
import {GoogleCalendarConnection} from '../auth/GoogleCalendarConnection';
import {GoogleMfaSetup} from '../auth/GoogleMfaSetup';
import {GoogleCompletePage} from '../../pages/GoogleCompletePage';
import {InterviewCalendarStatus} from '../recruitment/InterviewCalendarStatus';
import {googleRequest,followGoogle} from '../../lib/googleApi';
import {useAuth} from '../../lib/authContext';
import {GOOGLE_CONNECTION_TIMEOUT_MESSAGE,rememberSignInMethod,withGoogleTimeout} from '../../lib/googleConnection';

vi.mock('../../lib/authContext',()=>({useAuth:vi.fn()}));
vi.mock('../../lib/googleApi',()=>({googleRequest:vi.fn(),followGoogle:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();vi.mocked(useAuth).mockReturnValue({loading:false,impersonatingUser:null} as any);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('shows a disabled Google sign-in when server setup is missing',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"enabled":false}')));
  render(<GoogleSignInButton returnTo="/reports" onError={vi.fn()}/>);
  expect(await screen.findByText('Google sign-in needs administrator setup.')).toBeVisible();
  expect(screen.getByRole('button',{name:'Sign in with Google'})).toBeDisabled();
});

it('starts sign-in using the backend and follows only its Google authorization URL',async()=>{
  const send=vi.fn().mockResolvedValueOnce(new Response('{"enabled":true}'))
    .mockResolvedValueOnce(new Response('{"authorizationUrl":"https://accounts.google.com/o/oauth2/v2/auth?state=synthetic"}'));
  vi.stubGlobal('fetch',send);
  render(<GoogleSignInButton returnTo="/reports" onError={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Sign in with Google'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Sign in with Google'}));
  await waitFor(()=>expect(followGoogle).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'));
  expect(send.mock.calls[1][1].body).toBe('{"returnTo":"/reports"}');
});

it('consumes Google completion once in Strict Mode and preserves MFA',async()=>{
  const complete=vi.fn().mockResolvedValue({mfaRequired:true,mfaToken:'synthetic',returnTo:'/reports'});
  vi.mocked(useAuth).mockReturnValue({loading:false,completeGoogleSignIn:complete} as any);
  render(<StrictMode><MemoryRouter initialEntries={['/auth/google/complete']}><Routes>
    <Route path="/auth/google/complete" element={<GoogleCompletePage/>}/><Route path="/login" element={<h1>MFA login</h1>}/>
  </Routes></MemoryRouter></StrictMode>);
  expect(await screen.findByRole('heading',{name:'MFA login'})).toBeVisible();
  expect(complete).toHaveBeenCalledTimes(1);
});

it('displays connection failures and requires consent before redirecting',async()=>{
  vi.mocked(googleRequest).mockResolvedValueOnce({enabled:true,connected:false,status:'not_connected'})
    .mockResolvedValueOnce({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth'});
  render(<GoogleCalendarConnection/>);
  fireEvent.click(screen.getByRole('button',{name:'Google Calendar'}));
  expect(await screen.findByText('No Google Calendar connected.')).toBeVisible();
  expect(googleRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Connect Google Calendar'}));
  await waitFor(()=>expect(followGoogle).toHaveBeenCalledTimes(1));
  expect(googleRequest).toHaveBeenLastCalledWith('/connect',expect.objectContaining({returnTo:expect.any(String)}),'POST',expect.any(AbortSignal));
});

it('shows pending calendar delivery and allows an authorized retry',async()=>{
  vi.mocked(googleRequest).mockResolvedValue({status:'synced'});
  const changed=vi.fn();
  render(<InterviewCalendarStatus interview={{interviewId:'interview',status:'scheduled',canManage:true,
    googleCalendarStatus:'pending',googleCalendarError:'Temporary failure'} as any} onChanged={changed}/>);
  expect(screen.getByRole('status')).toHaveTextContent('sync pending');
  fireEvent.click(screen.getByRole('button',{name:'Retry calendar sync'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
  expect(googleRequest).toHaveBeenCalledWith('/interviews/interview/retry',{});
});

it('lets an administrator enroll existing MFA and save recovery codes before Google login',async()=>{
  const refreshUser=vi.fn().mockResolvedValue(undefined);
  vi.mocked(useAuth).mockReturnValue({user:{role:'admin',mfaEnabled:false},refreshUser,impersonatingUser:null} as any);
  const send=vi.fn().mockResolvedValueOnce(new Response('{"secret":"synthetic-setup-key"}'))
    .mockResolvedValueOnce(new Response('{"recoveryCodes":["synthetic-one","synthetic-two"]}'));
  vi.stubGlobal('fetch',send);
  render(<GoogleMfaSetup/>);
  fireEvent.click(screen.getByRole('button',{name:'Set up two-factor authentication'}));
  expect(await screen.findByLabelText('Authenticator setup key')).toHaveValue('synthetic-setup-key');
  fireEvent.change(screen.getByLabelText('Authenticator verification code'),{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Verify and enable'}));
  expect(await screen.findByText('synthetic-one')).toBeVisible();
  expect(screen.queryByLabelText('Authenticator setup key')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'I saved my recovery codes'}));
  expect(await screen.findByText('Enabled. Google sign-in will also ask for your verification code.')).toBeVisible();
  expect(refreshUser).toHaveBeenCalledOnce();
});

it('restores the Google button at exactly 30 seconds and ignores a late start response',async()=>{
  let resolveStart!:(response:Response)=>void;
  const pending=new Promise<Response>(resolve=>{resolveStart=resolve;});
  const send=vi.fn().mockResolvedValueOnce(new Response('{"enabled":true}')).mockReturnValueOnce(pending);
  vi.stubGlobal('fetch',send);const error=vi.fn();
  render(<GoogleSignInButton returnTo="/" onError={error}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Sign in with Google'})).toBeEnabled());
  vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Sign in with Google'}));
  await act(()=>vi.advanceTimersByTimeAsync(29_999));
  expect(screen.getByRole('button',{name:'Connecting…'})).toBeDisabled();expect(error).not.toHaveBeenCalled();
  await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(error).toHaveBeenCalledWith(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);
  expect(screen.getByRole('button',{name:'Sign in with Google'})).toBeEnabled();
  expect(send.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async()=>{resolveStart(new Response('{"authorizationUrl":"https://accounts.google.com/o/oauth2/v2/auth?state=late"}'));await pending;});
  expect(followGoogle).not.toHaveBeenCalled();
  send.mockResolvedValueOnce(new Response('{"authorizationUrl":"https://accounts.google.com/o/oauth2/v2/auth?state=retry"}'));
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Sign in with Google'}));});
  expect(followGoogle).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=retry');
});

it('resets a cancelled redirect when the browser restores the page from its back cache',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{"enabled":true}'))
    .mockResolvedValueOnce(new Response('{"authorizationUrl":"https://accounts.google.com/o/oauth2/v2/auth"}')));
  const error=vi.fn();render(<GoogleSignInButton returnTo="/" onError={error}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Sign in with Google'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Sign in with Google'}));
  await waitFor(()=>expect(followGoogle).toHaveBeenCalledOnce());
  const restore=new Event('pageshow');Object.defineProperty(restore,'persisted',{value:true});
  act(()=>window.dispatchEvent(restore));
  expect(error).toHaveBeenCalledWith(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);
  expect(screen.getByRole('button',{name:'Sign in with Google'})).toBeEnabled();
});

it('restores the Calendar connect action after a stalled redirect',async()=>{
  vi.mocked(googleRequest).mockResolvedValueOnce({enabled:true,connected:false,status:'not_connected'})
    .mockResolvedValueOnce({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth'});
  render(<GoogleCalendarConnection/>);fireEvent.click(screen.getByRole('button',{name:'Google Calendar'}));
  await screen.findByText('No Google Calendar connected.');
  vi.useFakeTimers();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Connect Google Calendar'}));});
  expect(screen.getByRole('button',{name:'Connecting…'})).toBeDisabled();
  await act(()=>vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByRole('alert')).toHaveTextContent(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);
  expect(screen.getByRole('button',{name:'Connect Google Calendar'})).toBeEnabled();
});

it('times out completion even if authentication bootstrap never finishes',async()=>{
  const complete=vi.fn();vi.mocked(useAuth).mockReturnValue({loading:true,completeGoogleSignIn:complete} as any);
  vi.useFakeTimers();render(<MemoryRouter><GoogleCompletePage/></MemoryRouter>);
  await act(()=>vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByRole('alert')).toHaveTextContent(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);
  expect(screen.getByRole('button',{name:'Try Google sign-in again'})).toBeEnabled();
  expect(complete).not.toHaveBeenCalled();
});

it('blocks late callback navigation after its deadline',async()=>{
  let finish!:(value:any)=>void;
  const completion=new Promise(resolve=>{finish=resolve;});
  const complete=vi.fn().mockReturnValue(completion);
  vi.mocked(useAuth).mockReturnValue({loading:false,completeGoogleSignIn:complete} as any);
  vi.useFakeTimers();render(<MemoryRouter><GoogleCompletePage/></MemoryRouter>);
  await act(()=>vi.advanceTimersByTimeAsync(30_000));
  await act(async()=>{finish({mfaRequired:true,mfaToken:'late',returnTo:'/'});await completion;});
  expect(screen.getByRole('alert')).toHaveTextContent(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);
  expect(complete.mock.calls[0][0].aborted).toBe(true);
});

it('bounds a request whose transport ignores cancellation',async()=>{
  vi.useFakeTimers();let signal:AbortSignal|undefined;
  const result=withGoogleTimeout(async value=>{signal=value;return new Promise(()=>{});});
  const rejected=expect(result).rejects.toThrow(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);
  await vi.advanceTimersByTimeAsync(30_000);await rejected;expect(signal?.aborted).toBe(true);
});

it('shows the recently used badge only for the last successful Google method',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"enabled":true}')));
  render(<GoogleSignInButton returnTo="/" onError={vi.fn()}/>);
  expect(screen.queryByText('Recently used')).not.toBeInTheDocument();
  act(()=>rememberSignInMethod('google'));expect(screen.getByText('Recently used')).toBeVisible();
  act(()=>rememberSignInMethod('password'));expect(screen.queryByText('Recently used')).not.toBeInTheDocument();
  expect(localStorage.getItem('elitehr.lastSignInMethod')).toBe('password');
});
