import {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {ArrowDown, ArrowUp, ArrowUpDown, CheckCheck, Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ElasticRangeSlider} from '../ElasticRangeSlider';
import {Application, Job, Page, recruitmentRequest, stageLabel} from '../../lib/recruitmentApi';

type Props={job?:Job; canShortlist:boolean; readOnly:boolean; onChanged:()=>void};
type Sort='name'|'ats'|'stage'|'status'|'score';
type BulkResult={shortlistedIds:string[];failed:{applicationId:string;message:string}[]};
const columns:[Sort,string][]=[['name','Candidate'],['ats','ATS score'],['stage','Pipeline stage'],['status','Assessment status'],['score','Assessment score']];
const eligible=(row:Application)=>row.currentStage==='ASSESSMENT_COMPLETED'&&!row.developerShortlist&&!!row.assessment;

export function DeveloperAssessments(props:Props){
  return <DeveloperAssessmentTable key={props.job?.jobId||'none'} {...props}/>;
}
function DeveloperAssessmentTable({job,canShortlist,readOnly,onChanged}:Props){
  const navigate=useNavigate();
  const [page,setPage]=useState(0),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
  const [result,setResult]=useState<Page<Application>>({items:[],total:0}),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [sort,setSort]=useState<Sort>('name'),[descending,setDescending]=useState(false);
  const [scoreField,setScoreField]=useState<'assessment'|'ats'>('assessment'),[range,setRange]=useState([0,100]);
  const [filter,setFilter]=useState(''),[selected,setSelected]=useState<Map<string,string>>(new Map());
  const [message,setMessage]=useState('');
  const action=useRef<AbortController|null>(null);
  useEffect(()=>()=>action.current?.abort(),[]);
  const rangeQuery=`scoreField=${scoreField}&minimum=${range[0]}&maximum=${range[1]}`;
  const selectionAllowed=canShortlist&&!readOnly;
  useEffect(()=>{
    setResult({items:[],total:0});
    if(!job)return;
    const controller=new AbortController();setLoading(true);
    void recruitmentRequest<Page<Application>>(`/applications?jobId=${encodeURIComponent(job.jobId)}&skip=${page*50}&limit=50&sortBy=${sort}&descending=${descending}${filter?`&${filter}`:''}`,undefined,'GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted)setResult(value);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[job?.jobId,page,revision,sort,descending,filter]);
  function applyRange(next:string){setFilter(next);setPage(0);setSelected(new Map());setMessage('');setError('');}
  function toggle(row:Application,checked:boolean){setSelected(previous=>{const next=new Map(previous);if(checked)next.set(row.applicationId,row.candidate.name);else next.delete(row.applicationId);return next;});}
  async function selectRange(){
    if(!job||!selectionAllowed)return;
    const controller=new AbortController();action.current=controller;
    setBusy(true);setError('');setMessage('');
    try{
      const matches=new Map<string,string>();
      for(let skip=0;;skip+=100){
        const rows=await recruitmentRequest<Page<Application>>(`/applications?jobId=${encodeURIComponent(job.jobId)}&${rangeQuery}&stage=ASSESSMENT_COMPLETED&sortBy=name&skip=${skip}&limit=100`,undefined,'GET',controller.signal);
        if(controller.signal.aborted)return;
        rows.items.filter(eligible).forEach(row=>matches.set(row.applicationId,row.candidate.name));
        if(skip+rows.items.length>=rows.total||!rows.items.length)break;
      }
      setFilter(rangeQuery);setPage(0);setSelected(matches);
      setMessage(`${matches.size} eligible candidates selected across all pages. Review your selection, then shortlist.`);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not select candidates in range.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  async function shortlist(ids:string[]){
    if(!selectionAllowed||!ids.length)return;
    const controller=new AbortController();action.current=controller;
    setBusy(true);setError('');setMessage('');
    const completed:string[]=[];const failures:string[]=[];
    try{
      for(let offset=0;offset<ids.length;offset+=100){
        const response=await recruitmentRequest<BulkResult>('/applications/shortlist-bulk',{applicationIds:ids.slice(offset,offset+100)},'POST',controller.signal);
        completed.push(...response.shortlistedIds);
        failures.push(...response.failed.map(item=>`${selected.get(item.applicationId)||'Candidate'}: ${item.message}`));
        if(controller.signal.aborted)return;
      }
      if(failures.length)setError(`${failures.length} candidates were not shortlisted. ${failures.slice(0,3).join(' ')}${failures.length>3?' Review the remaining selection and retry.':''}`);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Shortlisting failed. Refresh before retrying.');}
    finally{
      if(!controller.signal.aborted){
        setSelected(previous=>{const next=new Map(previous);completed.forEach(id=>next.delete(id));return next;});
        setMessage(`${completed.length} candidates shortlisted. Administrators can now schedule their developer interviews.`);
        setRevision(n=>n+1);setBusy(false);if(completed.length)onChanged();
      }
    }
  }
  if(!job)return <p className="rounded-xl border p-6">Choose an assigned job above to review its details and assessments. Ask an administrator to assign a developer in Job Details if none appear.</p>;
  const pageEligible=result.items.filter(eligible);
  const allPageSelected=pageEligible.length>0&&pageEligible.every(row=>selected.has(row.applicationId));
  return <section aria-label="Developer assessment review" className="space-y-5">
    <article className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-bold">{job.title}</h2>
      <p className="text-sm text-muted-foreground">{job.companyName||'Company not specified'} · {job.lifecycleStatus||'Status unavailable'} · {job.positionsFilled??0} of {job.positionsTotal??'—'} positions filled</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">{[['Role',job.jobRole],['Department',job.department],['Location',job.location],['Work mode',job.workMode],['Experience',`${job.minExperienceYears??'—'}–${job.maxExperienceYears??'—'} years`],['Assessment',job.assessmentJobId],['Round',job.assessmentRoundType]].map(([label,value])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value||'Not specified'}</dd></div>)}</dl>
      <p className="text-sm">Skills: {job.keywords?.join(', ')||'Not specified'}</p>
      <details><summary className="cursor-pointer font-semibold">Job description</summary><p className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{job.jdText||'No job description available.'}</p></details>
    </article>
    <header><h2 className="text-xl font-bold">Candidate assessments</h2><p className="text-sm text-muted-foreground">Compare scores, review reports, and shortlist candidates for an administrator to schedule your developer round.</p></header>
    <section aria-label="Candidate score range" className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm font-medium">Score to filter <select aria-label="Score to filter" className="ml-2 rounded-md border bg-background px-3 py-2" value={scoreField} disabled={busy} onChange={event=>setScoreField(event.target.value as 'ats'|'assessment')}><option value="assessment">Assessment score</option><option value="ats">ATS score</option></select></label><output className="text-xl font-semibold tabular-nums">{range[0]}–{range[1]}%</output></div>
      <ElasticRangeSlider value={range} onChange={setRange} disabled={busy} label={`${scoreField==='ats'?'ATS':'assessment'} score`}/>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium">Minimum (%)<Input aria-label="Minimum score percentage" className="mt-1 w-24" type="number" min={0} max={range[1]} value={range[0]} disabled={busy} onChange={e=>{if(e.target.value!=='')setRange([Math.max(0,Math.min(range[1],Math.round(Number(e.target.value)))),range[1]]);}}/></label>
        <label className="text-xs font-medium">Maximum (%)<Input aria-label="Maximum score percentage" className="mt-1 w-24" type="number" min={range[0]} max={100} value={range[1]} disabled={busy} onChange={e=>{if(e.target.value!=='')setRange([range[0],Math.min(100,Math.max(range[0],Math.round(Number(e.target.value))))]);}}/></label>
        <Button variant="outline" disabled={busy} onClick={()=>applyRange(rangeQuery)}>Apply range</Button>
        {canShortlist&&<Button variant="outline" disabled={busy||readOnly} onClick={()=>void selectRange()}>Select all in range</Button>}
        {filter&&<Button variant="ghost" disabled={busy} onClick={()=>applyRange('')}>Clear range filter</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Both endpoints are included. Candidates without a score are excluded from range results. Only completed assessments awaiting developer review can be selected.</p>
      {filter&&<p className="text-xs font-medium">Applied: {new URLSearchParams(filter).get('scoreField')==='ats'?'ATS':'Assessment'} score {new URLSearchParams(filter).get('minimum')}–{new URLSearchParams(filter).get('maximum')}%</p>}
    </section>
    {canShortlist&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-sm font-medium">{selected.size} selected across all pages</p><div className="flex gap-2"><Button variant="ghost" disabled={!selected.size||busy} onClick={()=>setSelected(new Map())}>Clear selection</Button><Button disabled={!selected.size||busy||readOnly} onClick={()=>void shortlist([...selected.keys()])}>{busy?<Loader2 className="size-4 animate-spin"/>:<CheckCheck className="size-4"/>}Shortlist selected{selected.size?` (${selected.size})`:''}</Button></div></div>}
    {message&&<p role="status" className="text-sm">{message}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error} <Button variant="outline" disabled={busy} onClick={()=>setRevision(n=>n+1)}>Refresh candidates</Button></p>}
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[850px] text-left text-sm" aria-label="Candidate assessments" aria-busy={loading}>
        <thead className="border-b bg-muted/60"><tr>
          <th scope="col" className="w-12 p-4"><input type="checkbox" aria-label="Select eligible candidates on this page" disabled={!selectionAllowed||busy||loading||!pageEligible.length} checked={allPageSelected} ref={node=>{if(node)node.indeterminate=!allPageSelected&&pageEligible.some(row=>selected.has(row.applicationId));}} onChange={e=>{const checked=e.target.checked;setSelected(previous=>{const next=new Map(previous);pageEligible.forEach(row=>{if(checked)next.set(row.applicationId,row.candidate.name);else next.delete(row.applicationId);});return next;});}}/></th>
          {columns.map(([key,label])=><th scope="col" key={key} aria-sort={sort===key?(descending?'descending':'ascending'):'none'} className="px-4 py-3"><button type="button" disabled={busy||loading} className="inline-flex items-center gap-1 whitespace-nowrap rounded py-1 font-semibold focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>{setSort(key);setDescending(sort===key?!descending:false);setPage(0);}}>{label}{sort===key?(descending?<ArrowDown className="size-3.5"/>:<ArrowUp className="size-3.5"/>):<ArrowUpDown className="size-3.5 text-muted-foreground"/>}</button></th>)}
          <th scope="col" className="px-4 py-3">Actions</th>
        </tr></thead>
        <tbody className="divide-y">{loading?<tr><td colSpan={7} className="p-8 text-center" role="status">Loading assessments…</td></tr>:result.items.map(row=><tr key={row.applicationId} className={selected.has(row.applicationId)?'bg-primary/5':'hover:bg-muted/25'}>
          <td className="p-4"><input type="checkbox" aria-label={`Select ${row.candidate.name}`} checked={selected.has(row.applicationId)} disabled={!selectionAllowed||busy||!eligible(row)} onChange={e=>toggle(row,e.target.checked)}/></td>
          <th scope="row" className="px-4 py-4 font-medium">{row.candidate.name}{row.developerShortlist&&<span className="mt-1 block text-xs font-normal text-primary">Developer shortlisted</span>}</th>
          <td className="px-4 py-4 tabular-nums">{row.atsScore!=null?`${row.atsScore}%`:'Pending'}</td>
          <td className="px-4 py-4">{stageLabel(row.currentStage)}</td>
          <td className="px-4 py-4 capitalize">{(row.assessment?.status||'Not invited').replaceAll('_',' ')}</td>
          <td className="px-4 py-4 font-medium tabular-nums">{row.assessment?.score!=null?`${row.assessment.score}%`:'Pending'}</td>
          <td className="px-4 py-4"><div className="flex flex-col items-start gap-2"><Button size="sm" variant="outline" disabled={!row.assessment} onClick={()=>navigate(`/reports/applications/${encodeURIComponent(row.applicationId)}`)}>View assessment reports</Button>{canShortlist&&eligible(row)&&<Button size="sm" variant="ghost" disabled={busy||readOnly} onClick={()=>void shortlist([row.applicationId])}>Shortlist for interview</Button>}</div></td>
        </tr>)}{!loading&&!result.items.length&&<tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{error?'Candidates could not be loaded.':'No candidates match this view.'}</td></tr>}</tbody>
      </table>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{result.total?`${page*50+1}–${Math.min((page+1)*50,result.total)} of ${result.total}`:'0'} candidates</span><div className="flex gap-2"><Button variant="outline" disabled={!page||loading||busy} onClick={()=>setPage(n=>n-1)}>Previous assessments</Button><Button variant="outline" disabled={(page+1)*50>=result.total||loading||busy} onClick={()=>setPage(n=>n+1)}>Next assessments</Button></div></footer>
  </section>;
}
