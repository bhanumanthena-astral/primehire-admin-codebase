import {useState} from 'react';
import {FileText, Search, Send, CheckCircle2, Code2, Users, MessageCircle, RefreshCw, MousePointer2, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {JobPipeline} from '../lib/hiringApi';
import {JobPipelineDetails} from './JobPipelineDetails';

export const hiringSteps = [
  {key:'resumesUploaded', label:'Resumes uploaded', icon:FileText, note:'All uploaded resume records, including resumes awaiting parsing and profiles created before resume intake was introduced.'},
  {key:'atsTotal', label:'Resumes under ATS', icon:Search, note:'Resumes with completed ATS scores, plus those queued or currently being scored.'},
  {key:'linksSent', label:'Assessment links sent', icon:Send, note:'Delivered invitations and links confirmed as shared by a candidate submission. Generating a link alone does not count as sending it.'},
  {key:'assessmentsCompleted', label:'Assessments completed', icon:CheckCircle2, note:'Candidates who submitted their assessment, including reports still being generated and candidates who have moved to later rounds.'},
  {key:'technical', label:'Technical round', icon:Code2, note:'Candidates who reached this round, including candidates who have advanced to later rounds.'},
  {key:'managerial', label:'Managerial round', icon:Users, note:'Candidates who reached this round, including candidates who have advanced to later rounds.'},
  {key:'hr', label:'HR round', icon:MessageCircle, note:'Candidates who reached this round, including candidates who have advanced to later rounds.'},
] as const;
export type HiringStage = typeof hiringSteps[number]['key'];

const fills = [
  'color-mix(in srgb, var(--primary) 25%, var(--card))',
  'color-mix(in srgb, var(--primary) 48%, var(--card))',
  'color-mix(in srgb, var(--primary) 72%, var(--card))',
  'var(--primary)',
  'color-mix(in srgb, var(--primary) 65%, var(--accent))',
  'var(--accent)',
  'color-mix(in srgb, var(--accent) 68%, var(--foreground))',
];

export function JobHiringProgress({jobId, pipeline, onRefresh}:{jobId:string; pipeline?:JobPipeline|null; onRefresh:()=>void}) {
  const [selected,setSelected]=useState<HiringStage|null>(null);
  const selectedStep=hiringSteps.find(step=>step.key===selected);
  return <section aria-label="Hiring lifecycle progress" className="ehr-rise overflow-hidden rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-muted-foreground">Job hiring pipeline</p><h2 className="mt-1 text-lg font-bold">Hiring progress</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Every stage, from the first resume to the final conversation.</p></div>
      <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw size={14}/>Refresh counts</Button>
    </header>
    <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><MousePointer2 size={14}/><span>Select a stage to explore the records behind its number.</span></div>
    <p className="mt-2 text-[0.6875rem] text-muted-foreground lg:hidden">Swipe across the funnel to explore all seven stages.</p>
    <div className="-mx-2 mt-3 overflow-x-auto pb-2" role="group" aria-label="Interactive hiring funnel">
      <ol className="grid min-w-[840px] grid-cols-7 gap-1 px-2 py-3">
        {hiringSteps.map(({key,label,icon:Icon},index)=>{
          const active=selected===key;
          // Geometry describes the sequence, not a conversion rate: interview stages are current occupancy.
          const left=20+index*12, right=32+index*12;
          return <li key={key} className="min-w-0">
            <button type="button" onClick={()=>setSelected(key)} aria-label={`${label}: ${pipeline?.[key]??'unavailable'}. Show details`}
              aria-pressed={active} aria-controls={selected?'hiring-stage-details':undefined}
              className={`group flex w-full cursor-pointer flex-col items-center rounded-xl px-0.5 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active?'bg-primary/10':'hover:bg-muted/40'}`}>
              <span className="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground">{String(index+1).padStart(2,'0')}</span>
              <span className="mt-2 text-3xl font-bold tracking-tight tabular-nums text-foreground">{pipeline?.[key]?.toLocaleString()??'—'}</span>
              <span className="h-4 w-px bg-border" aria-hidden="true"/>
              <span className="relative flex h-[220px] w-full items-center justify-center">
                <svg aria-hidden="true" viewBox="0 0 140 220" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
                  <polygon points={`2,${left} 138,${right} 138,${220-right} 2,${220-left}`} fill={fills[index]} stroke={active?'var(--foreground)':'var(--border)'} strokeWidth={active?2:0.5} vectorEffect="non-scaling-stroke" className="transition-[filter] group-hover:brightness-95"/>
                </svg>
                <Icon aria-hidden="true" size={20} className="relative" style={{color:index>=5?'var(--accent-foreground)':'var(--primary-foreground)'}}/>
              </span>
              <span className="mt-2 min-h-10 max-w-[125px] px-1 text-xs font-semibold leading-5">{label}</span>
              <span className={`mt-2 rounded-full px-2 py-1 text-[0.6875rem] font-medium ${active?'bg-primary text-primary-foreground':'text-muted-foreground group-hover:text-foreground'}`}>{active?'Viewing details':'View details'}</span>
            </button>
          </li>;
        })}
      </ol>
    </div>
    <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">Resume and assessment stages show totals; interview stages include candidates who have completed each round. Funnel shapes show the sequence, not conversion percentages.</p>
    {selectedStep&&selected&&<section id="hiring-stage-details" aria-label={`${selectedStep.label} details`} className="mt-5 overflow-hidden rounded-xl border border-border bg-background/40">
      <div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
        <div><div className="flex flex-wrap items-center gap-3"><h3 className="text-sm font-bold">{selectedStep.label}</h3><span className="rounded-full bg-primary/20 px-2.5 py-1 text-xs font-bold tabular-nums">{pipeline?.[selected]?.toLocaleString()??'—'}</span></div><p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">{selectedStep.note}</p>
          {pipeline&&selected==='atsTotal'&&<p className="mt-2 text-xs font-semibold">{pipeline.atsScored} scored · {pipeline.atsProcessing} queued or scoring</p>}
          {pipeline&&selected==='linksSent'&&<p className="mt-2 text-xs font-semibold">{pipeline.linksGenerated} links generated · {pipeline.linksSent} confirmed sent or attempted</p>}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close stage details" onClick={()=>setSelected(null)}><X size={16}/></Button>
      </div>
      <JobPipelineDetails key={`${jobId}:${selected}`} jobId={jobId} stage={selected}/>
    </section>}
  </section>;
}
