import McqAnswerReview from './McqAnswerReview';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import type {NormalizedReport,Insights} from '../../utils/normalizeReport';
import {getRadarPoints} from '../../utils/reportMetrics';
import {TECHNICAL_RADAR_AXES,COMM_RADAR_AXES} from '../../utils/reportConfig';
import QuestionReview from './QuestionReview';
import TranscriptPanel from './TranscriptPanel';
import InsightPanels from './InsightPanels';
import ProctoringAudit from './ProctoringAudit';

export default function RoundReport({report,insights}:{report:NormalizedReport;insights:Insights}) {
  const [tab,setTab]=useState('technical');
  const [selected,setSelected]=useState(0);
  const [question,setQuestion]=useState(0);
  const [filter,setFilter]=useState('all');
  const technical=getRadarPoints(report.overall,TECHNICAL_RADAR_AXES);
  const communication=getRadarPoints(report.overall,COMM_RADAR_AXES);
  const points=tab==='hr'?communication:technical;
  const metric=points[selected]??points[0];
  const questions=report.questions.filter(q=>filter==='all'||(filter==='evaluated'?q.percentage!==null:q.percentage===null));
  const transcript=report.questions.map(q=>q.transcript).filter(Boolean).join('\n\n');
  const proof=report.questions[question]??report.questions[0];
  const score=(value:number|null|undefined)=>value==null?'Not evaluated':Math.round(value)+'/100';
  return <div className="space-y-6">
    <section className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3" aria-label="Round summary">
      {[['This round',score(report.overall.overallScore)],['Questions',String(report.questions.length)],['Reviewed',String(report.questions.filter(q=>q.percentage!==null).length)]].map(([label,value])=><div key={label} className="bg-card p-5"><p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}
    </section>
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Round setup · {report.meta.roundType}</summary>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">{Object.entries({'Job':report.meta.jobId,'Candidate':report.meta.candidateId,'Submitted':report.meta.submittedAt,'Status':report.meta.status}).map(([label,value])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value||'Unavailable'}</dd></div>)}</dl>
    </details>
    <nav className="grid gap-3 sm:grid-cols-3" aria-label="Report views">
      {[['technical','Technical depth',score(report.overall.overallScore)],['hr','HR readiness',score(report.overall.communication?.overall_score??report.overall.communication?.overallScore)],['questions','Question by question',report.questions.length+' questions']].map(([id,label,value])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setSelected(0)}} className={'rounded-xl border p-5 text-left transition '+(tab===id?'border-primary bg-primary/10':'bg-card hover:bg-muted')}><span className="block font-semibold">{label}</span><span className="mt-2 block text-sm text-muted-foreground">{value}</span></button>)}
    </nav>
    {tab==='questions'?<section className="space-y-4"><h2 className="text-xl font-semibold">What was asked and how the candidate answered</h2>
      <div className="flex gap-2">{['all','evaluated','pending'].map(value=><Button key={value} variant={filter===value?'default':'outline'} onClick={()=>{setFilter(value);setQuestion(0)}}>{value}</Button>)}</div>
      {questions.length?<QuestionReview questions={questions} selectedIndex={Math.min(question,questions.length-1)} onSelect={setQuestion}/>:<p>No questions match this filter.</p>}
    </section>:<section className="space-y-4">
      <div><p className="text-xs uppercase tracking-widest text-primary">{tab==='hr'?'HR readiness':'Technical'}</p><h2 className="mt-1 text-2xl font-semibold">{tab==='hr'?'Communication and confidence':'Technical depth in this round'}</h2></div>
      {points.length?<div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5"><h3 className="font-semibold">Component breakdown</h3>
          <svg viewBox="0 0 400 400" className="mx-auto w-full max-w-md" role="group" aria-label="Interactive component scores">
            {[40,80,120].map(r=><circle key={r} cx="200" cy="200" r={r} fill="none" stroke="var(--border)"/>)}
            {points.map((p,i)=>{
              const angle=Math.PI*2/points.length;
              const a=i*angle-Math.PI/2,b=a+angle*.88;
              const radius=58+Math.max(0,Math.min(100,p.value??0))*.9;
              const x=(r:number,t:number)=>200+r*Math.cos(t),y=(r:number,t:number)=>200+r*Math.sin(t);
              return <g key={p.key} role="button" tabIndex={0} aria-label={p.label+' '+score(p.value)} aria-pressed={selected===i} className="cursor-pointer focus:outline-none" onClick={()=>setSelected(i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(i)}}}>
                <path d={'M '+x(50,a)+' '+y(50,a)+' L '+x(radius,a)+' '+y(radius,a)+' A '+radius+' '+radius+' 0 0 1 '+x(radius,b)+' '+y(radius,b)+' L '+x(50,b)+' '+y(50,b)+' A 50 50 0 0 0 '+x(50,a)+' '+y(50,a)} fill="var(--primary)" opacity={selected===i?1:.35} stroke={selected===i?'var(--foreground)':'var(--background)'} strokeWidth="2"/>
                <text x={x(174,a+angle*.44)} y={y(174,a+angle*.44)} textAnchor="middle" fill="var(--foreground)" fontSize="10">{p.label}</text>
              </g>;
            })}
            <circle cx="200" cy="200" r="45" fill="var(--card)"/><text x="200" y="204" textAnchor="middle" fill="var(--foreground)" fontSize="19">{metric?.value==null?'—':Math.round(metric.value)}</text>
          </svg>
          <div className="flex flex-wrap gap-2">{points.map((p,i)=><Button key={p.key} size="sm" variant={selected===i?'default':'outline'} onClick={()=>setSelected(i)}>{p.label} {p.value}</Button>)}</div>
        </div>
        <div className="space-y-5 rounded-2xl border bg-card p-6">
          <div className="flex justify-between"><Button variant="outline" onClick={()=>setSelected((selected+points.length-1)%points.length)}>Previous component</Button><Button variant="outline" onClick={()=>setSelected((selected+1)%points.length)}>Next component</Button></div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Selected component</p><h3 className="text-2xl font-semibold">{metric?.label}</h3><p className="text-4xl font-semibold text-primary">{score(metric?.value)}</p>
          <p className="text-sm text-muted-foreground">Score provided by the assessment evaluation. Question transcripts below can be reviewed alongside the overall component score.</p>
          <h4 className="text-sm font-semibold">Interview answer review</h4>
          {proof?.mcq?<><p className="text-sm">{proof.question}</p><McqAnswerReview result={proof.mcq}/></>:proof?<><p className="text-sm">{proof.question}</p><blockquote className="border-l-2 border-primary pl-4 text-sm">{proof.transcript||'Transcript unavailable for this question.'}</blockquote><p className="text-sm">{proof.message}</p><Button variant="outline" onClick={()=>setTab('questions')}>Open question {proof.index+1}</Button></>:<p>Question evidence unavailable.</p>}
        </div>
      </div>:<p className="rounded-xl border p-5">These metrics have not been evaluated.</p>}
      {tab==='hr'&&<p className="text-sm text-muted-foreground">Behavioural competencies and speaking pace are unavailable in this report payload.</p>}
    </section>}
    <InsightPanels insights={insights}/>
    <details className="rounded-xl border p-5"><summary className="cursor-pointer font-semibold">Full transcript · {report.questions.length} questions</summary><div className="mt-4"><TranscriptPanel text={transcript||null}/></div></details>
    <details className="rounded-xl border p-5"><summary className="cursor-pointer font-semibold">Assessment integrity</summary><div className="mt-4"><ProctoringAudit violations={report.violations}/></div></details>
  </div>;
}
