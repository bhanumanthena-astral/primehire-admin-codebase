import React from 'react';
import { Config, assessmentTime } from '../../lib/assessmentManagementApi';

export function AssessmentPreview({ config }: { config: Config }) {
  return <div className="space-y-5">
    <div><h3 className="break-words text-lg font-bold">{config.jobTitle}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{config.jobId}</p></div>
    <dl className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2">{[
      ['Language',config.language],['Round',config.roundType],['Start date',assessmentTime(config.startDate)],['End date',assessmentTime(config.endDate)],
    ].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>
    <section><h4 className="text-sm font-semibold">Job description</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{config.jobDescription}</p></section>
    <section className="space-y-3"><h4 className="font-semibold">Questions ({config.questions.length})</h4>{config.questions.map((question,index)=><article key={question.id} className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>Question {index+1} · {question.type}</span><span>{question.maxDuration}s{config.roundType!=='HR'&&` · Max score ${question.maxScore} · Weight ${question.weightage}%`}</span></div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium">{question.text}</p>
      {question.type==='MCQ'&&<ul className="mt-3 space-y-1">{question.options?.map(option=><li key={option} className={`rounded-lg p-2 text-sm ${option===question.correctOption?'bg-primary/15 font-semibold':'bg-muted/30'}`}>{option}{option===question.correctOption?' · Correct answer':''}</li>)}</ul>}
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground"><strong className="text-foreground">Expected reference answer: </strong>{question.referenceAnswer||question.criteria||question.correctOption||'Not available'}</p>
    </article>)}</section>
    {config.roundType==='HR'&&<p className="text-xs text-muted-foreground">HR assessments preserve the existing unscored question format.</p>}
  </div>;
}
