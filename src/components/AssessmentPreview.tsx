import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, Clock, Eye, Loader2, Lock } from 'lucide-react';
import type { AssessmentProfile } from '../types';
import { formatUtcAsIst } from '../utils/istSchedule';
import { Panel, SectionHeader } from './ui/primitives';

export type AssessmentDraft = Pick<AssessmentProfile,
  'jobId' | 'jobTitle' | 'jobDescription' | 'language' | 'roundType' | 'questions' | 'startDate' | 'endDate'>;

export default function AssessmentPreview({ draft, saving, onBack, onConfirm }: {
  draft: AssessmentDraft;
  saving: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const scored = draft.roundType !== 'HR';
  useEffect(() => {
    window.scrollTo(0, 0);
    previewRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section ref={previewRef} tabIndex={-1} aria-label="Assessment preview" className="space-y-6 outline-none">
      <SectionHeader eyebrow="Step 2 of 2 · Review" title="Preview your assessment"
        subtitle="Check every detail before confirming. You can return to the form to make corrections now."
        icon={<Eye className="h-5 w-5" />} />
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>After creation, the assessment details and questions cannot be edited. To change them later, create a new assessment.</p>
      </div>

      <Panel className="space-y-5">
        <h3 className="break-words text-lg font-semibold">{draft.jobTitle}</h3>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          {[['Job ID', draft.jobId], ['Round', draft.roundType], ['Language', draft.language],
            ['Questions', String(draft.questions.length)],
            ['Total answer time', `${draft.questions.reduce((sum, q) => sum + q.maxDuration, 0)} seconds`],
            ...(scored ? [['Total weightage', `${draft.questions.reduce((sum, q) => sum + (q.weightage || 0), 0)}%`]] : []),
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
        </dl>
        <div><h4 className="text-xs font-medium text-muted-foreground">Job description</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{draft.jobDescription}</p></div>
        <div className="border-t border-border pt-4 text-sm">
          <h4 className="mb-2 font-medium">Assessment window (IST)</h4>
          <p>Start: {draft.startDate ? formatUtcAsIst(draft.startDate) : 'Not set'}</p>
          <p>End: {draft.endDate ? formatUtcAsIst(draft.endDate) : 'Not set'}</p>
          {!draft.startDate && !draft.endDate && <p className="mt-2 text-xs text-muted-foreground">Schedule interview windows when assigning candidates.</p>}
        </div>
      </Panel>

      <div className="space-y-4">
        <h3 className="text-base font-semibold">Questions and answers</h3>
        {draft.questions.map((q, index) => (
          <article key={q.id || index}><Panel className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-primary">Question {index + 1}</span>
              <span>· {q.type === 'MCQ' ? 'Multiple choice' : 'Spoken answer'}</span>
              <span>· {q.maxDuration} seconds</span>
              {scored && <><span>· Maximum score: {q.maxScore}</span><span>· Weightage: {q.weightage}%</span></>}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed">{q.text}</p>
            {q.type === 'MCQ' ? (
              <ol className="space-y-2">
                {(q.options || []).map((option, optionIndex) => {
                  const correct = optionIndex === q.options?.indexOf(q.correctOption || '');
                  return <li key={optionIndex} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${correct ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-border'}`}>
                    <span className="font-semibold">{String.fromCharCode(65 + optionIndex)}.</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{option}</span>
                    {correct && <span className="flex shrink-0 items-center gap-1 text-xs font-semibold"><CheckCircle className="h-4 w-4" aria-hidden="true" /> Correct</span>}
                  </li>;
                })}
              </ol>
            ) : (draft.roundType === 'TECHNICAL' || draft.roundType === 'BASIC') && (
              <div className="rounded-lg bg-muted/40 p-4">
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{draft.roundType === 'TECHNICAL' ? 'Reference answer' : 'Grading criteria / rubric'}</h4>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{draft.roundType === 'TECHNICAL' ? q.referenceAnswer : q.criteria}</p>
              </div>
            )}
          </Panel></article>
        ))}
      </div>

      <Panel className="space-y-5">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>After setup succeeds, a five-minute preparation buffer allows time for question audio generation. Candidate creation will unlock automatically. Refreshing this page will not restart the wait.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" checked={reviewed} disabled={saving} onChange={e => setReviewed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
          <span>I have reviewed the details, questions and answers. I understand this assessment cannot be edited after creation.</span>
        </label>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" disabled={saving} onClick={onBack} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-semibold hover:bg-muted disabled:opacity-50"><ArrowLeft className="h-4 w-4" /> Back to form</button>
          <button type="button" disabled={!reviewed || saving} onClick={onConfirm} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            {saving ? 'Creating assessment…' : 'Confirm and create assessment'}
          </button>
        </div>
      </Panel>
    </section>
  );
}
