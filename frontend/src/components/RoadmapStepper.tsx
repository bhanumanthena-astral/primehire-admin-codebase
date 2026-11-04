import React from 'react';

export interface Step {
  key: string;
  label: string;
  status: 'done' | 'current' | 'todo' | 'skipped';
  detail?: string;
}

/**
 * Data-driven roadmap stepper. The parent feeds an ordered step list;
 * this component never hardcodes stage names (pipeline amendment replaces
 * the interview aggregate later without touching this file).
 */
export default function RoadmapStepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Recruitment roadmap">
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <li aria-hidden className="px-1 opacity-40">→</li>}
          <li
            title={s.detail}
            aria-current={s.status === 'current' ? 'step' : undefined}
            className={
              'rounded-full border px-2.5 py-1 text-xs ' +
              (s.status === 'done'
                ? 'border-[var(--success)]/40 bg-[var(--success-soft)]'
                : s.status === 'current'
                  ? 'border-[var(--ring)] bg-[var(--primary-soft)] font-semibold'
                  : s.status === 'skipped'
                    ? 'border-dashed opacity-60 line-through'
                    : 'opacity-60')
            }
          >
            {s.status === 'done' ? '✓ ' : ''}{s.label}
          </li>
        </React.Fragment>
      ))}
    </ol>
  );
}

/** Coarse applicant roadmap derived from currentStage (no round numbers). */
export function stepsForStage(currentStage: string): Step[] {
  const flow = [
    { key: 'RESUME_UPLOADED', label: 'Resume' },
    { key: 'PARSED', label: 'Parsed' },
    { key: 'SHORTLISTED', label: 'Shortlisted' },
    { key: 'ASSESSMENT_SENT', label: 'Assessment Sent' },
    { key: 'ASSESSMENT_COMPLETED', label: 'Assessment Done' },
    { key: 'INTERVIEWS', label: 'Interviews' },
    { key: 'OFFER', label: 'Offer' },
    { key: 'HIRED', label: 'Hired' },
  ];
  const interviewStages = new Set([
    'ROUND1_PENDING_ASSIGNMENT', 'ROUND1_SCHEDULED', 'ROUND1_REVIEW_PENDING',
    'ROUND2_PENDING_ASSIGNMENT', 'ROUND2_SCHEDULED', 'ROUND2_REVIEW_PENDING',
    'HR_ROUND',
  ]);
  const branch = new Set(['TALENT_POOL', 'REJECTION_PENDING_HR_REVIEW', 'REJECTED', 'ON_HOLD', 'WITHDRAWN']);
  const normalized = interviewStages.has(currentStage) ? 'INTERVIEWS' : currentStage;
  const idx = flow.findIndex((s) => s.key === normalized);
  const steps: Step[] = flow.map((s, i) => ({
    ...s,
    status: idx === -1 ? 'todo' : i < idx ? 'done' : i === idx ? 'current' : 'todo',
  }));
  if (branch.has(currentStage)) {
    steps.push({ key: currentStage, label: prettyStage(currentStage), status: 'current' });
  }
  return steps;
}

function prettyStage(stage: string): string {
  return stage.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}
