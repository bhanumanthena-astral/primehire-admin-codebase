import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {workflowRequest,SOURCE_LABELS,sourceLabel} from '../lib/hiringWorkflow';
import {candidateRequest} from '../lib/candidateManagementApi';
import type {IntakeItem} from '../lib/resumeIntakeApi';
import {useAuth} from '../lib/authContext';
export function IntakeIdentityReview({item,onUpdated}:{item:IntakeItem;onUpdated:(patch:Partial<IntakeItem>)=>void}){
 const {user}=useAuth();
 const [reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[existing,setExisting]=useState<any>(null);
 const [source,setSource]=useState(item.source||'unknown');
 const canManage=['super_admin','admin','hr'].includes(user?.role||'');
 return <div className="my-4 space-y-3">
 <p className="text-sm">Application source · {sourceLabel(item.source)}</p>
 {item.applicationId&&canManage&&<label className="block text-sm">Update application source<select className="ml-2 rounded border bg-background p-2" value={source} onChange={async e=>{setSource(e.target.value);setBusy(true);try{await workflowRequest('/applications/'+item.applicationId+'/source',{source:e.target.value},'PUT');onUpdated({source:e.target.value});}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}} disabled={busy}>{Object.entries(SOURCE_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
 {item.matches?.length>0&&<section className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4"><h3 className="font-semibold">{item.duplicateReview?'Duplicate review recorded':'Potential Duplicate'}</h3>
 {item.matches.map(match=><div key={match.candidateId} className="text-sm"><p>{match.name} · Candidate {match.candidateId}</p><p>Matched on · {match.matchedOn?.join(', ')||'Existing candidate identity'}</p>{match.previousJobs?.length>0&&<p>Previously applied openings · {match.previousJobs.join(', ')}</p>}<p>{match.sameJob?'An application already exists for this opening.':'An additional application for another opening is permitted.'}</p>
 {canManage&&<Button variant="outline" size="sm" onClick={async()=>{try{setExisting(await candidateRequest('/'+match.candidateId));}catch(e){setError((e as Error).message);}}}>Open existing profile</Button>}</div>)}
 {existing&&<div className="rounded border bg-card p-3"><h4 className="font-semibold">{existing.profile?.name}</h4><p>{existing.profile?.currentDesignation}</p><p>{existing.profile?.summary}</p><Button variant="ghost" onClick={()=>setExisting(null)}>Close profile</Button></div>}
 {item.duplicateReview&&<p className="text-sm">{item.duplicateReview.decision} · {item.duplicateReview.reason}</p>}
 {canManage&&<><label className="block text-sm">Review reason<Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain why this application should be kept or the warning dismissed"/></label><div className="flex flex-wrap gap-2">{[['keep','Keep application'],['dismiss','Dismiss false-positive warning']].map(([decision,label])=><Button key={decision} disabled={busy||reason.trim().length<3} variant="outline" onClick={async()=>{setBusy(true);try{const result=await workflowRequest('/items/'+item.itemId+'/duplicate-review',{decision,reason,expectedRevision:item.revision});onUpdated(result);setReason('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{label}</Button>)}</div></>}
 </section>}
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 </div>;
}
