import {useState, type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Modal} from './ui/Modal';
import {intakeGet,intakeMutate,type BatchPage,type IntakeItem} from '../lib/resumeIntakeApi';

export type ResumeSelection = {ids:Set<string>;toggle:(item:IntakeItem)=>void;togglePage:()=>void};
export function ResumeBulkSelection({batchId,query,items,total,enabled,onChanged,children}:{batchId:string;query:string;items:IntakeItem[];total:number;enabled:boolean;onChanged:()=>void;children:(selection?:ResumeSelection)=>ReactNode}) {
  const [selected,setSelected]=useState<Map<string,IntakeItem>>(new Map());
  const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const selectable=items.filter(item=>item.status!=='deleted');
  const selection:ResumeSelection={ids:new Set(selected.keys()),toggle:item=>setSelected(previous=>{const next=new Map(previous);next.has(item.itemId)?next.delete(item.itemId):next.set(item.itemId,item);return next;}),togglePage:()=>setSelected(previous=>{const next=new Map(previous),all=selectable.every(item=>next.has(item.itemId));selectable.forEach(item=>all?next.delete(item.itemId):next.set(item.itemId,item));return next;})};
  async function selectAll(){
    setBusy(true);setError('');setMessage('');
    try{const all=new Map<string,IntakeItem>();let skip=0;while(true){const params=new URLSearchParams(query);params.set('skip',String(skip));params.set('limit','100');const result=await intakeGet<BatchPage>(`/batches/${batchId}?${params}`);result.items.filter(item=>item.status!=='deleted').forEach(item=>all.set(item.itemId,item));skip+=result.items.length;if(skip>=result.total)break;if(!result.items.length)throw new Error('Results changed. Refresh and select again.');}setSelected(all);}
    catch(e){setError(e instanceof Error?e.message:'Could not select resumes.');}finally{setBusy(false);}
  }
  async function remove(){
    setBusy(true);setError('');setMessage('');let deleted=0;const failed=new Map<string,IntakeItem>();const errors:string[]=[];
    for(const item of selected.values()){try{await intakeMutate(`/items/${item.itemId}`,{reason:reason.trim(),expectedRevision:item.revision},'DELETE');deleted++;}catch(e){failed.set(item.itemId,item);errors.push(`${item.fileName}: ${e instanceof Error?e.message:'Could not delete.'}`);}}
    setSelected(failed);setMessage(`${deleted} resume${deleted===1?'':'s'} deleted.${failed.size?` ${failed.size} could not be deleted. Refresh before retrying.`:''}`);setError(errors.slice(0,3).join(' '));setConfirm(false);setBusy(false);onChanged();
  }
  return <>{enabled&&<div className="flex flex-wrap items-center gap-3 px-5 pb-4"><Button variant="outline" disabled={busy||!total} onClick={()=>void selectAll()}>Select all matching resumes</Button><span className="text-xs text-muted-foreground">{selected.size} selected across all pages</span><Button variant="outline" disabled={busy||!selected.size} onClick={()=>setSelected(new Map())}>Clear selection</Button><Button variant="destructive" disabled={busy||!selected.size} onClick={()=>{setError('');setReason('');setConfirm(true);}}>Delete selected resumes</Button>{busy&&<span role="status" className="text-xs">Working…</span>}</div>}
    {message&&<p role="status" className="px-5 pb-3 text-xs">{message}</p>}{error&&<p role="alert" className="px-5 pb-3 text-xs text-destructive">{error}</p>}
    {children(enabled&&!busy?selection:undefined)}
    {confirm&&<Modal label="Delete selected resumes" onClose={()=>setConfirm(false)} dismissible={!busy} className="max-w-lg p-6"><h2 className="text-lg font-bold">Delete {selected.size} selected resumes?</h2><p className="my-4 text-sm text-muted-foreground">The original documents will become unavailable across their associations. Candidate and application records remain. This cannot be undone.</p><label className="grid gap-2 text-sm">Reason<textarea aria-label="Bulk deletion reason" className="ehr-input p-3" maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button><Button variant="destructive" disabled={busy||reason.trim().length<3} onClick={()=>void remove()}>{busy?'Deleting…':'Confirm deletion'}</Button></div></Modal>}
  </>;
}
