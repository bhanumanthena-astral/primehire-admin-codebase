import {useEffect,useState} from 'react';
import DOMPurify from 'dompurify';
import {workflowRequest} from '../lib/hiringWorkflow';
export function RejectionPreview({applicationId,onReady}:{applicationId:string;onReady:(value:boolean)=>void}){
 const [preview,setPreview]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;onReady(false);void workflowRequest('/applications/'+applicationId+'/rejection-preview').then(value=>{if(active){setPreview(value);onReady(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[applicationId]);
 return <section aria-label="Rejection email preview" className="w-full space-y-2 rounded-xl border p-4 text-sm">
 {error?<p role="alert" className="text-destructive">{error}</p>:preview?<><h4 className="font-semibold">{preview.templateName}</h4><p>Recipient · {preview.name} · {preview.to}</p><p>{preview.subject}</p><div dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(preview.html)}}/><p>Confirming rejection queues this email. Provider acceptance is tracked separately.</p></>:<p>Loading the default rejection email…</p>}</section>;
}
