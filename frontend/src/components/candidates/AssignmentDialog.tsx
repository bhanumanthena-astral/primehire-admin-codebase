import React,{useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {AppSelect} from '../ui/AppSelect';
import {Modal} from '../ui/Modal';
import {Application,AvailableAssessment,Person,Assignment,Page,candidateRequest,candidateTime,inputIST,isoIST} from '../../lib/candidateManagementApi';

export function AssignmentDialog({person,editing,onClose,onSaved}:{person:Person;editing?:Assignment;onClose:()=>void;onSaved:()=>void}){
  const [assessments,setAssessments]=useState<AvailableAssessment[]>([]),[applications,setApplications]=useState<Application[]>([]);
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[total,setTotal]=useState(0),[appPage,setAppPage]=useState(0),[appTotal,setAppTotal]=useState(0);
  const [selected,setSelected]=useState<AvailableAssessment|null>(null),[application,setApplication]=useState(editing?.applicationId||'');
  const [start,setStart]=useState(editing?inputIST(editing.startDate):inputIST(new Date(Date.now()+15*60000))),[end,setEnd]=useState(editing?inputIST(editing.endDate):inputIST(new Date(Date.now()+86400000)));
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    void Promise.all([editing?Promise.resolve({items:[],total:0}):candidateRequest<Page<AvailableAssessment>>(`/assessments?search=${encodeURIComponent(search)}&skip=${page*20}`,undefined,'GET',controller.signal),
      candidateRequest<Page<Application>>(`/${encodeURIComponent(person.candidateId)}/applications?skip=${appPage*20}`,undefined,'GET',controller.signal)])
      .then(([available,apps])=>{if(!controller.signal.aborted){setAssessments(available.items);setTotal(available.total);setApplications(apps.items);setAppTotal(apps.total);}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[page,search,appPage,retry]);
  function validate(){
    if(!editing&&!selected){setError('Select an available assessment');return false;}
    if(!editing&&appTotal>0&&!application){setError('Select the correct candidate job application');return false;}
    if(!start||!end||Date.parse(isoIST(start))<Date.now()||Date.parse(isoIST(end))<=Date.parse(isoIST(start))){setError('Choose a future Start Date and an End Date later than Start Date');return false;}
    setError('');return true;
  }
  async function submit(){if(busy||!validate())return;setBusy(true);try{
    const body={startDate:isoIST(start),endDate:isoIST(end)};
    if(editing)await candidateRequest(`/${encodeURIComponent(person.candidateId)}/assignments/${editing.assignmentId}/dates`,{...body,expectedRevision:editing.revision},'PUT');
    else await candidateRequest(`/${encodeURIComponent(person.candidateId)}/assignments`,{...body,assessmentId:selected!.assessmentId,applicationId:application||null,confirmed:true});
    onSaved();
  }catch(cause:any){setError(cause.message);}finally{setBusy(false);}}
  return <Modal label={editing?'Configure assessment dates':'Assign assessment'} onClose={onClose} dismissible={!busy} className="max-w-2xl p-5 sm:p-7"><h3 className="text-xl font-bold">{review?'Confirm assessment assignment':editing?'Configure assessment dates':'Assign an assessment'}</h3><div className="my-4 rounded-xl border border-border bg-muted/30 p-4"><p className="font-semibold">{person.profile.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">Candidate ID: {person.candidateId}</p><p className="mt-1 text-sm text-muted-foreground">{person.profile.email||'Email not available'}</p></div>
    {loading?<p role="status">Loading available assessments and job applications…</p>:review?<div className="space-y-3 text-sm"><p className="font-semibold">{editing?.assessmentTitle||selected?.title}</p><p>Assessment ID: {editing?.assessmentId||selected?.assessmentId}</p><p>Application: {application||'No associated application'}</p><p>Start: {candidateTime(isoIST(start))}</p><p>End: {candidateTime(isoIST(end))}</p><p className="rounded-xl bg-primary/10 p-3">This saves the assignment only. Generate and share its link separately when ready.</p></div>:<div className="space-y-4">
      {!editing&&<><label className="block text-sm font-medium">Find an assessment<Input className="mt-1" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}} placeholder="Search assessment title or ID"/></label><label className="block text-sm font-medium">Assessment *<AppSelect aria-label="Available assessment" value={selected?.assessmentId||''} onValueChange={value=>{const record=assessments.find(a=>a.assessmentId===value)||null;setSelected(record);if(record?.startDate&&Date.parse(record.startDate)>Date.now()+15*60000)setStart(inputIST(record.startDate));if(record?.endDate&&Date.parse(record.endDate)<Date.parse(isoIST(end)))setEnd(inputIST(record.endDate));}}><option value="">Select a published assessment</option>{selected&&!assessments.some(a=>a.assessmentId===selected.assessmentId)&&<option value={selected.assessmentId}>{selected.title}</option>}{assessments.map(a=><option key={a.assessmentId} value={a.assessmentId}>{a.title} · {a.roundType}</option>)}</AppSelect></label>{!assessments.length&&<p className="text-sm text-muted-foreground">No available assessments match your search and permissions.</p>}{total>20&&<div className="flex items-center gap-3 text-xs"><Button variant="outline" size="sm" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous assessments</Button><span>Page {page+1}</span><Button variant="outline" size="sm" disabled={(page+1)*20>=total} onClick={()=>setPage(p=>p+1)}>Next assessments</Button></div>}
      {selected&&<dl className="grid gap-2 rounded-xl bg-muted/30 p-3 text-xs sm:grid-cols-2"><div>Language: {selected.language||'Not available'}</div><div>Round: {selected.roundType||'Not available'}</div><div>Questions: {selected.questionCount}</div><div>Available until: {candidateTime(selected.endDate)}</div></dl>}
      {appTotal>0&&<><label className="block text-sm font-medium">Associated job application *<AppSelect aria-label="Associated application" value={application} onValueChange={setApplication}><option value="">Select this candidate’s application</option>{application&&!applications.some(a=>a.applicationId===application)&&<option value={application}>{application}</option>}{applications.map(a=><option key={a.applicationId} value={a.applicationId}>{a.jobTitle||a.jobId} · {a.applicationId}</option>)}</AppSelect></label>{appTotal>20&&<div className="flex gap-2"><Button variant="outline" size="sm" disabled={!appPage} onClick={()=>setAppPage(p=>p-1)}>Previous applications</Button><Button variant="outline" size="sm" disabled={(appPage+1)*20>=appTotal} onClick={()=>setAppPage(p=>p+1)}>Next applications</Button></div>}</>}
      </>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Start Date and time (IST) *<Input className="mt-1" type="datetime-local" required min={inputIST(new Date())} value={start} onChange={event=>setStart(event.target.value)}/></label><label className="text-sm font-medium">End Date and time (IST) *<Input className="mt-1" type="datetime-local" required min={start} value={end} onChange={event=>setEnd(event.target.value)}/></label></div><p className="text-xs text-muted-foreground">The assessment is accessible only during this window. Dates lock when its link is generated.</p>
    </div>}
    {error&&<div role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{error}{loading===false&&!assessments.length&&!editing&&<Button variant="outline" className="ml-2" onClick={()=>setRetry(v=>v+1)}>Retry loading</Button>}</div>}
    <div className="mt-5 flex flex-wrap gap-2">{review?<><Button disabled={busy} onClick={()=>void submit()}>{busy?'Saving…':editing?'Confirm dates':'Confirm assignment'}</Button><Button variant="outline" disabled={busy} onClick={()=>setReview(false)}>Back to configuration</Button></>:<Button disabled={loading||busy} onClick={()=>{if(validate())setReview(true);}}>Review assignment</Button>}<Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button></div>
  </Modal>;
}
