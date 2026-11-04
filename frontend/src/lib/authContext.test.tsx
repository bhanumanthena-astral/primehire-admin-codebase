import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthProvider, useAuth } from './authContext';
import { setAccessToken } from './authFetch';
import {recentSignInMethod} from './googleConnection';

describe('authentication startup ordering', () => {
  afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });
  it('late failed bootstrap cannot clear a successful login', async () => {
    let finishBootstrap!: (response: Response) => void;
    const bootstrap = new Promise<Response>(resolve => { finishBootstrap = resolve; });
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(bootstrap)
      .mockResolvedValueOnce(new Response(JSON.stringify({accessToken:'test-token',user:{email:'hr@example.com',role:'hr'}}),{status:200})));
    function Probe() {
      const auth = useAuth();
      return <><button onClick={() => void auth.login('hr@example.com','fictional-test-password')}>Login</button><span>{auth.user?.email || 'logged out'}</span></>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Login'}));
    await screen.findByText('hr@example.com');
    await act(async () => { finishBootstrap(new Response('{}',{status:401})); await bootstrap; });
    await waitFor(() => expect(screen.getByText('hr@example.com')).toBeInTheDocument());
  });
});


it('a temporary profile outage does not clear a successful login',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response(JSON.stringify({accessToken:'test-token',user:{email:'hr@example.com',role:'hr'}}),{status:200})).mockResolvedValueOnce(new Response('{}',{status:503}));
 vi.stubGlobal('fetch',fetch);
 function Probe(){const auth=useAuth();return <><button onClick={()=>void auth.login('hr@example.com','fictional-test-password')}>Login</button><button onClick={()=>void auth.refreshUser()}>Refresh profile</button><span>{auth.user?.email||'logged out'}</span></>;}
 try{render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'Login'}));await screen.findByText('hr@example.com');fireEvent.click(screen.getByRole('button',{name:'Refresh profile'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));expect(screen.getByText('hr@example.com')).toBeVisible();}
 finally{vi.unstubAllGlobals();setAccessToken(null);}
});

it('records a successful Google login without storing account data or credentials in the preference',async()=>{
  localStorage.clear();
  const send=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401}))
    .mockResolvedValueOnce(new Response(JSON.stringify({accessToken:'synthetic-google-token',user:{email:'synthetic@example.test',role:'hr'},returnTo:'/'})));
  vi.stubGlobal('fetch',send);
  function Probe(){const auth=useAuth();return <><button onClick={()=>void auth.completeGoogleSignIn()}>Complete Google login</button><span>{auth.user?.email||'Logged out'}</span></>;}
  try{
    render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(send).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button',{name:'Complete Google login'}));
    await screen.findByText('synthetic@example.test');expect(recentSignInMethod()).toBe('google');
    expect(localStorage.getItem('elitehr.lastSignInMethod')).toBe('google');
    expect(Object.keys(localStorage)).toEqual(['elitehr.lastSignInMethod']);
    expect(JSON.stringify(localStorage)).not.toContain('synthetic-google-token');
    expect(JSON.stringify(localStorage)).not.toContain('synthetic@example.test');
  }finally{vi.unstubAllGlobals();setAccessToken(null);localStorage.clear();}
});
