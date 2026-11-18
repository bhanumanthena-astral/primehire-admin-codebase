import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {workflowRequest} from '../lib/hiringWorkflow';

export function ApplicationEmailStatus({applicationId,revision=0}:{applicationId:string;revision?:number}){
 const [items,setItems]=useState<any[]>([]);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true;
  workflowRequest('/applications/'+applicationId+'/messages').then(page=>{
   if(active){setItems(page.items||[]);setError("");}
  }).catch(cause=>{if(active)setError(cause.message);});
  return()=>{active=false;};
 },[applicationId,revision,refresh]);
 useEffect(()=>{
  if(!items.some(item=>['pending','sending'].includes(item.status)))return;
  const timer=setInterval(()=>{if(!document.hidden)setRefresh(value=>value+1);},5000);
  return()=>clearInterval(timer);
 },[items]);
 return <section className="space-y-2 text-sm" aria-label="Application email status">
  <div className="flex items-center gap-2">
   <h4 className="font-semibold">Email status</h4>
   <Button variant="ghost" onClick={()=>{setError('');setRefresh(value=>value+1);}}>Refresh status</Button>
  </div>
  {error&&<p role="alert">{error}</p>}
  {items.map(message=><div key={message.messageId} className="rounded border p-2">
   {message.kind==='workflow_rejection'?'Rejection email':'Report sharing'} · {message.sentVia==='dry_run'?'Dry run — no email sent':message.deliveryStatus==='accepted'?'Accepted by provider':message.status==='pending'?'Queued':message.status}
   {message.lastError&&<p>{message.lastError}</p>}
   {message.status==='failed'&&<Button variant="outline" onClick={async()=>{
    try{await workflowRequest('/messages/'+message.messageId+'/retry',{});setRefresh(value=>value+1);}
    catch(cause){setError((cause as Error).message);}
   }}>Retry email</Button>}
  </div>)}
 </section>;
}
