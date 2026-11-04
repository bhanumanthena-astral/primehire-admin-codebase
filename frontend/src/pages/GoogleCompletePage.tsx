import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {useAuth} from '../lib/authContext';
import {Button} from '@/components/ui/button';
import {googleRequest} from '../lib/googleApi';
import {useGoogleRedirect} from '../components/auth/useGoogleRedirect';
import {GOOGLE_CONNECTION_TIMEOUT_MS,GOOGLE_CONNECTION_TIMEOUT_MESSAGE} from '../lib/googleConnection';

export function GoogleCompletePage(){
  const {completeGoogleSignIn,loading,user}=useAuth(),navigate=useNavigate();
  const [error,setError]=useState('');
  const redirect=useGoogleRedirect(setError);
  const pending=useRef<ReturnType<typeof completeGoogleSignIn>|null>(null);
  const controller=useRef(new AbortController());
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const lifetime=useRef<object|null>(null);
  useEffect(()=>{
    const owner={};lifetime.current=owner;
    timer.current=setTimeout(()=>{controller.current.abort();setError(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);},GOOGLE_CONNECTION_TIMEOUT_MS);
    return()=>{clearTimeout(timer.current);queueMicrotask(()=>{if(lifetime.current===owner)controller.current.abort();});};
  },[]);
  useEffect(()=>{if(loading)return;let active=true;
    if(controller.current.signal.aborted)return;
    pending.current??=completeGoogleSignIn(controller.current.signal);
    void pending.current.then(result=>{if(!active||controller.current.signal.aborted)return;clearTimeout(timer.current);
      if(result.mfaRequired)navigate('/login',{replace:true,state:{googleMfaToken:result.mfaToken,from:{pathname:result.returnTo}}});
      else navigate(result.returnTo||'/',{replace:true});
    }).catch(cause=>{if(active&&!controller.current.signal.aborted){clearTimeout(timer.current);setError(cause instanceof Error?cause.message:'Google sign-in failed');}});
    return()=>{active=false;};
  },[loading,completeGoogleSignIn,navigate]);
  async function reconnect(){await redirect.start(async signal=>{
    if(user){const result=await googleRequest<{authorizationUrl:string}>('/connect',{returnTo:'/'},'POST',signal);return result.authorizationUrl;}
    const response=await fetch('/api/auth/google/start',{method:'POST',signal,credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnTo:'/'})});
    const result=await response.json();if(!response.ok)throw new Error(result.detail||'Google sign-in could not start');return result.authorizationUrl;
  });}
  return <main className="flex min-h-dvh items-center justify-center bg-background p-6"><section className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8">
    <h1 className="text-xl font-semibold">{error?'Google connection needs attention':'Completing Google connection'}</h1>
    {error?<><p role="alert" className="text-sm text-destructive">{error}</p><Button disabled={redirect.busy} onClick={()=>void reconnect()}>{redirect.busy?'Connecting…':user?'Connect Google Calendar again':'Try Google sign-in again'}</Button><Link to={user?'/':'/login'} className="block text-sm font-medium underline">{user?'Return to workspace':'Return to sign in'}</Link></>:<p role="status" className="text-sm text-muted-foreground">Verifying your account securely…</p>}
  </section></main>;
}
