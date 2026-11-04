import {useCallback,useEffect,useRef,useState} from 'react';
import {followGoogle} from '../../lib/googleApi';
import {GOOGLE_CONNECTION_TIMEOUT_MS,GOOGLE_CONNECTION_TIMEOUT_MESSAGE} from '../../lib/googleConnection';

/** Covers both the start request and a redirect that is cancelled/back-restored. */
export function useGoogleRedirect(onError:(message:string)=>void){
  const [busy,setBusy]=useState(false);
  const current=useRef<{controller:AbortController;timer:ReturnType<typeof setTimeout>}|null>(null);
  const errorHandler=useRef(onError);errorHandler.current=onError;
  const stop=useCallback((message?:string)=>{
    const attempt=current.current;if(!attempt)return;
    current.current=null;clearTimeout(attempt.timer);attempt.controller.abort();setBusy(false);
    if(message)errorHandler.current(message);
  },[]);
  useEffect(()=>{
    const restore=(event:PageTransitionEvent)=>{if(event.persisted)stop(GOOGLE_CONNECTION_TIMEOUT_MESSAGE);};
    window.addEventListener('pageshow',restore);
    return()=>{window.removeEventListener('pageshow',restore);
      const attempt=current.current;current.current=null;
      if(attempt){clearTimeout(attempt.timer);attempt.controller.abort();}
    };
  },[stop]);
  const start=useCallback(async(load:(signal:AbortSignal)=>Promise<string>)=>{
    if(current.current)return;
    const controller=new AbortController();
    const attempt={controller,timer:setTimeout(()=>stop(GOOGLE_CONNECTION_TIMEOUT_MESSAGE),GOOGLE_CONNECTION_TIMEOUT_MS)};
    current.current=attempt;setBusy(true);
    try{
      const url=await load(controller.signal);
      if(current.current===attempt&&!controller.signal.aborted)followGoogle(url);
      // Remain busy until navigation succeeds, a back restore occurs, or the deadline expires.
    }catch(error){if(current.current===attempt)stop(error instanceof Error?error.message:'Google connection failed. Please try again.');}
  },[stop]);
  return {busy,start};
}
