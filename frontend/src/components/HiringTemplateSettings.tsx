import {toast} from 'sonner';
import {CheckCircle2,Loader2} from 'lucide-react';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {workflowRequest,templatePreview,type HiringPreferences,type HiringTemplate} from '../lib/hiringWorkflow';
import {useAuth} from '../lib/authContext';
const categories={rejection:'Rejection Email',candidate_reminder:'Candidate-side reminder',company_reminder:'Company-side reminder',report_share:'Company-side report sharing'};
export function HiringTemplateSettings(){
 const {user}=useAuth();
 const [settings,setSettings]=useState<HiringPreferences|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{void workflowRequest('/settings').then(setSettings).catch(e=>setError(e.message));},[]);
 if(!['super_admin','admin','hr'].includes(user?.role||''))return null;
 async function save(defaultId=settings?.defaultRejectionId){if(!settings||busy)return;setNotice('');if(settings.templates.some(template=>!template.name.trim()||!template.subject.trim()||!template.body.trim())){setError("Each template needs a name, subject and email body.");return;}setBusy(true);setError('');try{setSettings(await workflowRequest('/settings',{templates:settings.templates,defaultRejectionId:defaultId,expectedRevision:settings.revision},'PUT'));setNotice('Hiring email templates saved successfully.');toast.success('Hiring email templates saved successfully.');}catch(e){const message=(e as Error).message;setError(message);toast.error('Templates were not saved', {description:message});}finally{setBusy(false);}}
 function change(id:string,patch:Partial<HiringTemplate>){setNotice('');setSettings(s=>s?{...s,templates:s.templates.map(t=>t.id===id?{...t,...patch}:t)}:s);}
 return <section className="space-y-4 rounded-2xl border p-5" aria-label="Hiring email templates"><h2 className="text-lg font-semibold">Hiring email templates</h2>
 <p className="text-sm text-muted-foreground">Templates are saved for your company. Variables include candidate_name, job_title, company, application_reference, hr_contact, report_summary, round_type, start_time and meeting_link, enclosed in double braces.</p>
 {!settings&&!error&&<p role="status">Loading company templates…</p>}{!settings&&error&&<Button variant="outline" onClick={()=>{setError('');void workflowRequest('/settings').then(setSettings).catch(e=>setError(e.message));}}>Retry settings</Button>}
 {settings?.templates.map(template=><details key={template.id} className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">{template.name} · {categories[template.category]}{settings.defaultRejectionId===template.id?' · Default rejection email':''}</summary><div className="mt-4 grid gap-3">
 <label>Name<Input disabled={busy} value={template.name} onChange={e=>change(template.id,{name:e.target.value})}/></label>
 <label>Category<select disabled={busy} className="block rounded border p-2" value={template.category} onChange={e=>change(template.id,{category:e.target.value as HiringTemplate['category']})}>{Object.entries(categories).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <label>Subject<Input disabled={busy} value={template.subject} onChange={e=>change(template.id,{subject:e.target.value})}/></label>
 <label>Email body<Textarea disabled={busy} value={template.body} onChange={e=>change(template.id,{body:e.target.value})}/></label>
 <details><summary>Email preview</summary><p className="text-xs text-muted-foreground">Example values</p><h3>{templatePreview(template.subject)}</h3><p className="whitespace-pre-wrap">{templatePreview(template.body)}</p></details>
 {template.category==='rejection'&&<Button variant="outline" disabled={busy} onClick={()=>void save(template.id)}>Set as Default Rejection Email</Button>}
 </div></details>)}
 <div className="sticky bottom-0 space-y-3 rounded-xl border bg-background p-3 shadow-sm">{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0"/>{notice}</p>}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!settings||busy} onClick={()=>{setNotice('');setSettings(s=>s?{...s,templates:[...s.templates,{id:crypto.randomUUID(),name:'New hiring template',category:'rejection',subject:'Application update for {{job_title}}',body:'Dear {{candidate_name}},\nThank you for your interest in {{company}}.'}]}:s);}}>Add hiring template</Button><Button disabled={!settings||busy} onClick={()=>void save()}>{busy&&<Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin"/>}{busy?'Saving…':'Save hiring templates'}</Button></div></div>
 </section>;
}
