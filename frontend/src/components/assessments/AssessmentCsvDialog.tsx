import React, { useState } from 'react';
import { Upload, Download, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '@/components/ui/button';
import { assessmentRequest, CsvPreview, ImportSummary, downloadAssessmentTemplate } from '../../lib/assessmentManagementApi';
import { AssessmentPreview } from './AssessmentPreview';

export function AssessmentCsvDialog({onClose,onImported}:{onClose:()=>void;onImported:()=>void}) {
  const [text,setText]=useState(''),[filename,setFilename]=useState(''),[preview,setPreview]=useState<CsvPreview|null>(null),[summary,setSummary]=useState<ImportSummary|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[selected,setSelected]=useState('');
  async function fileSelected(file?:File) {
    if(!file||busy)return;
    setError('');setPreview(null);setSummary(null);setConfirm(false);setText('');setSelected('');
    if(!file.name.toLowerCase().endsWith('.csv')||!file.size||file.size>2_000_000){setError('Choose a non-empty CSV file up to 2 MB.');return;}
    setBusy(true);setFilename(file.name);
    try{const content=await file.text();setText(content);setPreview(await assessmentRequest<CsvPreview>('/csv/validate',{text:content}));}
    catch(cause:any){setError(cause.message||'Could not read this file. Please choose it again.');}finally{setBusy(false);}
  }
  async function submit(){
    if(!preview||busy)return;
    setBusy(true);setError('');
    try{setSummary(await assessmentRequest<ImportSummary>('/csv/import',{text,previewHash:preview.previewHash,confirmed:true}));onImported();setConfirm(false);}
    catch(cause:any){setError(cause.message);}finally{setBusy(false);}
  }
  const valid=preview?.groups.filter(group=>group.status==='valid')||[];
  return <Modal label="Import assessment CSV" onClose={onClose} dismissible={!busy} className="max-w-5xl p-5 sm:p-6">
    <h2 className="text-xl font-bold">Import assessments from CSV</h2>
    <p className="mt-2 text-sm text-muted-foreground">One row per question. Rows with the same Assessment Group ID create one draft. Preview and confirm before importing.</p>
    <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" onClick={downloadAssessmentTemplate}><Download className="mr-2 h-4 w-4"/>Download CSV template</Button></div>
    <label className={`mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-6 text-center focus-within:ring-2 focus-within:ring-ring ${busy?'pointer-events-none opacity-60':''}`}
      onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void fileSelected(event.dataTransfer.files[0]);}}>
      <Upload className="h-7 w-7 text-primary"/><span className="text-sm font-semibold">Drop your assessment CSV here, or choose a file</span><span className="text-xs text-muted-foreground">CSV · 2 MB · Up to 1,000 questions across 100 assessments</span>
      <input aria-label="Assessment CSV file" type="file" accept=".csv,text/csv" disabled={busy} className="sr-only" onChange={event=>{void fileSelected(event.target.files?.[0]);event.target.value='';}}/>
    </label>
    {filename&&<p className="mt-3 flex items-center gap-2 break-all text-sm"><FileSpreadsheet className="h-4 w-4"/>{filename}</p>}
    {busy&&<p role="status" className="mt-4 text-sm">{confirm?'Importing assessment drafts…':'Validating CSV…'}</p>}
    {error&&<p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm">{error}</p>}
    {preview?.fileErrors.map(message=><p role="alert" key={message} className="mt-3 text-sm text-destructive">{message}</p>)}
    {summary?<section aria-label="Assessment import summary" className="mt-5 rounded-xl border border-border bg-primary/5 p-4"><h3 className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4"/>Import complete</h3><p className="mt-2 text-sm">{summary.totalRows} question rows · {summary.totalGroups} assessment groups · {summary.imported} drafts created · {summary.failed} invalid/failed groups · {summary.duplicates} duplicates</p><p className="mt-2 text-xs text-muted-foreground">Successful drafts are saved. Publish each draft after reviewing its questions. No candidate invitations were sent.</p>{summary.items.filter(item=>item.reason).map(item=><p key={item.groupId} className="mt-2 text-sm">{item.groupId}: {item.reason}</p>)}</section>
      :preview&&!preview.fileErrors.length&&<section className="mt-5 space-y-4"><div className="rounded-xl border border-border p-4 text-sm">{preview.rows.length} question rows · {valid.length} valid assessments · {preview.groups.filter(group=>group.status==='invalid').length} invalid groups · {preview.groups.filter(group=>group.status==='duplicate').length} duplicates</div>
        <div className="flex flex-wrap gap-2">{valid.map(group=><Button key={group.groupId} variant={selected===group.groupId?'secondary':'outline'} size="sm" onClick={()=>setSelected(selected===group.groupId?'':group.groupId)}>Preview {group.groupId} ({group.rows.length} questions)</Button>)}</div>
        {valid.find(group=>group.groupId===selected)?.config&&<div className="max-h-80 overflow-y-auto rounded-xl border border-border p-4"><AssessmentPreview config={valid.find(group=>group.groupId===selected)!.config!}/></div>}
        {!!valid.length&&<div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">{confirm?<><p className="text-sm">Create {valid.length} valid assessment drafts? Invalid and duplicate groups will be skipped.</p><Button disabled={busy} onClick={()=>void submit()}>Confirm import</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirm(false)}>Back to validation</Button></>:<Button disabled={busy} onClick={()=>setConfirm(true)}>Review import confirmation</Button>}</div>}
      </section>}
    {(summary?.rows||preview?.rows)?.length>0&&<div className="mt-5 max-h-72 overflow-auto rounded-xl border border-border"><table className="w-full text-left text-xs"><caption className="sr-only">Assessment CSV row validation results</caption><thead className="sticky top-0 bg-muted"><tr>{['Row','Group','Status','Field / reason'].map(value=><th key={value} className="p-3">{value}</th>)}</tr></thead><tbody>{(summary?.rows||preview!.rows).map(row=><tr key={row.row} className="border-t border-border"><td className="p-3">{row.row}</td><td className="p-3">{row.groupId||'Not available'}</td><td className="p-3 capitalize">{row.status}</td><td className="p-3">{row.errors.map((value,index)=><p key={index}>{value.field}: {value.reason}</p>)}</td></tr>)}</tbody></table></div>}
  </Modal>;
}
