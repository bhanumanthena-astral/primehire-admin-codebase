import {useEffect,useId,useState} from 'react';
import {useGoogleRedirect} from './useGoogleRedirect';
import {recentSignInMethod,SIGN_IN_METHOD_EVENT,withGoogleTimeout} from '../../lib/googleConnection';

export function GoogleSignInButton({returnTo,onError,disabled=false}:{returnTo:string;onError:(message:string)=>void;disabled?:boolean}) {
  const [enabled,setEnabled]=useState<boolean|null>(null),[configError,setConfigError]=useState(''),[retry,setRetry]=useState(0);
  const [recent,setRecent]=useState(()=>recentSignInMethod()==='google');
  const {busy,start}=useGoogleRedirect(onError);
  const recentId=useId();
  useEffect(()=>{const update=()=>setRecent(recentSignInMethod()==='google');
    window.addEventListener(SIGN_IN_METHOD_EVENT,update);window.addEventListener('storage',update);
    return()=>{window.removeEventListener(SIGN_IN_METHOD_EVENT,update);window.removeEventListener('storage',update);};
  },[]);
  useEffect(()=>{const controller=new AbortController();
    setEnabled(null);setConfigError('');
    void withGoogleTimeout(async signal=>{const response=await fetch('/api/auth/google/config',{signal,credentials:'include'});
      if(!response.ok)throw new Error('Google sign-in could not be checked. Please retry.');return response.json();
    },controller.signal).then(result=>{if(!controller.signal.aborted)setEnabled(!!result.enabled);})
      .catch(error=>{if(!controller.signal.aborted){setEnabled(false);setConfigError(error instanceof Error?error.message:'Google sign-in could not be checked. Please retry.');}});
    return()=>controller.abort();
  },[retry]);
  async function signIn(){await start(async signal=>{
    const response=await fetch('/api/auth/google/start',{method:'POST',signal,credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnTo})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.detail||'Google sign-in could not start');
    return result.authorizationUrl;
  });}
  return <div className="space-y-2">
    <button type="button" aria-describedby={recent?recentId:undefined} onClick={()=>void signIn()} disabled={disabled||busy||!enabled}
      className="flex min-h-11 w-full items-center justify-center gap-3 rounded-[4px] border border-[#747775] bg-white px-3 text-sm font-medium text-[#1f1f1f] transition hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:opacity-50">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"/><path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>
      {busy?'Connecting…':'Sign in with Google'}
    </button>
    {recent&&<p id={recentId} className="text-center text-xs font-medium text-primary">Recently used</p>}
    {enabled===null?<p role="status" className="text-center text-xs text-muted-foreground">Checking Google sign-in…</p>:configError?<div className="text-center text-xs text-muted-foreground"><p role="status">{configError}</p><button type="button" className="mt-2 underline" onClick={()=>setRetry(value=>value+1)}>Retry Google sign-in check</button></div>:!enabled&&<p className="text-center text-xs text-muted-foreground">Google sign-in needs administrator setup.</p>}
  </div>;
}
