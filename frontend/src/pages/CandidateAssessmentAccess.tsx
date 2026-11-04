import React,{useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';

export function CandidateAssessmentAccess(){
  const [error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  const [token]=useState(()=>window.location.hash.slice(1));
  useEffect(()=>{document.title='Assessment access';const meta=document.createElement('meta');meta.name='referrer';meta.content='no-referrer';document.head.append(meta);return()=>meta.remove();},[]);
  async function open(){if(busy)return;setBusy(true);setError('');try{
    const response=await fetch('/api/candidate-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    const body=await response.json();if(!response.ok)throw new Error(typeof body.detail==='string'?body.detail:'This assessment link is invalid or unavailable.');
    const url=new URL(body.url);if(url.protocol!=='https:')throw new Error('Assessment destination is unavailable.');setReady(true);window.location.replace(url.href);
  }catch(cause:any){setError(cause.message);}finally{setBusy(false);}}
  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><section className="w-full max-w-md rounded-2xl border border-border bg-card p-8"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">PrimeHire assessment</p><h1 className="mt-3 text-2xl font-bold">Your assessment</h1><p className="mt-3 text-sm text-muted-foreground">Continue during your assigned availability window. The assessment provider will ask you to sign in.</p>{error&&<p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm">{error}</p>}<Button className="mt-6" disabled={busy||ready||!token} onClick={()=>void open()}>{busy?'Checking access…':ready?'Opening assessment…':'Continue to assessment'}</Button>{!token&&<p className="mt-3 text-sm">This link is incomplete. Ask your recruiter for the full invite link.</p>}</section></main>;
}
