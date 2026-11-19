import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import type {CsvPreview,CsvRow} from '../../lib/assessmentManagementApi';
import {useState} from 'react';

const sharedFields=['Job Title','Job Description','Language Selection','Round Type','Start Date','End Date'];
const choices:Record<string,string[]>={
 'Language Selection':['ENGLISH','DUTCH'],
 'Round Type':['BASIC','TECHNICAL','HR'],
 'Question Type':['SPEAK_TO_ANSWER','MCQ'],
};
const labels:Record<string,string>={SPEAK_TO_ANSWER:'Spoken answer',MCQ:'Multiple choice',BASIC:'Basic',TECHNICAL:'Technical',HR:'HR',ENGLISH:'English',DUTCH:'Dutch'};

export function AssessmentCsvCorrections({preview,busy,onChange}:{preview:CsvPreview;busy:boolean;onChange:(rows:number[],field:string,value:string)=>void}){
 const [groupId,setGroupId]=useState(()=>preview.groups.find(group=>group.status==='invalid')?.groupId||preview.groups[0]?.groupId);
 const [questionRow,setQuestionRow]=useState<number>();
 const group=preview.groups.find(group=>group.groupId===groupId)||preview.groups[0];
 const rows=preview.rows.filter(row=>group?.rows.includes(row.row));
 const current=rows.find(row=>row.row===questionRow)||rows[0];
 if(!current)return null;
 function field(header:string,row:CsvRow,shared=false){
  const value=row.values?.[header]??'';
  const common={disabled:busy,'aria-invalid':row.errors.some(error=>error.field===header)||undefined,value,onChange:(event:any)=>onChange(shared?rows.map(item=>item.row):[row.row],header,event.target.value)};
  return <label key={header} className={'min-w-0 space-y-1 text-sm '+(header==='Job Description'||header==='Question Prompt / Text'||header==='Expected Reference Answer'?'sm:col-span-2':'')}>
   <span className="block font-medium">{header}</span>
   {choices[header]?<select {...common} className="w-full rounded-lg border border-input bg-background p-2.5" aria-label={header}>
    {!choices[header].includes(value)&&<option value={value}>{value||'Choose a value'}</option>}
    {choices[header].map(option=><option key={option} value={option}>{labels[option]||option}</option>)}
   </select>:['Job Description','Question Prompt / Text','Expected Reference Answer'].includes(header)?<Textarea {...common} rows={3} aria-label={header}/>:<Input {...common} aria-label={header} placeholder={header.endsWith('Date')?'YYYY-MM-DD or DD/MM/YYYY':undefined}/>}
  </label>;
 }
 return <details className="rounded-xl border border-border bg-card p-4">
  <summary className="cursor-pointer font-semibold">Edit CSV values before importing</summary>
  <div className="mt-4 space-y-5">
   <p className="text-sm text-muted-foreground">Correct the fields here, then validate corrections. Dates accept YYYY-MM-DD or DD/MM/YYYY (day first). Your original file is not changed.</p>
   <label className="block space-y-1 text-sm font-medium">Assessment to correct<select aria-label="Assessment to correct" disabled={busy} value={group?.groupId} onChange={event=>{setGroupId(event.target.value);setQuestionRow(undefined)}} className="block w-full rounded-lg border border-input bg-background p-2.5">
    {preview.groups.map(item=><option key={item.groupId} value={item.groupId}>{item.groupId} · {item.rows.length} questions · {item.status}</option>)}
   </select></label>
   <section className="space-y-3"><h3 className="font-semibold">Assessment details</h3><p className="text-xs text-muted-foreground">These fields update all {rows.length} questions in this assessment together.</p><div className="grid gap-3 sm:grid-cols-2">{sharedFields.filter(header=>preview.columns?.includes(header)).map(header=>field(header,rows[0],true))}</div></section>
   <section className="space-y-3 border-t border-border pt-4"><h3 className="font-semibold">Question details</h3>
    <label className="block space-y-1 text-sm font-medium">Question to correct<select aria-label="Question to correct" disabled={busy} value={current.row} onChange={event=>setQuestionRow(Number(event.target.value))} className="block w-full rounded-lg border border-input bg-background p-2.5">
     {rows.map(row=><option key={row.row} value={row.row}>Row {row.row} · {(row.values?.['Question Prompt / Text']||'Untitled question').slice(0,80)}</option>)}
    </select></label>
    <div className="grid gap-3 sm:grid-cols-2">{preview.columns?.filter(header=>!sharedFields.includes(header)&&header!=='Assessment Group ID').map(header=>field(header,current))}</div>
   </section>
  </div>
 </details>;
}
