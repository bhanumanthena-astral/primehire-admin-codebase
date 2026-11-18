import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {workflowRequest,type TraitConfiguration} from '../lib/hiringWorkflow';
export function TraitManager({jobId,round,configuration,onSaved,interviewId,readOnly=false}:{jobId:string;round:string;configuration:TraitConfiguration;interviewId?:string;readOnly?:boolean;onSaved:(value:TraitConfiguration)=>void}){
 const [draft,setDraft]=useState(configuration),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 function move(index:number,delta:number){const traits=[...draft.traits];[traits[index],traits[index+delta]]=[traits[index+delta],traits[index]];setDraft({...draft,traits});}
 return <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">{readOnly ? 'Round Traits' : 'Manage Traits'}</summary><div className="mt-4 space-y-3">
 <p className="text-sm text-muted-foreground">{interviewId ? "These traits belong to the assigned reviewer for this job and round. Admin can see them; submitted ratings are included in later round reviews." : "Default traits for this job and round."}</p>
 {readOnly ? <ul className="space-y-2">{draft.traits.filter(trait=>trait.active).map(trait=><li key={trait.id}><strong>{trait.name}</strong>{trait.description&&<p className="text-sm text-muted-foreground">{trait.description}</p>}</li>)}</ul> : <>
 {draft.traits.map((trait,index)=><div key={trait.id} className="space-y-2 rounded border p-3"><label>Trait name<Input disabled={busy} value={trait.name} onChange={e=>setDraft({...draft,traits:draft.traits.map((t,i)=>i===index?{...t,name:e.target.value}:t)})}/></label><label>Description<Textarea disabled={busy} value={trait.description} onChange={e=>setDraft({...draft,traits:draft.traits.map((t,i)=>i===index?{...t,description:e.target.value}:t)})}/></label>
 <label className="flex gap-2"><input type="checkbox" disabled={busy||!trait.active&&draft.traits.filter(t=>t.active).length>=6} checked={trait.active} onChange={e=>setDraft({...draft,traits:draft.traits.map((t,i)=>i===index?{...t,active:e.target.checked}:t)})}/>Active</label>
 <Button variant="ghost" disabled={busy||index===0} onClick={()=>move(index,-1)}>Move up</Button><Button variant="ghost" disabled={busy||index===draft.traits.length-1} onClick={()=>move(index,1)}>Move down</Button></div>)}
 {error&&<p role="alert">{error}</p>}
 <Button variant="outline" disabled={busy||draft.traits.filter(t=>t.active).length>=6} onClick={()=>setDraft({...draft,traits:[...draft.traits,{id:'trait_'+crypto.randomUUID().replaceAll('-',''),name:'New trait',description:'',active:true}]})}>Add trait</Button>
 <Button disabled={busy} onClick={async()=>{setBusy(true);try{const result=await workflowRequest(interviewId ? '/interviews/'+interviewId+'/traits' : '/jobs/'+jobId+'/traits/'+round,{expectedRevision:draft.revision,traits:draft.traits},'PUT');setDraft(result);onSaved(result);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Save traits</Button>
 </>}</div></details>;
}
