import React, {useEffect, useState} from 'react';
import {ArrowUpDown, ChevronDown, ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {TableColumnSettings} from './TableColumnSettings';
import {useTableColumnSettings} from '../lib/useTableColumnSettings';
import type {Capabilities, IntakeItem} from '../lib/resumeIntakeApi';
import type {ResumeSelection} from './ResumeBulkSelection';
import type {Job} from '../lib/hiringApi';
import {IntakeStatus, readableStatus, ResumeProfileDialog} from './ResumeProfileDialog';
const REVIEW_COLUMNS=[{key:'name',label:'Name',required:true},{key:'designation',label:'Current designation'},{key:'score',label:'ATS score'},...['Skills','Experience','Education','Keyword','Role'].map(label=>({key:label.toLowerCase(),label})),{key:'matched',label:'Matched skills'},{key:'missing',label:'Missing skills'},{key:'evaluation',label:'Evaluation'},{key:'notes',label:'Evaluation notes'},{key:'status',label:'Status / eligibility'}];
const selectionLabels={within:'Within ATS range',below:'Below minimum · retained',above:'Above maximum · retained',pending:'ATS pending',score_failed:'ATS failed',range_required:'Choose ATS range',already_created:'Candidate already created'};
function educationText(item:IntakeItem) {
  const education=Array.isArray(item.profile.education)?item.profile.education:[];
  const degrees=['ug','pg','doctorate'].flatMap(level=>[item.profile[`${level}Degree`],item.profile[`${level}Specialization`],item.profile[`${level}University`]]).filter(value=>typeof value==='string'&&value);
  return [...new Set([...education,...degrees])].join(' · ')||'Education not available';
}
export function ResumeReviewTable({items,caps,jobs,busy,onOpen,onRetry,onDelete,onChanged,onAssociated,selection,preferenceKey}:{items:IntakeItem[];caps:Capabilities;jobs:Job[];busy:boolean;onOpen:(id:string)=>void;onRetry:(item:IntakeItem)=>void;onDelete:(item:IntakeItem)=>void;onChanged:()=>void;onAssociated:(id:string)=>void;selection?:ResumeSelection;preferenceKey?:string}) {
  const columns=useTableColumnSettings(REVIEW_COLUMNS,preferenceKey);
  const columnCount=columns.visible.length+2+(selection?1:0);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [sort,setSort]=useState<'name'|'score'>('name'),[descending,setDescending]=useState(false);
  useEffect(()=>{if(expanded&&!items.some(item=>item.itemId===expanded))setExpanded(null);},[items,expanded]);
  const rows=[...items].sort((a,b)=>{
    if(sort==='score'){
      if(a.ats?.overall==null)return b.ats?.overall==null?0:1;
      if(b.ats?.overall==null)return -1;
      return (a.ats.overall-b.ats.overall)*(descending?-1:1);
    }
    return (a.profile.name||a.fileName).localeCompare(b.profile.name||b.fileName,undefined,{numeric:true})*(descending?-1:1);
  });
  function heading(key:'name'|'score',label:string){return <TableHead aria-sort={sort===key?(descending?'descending':'ascending'):'none'}><Button variant="ghost" size="sm" onClick={()=>{if(sort===key)setDescending(value=>!value);else{setSort(key);setDescending(key==='score');}}}>{label}<ArrowUpDown size={13}/></Button></TableHead>;}
  function renderCell(item:IntakeItem,key:string){const open=expanded===item.itemId;switch(key){
    case 'name':return <TableCell className="min-w-48 max-w-72 whitespace-normal"><button className="cursor-pointer text-left font-semibold hover:underline" aria-expanded={open} onClick={()=>setExpanded(open?null:item.itemId)}>{item.profile.name||'Awaiting name extraction'}</button><p className="mt-1 max-w-64 truncate text-xs text-muted-foreground" title={item.fileName}>{item.fileName}</p>{item.error&&<p className="mt-1 text-xs text-destructive">{item.error}</p>}</TableCell>;
    case 'designation':return <TableCell className="min-w-44 max-w-64 whitespace-normal text-xs">{item.profile.currentDesignation||'Not available'}</TableCell>;
    case 'score':return <TableCell className="tabular-nums"><p className="font-bold">{item.ats?`${item.ats.overall} / 100`:'Not scored'}</p><p className="mt-1 text-xs text-muted-foreground">{item.ats?.category||readableStatus(item.atsState||'pending')}</p>{item.atsStale&&<p className="mt-1 text-xs text-warning">Recalculate needed</p>}</TableCell>;
    case 'matched':return <TableCell className="min-w-56 max-w-72 whitespace-normal text-xs leading-relaxed">{item.ats?.matchedSkills?.join(', ')||'None confirmed'}</TableCell>;
    case 'missing':return <TableCell className="min-w-56 max-w-72 whitespace-normal text-xs leading-relaxed">{item.ats?.missingSkills?.join(', ')||(item.ats?'No listed skill gaps':'Not evaluated')}</TableCell>;
    case 'evaluation':return <TableCell className="min-w-44 max-w-64 whitespace-normal text-xs">{item.ats?<><p>{item.ats.llmStatus==='done'?'LLM evaluation':`Local evaluation · ${readableStatus(item.ats.llmStatus||'local_rules')}`}</p>{item.ats.localOverall!=null&&<p className="mt-1 text-muted-foreground">Local comparison: {item.ats.localOverall}/100</p>}{item.ats.needsReview&&<p className="mt-1 font-semibold text-warning">Reviewer attention required. Check the evaluation notes before making a hiring decision.</p>}</>:<span className="text-muted-foreground">Evaluation pending</span>}</TableCell>;
    case 'notes':return <TableCell className="min-w-80 max-w-96 whitespace-normal text-xs leading-relaxed">{item.ats?<><ul className="list-disc space-y-1 pl-4">{[...(item.ats.llmReasons||[]),...item.ats.strengths,...item.ats.gaps].map((note,index)=><li key={index}>{note}</li>)}</ul><p className="mt-2 text-muted-foreground">{item.ats.note}</p></>:<span className="text-muted-foreground">Evaluation pending</span>}</TableCell>;
    case 'status':return <TableCell className="min-w-40 whitespace-normal"><IntakeStatus status={item.status}/>{item.atsSelection&&<p className="mt-2 text-xs text-muted-foreground">{selectionLabels[item.atsSelection.state]}</p>}</TableCell>;
    default:return <TableCell className={`${key==='education'?'min-w-56 max-w-72':'min-w-28'} whitespace-normal text-xs`}>
            <p className="font-semibold tabular-nums">{item.ats?.breakdown?.[key]==null?'Not assessed':`${item.ats.breakdown[key]}/100`}</p>
            {key==='experience'&&item.profile.experienceYears!=null&&<p className="mt-1 text-muted-foreground">{item.profile.experienceYears} years</p>}
            {key==='education'&&<p className="mt-1 leading-relaxed text-muted-foreground">{educationText(item)}</p>}
          </TableCell>;
  }}
  return <div className="px-5 pb-5"><div className="mb-3 flex justify-end"><TableColumnSettings settings={columns}/></div><p className="mb-3 text-xs text-muted-foreground">Use Columns to choose and arrange the information you need. Sort by name or ATS score, or expand a row for resume versions and assignment controls.</p>
    <Table aria-label="Resume and ATS review"><TableHeader><TableRow>{selection&&<TableHead className="w-10"><input type="checkbox" aria-label="Select all resumes on this page" disabled={busy||!rows.some(item=>item.status!=='deleted')} checked={rows.some(item=>item.status!=='deleted')&&rows.filter(item=>item.status!=='deleted').every(item=>selection.ids.has(item.itemId))} onChange={selection.togglePage}/></TableHead>}<TableHead className="w-10"><span className="sr-only">Details</span></TableHead>{columns.visible.map(column=><React.Fragment key={column.key}>{column.key==='name'||column.key==='score'?heading(column.key,column.label):<TableHead>{column.label}</TableHead>}</React.Fragment>)}<TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {rows.map(item=>{const open=expanded===item.itemId;return <React.Fragment key={item.itemId}>
        <TableRow className={open?'bg-primary/10':undefined}>
          {selection&&<TableCell><input type="checkbox" aria-label={`Select resume ${item.fileName}`} disabled={busy||item.status==='deleted'} checked={selection.ids.has(item.itemId)} onChange={()=>selection.toggle(item)}/></TableCell>}
          <TableCell><Button variant="ghost" size="icon" aria-label={`${open?'Collapse':'Expand'} ATS details for ${item.profile.name||item.fileName}`} aria-expanded={open} aria-controls={open?`resume-details-${item.itemId}`:undefined} onClick={()=>setExpanded(open?null:item.itemId)}>{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</Button></TableCell>
          {columns.visible.map(column=><React.Fragment key={column.key}>{renderCell(item,column.key)}</React.Fragment>)}
          <TableCell><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={()=>onOpen(item.itemId)}>{caps.canUpload&&['review_required','duplicate_suspected'].includes(item.status)?'Review profile':'View profile'}</Button>{caps.canUpload&&['scan_required','ocr_required','conversion_required','failed','confirmation_paused'].includes(item.status)&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>onRetry(item)}>Retry</Button>}{caps.canAdmin&&item.status!=='deleted'&&<Button variant="ghost" size="sm" disabled={busy} className="text-muted-foreground hover:text-destructive" onClick={()=>onDelete(item)}>Delete resume</Button>}</div></TableCell>
        </TableRow>
        {open&&<TableRow id={`resume-details-${item.itemId}`} className="bg-background/40 hover:bg-background/40"><TableCell colSpan={columnCount} className="max-w-0 p-0"><ResumeProfileDialog embedded item={item} caps={{...caps,canUpload:caps.canUpload&&item.canEdit!==false,canAssign:caps.canAssign&&item.canEdit!==false}} jobs={jobs} onClose={()=>setExpanded(null)} onChanged={onChanged} onAssociated={onAssociated}/></TableCell></TableRow>}
      </React.Fragment>;})}
      {!rows.length&&<TableRow><TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">No resumes match these filters.</TableCell></TableRow>}
    </TableBody></Table>
  </div>;
}
