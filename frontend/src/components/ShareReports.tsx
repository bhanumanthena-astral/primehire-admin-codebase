import {ApplicationEmailStatus} from './ApplicationEmailStatus';
import {useEffect,useState} from 'react';
import DOMPurify from 'dompurify';
import {Button} from '@/components/ui/button';
import {workflowRequest,type HiringTemplate} from '../lib/hiringWorkflow';
export function ShareReports({applicationId,canEmail=true}:{applicationId:string;canEmail?:boolean}){
 const [open,setOpen]=useState(false),[items,setItems]=useState<any[]>([]),[recipients,setRecipients]=useState<any[]>([]),[templates,setTemplates]=useState<HiringTemplate[]>([]);
 const [selected,setSelected]=useState<string[]>([]),[recipient,setRecipient]=useState(''),[template,setTemplate]=useState(''),[gmail,setGmail]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<any>(null),[provider,setProvider]=useState('company');
 const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const [statusRevision,setStatusRevision]=useState(0);
 useEffect(()=>{if(!open)return;let active=true;void Promise.all([workflowRequest('/applications/'+applicationId+'/shareable'),workflowRequest('/hr-recipients?applicationId='+encodeURIComponent(applicationId)),workflowRequest('/settings'),workflowRequest('/integration-status')]).then(([reports,people,settings,status])=>{if(!active)return;setItems(reports.items);setSelected(reports.items.map((r:any)=>r.id));setRecipients(people.items);setRecipient(people.items[0]?.userId||'');setTemplates(settings.templates.filter((t:HiringTemplate)=>t.category==='report_share'));setGmail(status.connected&&status.gmailAuthorized);}).catch(e=>setError(e.message));return()=>{active=false;};},[open,applicationId]);
 const payload={reportIds:selected,recipientUserId:recipient,templateId:template,provider,requestId};
 function invalidate(){setPreview(null);setRequestId(crypto.randomUUID());}
 async function copy(links:boolean){try{const text=items.filter(item=>selected.includes(item.id)).map(item=>(links?'':item.summary+'\n')+new URL(item.url,window.location.origin).href).join('\n\n');await navigator.clipboard.writeText(text);setNotice('Selected report references copied. Links require an authorized sign-in.');}catch{setError('Could not copy reports. Check clipboard permission.');}}
 return <details className="space-y-3 rounded-xl border p-4" onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-semibold">Share Reports with HR</summary>{open&&<div className="mt-4 space-y-3">
 {error&&<p role="alert" className="text-destructive">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {items.map(item=><label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={selected.includes(item.id)} onChange={e=>{setSelected(e.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id));invalidate();}}/>{item.round} · {item.kind==='review'?'Finalized interviewer evaluation':'Assessment report'} · Version {item.version}</label>)}
 {!items.length&&<p>No finalized reports are available for sharing.</p>}
 <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!selected.length} onClick={()=>void copy(false)}>Copy Report</Button><Button variant="outline" disabled={!selected.length} onClick={()=>void copy(true)}>Copy Secure Report Link</Button></div>
 <label className="block text-sm">HR recipient<select disabled={busy} className="block w-full rounded border bg-background p-2" value={recipient} onChange={e=>{setRecipient(e.target.value);invalidate();}}><option value="">Choose recipient</option>{recipients.map(person=><option key={person.userId} value={person.userId}>{person.name} · {person.email}</option>)}</select></label>
 <label className="block text-sm">Company-side report template<select disabled={busy} className="block w-full rounded border bg-background p-2" value={template} onChange={e=>{setTemplate(e.target.value);invalidate();}}><option value="">Choose template</option>{templates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
 {!gmail&&<p className="text-sm text-muted-foreground">Connect Google with Gmail sending permission to use Send via Gmail.</p>}
 <div className="flex gap-2">{[['company','Email Reports'],['gmail','Send via Gmail']].map(([id,label])=><Button key={id} variant="outline" disabled={!canEmail||busy||!selected.length||!recipient||!template||id==='gmail'&&!gmail} onClick={async()=>{setBusy(true);setError('');try{setProvider(id);setPreview(await workflowRequest('/applications/'+applicationId+'/share-preview',{...payload,provider:id}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{label}</Button>)}</div>
 {preview&&<section className="space-y-2 rounded border p-3"><h4 className="font-semibold">Confirm report email</h4><p>{preview.to}</p><p>{preview.subject}</p><div dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(preview.html)}}/><Button disabled={busy} onClick={async()=>{setBusy(true);try{await workflowRequest('/applications/'+applicationId+'/share',payload);setNotice('Report email queued. Provider acceptance is tracked below.');setPreview(null);setStatusRevision(value=>value+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Confirm email</Button></section>}
 <ApplicationEmailStatus applicationId={applicationId} revision={statusRevision}/>
 </div>}</details>;
}
