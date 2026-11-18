import React, {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Modal} from './ui/Modal';
import {AppSelect} from './ui/AppSelect';
import {authFetch} from '../lib/authFetch';

type Settings = {revision:number; enabledPermissions:string[];
  email:{mode:string; fromAddress:string; fromName:string; apiKeyConfigured:boolean}};

export function CompanySettingsDialog({company, catalog, onClose}:{
  company:{orgId:string; name:string}; catalog:string[]; onClose:()=>void;
}) {
  const [data,setData]=useState<Settings|null>(null);
  const [apiKey,setApiKey]=useState('');
  const [clearApiKey,setClearApiKey]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  const [reload,setReload]=useState(0);
  const path=`/api/companies/${encodeURIComponent(company.orgId)}/settings`;
  useEffect(()=>{
    const controller=new AbortController();
    setData(null); setError(''); setApiKey(''); setClearApiKey(false); setSaved(false);
    void authFetch(path,{signal:controller.signal}).then(async res=>{
      if (!res.ok) throw new Error('Could not load company settings');
      const value=await res.json();
      if (!controller.signal.aborted) setData(value);
    }).catch(err=>{if (!controller.signal.aborted) setError(err.message);});
    return ()=>controller.abort();
  },[path,reload]);
  async function save(event:React.FormEvent) {
    event.preventDefault(); if (!data) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const {apiKeyConfigured:_,...email}=data.email;
      const res=await authFetch(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        expectedRevision:data.revision, enabledPermissions:data.enabledPermissions,
        email:{...email,...(apiKey.trim()?{apiKey:apiKey.trim()}:{}),clearApiKey},
      })});
      const result=await res.json();
      if (!res.ok) throw new Error(typeof result.detail==='string'?result.detail:'Could not save company settings');
      setData(result); setApiKey(''); setClearApiKey(false); setSaved(true);
    } catch(err) {setError(err instanceof Error?err.message:'Could not save company settings');}
    finally {setSaving(false);}
  }
  function updateEmail(key:'mode'|'fromAddress'|'fromName',value:string) {
    setSaved(false); setData(current=>current?{...current,email:{...current.email,[key]:value}}:current);
  }
  return <Modal label={`${company.name} settings`} onClose={onClose} dismissible={!saving} className="w-full max-w-2xl p-6">
    <h2 className="text-xl font-bold">{company.name} settings</h2>
    <p className="mt-1 text-sm text-muted-foreground">Only the super admin can change these settings.</p>
    {error&&<div role="alert" className="my-4 text-sm text-destructive">{error} <Button variant="link" disabled={saving} onClick={()=>setReload(v=>v+1)}>Reload settings</Button></div>}
    {!data&&!error&&<p role="status" className="py-6">Loading company settings…</p>}
    {data&&<form onSubmit={save} className="mt-6 space-y-6">
      <fieldset disabled={saving} className="space-y-4">
        <legend className="mb-3 font-semibold">ZeptoMail delivery</legend>
        <label className="block space-y-1 text-sm"><span>Email delivery</span>
          <AppSelect aria-label="Email delivery" value={data.email.mode} onValueChange={value=>updateEmail('mode',value)}>
            <option value="disabled">Disabled</option><option value="custom">Company ZeptoMail account</option>
            {company.orgId==='default'&&<option value="platform">Existing platform email account</option>}
          </AppSelect>
        </label>
        {data.email.mode==='custom'&&<>
          <label className="block space-y-1 text-sm"><span>Sender email address</span><Input required type="email" value={data.email.fromAddress} onChange={e=>updateEmail('fromAddress',e.target.value)}/></label>
          <label className="block space-y-1 text-sm"><span>Sender name</span><Input required maxLength={160} value={data.email.fromName} onChange={e=>updateEmail('fromName',e.target.value)}/></label>
          <label className="block space-y-1 text-sm"><span>ZeptoMail Send Mail token</span><Input type="password" autoComplete="new-password" maxLength={4096} required={!data.email.apiKeyConfigured} value={apiKey} onChange={e=>{setApiKey(e.target.value);setSaved(false);setClearApiKey(false);}} placeholder={data.email.apiKeyConfigured?'Saved securely — leave blank to keep it':'Enter company Send Mail token'}/></label>
          <p className="text-xs text-muted-foreground">Verify this sender’s domain in ZeptoMail. Saving does not send a test email or verify delivery.</p>
        </>}
        {data.email.apiKeyConfigured&&data.email.mode==='disabled'&&<label className="flex items-center gap-2 text-sm"><Checkbox checked={clearApiKey} onCheckedChange={value=>{setClearApiKey(value===true);setSaved(false);}}/>Remove saved API key</label>}
      </fieldset>
      <fieldset disabled={saving}>
        <legend className="font-semibold">Company permissions</legend>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">Allowed activities for this company. Each member’s role and individual access still apply. Super admins retain full access.</p>
        <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          {catalog.map(permission=><label key={permission} className="flex items-center gap-2 text-sm"><Checkbox checked={data.enabledPermissions.includes(permission)} onCheckedChange={checked=>{
            setSaved(false);setData({...data,enabledPermissions:checked?[...data.enabledPermissions,permission]:data.enabledPermissions.filter(p=>p!==permission)});
          }}/><span className="capitalize">{permission.replace(/[._]/g,' ')}</span></label>)}
        </div>
      </fieldset>
      {saved&&<p role="status" className="text-sm text-success">Company settings saved. Permissions apply to subsequent requests.</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Close</Button><Button type="submit" disabled={saving}>{saving?'Saving…':'Save company settings'}</Button></div>
    </form>}
  </Modal>;
}
