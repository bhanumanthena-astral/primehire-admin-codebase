import McqAnswerReview from './McqAnswerReview';
import {normalizeMcq} from '../../utils/mcqReport';
import {useState} from 'react';
import {ChevronLeft,ChevronRight,Code2,HeartPulse,MessagesSquare,CheckCircle2,AlertTriangle} from 'lucide-react';
import {StoredReportEvidence,metricValue,QuestionVideo} from './StoredReportEvidence';
import {jobDate} from '../../lib/jobTimezone';
import type {ReportContent,ReportMetadata,ReportMetric} from '../../lib/reportingApi';
import './interactive-report.css';

// Charts require an explicit source scale.
export function storedPercentage(metric:ReportMetric):number|null {
  return metric.value!==null && metric.maximum!==null && metric.maximum>0
    ? metric.value/metric.maximum*100 : null;
}

function FeedbackList({items,empty}:{items:string[];empty:string}) {
  return items.length?<ul>{items.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p className="report-muted">{empty}</p>;
}

export function InteractiveStoredReport({content,metadata}:{content:ReportContent;metadata:ReportMetadata}) {
  const [view,setView]=useState('technical');
  const [selected,setSelected]=useState(0);
  const [questionIndex,setQuestionIndex]=useState(0);
  const [filter,setFilter]=useState('all');
  const technical=content.skillProfile.filter(metric=>metric.applicable!==false);
  const communication=content.communication.filter(metric=>metric.applicable!==false);
  const metrics=view==='hr'?communication:technical;
  const metric=metrics[selected]??metrics[0];
  const question=content.questions[questionIndex];
  const reviewed=content.questions.filter(q=>q.score!==null).length;
  const words=content.questions.map(q=>q.transcript??'').join(' ').trim().split(/\s+/).filter(Boolean).length;
  const overall=storedPercentage(content.overview);
  const technicalScore=content.feedback.find(m=>m.label==='Technical proficiency');
  const communicationScore=content.feedback.find(m=>m.label==='Communication');
  const questions=content.questions.map((q,index)=>({...q,index})).filter(q=>filter==='all'||(filter==='reviewed'?q.score!==null:q.score===null));
  function changeView(next:string){setView(next);setSelected(0);}
  function nextComponent(delta:number){if(metrics.length)setSelected((selected+delta+metrics.length)%metrics.length);}
  return <div className="replica-report">
    <section className="report-hero" aria-label="Round summary">
      <p className="report-eyebrow">This round</p>
      <div className="report-overall"><strong>{content.overview.value??'—'}</strong>{content.overview.maximum!==null&&<span>/ {content.overview.maximum}</span>}{content.overview.grade&&<span className="report-grade">{content.overview.grade}</span>}</div>
      <div className="report-hero-stats">
        <div><span>Questions</span><strong>{content.questions.length}</strong></div>
        <div><span>Words spoken</span><strong>{words?words+' W':'Unavailable'}</strong></div>
        <div><span>Round</span><strong>{metadata.roundType}</strong></div>
      </div>
      {overall!==null&&<div className="report-progress"><span style={{width:Math.max(0,Math.min(100,overall))+'%'}}/></div>}
      <p className="report-hero-note">Technical depth, communication and question evidence from this round.</p>
    </section>
    <details className="report-setup report-surface">
      <summary><span className="report-logo">{metadata.jobTitle.slice(0,1)}</span><span><strong>{metadata.jobTitle}</strong><span className="report-eyebrow"> · Round setup</span><small>{metadata.candidateName} · {jobDate(metadata.roundCompletedAt??metadata.generatedAt)}</small></span><span className="report-tag">{metadata.roundType}</span></summary>
      <dl>{[['Candidate',metadata.candidateName],['Job',metadata.jobTitle],['Taken on',jobDate(metadata.roundCompletedAt)],['Status',metadata.status],['Version',String(metadata.version)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </details>
    <nav className="report-view-cards" aria-label="Report views">
      {[{id:'technical',label:'Technical depth',hint:technical.length+' components',value:technicalScore?metricValue(technicalScore):'Unavailable',icon:Code2},
        {id:'hr',label:'HR readiness',hint:'Communication breakdown',value:communicationScore?metricValue(communicationScore):'Unavailable',icon:HeartPulse},
        {id:'questions',label:'Question by question',hint:reviewed+' of '+content.questions.length+' questions reviewed',value:String(reviewed),icon:MessagesSquare}].map(item=><button key={item.id} type="button" aria-pressed={view===item.id} className={'report-view-card '+(view===item.id?'is-selected':'')} onClick={()=>changeView(item.id)}>
          <span className="report-view-title"><span className="report-icon"><item.icon size={18}/></span><span><strong>{item.label}</strong><small>{item.hint}</small></span></span>
          <span className="report-view-score">{item.value}</span><span className="report-card-line"/>
        </button>)}
    </nav>
    <section className="report-surface report-detail">
      <header><p className="report-eyebrow">{view==='questions'?'Question by question':view==='hr'?'Communication':'Technical'}</p><h2>{view==='questions'?'What was asked and how the candidate answered':view==='hr'?'Communication and readiness in this round':'Technical depth in this round'}</h2><p className="report-muted">{view==='questions'?'Review the response, transcript and feedback for each question.':'Select a component to explore its score alongside the candidate’s answers.'}</p></header>
      {view==='questions'?<>
        <div className="report-filter" aria-label="Question filters">{[['all','All'],['reviewed','Reviewed'],['pending','Not scored']].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
        <div className="report-filter" aria-label="Choose a question">{questions.map(q=><button key={q.reference} aria-pressed={questionIndex===q.index} onClick={()=>setQuestionIndex(q.index)}>Q{q.index+1}</button>)}</div>
        {!questions.length?<p className="report-muted">No questions match this filter.</p>:question&&<div className="report-question">
          <p className="report-eyebrow">Question {questionIndex+1}</p><h3>{question.question??'Question text unavailable'}</h3><span className="report-tag">{question.score??'Not scored'}{question.maximum!==null?' / '+question.maximum:''}</span>
          {question.type?.toUpperCase()==='MCQ'?<><McqAnswerReview result={normalizeMcq(question.mcqInput??{},content.assessmentQuestions)}/>{question.mediaReference&&<QuestionVideo key={question.reference} reportId={metadata.reportId} version={metadata.version} reference={question.mediaReference}/>}</>:<>
            <QuestionVideo key={question.reference} reportId={metadata.reportId} version={metadata.version} reference={question.mediaReference}/>
            <h4>Candidate response</h4><blockquote>{question.transcript??'Transcript unavailable for this question.'}</blockquote>
          </>}
          <h4>Evaluation</h4><p>{question.aiAnalysis??question.feedback??'Evaluation unavailable for this question.'}</p>
          <div className="report-feedback-grid"><div><h4>Strengths</h4><FeedbackList items={question.strengths} empty="No strengths supplied."/></div><div><h4>Areas for improvement</h4><FeedbackList items={question.areasForImprovement} empty="No improvement feedback supplied."/></div></div>
          {!!question.recommendations.length&&<><h4>Recommendations</h4><FeedbackList items={question.recommendations} empty=""/></>}
        </div>}
      </>:<div className="report-breakdown">
        <p className="report-eyebrow">Breakdown</p><h3>Component breakdown</h3><p className="report-muted">Each segment represents one scored component.</p>
        <div className="report-chart" role="group" aria-label="Interactive component scores">
          <svg viewBox="0 0 420 360" className="report-petals">
            {[60,90,120].map(r=><circle key={r} cx="210" cy="180" r={r} fill="none" stroke="var(--report-border)"/>)}
            {metrics.map((point,index)=>{
              const angle=2*Math.PI/Math.max(metrics.length,1),a=index*angle-Math.PI/2,b=a+angle-.025;
              const percentage=storedPercentage(point);
              const radius=percentage===null?60:60+Math.max(0,Math.min(100,percentage))*.65;
              const x=(r:number,t:number)=>210+r*Math.cos(t),y=(r:number,t:number)=>180+r*Math.sin(t);
              const large=b-a>Math.PI?1:0;
              return <g key={point.label} role="button" tabIndex={0} aria-label={point.label+' '+metricValue(point)} aria-pressed={selected===index} onClick={()=>setSelected(index)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(index);}}}>
                <path d={'M '+x(55,a)+' '+y(55,a)+' L '+x(radius,a)+' '+y(radius,a)+' A '+radius+' '+radius+' 0 '+large+' 1 '+x(radius,b)+' '+y(radius,b)+' L '+x(55,b)+' '+y(55,b)+' A 55 55 0 '+large+' 0 '+x(55,a)+' '+y(55,a)} fill="var(--report-blue)" opacity={selected===index?.85:.22} stroke="var(--report-blue)" strokeWidth={selected===index?2:0}/>
                <text x={x(153,a+angle/2)} y={y(153,a+angle/2)-5} textAnchor="middle" className="report-chart-label">{point.label}</text>
                <text x={x(153,a+angle/2)} y={y(153,a+angle/2)+12} textAnchor="middle" className="report-chart-value">{point.value??'—'}</text>
              </g>;
            })}
            <circle cx="210" cy="180" r="49" fill="var(--report-surface)" stroke="var(--report-border)"/>
            <text x="210" y="175" textAnchor="middle" className="report-chart-label">{view==='hr'?'COMMUNICATION':'THIS ROUND'}</text><text x="210" y="201" textAnchor="middle" className="report-chart-center">{content.overview.value??'—'}</text>
          </svg>
        </div>
        <p className="report-chart-caption">Select a segment to see that component in detail.</p>
        <div className="report-component-controls"><button aria-label="Previous component" onClick={()=>nextComponent(-1)} disabled={!metrics.length}><ChevronLeft size={16}/></button><div>{metrics.map((point,index)=><button key={point.label} aria-pressed={selected===index} onClick={()=>setSelected(index)}>{point.label} <strong>{point.value??'—'}</strong></button>)}</div><button aria-label="Next component" onClick={()=>nextComponent(1)} disabled={!metrics.length}><ChevronRight size={16}/></button></div>
        <div className="report-component-heading"><div><p className="report-eyebrow">Selected component</p><h3>{metric?.label??'No components available'}</h3></div><div className="report-score-ring"><strong>{metric?.value??'—'}</strong><small>{metric?.maximum!==null&&metric?.maximum!==undefined?'/ '+metric.maximum:'Source score'}</small></div></div>
        <div className="report-component-body">
          {metric?.grade&&<span className="report-tag">{metric.grade}</span>}
          <div className="report-proof"><p className="report-eyebrow">Proof from the transcript</p>
            {question?.type?.toUpperCase()==='MCQ'?<McqAnswerReview result={normalizeMcq(question.mcqInput??{},content.assessmentQuestions)}/>:question?<><button className="report-question-link" onClick={()=>setView('questions')}>Open question {questionIndex+1}</button><h4>{question.question??'Question text unavailable'}</h4><blockquote>{question.transcript??'Transcript unavailable for this question.'}</blockquote><p className="report-muted">{question.feedback??question.aiAnalysis}</p></>:<p className="report-muted">Question evidence unavailable.</p>}
          </div>
          <div className="report-feedback-grid"><div><p className="report-eyebrow">Before the next round</p><FeedbackList items={content.aiSummary?.recommendations??[]} empty="Recommendations unavailable from this report."/></div><div><p className="report-eyebrow">Areas for improvement</p><FeedbackList items={content.aiSummary?.areasForImprovement??[]} empty="Improvement feedback unavailable from this report."/></div></div>
        </div>
      </div>}
    </section>
    <div className="report-feedback-grid report-summary-cards"><section className="report-surface"><h3><CheckCircle2 size={17}/> What went well</h3><FeedbackList items={content.aiSummary?.strengths??[]} empty="No strengths supplied in this report."/></section><section className="report-surface"><h3><AlertTriangle size={17}/> What to improve</h3><FeedbackList items={content.aiSummary?.areasForImprovement??[]} empty="No improvement feedback supplied in this report."/></section></div>
    <details className="report-surface report-transcript"><summary><span className="report-eyebrow">Full transcript</span><strong>{content.questions.filter(q=>q.transcript).length} responses from this round</strong></summary>{content.questions.map((q,index)=>q.transcript&&<section key={q.reference}><h4>Q{index+1} · {q.question}</h4><p>{q.transcript}</p></section>)}</details>
    <details className="report-surface report-transcript"><summary>Stored evidence and question recordings</summary><StoredReportEvidence content={content} reportId={metadata.reportId} version={metadata.version}/></details>
  </div>;
}
